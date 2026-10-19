// Snapshot codec: each snapshot is sent as a binary diff against the previous one sent to the same player.
// Used by the server (encode) and the browser (decode). Decoding gives exactly what JSON.parse(JSON.stringify(data))
// would, so the client handles snapshots the same way whichever transport is used.
//
// Wire format: [flags] [tick] [entities] [section ops] [section bodies] [extra keys]
//  flags: bit 0 = keyframe (no previous state is used; the decoder starts fresh).
//  entities: rows of integers keyed by id (row[0]). Each row sends a mask of the fields that changed since the last row
//   with that id, then the changes as zigzag varints. Rows that are not all safe integers fall back to JSON.
//  sections: the other snapshot keys (KEYS below), 2 bits each: absent, same as last sent, or a diff against the last
//   value sent for that key. Diffs recurse through arrays and objects; integers and cents-exact numbers send a delta,
//   anything else sends JSON. Keys not in KEYS (new ones the codec doesn't know yet) are sent as JSON at the end.
// The decoder only stays in step if it sees every snapshot, in order: when one is dropped, the next must be a keyframe.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SnapCodec=factory();})(typeof self!=='undefined'?self:this,function(){
'use strict';
const KEYS=['g','vip','rd','ev','vj','cl','b','bm','c','r','bus','k','wc','mk','fx','me','pf','mm','lb','names'];
const KNOWN=new Set(['t','tk','e',...KEYS]);
// one-off events: never diffed, and not kept (they may hold anything the sim passes to an effect)
const VOLATILE=new Set(['fx','pf']);
const OP_ABSENT=0,OP_SAME=1,OP_DIFF=2;
// node types (low 3 bits of a node's tag byte; the high 5 bits hold a small payload, 31 = a varint follows)
const T_INT=0,T_CENT=1,T_JSON=2,T_ARR=3,T_OBJ=4;
const TE=new TextEncoder(),TD=new TextDecoder();
// (v|0)===v first: Number.isSafeInteger is slow in JavaScriptCore, and nearly every value is a small integer
const isInt=v=>(v|0)===v||Number.isSafeInteger(v);
const isCent=v=>typeof v==='number'&&Math.abs(v)<1e12&&Math.round(v*100)/100===v;
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nullish=v=>v===null||v===undefined||(typeof v==='number'&&!Number.isFinite(v));
const json=v=>v===undefined?'null':JSON.stringify(v);
// equality as JSON sees it (undefined, NaN and Infinity all become null; object keys holding undefined are dropped)
function deq(a,b){
 if(a===b)return true;
 if(nullish(a)||nullish(b))return nullish(a)&&nullish(b);
 if(typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)){if(!Array.isArray(b)||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(!deq(a[i],b[i]))return false;return true;}
 if(Array.isArray(b))return false;
 for(const k in a){const v=a[k];if(v===undefined)continue;const w=b[k];if(w===undefined||!deq(v,w))return false;}
 for(const k in b)if(b[k]!==undefined&&a[k]===undefined)return false;
 return true;}

// ------------------------------------------------------------------ bytes
class Writer{
 constructor(){this.b=new Uint8Array(8192);this.n=0;}
 need(k){if(this.n+k>this.b.length){const nb=new Uint8Array(Math.max(this.b.length*2,this.n+k));nb.set(this.b.subarray(0,this.n));this.b=nb;}}
 u8(v){this.need(1);this.b[this.n++]=v;}
 uv(v){this.need(8);while(v>=128){this.b[this.n++]=(v%128)|128;v=Math.floor(v/128);}this.b[this.n++]=v;}
 sv(v){this.uv(v<0?-2*v-1:2*v);}
 tag(type,v){if(v<31)this.u8(type|v<<3);else{this.u8(type|31<<3);this.uv(v-31);}}
 bytes(u){this.need(u.length);this.b.set(u,this.n);this.n+=u.length;}
 // a T_JSON node: the tag holds the byte length
 jstr(s){let ascii=true;for(let i=0;i<s.length;i++)if(s.charCodeAt(i)>127){ascii=false;break;}
  if(!ascii){const u=TE.encode(s);this.tag(T_JSON,u.length);this.bytes(u);return;}
  this.tag(T_JSON,s.length);this.need(s.length);for(let i=0;i<s.length;i++)this.b[this.n++]=s.charCodeAt(i);}
 str(s){const n=s.length;this.need(n+8);const at=this.n;this.uv(n);const p=this.n;
  for(let i=0;i<n;i++){const c=s.charCodeAt(i);if(c>127){this.n=at;const u=TE.encode(s);this.uv(u.length);this.bytes(u);return;}this.b[p+i]=c;}
  this.n=p+n;}
}
class Reader{
 constructor(b){this.b=b;this.i=0;}
 u8(){if(this.i>=this.b.length)throw new Error('snapshot truncated');return this.b[this.i++];}
 uv(){let v=0,m=1,c;do{c=this.u8();v+=(c&127)*m;m*=128;}while(c&128);return v;}
 sv(){const z=this.uv();return z%2?-(z+1)/2:z/2;}
 str(){const n=this.uv();if(this.i+n>this.b.length)throw new Error('snapshot truncated');const s=TD.decode(this.b.subarray(this.i,this.i+n));this.i+=n;return s;}
}
const zz=d=>d<0?-2*d-1:2*d,unzz=z=>z%2?-(z+1)/2:z/2;

// ------------------------------------------------------------------ value diffs
// writes cur as a diff against prev; returns the number of changes found (0 = nothing written: they are equal).
// Only arrays and objects can come out equal here: callers check single values before calling.
function encNode(w,prev,cur){
 if(typeof cur==='number'&&typeof prev==='number'){
  if(isInt(cur)&&isInt(prev)&&isInt(cur-prev)){w.tag(T_INT,zz(cur-prev));return 1;}
  if(isCent(cur)&&isCent(prev)){w.tag(T_CENT,zz(Math.round(cur*100)-Math.round(prev*100)));return 1;}}
 else if(Array.isArray(cur)&&Array.isArray(prev)){
  // one pass: the change count goes in a 1-byte slot that is widened afterwards in the rare case it needs more
  const start=w.n;w.tag(T_ARR,cur.length);const at=w.n;w.u8(0);
  let n=0,last=-1;for(let i=0;i<cur.length;i++)if(!deq(prev[i],cur[i])){w.uv(i-last-1);last=i;n++;encNode(w,prev[i],cur[i]);}
  if(!n&&cur.length===prev.length){w.n=start;return 0;}
  if(n<128)w.b[at]=n;else{const end=w.n;let extra=0;for(let v=n;v>=128;v=Math.floor(v/128))extra++;w.need(extra);w.b.copyWithin(at+1+extra,at+1,end);w.n=at;w.uv(n);w.n=end+extra;}
  return n||1;}
 else if(isObj(cur)&&isObj(prev)){
  const ch=[],rm=[];
  for(const k in cur){const v=cur[k];if(v===undefined)continue;const p=prev[k];if(p===undefined||!deq(p,v))ch.push(k);}
  for(const k in prev)if(prev[k]!==undefined&&cur[k]===undefined)rm.push(k);
  if(!ch.length&&!rm.length)return 0;
  w.tag(T_OBJ,ch.length);for(const k of ch){w.str(k);encNode(w,prev[k],cur[k]);}
  w.uv(rm.length);for(const k of rm)w.str(k);
  return ch.length+rm.length;}
 w.jstr(json(cur));return 1;}
// returns a new value (prev is never modified; unchanged parts are shared with it)
function decNode(r,prev){
 const t=r.u8(),type=t&7;let v=t>>3;if(v===31)v=31+r.uv();
 if(type===T_INT)return prev+unzz(v);
 if(type===T_CENT)return(Math.round(prev*100)+unzz(v))/100;
 if(type===T_JSON){if(r.i+v>r.b.length)throw new Error('snapshot truncated');const s=TD.decode(r.b.subarray(r.i,r.i+v));r.i+=v;return JSON.parse(s);}
 if(type===T_ARR){if(!Array.isArray(prev))throw new Error('bad array diff');const a=prev.slice(0,v);while(a.length<v)a.push(null);
  let i=-1;for(let n=r.uv();n>0;n--){i+=r.uv()+1;a[i]=decNode(r,a[i]);}return a;}
 if(type===T_OBJ){if(!isObj(prev))throw new Error('bad object diff');const o={...prev};
  for(let n=v;n>0;n--){const k=r.str();o[k]=decNode(r,o[k]);}for(let n=r.uv();n>0;n--)delete o[r.str()];return o;}
 throw new Error('bad node type '+type);}
// deep copy, so what the game does with a decoded snapshot can't touch the decoder's state
const clone=v=>Array.isArray(v)?v.map(clone):isObj(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])):v;

// ------------------------------------------------------------------ encoder (one per player)
const W=new Writer();
// sections that are the same object for every player of a room (see keep() in sim.js) are encoded once per prev/cur
// pair: the last diff of each section is remembered (a WeakMap here makes garbage collection several times slower)
const MEMO=KEYS.map(()=>({prev:null,cur:null,bytes:null}));
function createEncoder(){
 let st=null; // {ents:Map id->row, sec:Map key->value}, null until the first snapshot or after reset()
 function encode(data){
  const key=!st;if(key)st={ents:new Map(),sec:new Map()};
  const w=W;w.n=0;w.u8(key?1:0);w.uv(data.tk);
  // entities
  const rows=data.e||[],ents=new Map(),L=rows.length?rows[0].length:0;w.uv(L);w.uv(rows.length);
  for(const row of rows){
   const id=isInt(row[0])&&row[0]>=0?row[0]:0;w.uv(id);
   let ok=row.length===L;for(let i=0;ok&&i<L;i++)if(!isInt(row[i]))ok=false;
   if(!ok){w.uv(1);w.str(json(row));ents.set(id,null);continue;}
   let prev=ents.get(id)||st.ents.get(id);if(!prev||prev.length!==L)prev=null;
   let mask=0;if(L<=31){for(let i=1;i<L;i++)if(row[i]!==(prev?prev[i]:0))mask|=1<<i;mask>>>=0;}else for(let i=1;i<L;i++)if(row[i]!==(prev?prev[i]:0))mask+=2**i;
   w.uv(mask);for(let i=1;i<L;i++){const d=row[i]-(prev?prev[i]:0);if(d)w.sv(d);}
   ents.set(id,row);}
  for(const[id,v]of ents)if(v===null)ents.delete(id);
  st.ents=ents;
  // sections
  const opAt=w.n,nOps=Math.ceil(KEYS.length/4);w.need(nOps);for(let i=0;i<nOps;i++)w.b[w.n++]=0;
  for(let k=0;k<KEYS.length;k++){
   const name=KEYS[k],cur=data[name];if(cur===undefined)continue;
   const prev=VOLATILE.has(name)?undefined:st.sec.get(name);let op;
   const m=MEMO[k];
   if(prev!==undefined&&prev===cur)op=OP_SAME;
   else if(prev!==undefined&&m.cur===cur&&m.prev===prev){op=OP_DIFF;w.bytes(m.bytes);}
   else if(prev!==undefined&&(cur===null||typeof cur!=='object')&&deq(prev,cur))op=OP_SAME;
   else{const s=w.n;
    if(!encNode(w,prev,cur))op=OP_SAME;
    else{op=OP_DIFF;if(prev!==undefined&&!VOLATILE.has(name)){m.prev=prev;m.cur=cur;m.bytes=w.b.slice(s,w.n);}}}
   if(!VOLATILE.has(name))st.sec.set(name,cur);
   w.b[opAt+(k>>2)]|=op<<((k&3)*2);}
  // keys the codec doesn't know about
  const extra=[];for(const k in data)if(!KNOWN.has(k)&&data[k]!==undefined)extra.push(k);
  w.uv(extra.length);for(const k of extra){w.str(k);w.str(json(data[k]));}
  return w.b.subarray(0,w.n);}
 // encode() returns a view of a scratch buffer shared by all encoders: use or copy it before the next encode()
 return{encode,reset(){st=null;},get keyframe(){return!st;}};}

// ------------------------------------------------------------------ decoder (one per connection)
function createDecoder(){
 let st=null;
 function decode(buf){
  const r=new Reader(buf instanceof Uint8Array?buf:new Uint8Array(buf));
  const key=r.u8()&1;if(!key&&!st)throw new Error('delta snapshot without a keyframe');
  // work on a copy of the state, so a bad snapshot leaves nothing half-applied
  const prev=key?{ents:new Map(),sec:new Map()}:st,sec=new Map(prev.sec);
  const o={t:'s',tk:r.uv()};
  const L=r.uv(),E=[],ents=new Map();
  for(let n=r.uv();n>0;n--){
   const id=r.uv(),mask=r.uv();
   if(mask===1){E.push(JSON.parse(r.str()));ents.set(id,null);continue;}
   const base=ents.get(id)||prev.ents.get(id),row=new Array(L);row[0]=id;
   for(let i=1;i<L;i++){const p=base&&base.length===L?base[i]:0;row[i]=(L<=31?(mask>>>i)&1:Math.floor(mask/2**i)%2)?p+r.sv():p;}
   ents.set(id,row);E.push(row.slice());}
  for(const[id,v]of ents)if(v===null)ents.delete(id);
  o.e=E;
  const opAt=r.i;r.i+=Math.ceil(KEYS.length/4);if(r.i>r.b.length)throw new Error('snapshot truncated');
  for(let k=0;k<KEYS.length;k++){
   const op=(r.b[opAt+(k>>2)]>>((k&3)*2))&3,name=KEYS[k];if(op===OP_ABSENT)continue;
   let v;
   if(op===OP_SAME){v=sec.get(name);if(v===undefined)throw new Error('no previous '+name);}
   else if(op===OP_DIFF)v=decNode(r,VOLATILE.has(name)?undefined:sec.get(name));
   else throw new Error('bad op');
   if(!VOLATILE.has(name))sec.set(name,v);
   o[name]=clone(v);}
  for(let n=r.uv();n>0;n--){const k=r.str();o[k]=JSON.parse(r.str());}
  st={ents,sec};return o;}
 return{decode,reset(){st=null;}};}

return{createEncoder,createDecoder,KEYS};
});


