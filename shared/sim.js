// Authoritative game simulation. Runs on the Node server (one instance per room) and in the browser for offline practice.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./world.js'));else root.Sim=factory(root.World);})(typeof self!=='undefined'?self:this,function(Wd){
'use strict';
const {TAU,clamp,d2,dist,hypot,angDiff,norm,ZONE,JM,WORLD,GATE_DEFS,CHECKS,ASSEMBLY,PSTATIONS,DEST,METRO,MCLOSE,BANGLA,ROADS,MUDDAS,POCKET_MUDDA,STALLS,SITES,MONKEY_HOMES,CCTV,HIDES,DOORS,DANCES,pointInBuilding,collideBuildings,moveBody,barClosest,inRiver,riverL,onBridge,SPEED,segDist}=Wd;
const DT=1/30;
const NPC_ARR=0;
const NM=MUDDAS.length;
const KAFILA_CAP=25;
const BUS_HP=192,BUS_WAIT=7;
// whole seconds until a loading van with detainees aboard drives off (-1: not counting down)
const busLeaves=b=>b.state==='load'&&b.count>0?Math.max(0,Math.ceil(BUS_WAIT-b.t)):-1;
// a detained leader calls their kafila by tapping: each tap adds 1 to callR, which fades over CALL_TAU s,
// so a steady rate r settles at r*CALL_TAU. ~5 taps/s (callR CALL_FULL) brings the whole kafila; slower brings fewer.
const CALL_TAU=1.5,CALL_FULL=7.5;
const callN=L=>Math.ceil(Math.min(1,(L.callR||0)/CALL_FULL)*L.followers.length);
const answering=(p,L)=>L.followers.indexOf(p)<callN(L);
const SCARE_LINES=['Bhaago! ðŸ˜±','Mummy!','Main toh sirf dekh raha tha!','Ghar chalo bhai!','Bas, bahut ho gaya!','Lathi nahi, lathi nahi!'];
const rand=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[(Math.random()*a.length)|0];

// ------------------------------------------------------------------ static navigation (computed once per process)
const GC=40,GN=Math.ceil(WORLD/GC);
let NAV=null;
function nav(){
 if(NAV)return NAV;
 const BLK=new Uint8Array(GN*GN);
 for(let j=0;j<GN;j++)for(let i=0;i<GN;i++){const x=(i+.5)*GC,y=(j+.5)*GC;if(hypot(x-ZONE.x,y-ZONE.y)<ZONE.R+26||pointInBuilding(x,y,12))BLK[j*GN+i]=1;}
 const q=new Int32Array(GN*GN);
 function bfs(srcs,maxD){const F=new Int16Array(GN*GN).fill(-1);let h=0,t=0;
  for(const[x,y]of srcs){const i=(x/GC)|0,j=(y/GC)|0;for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const ii=i+a,jj=j+b;if(ii<0||jj<0||ii>=GN||jj>=GN)continue;const k=jj*GN+ii;if(F[k]<0&&!BLK[k]){F[k]=0;q[t++]=k;}}}
  while(h<t){const k=q[h++],v=F[k]+1;if(maxD&&v>maxD)continue;const i=k%GN,j=(k/GN)|0;
   if(i>0&&F[k-1]<0&&!BLK[k-1]){F[k-1]=v;q[t++]=k-1;}if(i<GN-1&&F[k+1]<0&&!BLK[k+1]){F[k+1]=v;q[t++]=k+1;}
   if(j>0&&F[k-GN]<0&&!BLK[k-GN]){F[k-GN]=v;q[t++]=k-GN;}if(j<GN-1&&F[k+GN]<0&&!BLK[k+GN]){F[k+GN]=v;q[t++]=k+GN;}}
  return F;}
 const FIELDS=GATE_DEFS.map(g=>bfs([[g.ox,g.oy]]));
 const FANY=bfs(GATE_DEFS.map(g=>[g.ox,g.oy]));
 const cellOf=(x,y)=>{const i=(x/GC)|0,j=(y/GC)|0;return(i<0||j<0||i>=GN||j>=GN)?-1:j*GN+i;};
 const reach=(x,y)=>{const c=cellOf(x,y);return c>=0&&FANY[c]>=0;};
 function snap(x,y){if(reach(x,y))return{x,y};for(let r=1;r<20;r++)for(let a=0;a<16;a++){const xx=x+Math.cos(a/16*TAU)*r*GC,yy=y+Math.sin(a/16*TAU)*r*GC;if(reach(xx,yy)&&!inRiver(xx,yy))return{x:(((xx/GC)|0)+.5)*GC,y:(((yy/GC)|0)+.5)*GC};}return{x,y};}
 const POCKETS=[];const types=[['chai','CHAI STALL'],['coaching','COACHING CENTRE'],['petrol','E20 PETROL PUMP'],['hostel','STUDENT PG'],['polling','POLLING BOOTH 420'],['busstop','DTC BUS STOP'],['pension','PENSION OFFICE'],['dhaba','DHABA'],['mandi','SABZI MANDI'],['college','COLLEGE GATE'],['park','PARK'],['chai','CHAI STALL']];
 const R=Wd.mulberry32(11);let ti=0;
 for(let k=0;k<20000&&POCKETS.length<24;k++){const a=R()*TAU,r=480+R()*2300,x=ZONE.x+Math.cos(a)*r,y=ZONE.y+Math.sin(a)*r;if(x<120||y<120||x>WORLD-120||y>WORLD-120)continue;if(!reach(x,y)||pointInBuilding(x,y,44)||pointInBuilding(x,y+30,30)||inRiver(x,y))continue;if(POCKETS.some(p=>dist(p.x,p.y,x,y)<370))continue;if(METRO.some(m=>dist(m.x,m.y,x,y)<100))continue;if(CHECKS.some(c=>dist(c.x,c.y,x,y)<140))continue;if(STALLS.some(s=>dist(s.x,s.y,x,y)<110))continue;const[t,l]=types[ti++%types.length];const pm=POCKET_MUDDA[t];POCKETS.push({i:POCKETS.length,x,y,type:t,label:l,mud:pm>=0?pm:((R()*NM)|0)});}
 const SPAWNS_P=ASSEMBLY.map(a=>Object.assign({n:a.n},snap(a.x,a.y)));
 const SPAWNS_C=PSTATIONS.map(a=>Object.assign({n:a.n},snap(a.x,a.y)));
 const FCACHE=new Map();
 function fieldTo(x,y){const c=cellOf(x,y);if(c<0)return null;let F=FCACHE.get(c);if(F){FCACHE.delete(c);FCACHE.set(c,F);return F;}F=bfs([[x,y]],120);FCACHE.set(c,F);if(FCACHE.size>160)FCACHE.delete(FCACHE.keys().next().value);return F;}
 NAV={BLK,FIELDS,FANY,cellOf,reach,snap,POCKETS,SPAWNS_P,SPAWNS_C,fieldTo};return NAV;
}
function flowDir(p,F){const i=(p.x/GC)|0,j=(p.y/GC)|0;if(!F||i<1||j<1||i>=GN-1||j>=GN-1)return null;const c=F[j*GN+i];let best=c<0?1e9:c,bi=-1,bj=-1;
 for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){if(!a&&!b)continue;const v=F[(j+b)*GN+i+a];if(v<0||v>=best)continue;if(a&&b&&(F[j*GN+i+a]<0||F[(j+b)*GN+i]<0))continue;best=v;bi=i+a;bj=j+b;}
 if(bi<0)return null;return norm((bi+.5)*GC-p.x,(bj+.5)*GC-p.y);}
function clearLine(x0,y0,x1,y1){const d=dist(x0,y0,x1,y1),n=Math.ceil(d/28);for(let k=1;k<n;k++){const t=k/n;if(pointInBuilding(x0+(x1-x0)*t,y0+(y1-y0)*t,9))return false;}return true;}
function nearestRoad(x,y){let best=null,bd=1e9;for(const r of ROADS){if(r.spoke)continue;for(let i=0;i<r.L.length;i++){const[a,b]=r.p[i],[c,d]=r.p[i+1];const dd=segDist(x,y,a,b,c,d);if(dd<bd){bd=dd;const dx=c-a,dy=d-b,l=dx*dx+dy*dy;const t=clamp(((x-a)*dx+(y-b)*dy)/l,0,1);best={x:a+dx*t,y:b+dy*t};}}}return best;}

// ------------------------------------------------------------------ text content
const NAMES_P=['Bunty','Pinki','Chacha Ji','Comrade Raju','Asha Didi','Kisan Baldev','Hostel Wing B','DU Topper','Teacher Sangh','Gig Workers','Sharma Aunty','Rinku','Dolly','Tinku','Babli','Guddu','Pension Uncle','Biker Bhaiya'];
const NAMES_C=['SHO Yadav','Const. Pandey','Inspector Tomar','ACP Malik','HC Dhillon','SI Rathi','Const. Meena','DCP Sahab','SI Kaur','Const. Bhati'];
const QUICK={P:['Inquilab Zindabad!','Hum Dekhenge!','Bhai idhar aao! ðŸ™‹','Police aa rahi hai! ðŸš¨','Chai pee lo pehle â˜•','Reel ban rahi hai ðŸ“±'],C:['Permission dikhao! ðŸ“„','Security Zone lagu hai!','Chalo bus mein! ðŸšŒ','Permission check hogi!','Lunch break hai ðŸ±','Upar se order hai']};
const COP_LINES=['Chalo bus mein!','Permission dikhao!','Detain karo isko!','Upar se order hai!','Ghar jao, padhai karo!','Permission check hogi!','Banner kahan hai?'];
const HIT_LINES=['DHISHOOM!','THAK!','AAYEE!','Mummyyy!','Chappal gayi meri!'];
const LEAVE_LINES=['Mummy ka call aa gaya, chalta hoon','Mera mudda alag tha waise bhi','Ghar pe bata ke nahi aaya tha!','Kal exam hai, bye!','Boss ne call kiyaâ€¦'];
const REJECT_LINES=['Bhai mera mudda alag hai','Pehle mere mudde pe aao','Hum toh sirf chai peene aaye the','Soch ke batata hoon'];
const FUNDING=['💌 Community support received: ₹47 from your mausi in Jaipur','💌 Community gift: one Toblerone from a friend','💌 Chacha ji ne bheja... a "Good Morning" WhatsApp forward','💌 Pocket money: ₹50. After chai: one samosa','💌 Support kit received! It\'s a megaphone set','💌 Support from home: your uncle says "beta, time pe aana"'];
const FUNDING_C=['💌 Investigated community funds: found a ₹10 Paytm coupon. Case closed.','💌 Checked support kit: it was a geometry box','💌 Community support traced to... a WhatsApp family group'];
const SELFIE=['Selfie posted: 3 likes (2 from mummy)','Selfie posted: going viral in the family group','Selfie with "I â¤ DELHI": your ex liked it ðŸ‘€','Selfie posted: someone commented "awesome banner!"'];
const PAAN_P=g=>[`Paanwala: "Suna hai ${g} gate pe kam police hai"`,`Paanwala: "${g} gate try karo, wahan constable so raha hai"`];
const MONKEY=['ðŸ’ Bandar ne tumhara {b} chheen liya!','ðŸ’ A government-building monkey stole your {b}. Typical Lutyens\'.','ðŸ’ Bandar le gaya {b}. Complaint likhwa do!'];
const GODI_Q=['Kya aap live byte denge?','Aapke peeche kaun hai? Naam batayiye!','Desh jaanna chahta hai!','Pamphlet dikhaiye!','Aapko kitne paise mile?','Yeh andolan nahi, saazish hai!'];
const GODI_LEAVE=['Main TV pe aa gaya! 📺','Sir ne bola live debate chalu hai','Arre, debate dekhna hai','Mummy ne TV pe dekh liya, ghar jaata hoon','Sach mein TV pe aana hai kya?'];
const CHANNELS=['Breaking 24x7','Chillao TV','Desh Ki Awaaz','Sach Ka Saamna','TRP Tez News'];
const REP_Q=['Aapka mudda kya hai?','Ek byte dijiye!','Kya aap live interview denge?','Aapko kaisa lag raha hai?','Desh jaanna chahta hai!','Camera idhar dekhiye!'];
const ANS_P=['Hum bas apna haq maang rahe hain!','Mudda wahi hai, sarkar badal jaati hai!','Community support? Bhai metro ka kiraya bhi udhaar liya hai!','Mummy, main TV pe hoon! ðŸ‘‹','Inquilab Zindabad! (Aur subscribe karna)'];
const ANS_C=['Sab shaanti se ho raha hai.','Situation under control hai.','Hum toh bas duty kar rahe hain.','No comments. Lunch break hai.'];
const BUFFN={chaiT:'chai â˜•',reelT:'phone ðŸ“±',gamT:'gamchha ðŸ§£',pbT:'power bank ðŸ”‹'};

// ------------------------------------------------------------------ the simulation
function createSim(opts){
 opts=Object.assign({roundTime:480,minP:5,minC:4,npcLeaders:3,npcCap:130,intermission:15},opts||{});
 const N=nav();
 // spatial grid of 64 px cells: a flat array over the world (plus a margin); bodies further out go in S.gridFar
 const GW=Math.ceil(WORLD/64)+4,GO=2;
 const S={tick:0,ents:[],nid:1,grid:new Array(GW*GW).fill(null),gridFar:new Map(),cans:[],buses:[],riders:[],pickups:[],bars:[],fx:[],ev:{},nextEv:30,lastEv:null,vip:[],slow:[],monkeys:[],trend:-1,namesVer:1,barsVer:1,pickTimers:[],cells:[],
  gates:GATE_DEFS.map(()=>({hp:100,max:100,armor:0,up:true,rebuild:0,nPush:0,nHold:0,crowd:0,pushers:[]})),
  pockets:N.POCKETS.map(p=>({...p,members:[],refill:0,cd:{}})),stalls:STALLS.map(s=>({...s,cd:{}})),closed:{},round:null};
 const SLOWPERM=SITES.map(s=>({x:s.x,y:s.y,r:s.r,k:.6}));
 let CAMERA=null;
 // ---------- helpers
 function mk(o){const e=Object.assign({id:S.nid++,team:'P',ctl:'npc',mode:'free',role:'',name:'',x:0,y:0,vx:0,vy:0,sx:0,sy:0,r:10,face:Math.PI/2,want:{x:0,y:0},state:'active',gassed:0,stun:0,ghost:0,cd:rand(0,2),gasCd:rand(3,9),abCd:0,eCd:0,megaCd:rand(5,15),swingT:0,swingCd:0,metroCd:0,gheraoImm:0,sta:100,sprint:false,chaiT:0,gamT:0,pbT:0,reelT:0,boostT:0,dispT:0,kbT:0,kbx:0,kby:0,fleeT:0,moving:false,thinkT:Math.random()*.2,gateT:0,lat:rand(-.85,.85),bold:Math.random(),followers:[],leader:null,trail:[],trailT:0,fo:{x:rand(-30,30),y:rand(-30,30)},pushing:null,look:(Math.random()*8)|0,mud:(Math.random()*NM)|0,score:0,streak:0,best:1e9,stats:{det:0,arr:0,rec:0,brk:0,kick:0,gas:0,hits:0},fxq:null,inq:null,ack:0,last:null,chatT:0,sayT:0,lastAct:0,_sk:null,_rs:'',
  // every field any entity ever gets, so all entities share one hidden class (fast property access, less garbage)
  bar:undefined,slot:undefined,gate:undefined,patrolA:undefined,pocket:undefined,idleT:undefined,it:undefined,lstate:undefined,goalN:undefined,recruitT:undefined,crew:undefined,spd:undefined,buddy:undefined,home:undefined,teamSince:undefined,carrier:undefined,flyT:undefined,shoveT:undefined,hideSpot:undefined,hideCd:undefined,holdT:undefined,holdAcc:undefined,holdMs:undefined,inPlaza:undefined,arrivedRun:undefined,peakK:undefined,runBrk:undefined,runStart:undefined,spawnName:undefined,ffwd:undefined,squadOf:undefined,kafLag:undefined,kafC:undefined,cnt:undefined,rs:undefined,cheerT:undefined,stuckT:undefined,catchT:0,unT:0,unD:null,stk:0,stuckN:0,cctv:undefined,mis:undefined,misTeam:undefined,recAcc:undefined,dangerT:undefined,shoveFx:undefined,tgtT:undefined,tgt:undefined,retreatT:undefined,retreatFrom:undefined,scT:undefined,calmRun:undefined,flee:undefined,noZone:undefined,wp:undefined,misDone:undefined,chargeT:undefined,chargeTo:undefined,hbCd:undefined,carryT:undefined,bestBd:undefined,progT:undefined,struggle:undefined,resc:undefined,carrying:undefined,carryBus:undefined,wetT:undefined,esc:undefined,liftFor:undefined,godiTip:undefined,lagTip:undefined,spot:undefined,hideT:undefined,confT:undefined,confFrom:undefined,sitT:undefined,temp:undefined,ttl:undefined,lastCarrier:undefined,lastCarrierT:undefined,combo:undefined,lastHitT:undefined,huntOf:undefined,fasting:undefined,fastT:undefined},o);S.ents.push(e);return e;}
 function fx(k,x,y,a,b,c){S.fx.push({t:S.tick,k,x:x|0,y:y|0,a,b,c});}
 function pfx(e,k,a,b,c){if(e&&e.fxq)e.fxq.push([k,a,b,c]);}
 function toast(e,txt,col,big){pfx(e,'toast',txt,col||'#fff',big?1:0);}
 function say(e,txt){if(e.sayT>0)return;e.sayT=3;fx('say',e.x,e.y,e.id,txt);}
 function feed(txt,col){fx('feed',0,0,txt,col||'#fff');}
 const isPlayerish=e=>e.ctl==='human'||e.ctl==='bot';
 // cell arrays are reused between ticks (less garbage); S.cells lists this tick's non-empty cells in first-use order
 function gridBuild(){const C=S.cells;for(let i=0;i<C.length;i++)C[i].length=0;C.length=0;for(const e of S.ents){if(e.state!=='active')continue;const gx=(e.x/64)|0,gy=(e.y/64)|0;let a;
  if(gx>=-GO&&gy>=-GO&&gx<GW-GO&&gy<GW-GO){const i=(gx+GO)*GW+gy+GO;a=S.grid[i];if(!a){S.grid[i]=a=[];a.gx=gx;a.gy=gy;}}
  else{const k=gx*1000+gy;a=S.gridFar.get(k);if(!a){S.gridFar.set(k,a=[]);a.gx=gx;a.gy=gy;}}
  if(!a.length)C.push(a);a.push(e);}}
 const gridCell=(gx,gy)=>gx>=-GO&&gy>=-GO&&gx<GW-GO&&gy<GW-GO?S.grid[(gx+GO)*GW+gy+GO]:S.gridFar.get(gx*1000+gy);
 function separate(p,o){if(o.id<=p.id||o.team==='N')return;const dx=o.x-p.x,dy=o.y-p.y,dd=dx*dx+dy*dy,rr=p.r+o.r;if(dd>=rr*rr)return;const d=Math.sqrt(dd)||.01,ov=(rr-d)*.5;let wp=p.team==='C'&&o.team==='P'?.3:o.team==='C'&&p.team==='P'?.7:.5;if(p.team===o.team){if(p.ctl==='human'&&o.ctl!=='human')wp=0;else if(o.ctl==='human'&&p.ctl!=='human')wp=1;}p.sx-=dx/d*ov*2*wp;p.sy-=dy/d*ov*2*wp;o.sx+=dx/d*ov*2*(1-wp);o.sy+=dy/d*ov*2*(1-wp);}
 function query(x,y,R,fn){const x0=((x-R)/64)|0,x1=((x+R)/64)|0,y0=((y-R)/64)|0,y1=((y+R)/64)|0,RR=R*R;for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++){const a=gridCell(cx,cy);if(!a)continue;for(let i=0;i<a.length;i++){const e=a[i];if(d2(e.x,e.y,x,y)<=RR)if(fn(e)===false)return;}}}
 function liveNear(e){for(const m of S.media||[])if(d2(m.cam.x,m.cam.y,e.x,e.y)<220*220)return true;return false;}
 const FIR_AT=[100,250,500,850,1300];
 const FIR_TITLES=['','Notice 1','Notice 2','Warning','Challan','Top Leader'];
 function wantedLvl(e){if(e.team!=='P'||e.ctl==='npc')return 0;let l=0;while(l<5&&e.streak>=FIR_AT[l])l++;return l;}
 function addScore(e,v,label){if(!e||v<=0||e.ctl==='npc')return;const stars=wantedLvl(e);const m=(e.team==='P'?1+stars*.2:1.6)*((e.reelT>0||liveNear(e))?2:1)*(e.team==='P'&&S.trend===e.mud?1.5:1);e.score+=v*m;e.rs=(e.rs||0)+v*m;const got=Math.round(v*m);if(label||v>=10)pfx(e,'score',got,label||'');return got;}
 function addStreak(e,v){if(e.team!=='P'||e.ctl==='npc')return;const b=wantedLvl(e);e.streak+=v;const a=wantedLvl(e);if(a>b){toast(e,`ðŸ“„ ${a} Notice${a>1?'s':''}: "${FIR_TITLES[a]}"! Bigger kafila pull, Ã—${(1+a*.2).toFixed(1)} points, and more police on your tail`,'#ffab40',1);feed(`ðŸ“„ Notice #${a} issued to ${e.name}`,'#ffab40');pfx(e,'fir',a);
   if(a>=2){let have=0;for(const o of S.ents)if(o.huntOf===e&&o.state==='active')have++;for(let i=have;i<Math.min(4,a-1);i++){const an=Math.random()*TAU;const x=e.x+Math.cos(an)*520,y=e.y+Math.sin(an)*520;if(pointInBuilding(x,y,12))continue;const h=spawnCop('hunter',{look:0,ttl:50,huntOf:e,x,y});h.tgt=e;h.tgtT=6;}}}}
 // ---------- population
 function spawnPointP(){const sp=pick(N.SPAWNS_P);return{x:sp.x+rand(-30,30),y:sp.y+rand(-30,30),n:sp.n};}
 function spawnPointC(){const sp=pick(N.SPAWNS_C);return{x:sp.x+rand(-30,30),y:sp.y+rand(-30,30),n:sp.n};}
 function place(e,x,y){e.x=x;e.y=y;collideBuildings(e);// humans move by direct input + collision (the plaza is not on the nav grid), so never nav-snap them
  if(e.ctl!=='human'&&!N.reach(e.x,e.y)){const s=N.snap(e.x,e.y);e.x=s.x;e.y=s.y;}}
 function addPocketMember(pk){const a=Math.random()*TAU,r=rand(14,46);const e=mk({team:'P',mode:'idle',x:pk.x+Math.cos(a)*r,y:pk.y+20+Math.sin(a)*r*.6,mud:Math.random()<.72?pk.mud:(Math.random()*NM)|0});e.pocket=pk;collideBuildings(e);pk.members.push(e);return e;}
 let npcPCountCache=0;
 function spawnLeader(){const sp=spawnPointP();const used=new Set(S.ents.filter(e=>e.mode==='lead').map(e=>e.name));const name=pick(NAMES_P.filter(n=>!used.has(n)))||'Neta';const e=mk({team:'P',mode:'lead',name,look:8});place(e,sp.x,sp.y);e.lstate='recruit';e.goalN=(rand(6,12))|0;e.recruitT=0;S.namesVer++;return e;}
 function spawnCop(role,o){return mk(Object.assign({team:'C',ctl:'npc',role,look:Math.random()<.4?1:0,mud:0},o||{}));}
 function makeBar(x,y,ang,len,hp,o){const tx=Math.cos(ang),ty=Math.sin(ang);const b=Object.assign({id:S.nid++,x,y,ang,tx,ty,nx:-ty,ny:tx,len,x1:x-tx*len/2,y1:y-ty*len/2,hp,max:hp,up:true,nPush:0,nHold:0,armor:0,ttl:Infinity,rebuild:0,downT:0,name:'Barricade',pushers:[],_sk:null,_rs:''},o||{});S.bars.push(b);S.barsVer++;return b;}
 function newPickup(){const p=Wd.randomRoadPos(Math.random,r=>r.n!=='Ring Road');const side=Math.random()<.5?1:-1;const nx=-Math.sin(p.ang),ny=Math.cos(p.ang);const x=p.x+nx*side*(p.w/2+14),y=p.y+ny*side*(p.w/2+14);if(dist(x,y,ZONE.x,ZONE.y)<ZONE.R+60||pointInBuilding(x,y,8))return null;const type='gamchha';return{id:S.nid++,x,y,type};}
 function newRider(){const flt=r=>r.n!=='Ring Road'&&!r.spoke;const apart=q=>d2(q.x,q.y,ZONE.x,ZONE.y)>(ZONE.R+300)**2&&!(S.riders||[]).some(o=>d2(o.x,o.y,q.x,q.y)<650*650);let p=Wd.randomRoadPos(Math.random,flt);for(let k=0;k<20&&!apart(p);k++)p=Wd.randomRoadPos(Math.random,flt);const hs=S.ents?S.ents.filter(e=>e.ctl==='human'&&e.state==='active'):[];
  if(hs.length&&Math.random()<.5){const h=pick(hs);for(let k=0;k<30;k++){const q=Wd.randomRoadPos(Math.random,flt);const d=dist(q.x,q.y,h.x,h.y);if(d>700&&d<1300&&apart(q)){p=q;break;}}}return{id:S.nid++,road:p.road,i:p.i,t:p.t,dir:Math.random()<.5?1:-1,sp:rand(160,200),x:p.x,y:p.y,r:8,vx:1,vy:0,carry:null,saidT:rand(3,9),brand:Math.random()<.5?0:1};}
 function setupWorld(){
  S.ents=S.ents.filter(e=>e.ctl==='human');S.cans=[];S.buses=[];S.bars=[];S.fx=[];S.ev={};S.vip=[];S.slow=[];S.closed={};S.nextEv=25;S.trend=-1;S.pickTimers=[];
  for(const g of S.gates)Object.assign(g,{hp:100,max:100,armor:0,up:true,rebuild:0});
  {const RC=ZONE.R+230;for(const r of ROADS)for(let i=0;i<r.p.length-1;i++){const[ax,ay]=r.p[i],[bx,by]=r.p[i+1],dx=bx-ax,dy=by-ay,fx0=ax-ZONE.x,fy0=ay-ZONE.y,A=dx*dx+dy*dy,B=2*(fx0*dx+fy0*dy),C0=fx0*fx0+fy0*fy0-RC*RC,D=B*B-4*A*C0;if(D<0||!A)continue;
   for(const sg of[-1,1]){const t=(-B+sg*Math.sqrt(D))/(2*A);if(t<0||t>1)continue;const x=ax+dx*t,y=ay+dy*t;if(CHECKS.some(q=>dist(q.x,q.y,x,y)<170)||S.bars.some(q=>q.cordon&&dist(q.x,q.y,x,y)<130))continue;
    const b=makeBar(x,y,Math.atan2(dy,dx)+Math.PI/2,r.w+60,55,{name:'Security Zone cordon',check:true,cordon:true});const s=Math.sign((ZONE.x-b.x)*b.nx+(ZONE.y-b.y)*b.ny)||1;for(let k=0;k<2;k++){const sl=k-.5;spawnCop('guard',{bar:b,slot:sl,x:b.x+b.nx*s*22+b.tx*sl*24,y:b.y+b.ny*s*22+b.ty*sl*24});}}}}
  S.mats=[0,1,2,3,4].map(i=>{const a=i/5*TAU-Math.PI/2;return{i,x:JM.x+Math.cos(a)*JM.r*.55,y:JM.y+Math.sin(a)*JM.r*.55,by:null};});
  for(const c of CHECKS){const close=dist(c.x,c.y,ZONE.x,ZONE.y)<1000;const b=makeBar(c.x,c.y,c.ang,c.len,close?55:45,{name:close?'Security Zone cordon':c.name+' checkpoint',check:true,cordon:close});const s=Math.sign((ZONE.x-b.x)*b.nx+(ZONE.y-b.y)*b.ny)||1;const n=dist(c.x,c.y,ZONE.x,ZONE.y)<900?2:1;for(let k=0;k<n;k++){const sl=n===1?0:k-.5;spawnCop('guard',{bar:b,slot:sl,x:b.x+b.nx*s*22+b.tx*sl*24,y:b.y+b.ny*s*22+b.ty*sl*24});}}
  GATE_DEFS.forEach((g,gi)=>{for(const s of[-1,1])spawnCop('holder',{gate:gi,slot:s,x:g.x-g.nx*20+g.tx*s*22,y:g.y-g.ny*20+g.ty*s*22});});
  for(let i=0;i<4;i++){const a=Math.random()*TAU;spawnCop('rover',{x:JM.x+Math.cos(a)*120,y:JM.y+Math.sin(a)*120});}
  for(const pk of S.pockets){pk.members=[];pk.cd={};for(let i=0;i<5;i++)addPocketMember(pk);}
  for(const st of S.stalls)st.cd={};
  for(let i=0;i<opts.npcLeaders;i++)spawnLeader();
  for(let i=0;i<10;i++){const sp=spawnPointP();const e=mk({team:'P',mode:'free'});place(e,sp.x,sp.y);}
  S.media=[];[['Ground Zero News',0],['Sach Ka Saamna',0],['DESH TAK 24x7',1],['Chillao TV',1]].forEach(([ch,godi],i)=>{const sp=pick(N.SPAWNS_P);const rep=mk({team:'N',role:'reporter',name:(godi?'ðŸ“¢ ':'ðŸ“º ')+ch,x:sp.x+rand(-60,60),y:sp.y+rand(-60,60),look:godi?3:0});collideBuildings(rep);const cam=mk({team:'N',role:'camera',x:rep.x+30,y:rep.y+10,look:godi?4:1});cam.buddy=rep;const crew={ch,godi,rep,cam,cd:rand(5,15),target:null,retarget:0,drainT:1.5,fleeT:0,sayT:0};rep.crew=crew;S.media.push(crew);});CAMERA=null;
  for(const pk of S.pockets)if(pk.type==='chai')mk({team:'N',role:'chaiwala',x:pk.x-30,y:pk.y+18,look:2,home:pk});
  S.riders=[];for(let i=0;i<5;i++)S.riders.push(newRider());
  S.busStops=[];S.busRespawn=[];for(const ck of CHECKS){if(ck.i%2)continue;const ra=ck.ang-Math.PI/2;let best=null;for(const s of[-1,1]){const x=ck.x+Math.cos(ra)*s*200,y=ck.y+Math.sin(ra)*s*200;if(!best||d2(x,y,JM.x,JM.y)>d2(best.x,best.y,JM.x,JM.y))best={x,y,a:ra};}S.busStops.push(best);}
  for(const g of GATE_DEFS){const n=norm(g.ox-ZONE.x,g.oy-ZONE.y);S.busStops.push({x:g.ox+n.x*110,y:g.oy+n.y*110,a:Math.atan2(n.y,n.x)});}
  for(const st of S.busStops)parkBus(st);
  S.cannons=[0,2,4].map(i=>{const p=N.SPAWNS_C[i%N.SPAWNS_C.length];return{id:S.nid++,x:p.x,y:p.y,home:{x:p.x,y:p.y},vx:0,vy:0,r:22,cd:0,spray:0,stall:0,ang:0,sang:0,relocT:1+Math.random()*4,post:null,driving:false,trackId:0,sayT:0};});
  S.monkeys=[];
  S.pickups=[];for(let i=0;i<12;i++){const p=newPickup();if(p)S.pickups.push(p);}
  S.ents.filter(e=>e.ctl==='human').forEach(respawnHuman);
  S.namesVer++;S.barsVer++;
 }
 function stepAlong(o,dt){const r=o.road;let rem=o.sp*dt,guard=0;const ox=o.x,oy=o.y;while(rem>0&&guard++<20){const L=r.L[o.i];if(o.dir>0){const left=(1-o.t)*L;if(rem<left){o.t+=rem/L;rem=0;}else{rem-=left;o.i++;o.t=0;if(o.i>=r.L.length){o.i=r.L.length-1;o.t=1;o.dir=-1;}}}else{const left=o.t*L;if(rem<left){o.t-=rem/L;rem=0;}else{rem-=left;o.i--;o.t=1;if(o.i<0){o.i=0;o.t=0;o.dir=1;}}}}
  const[ax,ay]=r.p[o.i],[bx,by]=r.p[o.i+1];const L=r.L[o.i];const nx=-(by-ay)/L,ny=(bx-ax)/L,lane=r.w*.25*o.dir;o.x=ax+(bx-ax)*o.t+nx*lane;o.y=ay+(by-ay)*o.t+ny*lane;o.vx=(o.x-ox)/dt;o.vy=(o.y-oy)/dt;}
 // ---------- round
 function teamCounts(){let P=0,C=0;for(const e of S.ents)if(isPlayerish(e)&&e.state!=='gone'){if(e.team==='P')P++;else C++;}return{P,C};}
 function newRound(){S.tally=S.tally||{P:0,C:0};setupWorld();S.wave=0;S.waveT=12;S.calm=0;S.pin=0;S.round={t:opts.roundTime,arr:0,meter:0,target:0,det:0,over:false,winner:null,overT:0,num:(S.round?S.round.num+1:1),mud:new Array(NM).fill(0)};updateTarget();for(const e of S.ents)if(e.ctl==='human'){e.score=0;e.streak=0;e.stats={det:0,arr:0,rec:0,brk:0,kick:0,gas:0,hits:0};}fx('round',0,0,S.round.num);}
 function updateTarget(){let hp=0;for(const e of S.ents)if(e.ctl==='human'&&e.team==='P'&&e.state!=='gone')hp++;const n=Math.max(opts.minP,Math.min(teamCounts().P,hp+opts.minP));S.round.target=clamp(60+Math.max(opts.minP,hp)*28,160,1200);}
 // rounds never stop the world: the result is announced, the tally updates, and the next round starts at once
 function endRound(w){const R=S.round;S.tally[w]++;
  for(const e of S.ents)if(e.ctl==='human'&&e.state!=='gone'&&e.team===w&&S.tick-(e.teamSince||0)>=30*60)addScore(e,300,'TEAM WIN');
  const ranked=t=>S.ents.filter(e=>isPlayerish(e)&&e.state!=='gone'&&e.team===t).sort((a,b)=>(b.rs||0)-(a.rs||0));const rP=ranked('P'),rC=ranked('C'),mP=rP[0],mC=rC[0];
  for(const e of S.ents){if(e.ctl!=='human'||e.state==='gone')continue;const mates=e.team==='P'?rP:rC;pfx(e,'roundend',[w,R.num,Math.round(e.rs||0),mates.indexOf(e)+1,mates.length,mP?mP.name:'',Math.round(mP?mP.rs||0:0),mC?mC.name:'',Math.round(mC?mC.rs||0:0),S.tally.P,S.tally.C,R.arr,R.det]);}
  feed(w==='P'?`âœŠ Round ${R.num} to the PROTESTERS! Session ${S.tally.P}â€“${S.tally.C}`:`ðŸ‘® Round ${R.num} to the POLICE! Session ${S.tally.P}â€“${S.tally.C}`,w==='P'?'#ffcc80':'#90caf9');fx('over',0,0,w);
  for(const e of S.ents)e.rs=0;
  S.round={t:opts.roundTime,arr:0,meter:0,target:0,det:0,over:false,winner:null,overT:0,num:R.num+1,mud:new Array(NM).fill(0)};S.wave=0;S.waveT=12;S.calm=0;updateTarget();fx('round',0,0,S.round.num);}
 // ---------- personal missions ("aaj ka kaam"): always three, refilled as you finish them
 const MIS={P:[['kafila','Build a kafila of {n}',[10,15,20],60,1],['rec','Recruit {n} people',[12,20],50],['brk','Break {n} barricade{s}',[1,2],70],['godi','Chase off sensational media ðŸ“¢',[1],80],['hide','Hide from the police ðŸ™ˆ',[1],40],['hold','Hold the dharna for {n}s',[20,45],90,1],['int','Give a real TV interview ðŸ“º',[1],40],['free','Rescue someone or wriggle free',[1],60],['cheer','Shout {n} naaras âœŠ',[8,12],30],['fast','Survive an anshan (hunger strike) ðŸ™',[1],90],['halla','Shout HALLA BOL at the police {n}Ã—',[2,3],60]],
  C:[['det','Detain {n} protester{s}',[2,3],70],['scat','Scatter {n} people',[10,20],50],['gas','Throw {n} tear gas shells',[4,6],40],['hits','Land {n} lathi hits',[8,15],50],['carry','Carry someone to the bus ðŸšŒ',[1],60]]};
 function inc(e,k){if(!e||e.ctl!=='human')return;e.cnt=e.cnt||{};e.cnt[k]=(e.cnt[k]||0)+1;}
 function cnt(e,k){if(k==='kafila')return e.followers.length;if(k==='hold')return e.holdT||0;const st={rec:'rec',brk:'brk',det:'det',gas:'gas',hits:'hits'}[k];if(st)return e.stats[st]||0;return(e.cnt&&e.cnt[k])||0;}
 function newMission(e){const pool=MIS[e.team].filter(m=>!e.mis.some(x=>x.k===m[0]));const m=pick(pool);const n=pick(m[2]);return{k:m[0],n,base:m[4]?0:cnt(e,m[0]),rew:m[3]+(n>m[2][0]?20:0),txt:m[1].replace('{n}',n).replace('{s}',n>1?'s':'')};}
 function updateMissions(e){if(e.misTeam!==e.team){e.misTeam=e.team;e.mis=[];}while(e.mis.length<3)e.mis.push(newMission(e));
  for(let i=0;i<e.mis.length;i++){const m=e.mis[i];if(cnt(e,m.k)-m.base>=m.n){const got=addScore(e,m.rew,'MISSION')||m.rew;pfx(e,'mission',m.txt,got);e.misDone=(e.misDone||0)+1;e.mis[i]=newMission(e);}}}
 // ---------- humans
 function respawnHuman(e){for(const b of S.buses){const i=b.humans.indexOf(e);if(i>=0)b.humans.splice(i,1);}e.esc=null;e.callR=0;if(e.fasting){e.fasting.by=null;e.fasting=null;}if(e.carrier&&e.carrier.carrying===e)e.carrier.carrying=null;e.carrier=null;if(e.carrying){const q=e.carrying;e.carrying=null;if(q.state==='carried')releaseCarried(q,null);}e.flyT=0;e.shoveT=0;e.hideSpot=null;e.hideCd=0;e.holdT=0;e.holdAcc=0;e.holdMs=0;e.inPlaza=false;e.arrivedRun=false;e.peakK=0;e.runBrk=0;e.runStart=e.score;e.state='active';e.followers=[];e.leader=null;e.trail=[];e.ghost=3;e.sta=100;e.best=1e9;e.vx=e.vy=0;e.gassed=0;e.stun=0;e.pushing=null;e.dispT=0;const sp=e.team==='P'?spawnPointP():spawnPointC();place(e,sp.x,sp.y);e.spawnName=sp.n;
  if(e.team==='P'){for(let i=0;i<2;i++){const f=mk({team:'P',mode:'follow',mud:e.mud});place(f,e.x+rand(-40,40),e.y+rand(20,60));f.leader=e;e.followers.push(f);}}
  else if(e.ctl==='human'){for(let i=0;i<1;i++){const s=spawnCop('squad',{x:e.x+rand(-30,30),y:e.y+rand(-30,30),slot:i,squadOf:e});collideBuildings(s);}}
  pfx(e,'spawn',sp.n);}
 function addPlayer(name,team,bot,mud){SC=null;team=team==='C'?'C':'P';mud=Number.isInteger(mud)&&mud>=0&&mud<NM?mud:(Math.random()*NM)|0;
  const e=mk({team,ctl:bot?'bot':'human',mode:bot&&team==='P'?'lead':team==='P'?'player':'',role:team==='C'?(bot?'hunter':'player'):'',name,look:team==='C'?(Math.random()<.5?1:0):(Math.random()*8)|0,mud,lastAct:S.tick,teamSince:S.tick});
  if(bot){e.goalN=(rand(6,11))|0;e.lstate='recruit';e.recruitT=0;}
  e.fxq=bot?null:[];e.inq=[];e.cd=0;e.gasCd=0;e.megaCd=0;respawnHuman(e);if(bot)e.ghost=0;S.namesVer++;if(S.round)updateTarget();
  if(!bot)feed(`ðŸ‘‹ ${name} joined the ${team==='P'?'protesters ('+MUDDAS[mud].e+' '+MUDDAS[mud].n+')':'police'}`,team==='P'?'#ffcc80':'#90caf9');return e;}
 function removePlayer(id){SC=null;const e=S.ents.find(x=>x.id===id);if(!e)return;if(e.fasting){e.fasting.by=null;e.fasting=null;}if(e.carrying&&e.carrying.state==='carried')releaseCarried(e.carrying,e);if(e.carrier&&e.carrier.carrying===e)e.carrier.carrying=null;for(const f of e.followers){f.mode='free';f.leader=null;}for(const s of S.ents)if(s.squadOf===e)s.state='gone';for(const b of S.buses)b.humans=b.humans.filter(h=>h!==e);for(const r of S.riders)if(r.carry===e)r.carry=null;e.state='gone';S.namesVer++;}
 function setTeam(id,team,mud){SC=null;const e=S.ents.find(x=>x.id===id);if(!e)return;if(e.team!==team)e.teamSince=S.tick;if(Number.isInteger(mud)&&mud>=0&&mud<NM)e.mud=mud;if(e.team===team){S.namesVer++;return;}
  if(e.state==='carried'||e.state==='escort'||e.state==='bus'){toast(e,'ðŸš” Not now â€” you are being detained!','#ef9a9a');return;}
  for(const f of e.followers){f.mode='free';f.leader=null;}for(const s of S.ents)if(s.squadOf===e)s.state='gone';e.team=team;e.role=team==='C'?'player':'';e.mode=team==='P'?'player':'';e.look=team==='C'?(Math.random()<.5?1:0):(Math.random()*8)|0;e.score=0;e.streak=0;e.mis=[];respawnHuman(e);S.namesVer++;updateTarget();}
 // id -> entity for calls from the server (inputs arrive many times a tick). An entry is used only while the entity
 // is still at the index recorded for it in S.ents; otherwise the index is rebuilt (at most once per state of S.ents).
 const BYID=new Map();let byIdTick=-1,byIdArr=null,byIdLen=-1;
 function entById(id){let e=BYID.get(id);if(e!==undefined&&S.ents[e._bi]===e)return e;
  if(byIdTick===S.tick&&byIdArr===S.ents&&byIdLen===S.ents.length)return undefined;
  BYID.clear();for(let i=0;i<S.ents.length;i++){const x=S.ents[i];x._bi=i;if(!BYID.has(x.id))BYID.set(x.id,x);}byIdTick=S.tick;byIdArr=S.ents;byIdLen=S.ents.length;
  e=BYID.get(id);return e;}
 function input(id,inp){const e=entById(id);if(!e||e.ctl!=='human')return;if(e.inq.length>6)e.inq.shift();e.inq.push(inp);if(inp.m||inp.a||inp.e||inp.g||inp.f||inp.r||inp.x||inp.y)e.lastAct=S.tick;}
 function idleSeconds(id){const e=entById(id);if(!e)return 0;if(e.fasting||(e.state!=='active'&&e.state!=='hidden'))e.lastAct=S.tick;return(S.tick-e.lastAct)*DT;}
 function balanceBots(){const tc={P:0,C:0},hb={P:[],C:[]};for(const e of S.ents){if(e.state==='gone')continue;if(e.ctl==='human')tc[e.team]++;if(e.ctl==='bot')hb[e.team].push(e);}
  for(const t of['P','C']){const want=t==='P'?Math.min(24,Math.max(0,opts.minP+Math.round(tc.C*1.5)-tc.P,Math.ceil(tc.C*1.5)-tc.P)):Math.max(0,opts.minC-tc.C,Math.ceil(tc.P*.6)-tc.C);while(hb[t].length<want){const used=new Set(S.ents.map(e=>e.name));const pool=t==='P'?NAMES_P:NAMES_C;const nm=(pick(pool.filter(n=>!used.has(n+' ðŸ¤–')))||pick(pool))+' ðŸ¤–';hb[t].push(addPlayer(nm,t,true));}
   while(hb[t].length>want){const b=hb[t].pop();if(b.state==='active'||b.state==='escort')removePlayer(b.id);else{hb[t].push(b);break;}}}}
 // ---------- abilities
 function leaveKafila(o,from){if(o.leader){const L=o.leader;L.followers=L.followers.filter(f=>f!==o);}o.mode='free';o.leader=null;o.gate=null;if(from){o.fleeT=1.4;o.flee=norm(o.x-from.x,o.y-from.y);}}
 function scare(o,from,calm){if(o.state!=='active'||o.ctl!=='npc'||o.team!=='P'||o.mode==='scared')return;if(from&&from.team==='C'){inc(from,'scat');if(from.ctl==='human')addScore(from,3);}if(o.leader){const L=o.leader;L.followers=L.followers.filter(f=>f!==o);o.leader=null;}if(o.pocket){o.pocket.members=o.pocket.members.filter(m=>m!==o);o.pocket=null;}
  if(o.followers.length){const fs=o.followers.slice();o.followers=[];for(const f of fs){f.leader=null;scare(f,from,calm);}}
  o.mode='scared';o.gate=null;o.scT=0;o.calmRun=!!calm;const a=from?Math.atan2(o.y-from.y,o.x-from.x)+rand(-.5,.5):Math.random()*TAU;o.flee={x:Math.cos(a),y:Math.sin(a)};
  o.noZone=d2(o.x,o.y,ZONE.x,ZONE.y)<(ZONE.R+30)**2;if(o.noZone){const n=norm(o.x-ZONE.x,o.y-ZONE.y);o.flee=(n.x||n.y)?n:{x:1,y:0};}
  o.home=null;let best=null,bs=-1e9;for(let k=0;k<DOORS.length;k++){const d=DOORS[k],dx=d.x-o.x,dy=d.y-o.y,dd=dx*dx+dy*dy;if(dd<260*260||dd>850*850)continue;const sc=(dx*o.flee.x+dy*o.flee.y)/Math.sqrt(dd)+Math.random()*.4;if(sc>bs){bs=sc;best=d;}}if(best&&bs>-.2)o.home=best;o.thinkT=.3;o.sayT=0;if(Math.random()<.35)say(o,calm?pick(LEAVE_LINES):pick(SCARE_LINES));}
 // walking into people grows your kafila (slither style); the bigger the crowd, the wider the pull
 function touchRecruit(p){if(p.followers.length>=KAFILA_CAP)return;const R=30+Math.min(70,p.followers.length*3)+(p.pbT>0?20:0);let n=0;
  query(p.x,p.y,R,o=>{if(p.followers.length>=KAFILA_CAP)return false;if(o.team!=='P'||o===p||o.ctl!=='npc'||o.state!=='active'||o.mode==='lead'||o.mode==='sit'||(o.mode==='scared'&&(o.scT<1.5||o.calmRun))||o.fleeT>0)return;if(o.mode==='scared'){o.home=null;o.noZone=false;o.sprint=false;}
   // a kafila mobbing a detention van for its leader is on a rescue mission â€” not recruitable
   if(o.mode==='follow'&&o.leader&&o.leader.state!=='gone'&&o.leader.state!=='carried')return;
   if(o.leader){o.leader.followers=o.leader.followers.filter(f=>f!==o);}if(o.pocket){o.pocket.members=o.pocket.members.filter(m=>m!==o);o.pocket=null;}o.mode='follow';o.leader=p;p.followers.push(o);n++;if(p.ctl==='human')fx('pop',o.x,o.y,o.mud===p.mud?1:0);});
  if(!n)return;if(p.ctl==='human'){addScore(p,8*n);addStreak(p,5*n);p.stats.rec+=n;pfx(p,'join',n,p.followers.length);}
  p.recAcc=(p.recAcc||0)+n;if(p.recAcc>=3){p.recAcc=0;p.sayT=0;say(p,Math.random()<.6?pick(MUDDAS[p.mud].ch):pick(['Inquilab Zindabad!','Hum Dekhenge!','Aur log aao! âœŠ','Awaaz do! âœŠ']));}}
 // one button: what does a click do right here?
 // the barricade or gate within pushing reach, if any
 function pushTarget(e){for(const b of S.bars){if(!b.up||d2(b.x,b.y,e.x,e.y)>(b.len/2+50)**2)continue;const q=barClosest(b,e.x,e.y);if(dist(q.x,q.y,e.x,e.y)<e.r+30)return b;}
  for(let gi=0;gi<GATE_DEFS.length;gi++){const g=GATE_DEFS[gi];if(S.gates[gi].up&&d2(g.x,g.y,e.x,e.y)<75*75)return{gi,x:g.x,y:g.y};}return null;}
 function ctxOf(e){if(e.team==='P'&&e.followers.length>=4&&(e.hbCd||0)<=0){let cop=false;query(e.x,e.y,150,o=>{if(o.team==='C'&&o.state==='active'&&o.stun<=0){cop=true;return false;}});if(cop)return{k:10};}
  if(e.team==='P')for(const b of S.buses)if(b.state==='load'&&b.bmax&&d2(b.x,b.y,e.x,e.y)<90*90)return{k:12,o:b};
  let crew=null,bd=90*90;for(const m of S.media){const dd=d2(m.rep.x,m.rep.y,e.x,e.y);if(dd<bd){bd=dd;crew=m;}}
  if(crew&&crew.cd<=0)return{k:1,o:crew};
  let st=null;for(const m of METRO)if(d2(e.x,e.y,m.x,m.y)<70*70){st=m;break;}
  if(e.team==='P'&&S.mats)for(const m of S.mats)if(!m.by&&d2(e.x,e.y,m.x,m.y)<34*34)return{k:9,o:m};
  if(st&&!S.closed[st.n]){if(e.team!=='P'||metroDest(st))return{k:2,o:st};return{k:7,o:st};}
  if(e.team==='P')for(const d of DANCES)if(d2(e.x,e.y,d.x,d.y)<95*95)return{k:11,o:d};
  if((e.hideCd||0)<=0&&e.team==='P')for(const h of HIDES)if(d2(e.x,e.y,h.x,h.y)<48*48)return{k:8,o:h};
  if(e.eCd<=0){let r=null,bd2=70*70;for(const q of S.riders){if(q.carry)continue;const dd=d2(q.x,q.y,e.x,e.y);if(dd<bd2){bd2=dd;r=q;}}if(r)return{k:3,o:r};}
  {const t=pushTarget(e);if(t)return{k:4,o:t};}
  if(st)return{k:5,o:st};if(crew)return{k:6,o:crew};return{k:0};}
 // keeps rounds close whoever is playing: compare progress with the pace needed to win in time
 function paceRatio(){const R=S.round,el=Math.max(20,opts.roundTime-R.t);return R.meter/Math.max(1,R.target*el/opts.roundTime);}
 function meterAdd(v){const r=paceRatio();S.round.meter+=v*clamp(1+(1-r)*2,.5,2.5);}
 // HALLA BOL: a kafila surges at nearby police
 function hallaBol(e){if((e.hbCd||0)>0||e.followers.length<4)return false;let cops=[];query(e.x,e.y,150,o=>{if(o.team==='C'&&o.state==='active'&&o.stun<=0)cops.push(o);});if(!cops.length)return false;
  const k=e.followers.length;e.hbCd=4;fx('hallabol',e.x,e.y,e.id,k);e.sayT=0;say(e,pick(['HALLA BOL! âœŠ','Aage badho!','Ruko mat!','Inquilab Zindabad!']));
  for(const f of e.followers)if(d2(f.x,f.y,e.x,e.y)<190*190){f.boostT=Math.max(f.boostT,1);f.chargeT=.6;let best=cops[0],bd=1e12;for(const q of cops){const d=d2(q.x,q.y,f.x,f.y);if(d<bd){bd=d;best=q;}}f.chargeTo=best;}
  let n=0;for(const q of cops){if(d2(q.x,q.y,e.x,e.y)>110*110)continue;n++;if(k>=8&&q.gheraoImm<=0&&!q.carrying)throwCop(q,e.x,e.y,Math.min(14,k));else{const d=norm(q.x-e.x,q.y-e.y);q.kbx=d.x*(200+k*8);q.kby=d.y*(200+k*8);q.kbT=.25;q.stun=Math.max(q.stun,.6);if(q.carrying&&q.carrying.state==='carried')releaseCarried(q.carrying,q,'rescue');}}
  if(e.ctl==='human'){addScore(e,10+n*12,n?'HALLA BOL!':'');addStreak(e,5+n*5);inc(e,'halla');}return true;}
 function shove(e,t,loud){if(loud&&e.followers.length>=3){const o=t.gi!==undefined?S.gates[t.gi]:t;if(o&&o.up&&o.nPush>.7*o.nHold+.5){const dmg=1+e.followers.length*.22;if(o.armor>0)o.armor=Math.max(0,o.armor-dmg);else o.hp-=dmg;}}e.shoveT=.45;if((e.shoveFx||0)<=S.tick){e.shoveFx=S.tick+(loud?4:9);fx('shove',e.x,e.y,Math.round(t.x),Math.round(t.y));if(loud&&Math.random()<.25){e.sayT=0;say(e,pick(['Dhakka maaro! ðŸ’ª','Ek dhakka aur!','Tod do! âœŠ','Haiya! Haiya!','Zor lagao!']));}}}
 function hideIn(e,sp){inc(e,'hide');let lost=0;for(const o of S.ents){if(o.team!=='C'||o.state!=='active'||o.ctl==='human')continue;if(o.tgt===e||d2(o.x,o.y,e.x,e.y)<380*380){o.tgt=null;o.tgtT=4;o.confT=4;o.confFrom={x:e.x,y:e.y};lost++;fx('confused',o.x,o.y,o.id);}}if(lost&&e.ctl==='human')addScore(e,10+lost*8,'POLICE LOST YOU');e.state='hidden';e.hideT=sp.g?7:5;e.hideSpot=sp;place(e,sp.x,sp.y);e.vx=e.vy=0;e.sprint=false;fx('hide',sp.x,sp.y,e.id);const l=wantedLvl(e);if(l>0)e.streak=l>1?FIR_AT[l-2]:0;
  if(e.ctl==='human'){pfx(e,'hidden',sp.n);toast(e,sp.g?`ðŸ™ ${sp.n}: langar mil gaya! Police lost you${l?' and one notice got "misplaced"':''}`:`ðŸ™ˆ Hidden in ${sp.n}! Police lost you${l?' and one notice got "misplaced"':''}`,'#c5e1a5',1);}
  if(sp.g){e.sta=100;e.tired=false;e.chaiT=Math.max(e.chaiT,10);}}
 function unhide(e){if(e.state!=='hidden')return;const sp=e.hideSpot;e.state='active';e.ghost=1.2;e.hideCd=20;e.hideSpot=null;place(e,sp.x,sp.y+8);fx('unhide',sp.x,sp.y,e.id);}
 function startFast(e,m){m.by=e;e.fasting=m;e.fastT=0;place(e,m.x,m.y);e.vx=e.vy=0;fx('fast',m.x,m.y,e.id);
  if(e.ctl==='human')toast(e,'ðŸ™ ANSHAN shuru! You lie down: Ã—2 dharna points, but no crowd can shield you. Last 40s to make headlines (click to get up)','#ffcc80',1);feed(`ðŸ™ ${e.name} began a hunger strike at Jantar Mantar!`,'#ffcc80');}
 function endFast(e,why){const m=e.fasting;if(!m)return;m.by=null;e.fasting=null;
  if(why==='hospital'){addScore(e,300,'ANSHAN SAFAL');addStreak(e,80);inc(e,'fast');meterAdd(5);feed(`ðŸ¥ ${e.name} fainted after a 40s anshan, taken to AIIMS on a drip. Sarkar under pressure!`,'#ffab40');fx('hospital',e.x,e.y,e.id);if(e.ctl==='human')pfx(e,'hospital');
   place(e,2960+rand(-30,30),4960+rand(-20,20));e.ghost=3;e.vx=e.vy=0;e.trail=[];e.inPlaza=false;}
  else if(why==='broken'&&isPlayerish(e))feed(`ðŸ™ ${e.name}'s anshan was broken by the police`,'#90caf9');}
 function cheer(e){if((e.cheerT||0)>S.tick)return;e.cheerT=S.tick+6;fx('cheer',e.x,e.y,e.id);for(const f of e.followers)if(d2(f.x,f.y,e.x,e.y)<170*170)f.boostT=Math.max(f.boostT,.8);}
 function doCtx(e){const c=ctxOf(e);
  if(c.k===10)hallaBol(e);else if(c.k===1)interview(e,c.o);else if(c.k===2)rideMetro(e,c.o);else if(c.k===4)shove(e,c.o,true);else if(c.k===12)shove(e,c.o,true);
  else if(c.k===8)hideIn(e,c.o);else if(c.k===9)startFast(e,c.o);else if(c.k===11){if((e.danceT||0)<=S.tick){e.danceT=S.tick+30*5;fx('dance',e.x,e.y,e.id);e.sayT=0;say(e,pick(['Naacho re! ðŸ•º','Thumka lagao!','Pani mein masti! ðŸ’¦']));}}else if(c.k===5)toast(e,`ðŸš‡ ${c.o.n} is CLOSED by DMRC "for your convenience"`,'#e1bee7');else if(hallaBol(e)){}else if(e.abCd>0)cheer(e);else{rally(e);cheer(e);}}
 function hitch(e,r){const dJ=dist(e.x,e.y,JM.x,JM.y);const goal=Math.max(ZONE.R+280,dJ-1100);const n=norm(e.x-JM.x,e.y-JM.y);r.carry=e;
  const tx=JM.x+n.x*goal,ty=JM.y+n.y*goal;const s=N.reach(tx,ty)?{x:tx,y:ty}:N.snap(tx,ty);r.tx=s.x;r.ty=s.y;
  e.state='riding';e.eCd=20;pfx(e,'ride');toast(e,r.brand?'ðŸ›µ "Swiggi Instamart se aaya hoon, aapko bhi deliver kar dunga!"':'ðŸ›µ "Baitho bhaiya! 10 minute mein Jantar Mantar!"','#ffcc80');say(r,'Pakad ke baithna!');}
 function metroDest(m){const open=METRO.filter(o=>o!==m&&!S.closed[o.n]&&dist(o.x,o.y,JM.x,JM.y)>ZONE.R+250);let best=null,bd=1e12;for(const o of open){const d=dist(o.x,o.y,JM.x,JM.y);if(d<bd&&d<dist(m.x,m.y,JM.x,JM.y)-300){bd=d;best=o;}}return best;}
 function rideMetro(e,m){if(e.team==='P'&&!metroDest(m)){if(e.ctl==='human')toast(e,'ðŸš‡ This line goes nowhere closer to Jantar Mantar. Walk!','#e1bee7');e.metroCd=Math.max(e.metroCd,3);return;}if(S.closed[m.n]){if(e.ctl==='human')toast(e,`ðŸš‡ ${m.n} is CLOSED by DMRC "for your convenience"`,'#e1bee7');e.metroCd=Math.max(e.metroCd,3);return;}if(e.metroCd>0){if(e.ctl==='human')toast(e,`ðŸš‡ Next train in ${Math.ceil(e.metroCd)}s`,'#e1bee7');return;}
  const open=METRO.filter(o=>o!==m&&!S.closed[o.n]);let to;if(e.team==='P'){to=metroDest(m);}else{const w=wantedTargets().sort((a,b)=>wantedLvl(b)-wantedLvl(a))[0];to=w?open.sort((a,b)=>d2(a.x,a.y,w.x,w.y)-d2(b.x,b.y,w.x,w.y))[0]:pick(open);}
  if(!to)return;const dx=to.x+45-e.x,dy=to.y+45-e.y;
  const take=e.followers.filter(f=>d2(f.x,f.y,e.x,e.y)<320*320),left=e.followers.filter(f=>!take.includes(f));
  for(const f of left){f.mode='free';f.leader=null;}e.followers=take;for(const f of take)place(f,f.x+dx,f.y+dy);place(e,e.x+dx,e.y+dy);e.trail=[];e.metroCd=8;
  if(e.ctl==='human'){toast(e,left.length?`ðŸš‡ Metro se pahunche: ${to.n} with ${take.length} of your kafila (${left.length} were too far behind)`:`ðŸš‡ Metro se pahunche: ${to.n}, poora kafila saath!`,'#e1bee7');pfx(e,'metro');}}
 // the crowd lifts a cop and throws him out ("utha ke fek diya")
 function throwCop(c,ox,oy,n){const a=Math.atan2(c.y-oy,c.x-ox)+rand(-.3,.3),T=.6,D=80+Math.min(14,n)*11;c.kbx=Math.cos(a)*D/T;c.kby=Math.sin(a)*D/T;c.kbT=T;c.flyT=T;c.stun=T+1.6;c.gheraoImm=9;if(c.role!=='holder'&&c.role!=='guard'){c.retreatT=6;c.retreatFrom={x:ox,y:oy};}if(c.carrying&&c.carrying.state==='carried')releaseCarried(c.carrying,c,'rescue');fx('gherao',c.x,c.y,c.id,Math.round(a*100));}
 function releaseCarried(p,c,why){p.state='active';p.carrier=null;p.ghost=3.5;p.boostT=Math.max(p.boostT,2);if(c){p.lastCarrier=c;p.lastCarrierT=S.tick+30*12;}p.stun=0;p.vx=p.vy=0;p.struggle=0;if(c){if(c.carrying===p)c.carrying=null;place(p,c.x+rand(-12,12),c.y+14);}fx('free',p.x,p.y,p.id);
  if(p.ctl==='human')toast(p,why==='rescue'?'ðŸ™Œ RESCUED by your people! Bhaago!':why==='wriggle'?'ðŸ’¥ Wriggled free! Bhaago!':'Chhoot gaye!','#a5d6a7',1);
  if(why&&isPlayerish(p))feed(why==='rescue'?`ðŸ™Œ ${p.name} was rescued from the police!`:`ðŸ’¥ ${p.name} wriggled free!`,'#a5d6a7');}
 function helperFor(c,t){let h=null,bd=260*260;for(const o of S.ents){if(o.team!=='C'||o.ctl==='human'||o.state!=='active'||o.carrying||o.stun>0||o.role==='holder'||o.role==='guard')continue;const dd=d2(o.x,o.y,t.x,t.y)*(o.squadOf===c?.5:1);if(dd<bd){bd=dd;h=o;}}return h;}
 // the player's lathi exposes someone: a constable lifts them; the player keeps fighting
 function squadLift(c,t){const h=helperFor(c,t);if(!h)return false;if(t.pocket){t.pocket.members=t.pocket.members.filter(m=>m!==t);t.pocket=null;}h.liftFor=c;startCarry(t,h);h.sayT=0;say(h,pick(['Utha lo isko!','Sir, main le jaata hoon!','Chal bus mein!']));if(c.ctl==='human')addScore(c,8,'LIFTED');return true;}
 function startCarry(p,by){if(p.fasting)endFast(p,'broken');if(p.pocket){p.pocket.members=p.pocket.members.filter(m=>m!==p);p.pocket=null;}p.state='carried';p.carrier=by;p.carryT=0;p.bestBd=undefined;p.progT=0;p.struggle=0;by.carrying=p;by.carryBus=nearestBusFor(p.x,p.y);by.cd=1;
  if(p.leader){p.leader.followers=p.leader.followers.filter(f=>f!==p);p.leader=null;}
  p.resc=0;for(const f of p.followers)f.boostT=Math.max(f.boostT,1.5);
  by.sayT=0;say(by,pick(['Utha lo isko!','Chal bus mein!','Upar se order hai!','Bahut neta ban raha tha!']));fx('grab',p.x,p.y,p.id,by.id);
  if(p.ctl==='human'){toast(p,'ðŸ˜± UTHA LIYA! Keep clicking to wriggle free! Your kafila is coming to rescue you!','#ef9a9a',1);pfx(p,'grabbed');}
  if(by.ctl==='human'){toast(by,'ðŸ’ª Utha liya! Carry them to the ðŸšŒ detention bus. Follow the arrow!','#90caf9',1);addScore(by,10);}}
 function parkBus(st){const far=DEST.slice().sort(()=>Math.random()-.5).slice(0,3).sort((a,b)=>dist(b.x,b.y,JM.x,JM.y)-dist(a.x,a.y,JM.x,JM.y))[0];const b={id:S.nid++,x:st.x,y:st.y,vx:Math.cos(st.a||0),vy:Math.sin(st.a||0),state:'load',t:0,dest:far,count:0,humans:[],stop:st,bhp:BUS_HP,bmax:BUS_HP,bpush:0,bhold:0};S.buses.push(b);return b;}
 function rally(p){
  if(p.abCd>0)return 0;p.abCd=p.ctl==='human'?3.5:6;const R=(S.ev.internet&&p.pbT<=0?140:280)*(p.pbT>0?1.5:1)*(p.ctl==='npc'?.85:1);let n=0,rej=0;
  query(p.x,p.y,R,o=>{if(p.followers.length>=KAFILA_CAP)return false;if(o.team!=='P'||o===p||o.ctl!=='npc'||o.mode==='lead'||o.mode==='sit'||(o.mode==='scared'&&(o.scT<1.5||o.calmRun))||o.leader===p||o.fleeT>0)return;if(o.mode==='scared'){o.home=null;o.noZone=false;o.sprint=false;}
   // same as touchRecruit: a kafila rescuing its leader from a van stays loyal
   if(o.mode==='follow'&&o.leader&&o.leader.state!=='gone'&&o.leader.state!=='carried')return;
   if(o.pocket){o.pocket.members=o.pocket.members.filter(m=>m!==o);o.pocket=null;}o.mode='follow';o.leader=p;p.followers.push(o);n++;if(p.ctl==='human')fx('pop',o.x,o.y,o.mud===p.mud?1:0);});
  fx('ring',p.x,p.y,R);if(isPlayerish(p)||Math.random()<.3)say(p,Math.random()<.6?pick(MUDDAS[p.mud].ch):pick(['Inquilab Zindabad!','Hum Dekhenge!','Awaaz do! âœŠ']));
  if(p.ctl==='human'){pfx(p,'chant');inc(p,'cheer');if(n){addScore(p,8*n,`(${n} joined)`);addStreak(p,5*n);p.stats.rec+=n;toast(p,p.followers.length>=KAFILA_CAP?`Kafila full (${KAFILA_CAP})! Itna bhi mat le aao, police ko bhi khelna hai ðŸ˜„`:`${n} log kafile mein shamil! Kafila: ${p.followers.length} âœŠ${rej?` (${rej} said "mudda alag hai")`:''}`,'#ffcc80');}
   else toast(p,rej?`${rej} log bole "bhai mera mudda alag hai". Find ${MUDDAS[p.mud].e} ${MUDDAS[p.mud].n} people!`:S.ev.internet&&p.pbT<=0?'No one heard you: internet is down! Get closer, or find a ðŸ”‹':'Nobody new nearby. Walk into ðŸ™‹ groups at chai stalls, PGs and petrol pumps to recruit them','#ccc');}
  return n;}
 function shielded(t){if(t.dispT>0||t.fasting||onWall(t))return false;if(t.mode==='follow'&&t.leader&&isPlayerish(t.leader)&&t.leader.followers.length>=8&&!(t.gassed>0&&t.gamT<=0)&&d2(t.x,t.y,t.leader.x,t.leader.y)<130*130&&d2(t.x,t.y,ZONE.x,ZONE.y)>ZONE.R*ZONE.R)return true;const need=(d2(t.x,t.y,ZONE.x,ZONE.y)<ZONE.R*ZONE.R?5:3)+(t.gassed>0&&t.gamT<=0?1:0);let n=0;query(t.x,t.y,58,o=>{if(o!==t&&o.team==='P'&&o.mode!=='idle'&&o.mode!=='scared'&&o.dispT<=0)n+=(o.gassed>0&&o.gamT<=0)?.5:1;if(n>=need)return false;});return n>=need;}
 function nearestBusFor(x,y){let nb=null,nd=1e12;for(const b of S.buses)if(b.state==='load'&&b.stop){const d=d2(b.x,b.y,x,y);if(d<nd&&d<500*500){nd=d;nb=b;}}if(nb)return nb;for(const b of S.buses)if(b.state==='load'&&d2(b.x,b.y,x,y)<600*600)return b;
  // no van in reach: one drives in from down the road â€” well clear of the arrest, so the drag
  // to it (~5-12 s) always leaves the crowd a window to rock it apart or pull the person back
  let p=null;for(let k=0;k<25&&!p;k++){const q=Wd.randomRoadPos(Math.random);const dd=dist(q.x,q.y,x,y);if(dd>600&&dd<1400&&!pointInBuilding(q.x,q.y,20))p=q;}
  if(!p){const r=nearestRoad(x,y)||{x,y};let dx=r.x-x,dy=r.y-y,dd=hypot(dx,dy);if(dd<1){dx=1;dy=0;dd=1;}const off=Math.max(0,800-dd);p={x:r.x+dx/dd*off,y:r.y+dy/dd*off};}
  const far=DEST.slice().sort(()=>Math.random()-.5).slice(0,3).sort((a,b)=>dist(b.x,b.y,JM.x,JM.y)-dist(a.x,a.y,JM.x,JM.y))[0];const b={id:S.nid++,x:p.x,y:p.y,vx:1,vy:0,state:'load',t:0,dest:far,count:0,humans:[],bhp:BUS_HP,bmax:BUS_HP,bpush:0,bhold:0};S.buses.push(b);return b;}
 function detain(p,by){
  if(p.state!=='active'||p.ghost>0)return false;if(by&&p.lastCarrier===by&&S.tick<p.lastCarrierT)return false;
  if(!isPlayerish(p)&&p.mode!=='lead'){scare(p,by);if(by){by.cd=by.ctl==='human'?.5:2.5;if(by.ctl==='human')addScore(by,4);}return true;}
  if(by&&by.state==='active'&&by.team==='C'&&!by.carrying){startCarry(p,by);return true;}
  return sendToBus(p,by);}
 // the run ends when the van drives off with the player aboard, not at the arrest: the kafila may still break them out
 function endRun(p){p.streak=0;if(p.ctl==='human'){pfx(p,'runover',[Math.round(p.holdT||0),p.peakK||0,p.runBrk||0,Math.round(p.score-(p.runStart||0))]);}const heldFor=p.holdT||0;p.holdT=0;p.holdAcc=0;p.holdMs=0;p.inPlaza=false;p.arrivedRun=false;p.peakK=0;p.runBrk=0;p.runStart=p.score;if(heldFor>=10)feed(`ðŸšŒ ${p.name}'s dharna ended after ${Math.round(heldFor)}s`,'#bbdefb');}
 function sendToBus(p,by){
  const bus=(by&&by.carryBus&&by.carryBus.state==='load')?by.carryBus:nearestBusFor(p.x,p.y);p.state='escort';p.carrier=null;p.esc={bus,t:0,x0:p.x,y0:p.y,d0:dist(p.x,p.y,bus.x,bus.y)};if(!bus.stop)bus.t=0;
  if(p.leader){p.leader.followers=p.leader.followers.filter(f=>f!==p);p.leader=null;}
  const wl=wantedLvl(p),bounty=Math.round(p.streak*.6);
  if(p.followers.length){if(isPlayerish(p))feed(`ðŸš¨ ${p.name}'s kafila is chasing the detention van!`,'#ffcc80');
   else{feed(`ðŸ“£ ${p.name||'A leader'} detained, the kafila scattered!`,'#90caf9');for(const f of p.followers){f.mode='free';f.leader=null;}p.followers=[];}}
  if(by){by.cd=by.ctl==='human'?.7:by.role==='holder'?6:by.role==='squad'?4:by.role==='hunter'?2.5:by.role==='guard'?5:3.5;by.stats.det++;
   const inPl=d2(p.x,p.y,JM.x,JM.y)<JM.r*JM.r;const base=(isPlayerish(p)?(p.ctl==='human'?60:45):(p.mode==='lead'?30:6))+(inPl&&isPlayerish(p)?40:0);addScore(by,base+bounty,wl?`WANTED â­${wl} +${bounty}`:inPl&&isPlayerish(p)?'PLAZA CLEARED':isPlayerish(p)?'DETAINED':'');
   const boss=by.liftFor||by.squadOf;if(boss&&boss.ctl==='human'){addScore(boss,base,isPlayerish(p)?'DETAINED':'');boss.stats.det++;inc(boss,'carry');}by.liftFor=null;say(by,pick(COP_LINES));}
  S.round.det++;
  if(isPlayerish(p)){feed(`ðŸšŒ ${p.name} (${MUDDAS[p.mud].e}) detained by ${by?by.name||'Delhi Police':'VIP Security'}${wl?` Â· â­${wl} bounty ${bounty}`:''}`,'#bbdefb');p.inPlaza=false;if(p.ctl==='human')pfx(p,'detained',bus.dest.n,by?by.name||'Delhi Police':'VIP Security');}
  return true;}
 // lathi charge: a swing that knocks back everyone in a cone; small groups scatter, then the nearest exposed protester is detained
 function swing(c,target){
  if(c.swingCd>0||c.stun>0||c.carrying)return false;c.swingCd=c.ctl==='human'?1:(c.role==='guard'||c.role==='holder'?5.5:c.role==='hunter'?4.2:3.2);c.swingT=.35;
  if(target)c.face=Math.atan2(target.y-c.y,target.x-c.x);const fx_=Math.cos(c.face),fy_=Math.sin(c.face);const hits=[],bys=[];c.kbx=fx_*260;c.kby=fy_*260;c.kbT=.12;
  query(c.x,c.y,74,o=>{if(o.team!=='P'||o.state!=='active'||o.mode==='sit'||o.mode==='scared'||o.ghost>0)return;const dx=o.x-c.x,dy=o.y-c.y,d=hypot(dx,dy)||1;if((dx*fx_+dy*fy_)/d<.3)return;if(o.mode==='idle'){bys.push(o);return;}hits.push(o);});
  for(const o of bys){fx('hit',o.x,o.y,o.id,Math.round(Math.atan2(o.y-c.y,o.x-c.x)*100));scare(o,c);}if(c.ctl==='human'&&bys.length)addScore(c,bys.length);
  fx('swing',c.x,c.y,Math.round(c.face*100),c.id);
  const small=hits.length<=2;
  for(const o of hits){const n=norm(o.x-c.x,o.y-c.y);o.kbx=n.x*(small?300:170);o.kby=n.y*(small?300:170);o.kbT=.22;o.stun=Math.max(o.stun,.4);if(small)o.dispT=2.2;if(onWall(o)){const d=dist(o.x,o.y,ZONE.x,ZONE.y),out=d<ZONE.R?-1:1,n=norm(o.x-ZONE.x,o.y-ZONE.y);const nd=ZONE.R+out*(o.r+14);o.x=ZONE.x+n.x*nd;o.y=ZONE.y+n.y*nd;o.kbx=n.x*out*160;o.kby=n.y*out*160;fx('offwall',o.x,o.y,o.id);}fx('hit',o.x,o.y,o.id,Math.round(Math.atan2(n.y,n.x)*100));
   if(o.mode==='follow')o.boostT=Math.max(o.boostT,1.2);if(o.ctl==='npc'&&o.mode==='follow'&&Math.random()<(small?.55:o.leader&&isPlayerish(o.leader)&&o.leader.followers.length>=8&&!(o.gassed>0&&o.gamT<=0)&&d2(o.x,o.y,ZONE.x,ZONE.y)>ZONE.R*ZONE.R?0:.25)){scare(o,c);}
   if(o.ctl==='human'){pfx(o,'hurt',small?1:0);toast(o,small?'LATHI PADA! ðŸ˜µ You lost crowd cover for 2s, regroup!':'Lathi charge! Your crowd held together ðŸ’ª','#ef9a9a');}}
  if(c.ctl==='human'){c.stats.hits+=hits.length;if(hits.length){c.combo=S.tick-(c.lastHitT||-999)<75?(c.combo||0)+1:1;c.lastHitT=S.tick;const pts=Math.round(hits.length*4*(1+.3*(c.combo-1)));addScore(c,pts);pfx(c,'combo',c.combo,hits.length);}}
  let t=null,bd=58*58;for(const o of hits){const dd=d2(o.x,o.y,c.x,c.y);if(dd<bd&&!shielded(o)){bd=dd;t=o;}}
  if(t&&c.ctl==='human'&&t.state==='active'&&t.ghost<=0&&!(t.lastCarrier===c&&S.tick<t.lastCarrierT)&&(isPlayerish(t)||t.mode==='lead'||Math.random()<.15)&&squadLift(c,t)){}
  else if(t)detain(t,c);else if(c.ctl==='human')toast(c,hits.length?'The crowd is too thick: gas them (right-click)':bys.length?`ðŸ˜± ${bys.length} bystander${bys.length>1?'s':''} ran away! Kafilas are the real target`:'Lathi hawa mein! Nobody in range','#ccc');
  return true;}
 function megaphone(c){if(c.megaCd>0)return;c.megaCd=c.ctl==='human'?18:40;fx('mega',c.x,c.y);say(c,pick(['Security Zone lagu hai! Ghar jao!','Ghar jao, mummy wait kar rahi hai!','Permission nahi hai! Disperse!']));let n=0;const hurt=new Set();
  query(c.x,c.y,260,o=>{if(o.team!=='P'||o.ctl!=='npc'||o.mode!=='follow'||!o.leader)return;const same=o.mud===o.leader.mud,big=isPlayerish(o.leader)&&o.leader.followers.length>=8;if(Math.random()<(big?(same?.03:.1):(same?.15:.45))){if(o.leader.ctl==='human')hurt.add(o.leader);scare(o,c,true);n++;}});
  for(const h of hurt)toast(h,`ðŸ“¢ Police megaphone! Part of your kafila went home. Same-mudda people are more loyal!`,'#ef9a9a');
  if(c.ctl==='human'){addScore(c,3*n);toast(c,n?`ðŸ“¢ ${n} log ghar chale gaye!`:'ðŸ“¢ Nobody listened. Typical.','#90caf9');}}
 // ---------- AI
 function nearestCloud(p,extra){let best=null,bd=1e9;for(const c of S.cans){if(c.state!=='land')continue;const d=dist(p.x,p.y,c.x,c.y)-c.r;if(d<extra&&d<bd){bd=d;best=c;}}return best;}
 function chooseGate(p){const c=N.cellOf(p.x,p.y);let best=0,bs=1e9;GATE_DEFS.forEach((g,i)=>{const f=c>=0?N.FIELDS[i][c]:-1;let s=f>=0?f*GC:dist(p.x,p.y,g.ox,g.oy)+1500;s-=!S.gates[i].up?1100:0;s-=Math.min(10,S.gates[i].crowd)*45;s+=rand(0,300);if(S.ev.internet)s=rand(0,800)+s*.3;if(s<bs){bs=s;best=i;}});return best;}
 function plazaSpot(p,tight){if(!p.spot||dist(p.spot.x,p.spot.y,JM.x,JM.y)>JM.r){const a=Math.random()*TAU,r=Math.sqrt(Math.random())*(JM.r*(tight||.7));p.spot={x:JM.x+Math.cos(a)*r,y:JM.y+Math.sin(a)*r};}const d=dist(p.x,p.y,p.spot.x,p.spot.y);return d>12?norm(p.spot.x-p.x,p.spot.y-p.y):{x:0,y:0};}
 function marchTo(p,gi){const g=GATE_DEFS[gi],G=S.gates[gi],dg=dist(p.x,p.y,g.ox,g.oy);
  if(!G.up&&dg<130)return norm(JM.x-p.x,JM.y-p.y);
  if(G.up&&dg<130){const lx=g.x+g.tx*p.lat*(g.w/2-12)-g.nx*30,ly=g.y+g.ty*p.lat*(g.w/2-12)-g.ny*30;return norm(lx-p.x,ly-p.y);}
  return flowDir(p,N.FIELDS[gi])||norm(g.ox-p.x,g.oy-p.y);}
 function pathTo(p,tx,ty){if(d2(p.x,p.y,tx,ty)<40*40||clearLine(p.x,p.y,tx,ty))return norm(tx-p.x,ty-p.y);return flowDir(p,N.fieldTo(tx,ty))||norm(tx-p.x,ty-p.y);}
 function gasAvoid(p,w){if(p.gamT>0)return w;const cl=nearestCloud(p,35);if(cl){const a=norm(p.x-cl.x,p.y-cl.y);const k=p.bold>.5?1.1:2;return norm(w.x+a.x*k,w.y+a.y*k);}return w;}
 function kickCheck(p){for(const c of S.cans){if(c.state==='land'&&c.kicks<1&&c.age<2.2&&p.bold>.72&&d2(p.x,p.y,c.x,c.y)<150*150){p.want=norm(c.x-p.x,c.y-p.y);return true;}}return false;}
 const leaderOk=L=>L&&(L.state==='active'||L.state==='riding'||L.state==='hidden'||L.state==='carried'||L.state==='escort'||L.state==='bus');
 function thinkFree(p){if(p.fleeT>0){p.want=p.flee;return;}if(kickCheck(p))return;const dz=dist(p.x,p.y,ZONE.x,ZONE.y);let w;
  if(dz<ZONE.R-6)w=plazaSpot(p);
  else{if(Math.random()<.3){let L=null;query(p.x,p.y,220,o=>{if(o.team==='P'&&o.mode==='lead'&&o.lstate==='recruit'){L=o;return false;}});if(L){p.mode='follow';p.leader=L;L.followers.push(p);return thinkFollower(p);}}
   if(p.gate==null||p.gateT<=0){p.gate=chooseGate(p);p.gateT=rand(3,6);}w=marchTo(p,p.gate);}
  if(S.ev.langar&&!p.langar&&dist(p.x,p.y,BANGLA.x,BANGLA.y)<500)w=norm(BANGLA.x-p.x,BANGLA.y-p.y);
  p.want=gasAvoid(p,w);}
 function thinkFollower(p){const L=p.leader;if(!leaderOk(L)){p.mode='free';p.leader=null;return thinkFree(p);}
  if(p.chargeT>0&&p.chargeTo&&p.chargeTo.state==='active'){p.want=norm(p.chargeTo.x-p.x,p.chargeTo.y-p.y);return;}
  // the leader is being dragged to / loaded on a detention van: the ones they call mob it and rock it open,
  // the rest wait where they are for the call
  if((L.state==='escort'||L.state==='bus')&&L.esc&&L.esc.bus){const bb=L.esc.bus;
   if(bb.state!=='load'){leaveKafila(p);return thinkFree(p);}
   if(!answering(p,L)){p.want={x:0,y:0};p.sprint=false;return;}
   const a=(p.id*2.399)%TAU,tx=bb.x+Math.cos(a)*34,ty=bb.y+Math.sin(a)*34,dd=dist(p.x,p.y,tx,ty);
   p.want=gasAvoid(p,dd>10?norm(tx-p.x,ty-p.y):{x:0,y:0});p.sprint=dd>240&&p.sta>30;return;}
  if(kickCheck(p))return;const dz=dist(p.x,p.y,ZONE.x,ZONE.y),dzL=dist(L.x,L.y,ZONE.x,ZONE.y);let w;
  if(dz<ZONE.R-6){if(d2(L.x,L.y,JM.x,JM.y)<(JM.r+20)**2){const tx=L.x+p.fo.x*1.1,ty=L.y+p.fo.y*1.1;const d=dist(p.x,p.y,tx,ty);w=d>8?norm(tx-p.x,ty-p.y):{x:0,y:0};}else w=norm(L.x-p.x,L.y-p.y);}
  else if(L.pushing&&L.pushing.gi!==undefined)w=marchTo(p,L.pushing.gi);
  else if(L.pushing&&L.pushing.len){const b=L.pushing,s=Math.sign((L.x-b.x)*b.nx+(L.y-b.y)*b.ny)||1;const t=p.lat*b.len*.42;w=norm(b.x+b.tx*t-b.nx*s*25-p.x,b.y+b.ty*t-b.ny*s*25-p.y);}
  else if(dzL<ZONE.R-6){let gi=-1,bs=1e9;const c=N.cellOf(p.x,p.y);GATE_DEFS.forEach((g,i)=>{if(S.gates[i].up)return;const f=c>=0?N.FIELDS[i][c]:-1;const s=f>=0?f:1e6;if(s<bs){bs=s;gi=i;}});w=gi>=0?marchTo(p,gi):{x:0,y:0};}
  else{const tr=L.trail,dL=dist(p.x,p.y,L.x,L.y),tight=L.dangerT>0,near=(34+Math.sqrt(L.followers.length)*14)*(tight?.7:1);
    // members that fall behind, or whose leader is running, hurry to keep up
    if(dL>near*1.5||(L.sprint&&L.sta>0&&L.moving))p.catchT=.4;
   if(dL<near){const k=tight?.55:1;w=dL>(tight?16:24)?norm(L.x+p.fo.x*k-p.x,L.y+p.fo.y*k-p.y):{x:0,y:0};if(tight&&dL>30)p.boostT=Math.max(p.boostT,.4);}
   else{let target=null;for(let i=tr.length-1;i>=0;i--){const q=tr[i];if(d2(q.x,q.y,p.x,p.y)<26*26){target=tr[Math.min(tr.length-1,i+2)];break;}}
    if(!target){let bi=0,bd=1e12;for(let i=0;i<tr.length;i++){const dd=d2(tr[i].x,tr[i].y,p.x,p.y);if(dd<bd){bd=dd;bi=i;}}target=tr.length?tr[Math.min(tr.length-1,bi+2)]:L;}
    w=norm(target.x-p.x,target.y-p.y);if(dL>200)p.boostT=.3;
    if(!p.moving)p.stuckT=(p.stuckT||0)+.15;else p.stuckT=Math.max(0,(p.stuckT||0)-.3);if(p.stuckT>1.2){w=pathTo(p,L.x,L.y);p.boostT=Math.max(p.boostT,.5);}}}
  p.want=gasAvoid(p,w);}
 function nearestPickup(p,R){let best=null,bd=R*R;for(const k of S.pickups){if(k.type==='gamchha'&&p.team!=='P')continue;const dd=d2(k.x,k.y,p.x,p.y);if(dd<bd){bd=dd;best=k;}}return best;}
 function thinkLeader(p){// NPC leaders and protester bots
  if(kickCheck(p))return;const dz=dist(p.x,p.y,ZONE.x,ZONE.y),n=p.followers.length;let w;p.recruitT+=.15;
  if(dz<ZONE.R-6)w=plazaSpot(p,.3);
  else if(p.lstate==='recruit'){let best=null,bd=1e12;for(const pk of S.pockets){if(!pk.members.length)continue;const dd=d2(pk.x,pk.y,p.x,p.y)*(pk.mud===p.mud?.35:1);if(dd<bd){bd=dd;best=pk;}}
   if(best){const d=dist(best.x,best.y,p.x,p.y);if(d<150&&p.abCd<=0)rally(p);w=d>30?pathTo(p,best.x,best.y):{x:0,y:0};}else w={x:0,y:0};
   if(n>=p.goalN||p.recruitT>35){p.lstate='march';p.gate=chooseGate(p);}}
  else{if(n<3&&p.recruitT>12&&S.gates.every(g=>g.up)){p.lstate='recruit';p.recruitT=0;p.goalN=(rand(6,12))|0;}
   if(p.gateT<=0){p.gate=chooseGate(p);p.gateT=rand(5,9);}w=marchTo(p,p.gate);if(p.abCd<=0&&Math.random()<.2)rally(p);}
  if(n<4&&!p.pushing){let cop=null,cd=170*170;query(p.x,p.y,170,o=>{if(o.team==='C'&&o.state==='active'&&o.stun<=0){const dd=d2(o.x,o.y,p.x,p.y);if(dd<cd){cd=dd;cop=o;}}});if(cop){const a=norm(p.x-cop.x,p.y-cop.y);w=norm(w.x+a.x*2.2,w.y+a.y*2.2);p.sprint=p.sta>20;}}
  if(p.ctl==='bot'){const pk=nearestPickup(p,140);if(pk&&!p.pushing)w=norm(pk.x-p.x,pk.y-p.y);let cop=null;query(p.x,p.y,130,o=>{if(o.team==='C'&&o.state==='active'){cop=o;return false;}});p.sprint=!!cop&&p.sta>30&&!p.pushing;}
  p.want=gasAvoid(p,w);}
 function thinkIdle(p){const pk=p.pocket;if(!pk){p.mode='free';return;}p.idleT=(p.idleT||0)-.15;if(p.idleT<=0||!p.it){p.idleT=rand(1.5,4);const a=Math.random()*TAU,r=rand(10,48);p.it={x:pk.x+Math.cos(a)*r,y:pk.y+20+Math.sin(a)*r*.6};}
  const d=dist(p.x,p.y,p.it.x,p.it.y);p.want=d>8?norm(p.it.x-p.x,p.it.y-p.y):{x:0,y:0};if(d<=8)p.face=Math.atan2(pk.y+20-p.y,pk.x-p.x);}
 function copDetainCheck(p,reach){if(p.cd>0||p.swingCd>0||p.carrying)return;let t=null,bd=reach*reach;query(p.x,p.y,reach,o=>{if(o.team!=='P'||o.state!=='active'||o.ghost>0||o.mode==='idle'||o.mode==='sit')return;const dd=d2(o.x,o.y,p.x,p.y);if(dd<bd){bd=dd;t=o;}});if(t&&!shielded(t))swing(p,t);}
 function wantedTargets(){return S.ents.filter(e=>e.team==='P'&&e.state==='active'&&(isPlayerish(e)||e.mode==='lead'));}
 function thinkC(p){
  if(p.stun>0){p.want={x:0,y:0};return;}
  if(p.confT>0){p.confT-=.15;const a=(p.id*1.7+S.tick*.01)%TAU;p.want={x:Math.cos(a)*.4,y:Math.sin(a)*.4};p.sprint=false;return;}
  if(p.carrying){const b=p.carryBus;p.want=b?pathTo(p,b.x,b.y):{x:0,y:0};p.sprint=false;return;}
  if(p.gasCd<=0&&S.cans.length<18&&(p.role==='hunter'||p.role==='rover'||p.role==='squad'||p.temp||p.ttl!==undefined)){let L=null;query(p.x,p.y,270,o=>{if(o.team==='P'&&o.state==='active'&&o.followers&&o.followers.length>=6&&!(o.gassed>0)){L=o;return false;}});if(L){throwGas(p,L.x+rand(-25,25),L.y+rand(-25,25));p.gasCd=rand(7,11);}}
  if(p.retreatT>0){const R=p.retreatFrom;p.want=norm(p.x-R.x,p.y-R.y);p.sprint=false;if(Math.random()<.04){p.sayT=0;say(p,pick(['Backup bhejo!','Peeche hato, sab peeche!','Control room, crowd bahut bada hai!']));}return;}
  if(p.role!=='holder'&&p.role!=='guard'){let k=null,bd=420*420;for(const q of S.carriers||[]){if(q===p||q.state!=='active')continue;const dd=d2(q.x,q.y,p.x,p.y);if(dd<bd){bd=dd;k=q;}}if(k){copDetainCheck(p,48);const a=(p.id%4)/4*TAU;const tx=k.x+Math.cos(a)*34,ty=k.y+Math.sin(a)*34;p.want=dist(p.x,p.y,tx,ty)>10?pathTo(p,tx,ty):{x:0,y:0};p.sprint=dist(p.x,p.y,tx,ty)>90;return;}}
  copDetainCheck(p,48);let tx=p.x,ty=p.y,run=false;
  if(p.role==='holder'){const gi=p.gate,g=GATE_DEFS[gi],G=S.gates[gi];
   if(G.up){tx=g.x-g.nx*18+g.tx*p.slot*22;ty=g.y-g.ny*18+g.ty*p.slot*22;
    if(p.gasCd<=0&&G.crowd>=4&&S.cans.length<14){let sx=0,sy=0,n=0;query(g.ox,g.oy,230,o=>{if(o.team==='P'&&o.mode!=='idle'){sx+=o.x;sy+=o.y;n++;}});if(n>=4){throwGas(p,sx/n+rand(-40,40),sy/n+rand(-40,40));p.gasCd=rand(7,12);}}}
   else{let t=null,bd=230*230;query(g.x,g.y,230,o=>{if(o.team==='P'&&dist(o.x,o.y,ZONE.x,ZONE.y)<ZONE.R+40){const dd=d2(o.x,o.y,g.x,g.y);if(dd<bd){bd=dd;t=o;}}});if(t){tx=t.x;ty=t.y;}else{tx=g.x+g.tx*p.slot*20;ty=g.y+g.ty*p.slot*20;}}}
  else if(p.role==='guard'){const b=p.bar;const s=Math.sign((ZONE.x-b.x)*b.nx+(ZONE.y-b.y)*b.ny)||1;
   if(b.up){tx=b.x+b.nx*s*22+b.tx*p.slot*24;ty=b.y+b.ny*s*22+b.ty*p.slot*24;if(p.gasCd<=0&&b.nPush>=3&&S.cans.length<14){throwGas(p,b.x-b.nx*s*70+rand(-30,30),b.y-b.ny*s*70+rand(-30,30));p.gasCd=rand(9,14);}}
   else{let t=null,bd=200*200;query(b.x,b.y,200,o=>{if(o.team==='P'&&o.mode!=='idle'){const dd=d2(o.x,o.y,p.x,p.y);if(dd<bd){bd=dd;t=o;}}});if(t&&dist(t.x,t.y,b.x,b.y)<260){tx=t.x;ty=t.y;}else{tx=b.x+b.nx*s*10;ty=b.y+b.ny*s*10;}}}
  else if(p.role==='squad'){const L=p.squadOf;if(!L||L.state==='gone'){p.state='gone';return;}let t=null,bd=150*150;query(L.x,L.y,150,o=>{if(o.team==='P'&&o.mode!=='idle'&&o.mode!=='sit'&&!shielded(o)){const dd=d2(o.x,o.y,L.x,L.y);if(dd<bd){bd=dd;t=o;}}});
   if(t&&p.cd<=0){tx=t.x;ty=t.y;}else{const a=(p.slot/3)*TAU+S.tick*.006;tx=L.x+Math.cos(a)*36;ty=L.y+Math.sin(a)*36;run=dist(p.x,p.y,tx,ty)>120;}}
  else if(p.role==='hunter'){
   if(!p.tgt||p.tgt.state!=='active'||p.tgtT<=0){p.tgtT=2;let best=null,bs=1e12;for(const o of wantedTargets()){const d=d2(o.x,o.y,p.x,p.y);if(d>1300*1300)continue;const sc=d/(1+wantedLvl(o)*2+(o.ctl==='human'?1.5:0)+(o.followers.length>4?1:0));if(sc<bs){bs=sc;best=o;}}p.tgt=best;}
   p.tgtT-=.15;
   if(p.tgt){const t=p.tgt,d=dist(p.x,p.y,t.x,t.y);tx=t.x+t.vx*.4;ty=t.y+t.vy*.4;run=d<260&&p.sta>25;
    if(p.megaCd<=0&&d<240&&t.followers.length>=6)megaphone(p);
    if(p.gasCd<=0&&d<420&&d>90&&S.cans.length<14){let n=0;query(t.x,t.y,110,o=>{if(o.team==='P')n++;});if(n>=4){throwGas(p,t.x,t.y);p.gasCd=rand(6,10);}}
    if(p.eCd<=0&&d<180&&d>60&&t.vx*t.vx+t.vy*t.vy>2000){const n2=norm(t.vx,t.vy);makeBar(t.x+n2.x*80,t.y+n2.y*80,Math.atan2(n2.y,n2.x)+Math.PI/2,90,35,{name:'Police barricade',ttl:20,owner:p});p.eCd=rand(18,26);say(p,'Barricade lagao!');}}
   else{if(!p.wp||d2(p.x,p.y,p.wp.x,p.wp.y)<80*80||Math.random()<.004){const c=pick(CHECKS);p.wp={x:c.x+rand(-120,120),y:c.y+rand(-120,120)};}tx=p.wp.x;ty=p.wp.y;}}
  else{let t=null,bd=1e12;query(ZONE.x,ZONE.y,ZONE.R+260,o=>{if(o.team!=='P'||o.mode==='idle'||o.mode==='sit')return;const od=dist(o.x,o.y,ZONE.x,ZONE.y);if(od>ZONE.R-8&&!(isPlayerish(o)||o.mode==='lead'))return;let dd=d2(o.x,o.y,p.x,p.y);if(isPlayerish(o)||o.mode==='lead')dd*=.5;if(dd<bd){bd=dd;t=o;}});
   if(t){tx=t.x;ty=t.y;if(p.gasCd<=0&&S.cans.length<14){let n=0;query(JM.x,JM.y,JM.r,o=>{if(o.team==='P'&&o.mode!=='sit')n++;});if(n>=5&&dist(p.x,p.y,JM.x,JM.y)>90){throwGas(p,JM.x+rand(-60,60),JM.y+rand(-60,60));p.gasCd=rand(10,15);}}}
   else{p.patrolA=(p.patrolA||Math.random()*TAU)+.03;tx=JM.x+Math.cos(p.patrolA)*(JM.r+40);ty=JM.y+Math.sin(p.patrolA)*(JM.r+40);}}
  const d=dist(p.x,p.y,tx,ty);p.want=d>8?(p.role==='hunter'||p.role==='squad'?pathTo(p,tx,ty):norm(tx-p.x,ty-p.y)):{x:0,y:0};p.sprint=run;
  if(!p.want.x&&!p.want.y&&p.role==='holder'){const g=GATE_DEFS[p.gate];p.face=Math.atan2(g.ny,g.nx);}}
 // ---------- tear gas
 function throwGas(c,tx,ty){const max=650,d=dist(c.x,c.y,tx,ty);if(d>max){tx=c.x+(tx-c.x)/d*max;ty=c.y+(ty-c.y)/d*max;}const dd=dist(c.x,c.y,tx,ty);S.cans.push({id:S.nid++,x:c.x,y:c.y,sx:c.x,sy:c.y,tx,ty,t:0,T:.35+dd/850,state:'fly',age:0,r:0,life:7,kicks:0,owner:c,h:0,hit:new Set()});if(c.stats)c.stats.gas++;fx('thump',c.x,c.y);}
 function updateCans(dt){for(let i=S.cans.length-1;i>=0;i--){const c=S.cans[i];
  if(c.state==='fly'){c.t+=dt;const k=Math.min(1,c.t/c.T);c.x=c.sx+(c.tx-c.sx)*k;c.y=c.sy+(c.ty-c.sy)*k;c.h=30+Math.sin(k*Math.PI)*(40+dist(c.sx,c.sy,c.tx,c.ty)*.12)-30*k;if(k>=1){c.state='land';c.h=0;}continue;}
  c.age+=dt*(S.ev.rain?2:1);const grow=Math.min(1,c.age/1.1),fade=c.age>c.life-1.5?Math.max(0,(c.life-c.age)/1.5):1;c.r=(c.owner&&c.owner.ctl==='human'?150:115)*grow*fade;if(c.age>=c.life){S.cans.splice(i,1);continue;}
  let kicked=false;query(c.x,c.y,Math.max(c.r,24),p=>{if(p.team==='N')return;if(d2(p.x,p.y,c.x,c.y)<c.r*c.r){if(p.team==='P'&&!c.hit.has(p.id)){c.hit.add(p.id);if(c.owner&&c.owner.ctl==='human')addScore(c.owner,3);}p.gassed=p.gamT>0?0:(p.chaiT>0?.15:.35);
    if(c.owner&&c.owner.ctl==='human'&&p.team==='P'&&p.gamT<=0&&p.mode!=='idle'){const n=norm(p.x-c.x,p.y-c.y);const k=p.ctl==='npc'?95:45;p.kbx=(n.x||1)*k;p.kby=n.y*k;p.kbT=Math.max(p.kbT,.1);if(p.ctl==='npc'&&p.mode==='follow'&&Math.random()<dt*.06)scare(p,c.owner||c);}}
   if(!kicked&&p.team==='P'&&c.kicks<1&&c.age<2.6&&d2(p.x,p.y,c.x,c.y)<22*22&&p.mode!=='idle'){kicked=true;const dir={x:Math.cos(p.face),y:Math.sin(p.face)};c.sx=c.x;c.sy=c.y;c.tx=c.x+dir.x*300;c.ty=c.y+dir.y*300;c.t=0;c.T=.55;c.state='fly';c.age=0;c.r=0;c.kicks++;c.hit.clear();p.stats.kick++;
    if(p.ctl==='human'){toast(p,'Wapas bhej diya! ðŸ¦¶','#c5e1a5');addScore(p,25,'kick!');addStreak(p,15);}else if(Math.random()<.4)say(p,'Wapas! ðŸ¦¶');fx('thump',c.x,c.y);}});}}
 // ---------- barriers
 function applyPush(o,dt){const eff=o.nPush-.7*o.nHold;if(eff<=0)return false;const dmg=3.4*Math.pow(eff,1.45)*dt;if(o.armor>0)o.armor=Math.max(0,o.armor-dmg);else o.hp-=dmg;
  for(const p of o.pushers)if(p.ctl==='human')addScore(p,dmg/Math.max(1,o.nPush)*1.5);return o.hp<=0;}
 function updateBarriers(dt){
  for(let gi=0;gi<GATE_DEFS.length;gi++){const g=GATE_DEFS[gi],G=S.gates[gi];G.nPush=0;G.nHold=0;G.crowd=0;G.pushers=[];let reb=0,near=0;
   query(g.ox,g.oy,200,p=>{if(p.team==='P'&&p.mode!=='idle')G.crowd++;});
   query(g.x,g.y,110,p=>{if(p.team==='P'&&p.mode!=='idle'){near++;const dx=p.x-ZONE.x,dy=p.y-ZONE.y,d=hypot(dx,dy);if(G.up&&d>ZONE.R&&d<ZONE.R+p.r+(p.shoveT>0?34:24)&&Math.abs(angDiff(Math.atan2(dy,dx),g.ang))<=g.half+.05){const inward=-(p.want.x*g.nx+p.want.y*g.ny);if(inward>.3||p.shoveT>0){p.pushing={gi};G.nPush+=(p.gassed>0&&p.gamT<=0?.35:1)*(p.ctl==='human'?(p.shoveT>0?1.7:1.2):1);G.pushers.push(p);}}}
    else if(p.team==='C'&&p.stun<=0){const dd=d2(p.x,p.y,g.x,g.y);if(dd<80*80&&dist(p.x,p.y,ZONE.x,ZONE.y)<ZONE.R+4)G.nHold+=p.gassed>0?.6:1;if(dd<70*70)reb++;}});
   if(G.up){if(applyPush(G,dt)){G.up=false;G.hp=0;G.rebuild=0;feed(`ðŸš§ ${g.name} gate of Jantar Mantar TOOT GAYA!`,'#ffcc80');fx('break',g.x,g.y,1);for(const p of G.pushers){if(p.ctl==='human'){addScore(p,150,'GATE TODA!');p.stats.brk++;p.runBrk=(p.runBrk||0)+1;}addStreak(p,100);}}
    else if(G.nPush<.5&&G.nHold>0)G.hp=Math.min(G.max,G.hp+2.5*dt);
    if(G.nPush>0)query(g.x,g.y,90,c=>{if(c.ctl==='human'&&c.team==='C')addScore(c,dt*2);});}
   else{if(near===0){G.rebuild+=dt*(.065+.05*Math.min(3,reb));if(G.rebuild>=1){G.up=true;G.hp=55;G.rebuild=0;feed(`ðŸš§ Police rebuilt the ${g.name} gate`,'#90caf9');query(g.x,g.y,80,c=>{if(c.ctl==='human'&&c.team==='C')addScore(c,60,'REBUILT');});}}else G.rebuild=Math.max(0,G.rebuild-dt*.05);}}
  for(let i=S.bars.length-1;i>=0;i--){const b=S.bars[i];b.ttl-=dt;if(b.ttl<=0){S.bars.splice(i,1);S.barsVer++;continue;}
   b.nPush=0;b.nHold=0;b.pushers=[];let near=0,reb=0;
   query(b.x,b.y,b.len/2+40,p=>{if(p.team==='C'&&p.stun<=0){b.nHold+=1;reb++;return;}if(p.team!=='P'||p.mode==='idle')return;near++;if(!b.up||p.pushing)return;const q=barClosest(b,p.x,p.y);const qd=dist(p.x,p.y,q.x,q.y);const sh=p.shoveT>0;if(qd>p.r+(sh?28:16))return;const into=-((p.x-q.x)*p.want.x+(p.y-q.y)*p.want.y)/(qd||1);if(into>.3||sh){p.pushing=b;b.nPush+=(p.gassed>0&&p.gamT<=0?.35:1)*(p.ctl==='human'?(sh?1.7:1.2):1);b.pushers.push(p);}});
   if(b.up){if(applyPush(b,dt)){b.up=false;b.hp=0;b.downT=0;S.barsVer++;feed(`ðŸš§ ${b.name} broken!`,'#ffcc80');fx('break',b.x,b.y,0);for(const p of b.pushers){if(p.ctl==='human'){addScore(p,b.check?80:40,b.check?'CHECKPOINT!':'');p.stats.brk++;p.runBrk=(p.runBrk||0)+1;}addStreak(p,b.check?60:20);}if(!b.check)b.ttl=4;}
    else if(b.owner&&b.owner.ctl==='human'&&b.nPush>0)addScore(b.owner,dt);}
   else if(b.check){b.downT+=dt;if((near===0&&b.downT>(reb>0?6:14))||b.downT>60){b.up=true;b.hp=b.max;S.barsVer++;if(b.downT<=60)query(b.x,b.y,80,c=>{if(c.ctl==='human'&&c.team==='C')addScore(c,60,'REBUILT');});}}}}
 function updateGherao(){for(const c of S.ents){if(c.team!=='C'||c.state!=='active'||c.stun>0||c.gheraoImm>0||c.carrying)continue;const cin=d2(c.x,c.y,ZONE.x,ZONE.y)<ZONE.R*ZONE.R;let n=0,cx=0,cy=0;const hum=[];
  query(c.x,c.y,50,o=>{if(o.team!=='P'||o.mode==='idle'||o.mode==='scared'||o.dispT>0)return;const oin=d2(o.x,o.y,ZONE.x,ZONE.y)<ZONE.R*ZONE.R;if(oin===cin){n+=1;cx+=o.x;cy+=o.y;if(o.ctl==='human')hum.push(o);}});
  if(n>=4){throwCop(c,cx/n,cy/n,n);c.sayT=0;say(c,pick(['Arre arre! Neeche utaro!','Meri topi! Meri topi kahan gayi?','Main toh bas duty kar raha tha!','Control room, backup bhejo!']));if(c.ctl==='human')toast(c,'UTHA KE FEK DIYA! ðŸ˜µ The crowd threw you out. Bring backup!','#ef9a9a',1);for(const h of hum){addScore(h,40,'GHERAO!');addStreak(h,20);}}}}
 // ---------- buses (detention)
 function updateBuses(dt){
   S.carriers=[];for(const p of S.ents){if(p.state!=='carried')continue;const c=p.carrier;p.carryT+=dt;if(c)S.carriers.push(c);p.struggle=Math.max(0,(p.struggle||0)-dt*.8);
   if(!c||c.state!=='active'||c.team!=='C'||c.carrying!==p){releaseCarried(p,c&&c.state==='active'?c:null);continue;}
   p.x=c.x;p.y=c.y+1;if((!c.carryBus||c.carryBus.state!=='load')&&(S.tick+p.id)%15===0)c.carryBus=nearestBusFor(c.x,c.y);
   let n=0,sx=0,sy=0,cn=0;const res=[];query(c.x,c.y,70,o=>{if(o.team==='C'&&o!==c&&o.state==='active'&&o.stun<=0)cn++;});query(c.x,c.y,50,o=>{if(o.team==='P'&&o!==p&&o.state==='active'&&o.mode!=='idle'&&o.mode!=='scared'&&o.dispT<=0){n++;sx+=o.x;sy+=o.y;if(isPlayerish(o))res.push(o);}});
   if(p.ctl==='bot'&&Math.random()<dt*2.2)p.struggle+=1;
       p.resc=Math.max(0,(p.resc||0)+dt*(n>=3?(n-2-2*cn)/9:-.5));const smax=Math.min(13,8+2.5*cn);p.strgMax=smax;if(p.resc>=1||p.struggle>=smax){const why=p.resc>=1?'rescue':'wriggle';p.resc=0;releaseCarried(p,c,why);p.ghost=Math.max(p.ghost||0,1.5);throwCop(c,n?sx/n:p.x+rand(-5,5),n?sy/n:p.y-8,Math.max(4,n));inc(p,'free');for(const r of res)if(r.ctl==='human'){inc(r,'free');addScore(r,40,'RESCUE!');addStreak(r,25);}continue;}
   const b=c.carryBus;const bd=b?dist(c.x,c.y,b.x,b.y):1e9;if(p.bestBd===undefined||bd<p.bestBd-40){p.bestBd=bd;p.progT=p.carryT;}const stuck=p.carryT-p.progT>4;
   if((b&&b.state==='load'&&bd<80)||stuck||p.carryT>(c.ctl==='human'?14:12)){p.bestBd=undefined;c.carrying=null;inc(c,'carry');sendToBus(p,c);}}
  for(let i=S.busRespawn.length-1;i>=0;i--)if(S.busRespawn[i].at<=S.tick){parkBus(S.busRespawn[i].st);S.busRespawn.splice(i,1);}
  // protesters can push a loading detention bus apart (police nerf): it frees everyone aboard,
  // then a stop van returns after ~12 s. Works on the vans that drive in mid-arrest too, not just
  // parked ones. Cops nearby blunt the push, like barricades.
  for(const b of S.buses.slice()){if(b.state!=='load')continue;
   b.bpush=0;b.bhold=0;const pushers=[];
   query(b.x,b.y,100,p=>{if(p.team==='C'&&p.stun<=0){b.bhold++;return;}if(p.team!=='P'||p.state!=='active'||p.mode==='idle')return;
    const d=dist(p.x,p.y,b.x,b.y);if(d>85)return;const moving=p.want.x||p.want.y;
    // a detained leader's called kafila mobs the van: their presence rocks it, no run-up needed
    const L=p.leader,resc=p.mode==='follow'&&L&&(L.state==='escort'||L.state==='bus')&&L.esc&&L.esc.bus===b&&answering(p,L);
    // players pass through the van (nothing blocks them), so on the hull any movement is a push;
    // outside it, only movement toward the van counts
    const into=d<26?1:((b.x-p.x)*p.want.x+(b.y-p.y)*p.want.y)/(d||1);
    if(resc||p.shoveT>0||(moving&&(into>.25||d<26))){b.bpush+=(p.gassed>0&&p.gamT<=0?.35:1)*(p.ctl==='human'?(p.shoveT>0?2.6:1.2):1);pushers.push(p);}});
   // nobody can rock it from inside, but a detainee who is calling their kafila shares the credit
   for(const h of b.humans)if((h.callR||0)>=1)pushers.push(h);
   if(b.bpush>0){const eff=b.bpush-.7*b.bhold;
    // a van shrugs off a handful of pushers: real damage needs a proper mob (roughly a 10-12+ kafila)
    if(eff>0){b.bhp=Math.max(0,b.bhp-.6*Math.pow(Math.max(0,eff-4),1.5)*dt);
     // the driver won't pull away while the crowd is rocking the van (up to ~4Ã— the loading time)
     b.t=Math.max(0,b.t-dt*.75);
     if(Math.random()<dt*2.5)fx('shove',b.x+rand(-24,24),b.y+rand(-12,12),0);
     if(b.bhp<=0){b.state='wreck';const bi=S.buses.indexOf(b);if(bi>=0)S.buses.splice(bi,1);
      if(b.stop){S.busRespawn.push({st:b.stop,at:S.tick+30*12});b.stop=null;}
      fx('break',b.x,b.y,0);
      for(const p of pushers)if(p.ctl==='human'){addScore(p,150,'BUS TODA!');p.stats.brk++;p.runBrk=(p.runBrk||0)+1;addStreak(p,100);}
      feed('ðŸšŒ Andolankaris pushed a detention bus apart! Sab azad!','#a5d6a7');
      for(const h of b.humans){h.state='active';place(h,b.x+rand(-55,55),b.y+rand(-45,45));h.ghost=2;h.vx=h.vy=0;h.trail=[];h.best=1e9;toast(h,'ðŸšŒ BUS TODA! You are free â€” wapas chalo, dharna pe!','#a5d6a7',1);}
      for(const p of S.ents)if(p.state==='escort'&&p.esc&&p.esc.bus===b){p.state='active';p.esc=null;place(p,b.x+rand(-45,45),b.y+rand(-40,40));p.ghost=2;}
      continue;}}
    else b.bhp=Math.min(b.bmax,b.bhp+2*dt);}
   else if(b.bhp<b.bmax)b.bhp=Math.min(b.bmax,b.bhp+5*dt);}
  for(const p of S.ents){if(p.callR){p.callR*=Math.exp(-dt/CALL_TAU);if(p.callR<.05)p.callR=0;}
   if(p.team==='P'&&isPlayerish(p)&&p.followers.length>(p.peakK||0))p.peakK=p.followers.length;
   if(p.ctl==='bot'&&(p.state==='escort'||p.state==='bus')&&Math.random()<dt*5.5)p.callR=(p.callR||0)+1;
   if(p.state!=='escort')continue;const E=p.esc;E.t+=dt;// longer drags take longer, so a far bus looks like a drag, not a teleport
   const k=Math.min(1,E.t/Math.min(2.2,Math.max(.8,(E.d0||80)/300))),b=E.bus;p.x=E.x0+(b.x-E.x0)*k;p.y=E.y0+(b.y-E.y0)*k;
   if(k>=1){if(!b.count)b.t=0;b.count++;if(isPlayerish(p)){p.state='bus';b.humans.push(p);toast(p,'ðŸšŒ Inside the van! TAP FAST to call your kafila â€” the faster you tap, the more come to break it open!','#90caf9',1);}else p.state='gone';}}
  for(let i=S.buses.length-1;i>=0;i--){const b=S.buses[i];b.t+=dt;
   if(b.state==='load'){if(b.stop?((b.count>0&&b.t>BUS_WAIT)||b.count>=10):((b.count>0?b.t>BUS_WAIT:b.t>8)||b.count>=14)){if(b.stop){S.busRespawn.push({st:b.stop,at:S.tick+30*10});b.stop=null;}b.state='drive';b.t=0;fx('horn',b.x,b.y);
    for(const h of b.humans){pfx(h,'busgo',b.dest.n);endRun(h);
     if(h.followers.length){feed(`ðŸ“£ ${h.name}'s kafila couldn't stop the van â€” it scattered!`,'#90caf9');for(const f of h.followers){f.mode='free';f.leader=null;}h.followers=[];}}continue;}continue;}
   const dx=b.dest.x-b.x,dy=b.dest.y-b.y,d=hypot(dx,dy);const fast=b.humans.some(h=>h.ctl==='human'&&h.ffwd)?3.2:1;const sp=Math.min(d,Math.min(1,b.t)*720*fast*dt);b.vx=dx/(d||1);b.vy=dy/(d||1);b.x+=b.vx*sp;b.y+=b.vy*sp;
   for(const h of b.humans){h.x=b.x;h.y=b.y;}
   if(d<30){for(const h of b.humans){h.state='active';place(h,b.dest.x+rand(-40,40),b.dest.y+rand(-40,40));h.ghost=3;h.vx=h.vy=0;h.trail=[];h.best=1e9;toast(h,`Released from ${b.dest.n} after chai & paperwork. Grab a ðŸ›µ or the ðŸš‡ to get back!`,'#fff',1);}S.buses.splice(i,1);}}}
 // ---------- events
 const EVDEF={
  internet:{dur:25},metro:{dur:35,start(){for(const n of MCLOSE)S.closed[n]=1;},end(){S.closed={};}},
  vajra:{dur:10,start(e){const cand=S.bars.filter(b=>b.check&&b.up).concat(GATE_DEFS.map(g=>({x:g.x-g.nx*120,y:g.y-g.ny*120})));let best=cand[0],bs=-1;for(const c of cand){let n=0;query(c.x,c.y,260,o=>{if(o.team==='P'&&o.mode!=='idle')n++;});if(n>bs){bs=n;best=c;}}e.x=best.x;e.y=best.y;e.n=7;e.cd=1;},
   update(e,dt){e.cd-=dt;if(e.n>0&&e.cd<=0){e.n--;e.cd=1.1;let sx=0,sy=0,n=0;query(e.x,e.y,320,o=>{if(o.team==='P'&&o.mode!=='idle'){sx+=o.x;sy+=o.y;n++;}});throwGas({x:e.x,y:e.y-30},(n?sx/n:e.x)+rand(-80,80),(n?sy/n:e.y)+rand(-80,80));}}},
  viral:{dur:12,start(){for(const pk of S.pockets)for(let i=0;i<2;i++)if(npcPCountCache<opts.npcCap)addPocketMember(pk);}},
  trend:{dur:30,start(e){e.m=(Math.random()*NM)|0;S.trend=e.m;for(const pk of S.pockets)if(pk.mud===e.m)for(let i=0;i<3;i++)if(npcPCountCache<opts.npcCap+20)addPocketMember(pk).mud=e.m;for(let i=0;i<6;i++){const sp=spawnPointP();const x=mk({team:'P',mode:'free',mud:e.m});place(x,sp.x,sp.y);}},end(){S.trend=-1;}},
  reinforce:{dur:40,start(){for(let i=0;i<6;i++){const a=Math.random()*TAU;spawnCop('rover',{look:1,temp:1,x:JM.x+Math.cos(a)*150,y:JM.y+Math.sin(a)*150});}},end(){for(const e of S.ents)if(e.temp)e.state='gone';}},
 };
 function startEvent(id){SC=null;const def=EVDEF[id];const e={t:def.dur};S.ev[id]=e;if(def.start)def.start(e);fx('event',0,0,id,e.m);}
 function updateEvents(dt){S.nextEv-=dt;if(S.nextEv<=0&&Object.keys(S.ev).length<2){const ids=Object.keys(EVDEF).filter(k=>!S.ev[k]&&k!==S.lastEv);S.lastEv=pick(ids);startEvent(S.lastEv);S.nextEv=rand(24,36);}
  for(const id in S.ev){const e=S.ev[id];e.t-=dt;if(EVDEF[id].update)EVDEF[id].update(e,dt);if(e.t<=0){delete S.ev[id];if(EVDEF[id].end)EVDEF[id].end(e);}}}
 // ---------- per-tick pieces
 function onWall(e){if(e.team!=='P')return false;const dd=d2(e.x,e.y,ZONE.x,ZONE.y);if(dd>(ZONE.R+31)*(ZONE.R+31)||dd<(ZONE.R-31)*(ZONE.R-31))return false;const d=Math.sqrt(dd);if(Math.abs(d-ZONE.R)>30)return false;const a=Math.atan2(e.y-ZONE.y,e.x-ZONE.x);for(let i=0;i<GATE_DEFS.length;i++){const g=GATE_DEFS[i];if(Math.abs(angDiff(a,g.ang))<=g.half+.05)return false;}return true;}
function speedMult(e){let m=1;if(onWall(e))m*=.06;if(e.kafLag)m*=.72;if(e.carrying)m*=.8;if(e.wetT>0)m*=.6;if(e.gassed>0&&e.gamT<=0)m*=e.team==='P'?.5:.8;if(inRiver(e.x,e.y))m*=.5;if(S.ev.rain)m*=.88;if(e.boostT>0)m*=1.3;if(e.catchT>0)m*=1.5;if(e.chaiT>0)m*=1.2;if(e.stun>0)m=0;for(let i=0;i<S.slow.length;i++){const z=S.slow[i];if(d2(e.x,e.y,z.x,z.y)<z.r*z.r)m*=z.k;}for(let i=0;i<SLOWPERM.length;i++){const z=SLOWPERM[i];if(d2(e.x,e.y,z.x,z.y)<z.r*z.r)m*=z.k;}return m;}
 function speedOf(e){if(e.mode==='idle')return 45;if(e.mode==='sit')return 0;let s=SPEED[e.team]||120;if(e.ctl==='human'&&e.team==='P')s*=1.06;return s*speedMult(e);}
 function humanInput(e){let inp=null;if(e.inq.length){inp=e.inq.shift();e.ack=inp.s;e.last=inp;
   while(e.inq.length>2){const x=e.inq.shift();e.ack=x.s;inp={...x,aim:inp.aim??x.aim,a:inp.a||x.a,d:inp.d||x.d,e:inp.e||x.e,g:inp.g||x.g,f:inp.f||x.f,r:inp.r||x.r,q:inp.q>=0?inp.q:x.q};e.last=inp;}}
  else inp=e.last?{...e.last,a:0,e:0,g:0,f:0,r:0,q:-1}:null;
  if(!inp){e.want={x:0,y:0};return;}
  const mx=clamp(+inp.x||0,-1,1),my=clamp(+inp.y||0,-1,1),m=hypot(mx,my);e.want=m>1?{x:mx/m,y:my/m}:{x:mx,y:my};e.sprint=e.team==='P'&&!!inp.sp;e.ffwd=!!inp.a||!!inp.ff;
  if(e.state==='hidden'){e.want={x:0,y:0};if(inp.a||inp.e)unhide(e);return;}
  if(e.state==='carried'){if(inp.a||inp.e){e.struggle=(e.struggle||0)+1;pfx(e,'wriggle',Math.round(e.struggle));}return;}
  if(e.state==='bus'||e.state==='escort'){if(inp.a||inp.e){e.callR=(e.callR||0)+1;pfx(e,'wriggle',1);}return;}
  if(e.state!=='active'||S.round.over)return;
  if(e.fasting){e.want={x:0,y:0};if(inp.a||inp.e)endFast(e,'up');return;}
  if(e.team==='P'){if(inp.a||inp.e||inp.r){e.hitchT=0;doCtx(e);}
   else if(e.ffwd){
    // holding at a detention van always rocks it â€” a filming crew or dance spot must not steal the hold
    let vb=null;for(const b of S.buses)if(b.state==='load'&&b.bmax&&d2(b.x,b.y,e.x,e.y)<90*90){vb=b;break;}
    if(vb)shove(e,vb,false);
    else{const cx=ctxOf(e),pt=cx.k===3?null:pushTarget(e);
     // likewise a barricade: a metro station, crew, dance spot or HALLA BOL next to it must not swallow the hold
     // (a pulled-over bike still wins: hitching is hold-only and the label says so)
     if(pt)shove(e,pt,false);
     else{
     if(cx.k===3){e.hitchT=(e.hitchT||0)+1/30;if(e.hitchT>=.5){e.hitchT=0;hitch(e,cx.o);}}
     else e.hitchT=0;}}}
   else e.hitchT=0;
  }
  else{
   if(inp.g&&e.stun<=0&&e.gasCd<=0){throwGas(e,+inp.g[0]||e.x,+inp.g[1]||e.y);e.gasCd=e.pbT>0?2:4;}
   if(inp.a){if(Number.isFinite(+inp.aim))e.face=+inp.aim;swing(e,null);}
  }
}
 function stallTouch(e){for(const st of S.stalls){if(d2(st.x,st.y,e.x,e.y)>42*42)continue;if((st.cd[e.id]||0)>S.tick)continue;const H=e.ctl==='human';
   if(st.type==='golgappa'){st.cd[e.id]=S.tick+30*30;e.sta=100;e.tired=false;e.boostT=5;if(H){toast(e,'ðŸŒ¶ï¸ Golgappe! Teekha paani = turbo mode (stamina full)','#ffe0b2');addScore(e,5);}}
   if(st.type==='tanker'){st.cd[e.id]=S.tick+30*40;e.gassed=0;if(e.team==='P')e.gamT=Math.max(e.gamT,12);if(H){toast(e,'ðŸ’¦ Delhi Jal Board tanker! Washed off the gas. (First time it arrived on time.)','#b3e5fc');addScore(e,5);}}
   if(st.type==='selfie'){st.cd[e.id]=S.tick+30*60;e.reelT=Math.max(e.reelT,15);if(H){toast(e,'ðŸ¤³ '+pick(SELFIE)+' Â· LIVE Ã—2 for 15s','#f8bbd0');addScore(e,10);}}
   if(st.type==='sulabh'){st.cd[e.id]=S.tick+30*60;e.sta=100;e.tired=false;if(H){toast(e,'ðŸš» Sulabh Shauchalaya: â‚¹5 well spent. Relief +10','#c5e1a5');addScore(e,10);}}
   if(st.type==='paan'){st.cd[e.id]=S.tick+30*30;if(H){if(e.team==='P'){let best=0,bs=1e9;S.gates.forEach((g,i)=>{const s=g.up?g.nHold*10+g.hp:-100;if(s<bs){bs=s;best=i;}});toast(e,'ðŸƒ '+pick(PAAN_P(GATE_DEFS[best].name)),'#a5d6a7');}else{const w=wantedTargets().filter(isPlayerish).sort((a,b)=>b.streak-a.streak)[0];toast(e,w?`ðŸƒ Paanwala: "Woh ${w.name}? Abhi ${Math.abs(w.x-e.x)>Math.abs(w.y-e.y)?(w.x>e.x?'east':'west'):(w.y>e.y?'south':'north')} ki taraf gaya"`:'ðŸƒ Paanwala: "Sab shaant hai sahab. Ek meetha paan?"','#a5d6a7');}addScore(e,3);}}}}
 function interview(e,crew){if(crew.godi){godiInterview(e,crew);return;}if(e.team==='P')inc(e,'int');crew.cd=e.ctl==='human'?45:60;crew.target=null;crew.retarget=0;e.reelT=Math.max(e.reelT,20);fx('interview',e.x,e.y,crew.rep.id);
  crew.rep.sayT=0;say(crew.rep,pick(REP_Q));setTimeout0(()=>{e.sayT=0;say(e,e.team==='P'?pick(ANS_P):pick(ANS_C));},20);
  if(e.team==='P'){const n=Math.max(0,Math.min(4,KAFILA_CAP-e.followers.length));for(let i=0;i<n;i++){const a=Math.random()*TAU,r=rand(220,320);const f=mk({team:'P',mode:'follow',mud:e.mud});place(f,e.x+Math.cos(a)*r,e.y+Math.sin(a)*r);f.leader=e;f.boostT=3;e.followers.push(f);}
   addScore(e,60,'ON TV!');addStreak(e,30);if(e.ctl==='human')toast(e,`ðŸ“º ${crew.ch} par aap LIVE! ${n} log TV dekh ke aa gaye âœŠ (LIVE Ã—2 for 20s)`,'#f8bbd0',1);}
  else{addScore(e,40,'PRESS CONF');if(e.ctl==='human')toast(e,`ðŸ“º "Situation under control hai" (you, live on ${crew.ch}). +40`,'#90caf9',1);}}
 const LATER=[];function setTimeout0(fn,ticks){LATER.push([S.tick+ticks,fn]);}
 function updateGodi(m,dt){const rep=m.rep;let tx,ty;m.sayT-=dt;
  if(m.fleeT>0){m.fleeT-=dt;m.target=null;tx=m.fleeTo.x;ty=m.fleeTo.y;}
  else{if(m.target&&(m.target.state!=='active'||m.target.followers.length<2))m.target=null;
   if(m.retarget<=0){m.retarget=3;let best=null,bs=0;for(const e of S.ents){if(e.team!=='P'||!isPlayerish(e)||e.state!=='active'||e.followers.length<3)continue;if(S.media.some(o=>o!==m&&o.godi&&o.target===e))continue;const d=dist(e.x,e.y,rep.x,rep.y);if(d>2600)continue;const sc=(e.followers.length+(e.ctl==='human'?6:0))/(1+d/800);if(sc>bs){bs=sc;best=e;}}m.target=best;}
   const t=m.target;if(t){const d=dist(t.x,t.y,rep.x,rep.y),n=norm(rep.x-t.x,rep.y-t.y);tx=t.x+n.x*105;ty=t.y+n.y*105;
    if(d<155&&t.followers.length){if(m.sayT<=0){m.sayT=rand(3,5);rep.sayT=0;say(rep,pick(GODI_Q));}
     m.drainT-=dt;if(m.drainT<=0){m.drains=(m.drains||0)+1;m.drainT=m.drains%3===0?6:2.6;let f=null,bd=1e12;for(const o of t.followers){const dd=d2(o.x,o.y,rep.x,rep.y);if(dd<bd){bd=dd;f=o;}}if(f){scare(f,t,true);if(Math.random()<.5){f.sayT=0;say(f,pick(GODI_LEAVE));}if(t.ctl==='human'){pfx(t,'godi');if((t.godiTip||0)<=S.tick){t.godiTip=S.tick+30*7;toast(t,'ðŸ“¢ Sensational Media is distracting your kafila! Get 5 people around the anchor to chase them off','#ef9a9a');}}}}}}
   else{const h=hottest();tx=h.x+((rep.id%3)-1)*110;ty=h.y-80;}
   if((S.tick+rep.id)%6===0){let n=0;query(rep.x,rep.y,48,o=>{if(o.team==='P'&&o.state==='active'&&o.mode!=='idle'&&o.mode!=='scared')n++;});
    if(n>=5){const sp=pick(N.SPAWNS_P);m.fleeT=20;m.fleeTo={x:sp.x,y:sp.y};m.target=null;fx('goback',rep.x,rep.y,rep.id);rep.sayT=0;say(rep,pick(['Yeh hamla hai! Camera bandh karo!','Desh dekh raha hai! Bhaago!','Strategic retreat! Debate break!']));
     feed(pick([`ðŸ“¢ ${m.ch} anchor chased away! Calls it a "strategic debate break"`,`ðŸ“¢ "GO BACK!" ${m.ch} crew flees, blames pamphlets`,`ðŸ“¢ ${m.ch} van spotted leaving at 80 km/h, live coverage paused`]),'#a5d6a7');
     query(rep.x,rep.y,170,o=>{if(o.ctl==='human'&&o.team==='P'){inc(o,'godi');addScore(o,60,'GO BACK!');addStreak(o,20);}});}}}
  if((S.tick+rep.id)%6===0){const d=dist(rep.x,rep.y,tx,ty);rep.want=d>12?pathTo(rep,tx,ty):{x:0,y:0};rep.spd=m.fleeT>0?230:d>300?185:140;}}
 function godiInterview(e,crew){crew.cd=e.ctl==='human'?30:45;fx('interview',e.x,e.y,crew.rep.id);crew.rep.sayT=0;say(crew.rep,pick(GODI_Q));
  if(e.team==='C'){addScore(e,50,'PRIME TIME');setTimeout0(()=>{e.sayT=0;say(e,pick(ANS_C));},20);return;}
  setTimeout0(()=>{e.sayT=0;say(e,pick(ANS_P));},20);const vir=Math.min(160,20+e.followers.length*10);addScore(e,vir,'VIRAL (edited)');addStreak(e,e.followers.length>=4?60:10);const n=Math.ceil(e.followers.length*.25);const fs=e.followers.slice().sort(()=>Math.random()-.5).slice(0,n);for(const f of fs)scare(f,crew.rep,true);
  feed(`ðŸ“¢ ${crew.ch} EXCLUSIVE: "${e.name} fueled by ${pick(['biryani','Chacha ji','pizza','his mausi in Jaipur','passion','local samosas (source: WhatsApp)'])}"`,'#ffab91');
  if(e.ctl==='human')toast(e,`ðŸ“¢ Sensational Media! Your byte got edited. +${vir} viral points${n?`, but ${n} of your kafila went home`:''}`,'#ffab91',1);}
 function updateMedia(dt){for(const m of S.media){m.cd-=dt;m.retarget-=dt;const rep=m.rep;if(m.godi){updateGodi(m,dt);continue;}
  if(m.target&&m.target.state!=='active')m.target=null;
  if(m.retarget<=0){m.retarget=4;let best=null,bs=-1;for(const e of S.ents){if(e.team!=='P'||!isPlayerish(e)||e.state!=='active')continue;if(S.media.some(o=>o!==m&&o.target===e))continue;const d=dist(e.x,e.y,rep.x,rep.y);if(d>2200)continue;const sc=(e.ctl==='human'?3:1)*(1+e.followers.length*.3+wantedLvl(e))/(1+d/600);if(sc>bs){bs=sc;best=e;}}m.target=best;}
  let tx,ty;if(m.target){const t=m.target,d=dist(t.x,t.y,rep.x,rep.y);const n=norm(rep.x-t.x,rep.y-t.y);const back=m.cd>0?150:60;tx=t.x+n.x*back;ty=t.y+n.y*back;if(d<110&&m.cd<=0){if(Math.random()<dt*.35)say(rep,pick(REP_Q));if(t.ctl==='bot'&&Math.random()<dt*.5)interview(t,m);}}
  else{const h=hottest();tx=h.x+((rep.id%3)-1)*90;ty=h.y+70;}
  if((S.tick+rep.id)%6===0){const d=dist(rep.x,rep.y,tx,ty);rep.want=d>12?pathTo(rep,tx,ty):{x:0,y:0};rep.spd=d>300?190:130;}}
  for(let i=LATER.length-1;i>=0;i--)if(LATER[i][0]<=S.tick){const f=LATER[i][1];LATER.splice(i,1);f();}}
 // VARUN water cannons: park at a post with a 360Â° turret; every so often drive to a new post in front of the biggest kafila
 function cannonPost(w){if((S.jmCrowd||0)>=8){let cl=null,cd=1e12;for(const o of S.cannons){const d=d2(o.x,o.y,JM.x,JM.y);if(d<cd){cd=d;cl=o;}}if(cl===w){let g=null,gd=1e12;for(const G of GATE_DEFS){const d=d2(G.ox,G.oy,w.x,w.y);if(d<gd){gd=d;g=G;}}const n=norm(g.ox-ZONE.x,g.oy-ZONE.y);w.trackId=-1;return{x:ZONE.x+n.x*(ZONE.R+100),y:ZONE.y+n.y*(ZONE.R+100)};}}
  let best=null,bs=0;for(const e of S.ents){if(e.team!=='P'||e.state!=='active'||!(isPlayerish(e)||e.mode==='lead'))continue;const n=e.followers.length;if(n<4)continue;if(d2(e.x,e.y,ZONE.x,ZONE.y)<(ZONE.R+200)**2)continue;const d=dist(e.x,e.y,w.x,w.y);if(d>2000)continue;if(S.cannons.some(o=>o!==w&&o.trackId===e.id))continue;const sc=n/(1+d/600);if(sc>bs){bs=sc;best=e;}}
  if(!best){w.trackId=0;return{x:w.home.x,y:w.home.y};}w.trackId=best.id;const n=norm(JM.x-best.x,JM.y-best.y);
  for(const k of[170,120,230,80]){const x=best.x+n.x*k,y=best.y+n.y*k;if(!pointInBuilding(x,y,24)&&d2(x,y,ZONE.x,ZONE.y)>(ZONE.R+110)**2)return{x,y};}return{x:best.x,y:best.y};}
 function updateCannons(dt){for(const w of S.cannons){w.cd-=dt;w.relocT-=dt;
  if(w.stall>0){w.stall-=dt;w.spray=0;w.vx=w.vy=0;if(w.stall<=0)w.relocT=0;continue;}
  let crowd=0;query(w.x,w.y,75,o=>{if(o.team==='P'&&o.mode!=='idle'&&o.mode!=='scared')crowd++;});
  if(crowd>=9){w.stall=4;w.spray=0;w.driving=false;feed('ðŸ’¦ A VARUN water cannon got surrounded and backed off!','#ffcc80');say(w,'Paani khatam! Peeche chalo!');continue;}
  if(!w.driving&&w.relocT<=0){w.post=cannonPost(w);w.driving=dist(w.x,w.y,w.post.x,w.post.y)>40;w.relocT=w.driving?99:rand(6,10);w.spray=0;}
  if(w.driving){w.spray=0;if((S.tick+w.id)%6===0){const d=dist(w.x,w.y,w.post.x,w.post.y);if(d<35){w.driving=false;w.vx=w.vy=0;w.relocT=rand(12,18);}else{const n=pathTo(w,w.post.x,w.post.y);w.vx=n.x*165;w.vy=n.y*165;w.ang=Math.atan2(n.y,n.x);}}}
  else{w.vx=w.vy=0;let tgt=null,bd=320*320;query(w.x,w.y,320,o=>{if(o.team!=='P'||o.mode==='idle'||o.mode==='scared'||o.state!=='active')return;const dd=d2(o.x,o.y,w.x,w.y);if(dd<bd){bd=dd;tgt=o;}});
   if(tgt){const df=angDiff(Math.atan2(tgt.y-w.y,tgt.x-w.x),w.sang);w.sang+=clamp(df,-2.2*dt,2.2*dt);
    if(w.cd<=0&&Math.abs(df)<.35){w.spray=(w.spray||0)+dt;if(w.spray>5){w.spray=0;w.cd=3;}const sa=w.sang+Math.sin(S.tick*.08)*.2;
     query(w.x,w.y,310,o=>{if(o.team!=='P'||o.mode==='idle'||o.state!=='active')return;const an=Math.atan2(o.y-w.y,o.x-w.x);if(Math.abs(angDiff(an,sa))>.38)return;o.kbx=Math.cos(an)*230;o.kby=Math.sin(an)*230;o.kbT=.12;o.wetT=1.2;o.gassed=0;if(o.ctl==='npc'&&o.mode==='follow'&&Math.random()<dt*(o.leader&&isPlayerish(o.leader)&&o.leader.followers.length>=8?.04:.3))scare(o,w);if(o.ctl==='human'&&Math.random()<dt*.6)toast(o,'ðŸ’¦ VARUN water cannon! Bheeg gaye, slowed down','#90caf9');});}
    else if(w.cd>0)w.spray=0;}
   else{w.spray=0;w.sang+=dt*.5;if((S.tick+w.id)%30===0&&w.relocT>3){let near=null;query(w.x,w.y,520,o=>{if(o.team==='P'&&o.state==='active'&&o.followers&&o.followers.length>=4){near=o;return false;}});if(near&&d2(near.x,near.y,ZONE.x,ZONE.y)>(ZONE.R+200)**2){const n=norm(near.x-w.x,near.y-w.y);const x=w.x+n.x*160,y=w.y+n.y*160;if(!pointInBuilding(x,y,24)){w.post={x,y};w.driving=true;}}}}}
  w.x+=w.vx*dt;w.y+=w.vy*dt;collideBuildings(w);{const m=ZONE.R+95,dz=dist(w.x,w.y,ZONE.x,ZONE.y);if(dz<m){const n=norm(w.x-ZONE.x,w.y-ZONE.y);w.x=ZONE.x+n.x*m;w.y=ZONE.y+n.y*m;}}}}
 function updateMonkeys(dt){for(const m of S.monkeys){m.cd-=dt;
  if(m.run>0){m.run-=dt;m.x+=m.vx*dt;m.y+=m.vy*dt;if(m.run<=0){m.carry='';}continue;}
  m.t-=dt;if(m.t<=0){m.t=rand(1.5,4);const a=Math.random()*TAU,s=Math.random()<.5?0:45;m.vx=Math.cos(a)*s;m.vy=Math.sin(a)*s;if(d2(m.x,m.y,m.hx,m.hy)>130*130){const n=norm(m.hx-m.x,m.hy-m.y);m.vx=n.x*60;m.vy=n.y*60;}}
  m.x+=m.vx*dt;m.y+=m.vy*dt;
  if(m.cd<=0)query(m.x,m.y,36,e=>{if(!isPlayerish(e))return;const keys=['chaiT','reelT','gamT','pbT'].filter(k=>e[k]>0);if(!keys.length)return;const k=keys.sort((a,b)=>e[b]-e[a])[0];e[k]=0;m.carry=k;m.run=3;m.cd=12;const n=norm(m.x-e.x,m.y-e.y);m.vx=n.x*190;m.vy=n.y*190;fx('steal',m.x,m.y);if(e.ctl==='human')toast(e,pick(MONKEY).replace('{b}',BUFFN[k]),'#ffcc80');return false;});}}
 // one tick, split into phases: smaller functions stay optimized by V8 (one huge function kept deoptimizing as a whole)
 function step(){
  const dt=DT;S.tick++;const R=S.round;
  if(R.over){R.overT-=dt;if(R.overT<=0)newRound();return;}
  R.t-=dt;updateEvents(dt);
  if(S.tick%30===0){balanceBots();if(S.tick%150===0)updateTarget();}
  stepThink(dt);stepMove(dt);stepWorld(dt);stepPlayers(dt,R);stepCrowd(dt,R);
  if(R.meter>=R.target)endRound('P');else if(R.t<=0)endRound('C');
  if(S.fx.length&&S.fx[0].t<S.tick-60)S.fx=S.fx.filter(f=>f.t>=S.tick-60);
 }
 function stepThink(dt){
  gridBuild();
  for(const e of S.ents){if(e.sayT>0)e.sayT-=dt;if(e.chatT>0)e.chatT-=dt;if(e.ctl==='human')humanInput(e);}
  for(const e of S.ents){if(e.state!=='active'||e.ctl==='human')continue;e.thinkT-=dt;if(e.thinkT>0)continue;e.thinkT=rand(.12,.2);
   if(e.team==='C')thinkC(e);else if(e.team==='P'){if(e.mode==='idle')thinkIdle(e);else if(e.mode==='follow')thinkFollower(e);else if(e.mode==='lead')thinkLeader(e);else if(e.mode==='sit')e.want={x:0,y:0};else if(e.mode==='scared'&&e.home){const h=e.home;if(d2(e.x,e.y,h.x,h.y)<22*22){e.state='gone';fx('door',h.x,h.y);}else{e.want=pathTo(e,h.x,h.y);e.sprint=!e.calmRun&&e.scT<3;e.thinkT=.3;}}else if(e.mode==='scared'){if(!e.moving&&e.scT>.4){const a=Math.atan2(e.flee.y,e.flee.x)+(Math.random()<.5?1.6:-1.6);e.flee={x:Math.cos(a),y:Math.sin(a)};}e.want=e.flee;e.sprint=!e.calmRun;}else thinkFree(e);}}
 }
 function stepMove(dt){
  for(const e of S.ents){e.sx=0;e.sy=0;}
  // separation: same as query(p.x,p.y,22,...) for every body, written out to avoid a closure per body per tick.
  // Each pair is handled once (by the lower id; separate() ignores the other order and NPCs), so test that first.
  for(let ci=0;ci<S.cells.length;ci++){const a=S.cells[ci];for(let i=0;i<a.length;i++){const p=a[i];if(p.team==='N')continue;const x=p.x,y=p.y,x0=((x-22)/64)|0,x1=((x+22)/64)|0,y0=((y-22)/64)|0,y1=((y+22)/64)|0;
   for(let cx=x0;cx<=x1;cx++)for(let cy=y0;cy<=y1;cy++){const b=gridCell(cx,cy);if(!b)continue;for(let j=0;j<b.length;j++){const o=b[j];if(o.id<=p.id||o.team==='N')continue;if(d2(o.x,o.y,x,y)<=484)separate(p,o);}}}}
  const gd=S.gates.map(g=>!g.up);
  for(const e of S.ents){if(e.state!=='active')continue;
   if(e.gassed>0)e.gassed-=dt;if(e.stun>0)e.stun-=dt;e.cd-=dt;e.gasCd-=dt;e.abCd-=dt;e.eCd-=dt;e.megaCd-=dt;e.swingCd-=dt;if(e.swingT>0)e.swingT-=dt;e.metroCd-=dt;e.gateT-=dt;e.gheraoImm-=dt;if(e.ghost>0)e.ghost-=dt;if(e.boostT>0)e.boostT-=dt;if(e.catchT>0)e.catchT-=dt;if(e.chaiT>0)e.chaiT-=dt;if(e.gamT>0)e.gamT-=dt;if(e.pbT>0)e.pbT-=dt;if(e.reelT>0)e.reelT-=dt;if(e.dispT>0)e.dispT-=dt;if(e.wetT>0)e.wetT-=dt;if(e.fleeT>0)e.fleeT-=dt;if(e.shoveT>0)e.shoveT-=dt;if(e.hbCd>0)e.hbCd-=dt;if(e.chargeT>0)e.chargeT-=dt;if(e.hideCd>0)e.hideCd-=dt;if(e.flyT>0)e.flyT-=dt;if(e.retreatT>0)e.retreatT-=dt;if(e.mode==='scared')e.scT+=dt;
   if(e.kbT>0){e.kbT-=dt;e.sx+=e.kbx*dt;e.sy+=e.kby*dt;}
   let spd=speedOf(e);if(e.dashT>0){e.dashT-=dt;spd*=3;}
   // stamina: hitting 0 makes you tired (sprint locked out) until it regens back to 30,
   // otherwise a tick of regen would re-engage sprint and you could jog forever on an empty bar
   const sp=e.sprint&&!e.tired&&e.sta>0&&(e.want.x||e.want.y);
   if(sp){spd*=SPEED.sprint;e.sta=Math.max(0,e.sta-28*dt);if(e.sta<=0)e.tired=true;}
   else{e.sta=Math.min(100,e.sta+14*dt);if(e.tired&&e.sta>=30)e.tired=false;}
   if(e.team==='N'){const mv=moveBody(e,e.want.x,e.want.y,e.spd||110,dt,gd,S.bars);e.moving=mv>dt*20;if(e.moving)e.face=Math.atan2(e.want.y,e.want.x);continue;}
   let wx=e.want.x,wy=e.want.y;if(e.unT>0){e.unT-=dt;wx=e.unD.x;wy=e.unD.y;}
   const mv=moveBody(e,wx,wy,spd,dt,gd,S.bars);e.moving=mv>dt*25;
   // an AI that keeps walking into something sidesteps for a moment (no NPC frozen against a wall)
   if(e.ctl!=='human'&&e.unT<=0&&!e.pushing&&e.stun<=0&&spd>20&&(wx*wx+wy*wy)>.09&&mv<spd*dt*.15){e.stk+=dt;if(e.stk>1.5){const s=(e.id+((S.tick/90)|0))%2?1:-1;e.unT=.7;e.unD={x:-wy*s,y:wx*s};e.stk=0;e.stuckN++;if(e.mode==='scared'&&e.home&&e.stuckN>=2){e.home=null;e.stuckN=0;}}}else{if(e.stk)e.stk=Math.max(0,e.stk-dt);if(e.stuckN&&mv>spd*dt*.6)e.stuckN=0;}if(e.moving&&(e.want.x||e.want.y)&&e.swingT<=0)e.face=Math.atan2(e.want.y,e.want.x);
   if(e.followers.length||isPlayerish(e)){e.trailT-=dt;if(e.trailT<=0){e.trailT=.1;const l=e.trail[e.trail.length-1];if(!l||d2(l.x,l.y,e.x,e.y)>64){e.trail.push({x:e.x,y:e.y});if(e.trail.length>40)e.trail.shift();}}}}
 }
 function stepWorld(dt){
  gridBuild();
  for(const e of S.ents)e.pushing=null;
  updateBarriers(dt);updateGherao();updateCans(dt);updateBuses(dt);updateMedia(dt);updateCannons(dt);
  const hot=hottest();
  for(const n of S.ents){if(n.team!=='N')continue;let tx=n.x,ty=n.y;if(n.role==='chaiwala'){tx=n.home.x-30;ty=n.home.y+18;}if(n.role==='reporter')continue;if(n.role==='camera'){tx=n.buddy.x+30;ty=n.buddy.y+10;n.spd=n.buddy.spd||130;}if((S.tick+n.id)%6===0){const d=dist(n.x,n.y,tx,ty);n.want=d>10?pathTo(n,tx,ty):{x:0,y:0};}if(!n.moving)n.face=n.role==='chaiwala'?Math.PI/2:Math.atan2(hot.y-n.y,hot.x-n.x);}
  for(const r of S.riders){if(r.carry){const p=r.carry;if(p.state!=='riding'){r.carry=null;continue;}
   // the bike cuts across town, but around buildings â€” and over a bridge, never across the Yamuna:
   // first drive to the bridge entrance on this bank, then straight along the bridge to the far side
   let gx=r.tx,gy=r.ty;
   const bankR=r.x>riverL(r.y),bankT=r.tx>riverL(r.ty);
   if(bankR!==bankT||inRiver(r.x,r.y)){const by=Math.abs(r.y-2650)<Math.abs(r.y-4000)?2650:4000;
    gx=(onBridge(r.y)||inRiver(r.x,r.y))?riverL(by)+(bankT?340:-40):riverL(by)+(bankR?340:-40);gy=by;}
   const n=pathTo(r,gx,gy)||norm(gx-r.x,gy-r.y);const dw=dist(r.x,r.y,gx,gy);const s=Math.min(dw,300*dt);
   r.vx=n.x*300;r.vy=n.y*300;r.x+=n.x*s;r.y+=n.y*s;collideBuildings(r);p.x=r.x;p.y=r.y;
   if(dist(r.x,r.y,r.tx,r.ty)<12){p.state='active';r.carry=null;p.ghost=1.2;place(p,r.x,r.y+16);toast(p,pick(['Order delivered! â­â­â­â­â­ "Bhaiya, tip?"','Delivered in 9 min 59 sec! "Rating dena 5 star"','Order delivered! Packaging: 1 andolankari, slightly shaken']),'#ffcc80');addScore(p,20);const n2=newRider();Object.assign(r,{road:n2.road,i:n2.i,t:n2.t,dir:n2.dir,x:n2.x,y:n2.y});}continue;}
   // riders pull over and wait when a protester walks up (hitching is hold-to-ride now), but not forever
   let wait=false;for(const q of S.ents){if(q.team==='P'&&q.ctl==='human'&&q.state==='active'&&d2(q.x,q.y,r.x,r.y)<110*110){wait=true;break;}}
   if(wait){r.waitT=(r.waitT||0)+dt;if(r.waitT<5){r.vx=r.vy=0;}else wait=false;}
   if(!wait){r.waitT=0;stepAlong(r,dt);if(d2(r.x,r.y,ZONE.x,ZONE.y)<(ZONE.R+160)**2){r.dir*=-1;stepAlong(r,dt);}}
   r.saidT-=dt;if(r.saidT<=0){r.saidT=rand(8,14);if(S.bars.some(b=>b.up&&d2(b.x,b.y,r.x,r.y)<140*140))say(r,pick(['Bhaiya order hai, jaane do! ðŸ•','Customer andar hai sir!','10 minute delivery hai!']));}}
  if(S.tick%150===0){const hs=S.ents.filter(h=>h.ctl==='human'&&h.state==='active');if(hs.length)for(const r of S.riders){if(r.carry||hs.some(h=>d2(h.x,h.y,r.x,r.y)<1800*1800))continue;const n2=newRider();Object.assign(r,{road:n2.road,i:n2.i,t:n2.t,dir:n2.dir,x:n2.x,y:n2.y});}}
 }
 function stepPlayers(dt,R){
  for(const e of S.ents)if(e.state==='hidden'){e.hideT-=dt;if(e.hideT<=0)unhide(e);}
  for(const e of S.ents){if(!e.fasting)continue;if(e.state!=='active'){endFast(e,'broken');continue;}const m=e.fasting;e.x=m.x;e.y=m.y;e.vx=e.vy=0;e.fastT+=dt;meterAdd(dt*.08);if(e.fastT>=40)endFast(e,'hospital');}
  if(S.tick%60===13&&S.mats)for(const e of S.ents){if(e.ctl!=='bot'||e.team!=='P'||e.state!=='active'||e.fasting||!e.inPlaza||Math.random()>.1)continue;const m=S.mats.find(q=>!q.by&&d2(q.x,q.y,e.x,e.y)<90*90);if(!m)continue;let cop=false;query(e.x,e.y,200,o=>{if(o.team==='C'&&o.state==='active'){cop=true;return false;}});if(!cop)startFast(e,m);}
  if(S.tick%15===7)for(const e of S.ents)if(e.ctl==='human'&&e.state!=='gone'){e.mis=e.mis||[];updateMissions(e);}
  for(const e of S.ents){if(!isPlayerish(e)||e.state!=='active')continue;stallTouch(e);
   if(e.dangerT>0)e.dangerT-=dt;
   if(e.team==='P'&&(S.tick+e.id)%10===0&&e.followers.length>=4){let cx=0,cy=0;for(const f of e.followers){cx+=f.x;cy+=f.y;}cx/=e.followers.length;cy/=e.followers.length;const lag=dist(e.x,e.y,cx,cy)>110+Math.sqrt(e.followers.length)*14;if(lag&&!e.kafLag&&e.ctl==='human'&&(e.lagTip||0)<=S.tick){e.lagTip=S.tick+30*8;toast(e,'â³ Kafila peeche reh gaya! You slow down until they catch up','#ffcc80');}e.kafLag=lag;e.kafC=lag?[Math.round(cx),Math.round(cy)]:null;}else if(e.team==='P'&&(S.tick+e.id)%10===0){e.kafLag=false;e.kafC=null;}
   if(e.team==='P'&&(S.tick+e.id)%10===0){if(e.followers.length){let dn=false;query(e.x,e.y,230,o=>{if(o.team==='C'&&o.state==='active'&&o.stun<=0){dn=true;return false;}});if(dn)e.dangerT=1.5;}
    for(const cm of CCTV){if(d2(cm.x,cm.y,e.x,e.y)>110*110)continue;e.cctv=e.cctv||{};if((e.cctv[cm.i]||0)>S.tick)break;e.cctv[cm.i]=S.tick+30*25;fx('cctv',cm.x,cm.y,e.id);if(e.followers.length>=3){addStreak(e,30);if(e.ctl==='human')toast(e,'ðŸ“¹ CCTV: face matched! Notice file getting thickerâ€¦','#ffcc80');}break;}
    if(e.ctl==='bot'&&e.followers.length>=6&&Math.random()<.08)hallaBol(e);
    if(e.ctl==='bot'&&(e.hideCd||0)<=0){const sp=HIDES.find(h=>d2(h.x,h.y,e.x,e.y)<55*55);if(sp){let cop=false;query(e.x,e.y,170,o=>{if(o.team==='C'&&o.state==='active'){cop=true;return false;}});if(cop){hideIn(e,sp);continue;}}}}if(e.team==='P'&&(S.tick+e.id)%4===0)touchRecruit(e);
   for(let i=S.pickups.length-1;i>=0;i--){const k=S.pickups[i];if(d2(k.x,k.y,e.x,e.y)>26*26)continue;if(k.type==='gamchha'&&e.team!=='P')continue;S.pickups.splice(i,1);const H=e.ctl==='human';
    if(k.type==='chai'){e.chaiT=15;if(H)toast(e,'â˜• Chai! Speed +20% (15s)','#ffe0b2');}if(k.type==='samosa'){e.sta=100;e.tired=false;e.boostT=4;if(H)toast(e,'ðŸ¥Ÿ Samosa! Full stamina','#ffe0b2');}if(k.type==='gamchha'){e.gamT=20;e.gassed=0;if(H)toast(e,'ðŸ§£ Wet gamchha! Tear gas can\'t touch you (20s)','#c5e1a5');}
    if(k.type==='powerbank'){e.pbT=40;if(H)toast(e,e.team==='P'?'ðŸ”‹ Power bank! Bigger Naara range, and your map works in a shutdown (40s)':'ðŸ”‹ Power bank! Tear gas reloads 2Ã— faster (40s)','#b3e5fc');}
    if(k.type==='reel'){e.reelT=20;addScore(e,40,'VIRAL REEL');if(H)toast(e,'ðŸ“± Your reel went viral! LIVE Ã—2 points for 20s','#f8bbd0');}
    if(k.type==='funding'){addScore(e,15,'FUNDING');if(H)toast(e,e.team==='P'?pick(FUNDING):pick(FUNDING_C),'#f8bbd0');}
    pfx(e,'pickup',k.type);S.pickTimers.push(S.tick+30*20);}}
  for(let i=S.pickTimers.length-1;i>=0;i--)if(S.pickTimers[i]<=S.tick){S.pickTimers.splice(i,1);const p=newPickup();if(p)S.pickups.push(p);}
  for(const e of S.ents){if(!isPlayerish(e)||e.state!=='active')continue;
   if(e.metroCd<=0&&e.ctl!=='human'){for(const m of METRO){if(d2(e.x,e.y,m.x,m.y)>32*32)continue;rideMetro(e,m);break;}}
   if(e.team==='P'){const d=dist(e.x,e.y,JM.x,JM.y);if(d<e.best-50){if(e.best<1e8)addScore(e,Math.floor((e.best-d)/50)*5);e.best=d;}
    e.peakK=Math.max(e.peakK||0,e.followers.length);
    if(d<JM.r){if(!e.inPlaza){e.inPlaza=true;if(!e.arrivedRun){e.arrivedRun=true;R.arr++;e.stats.arr++;R.mud[e.mud]++;meterAdd(12);const bonus=250+e.followers.length*10;addScore(e,bonus,'PAHUNCH GAYE!');addStreak(e,150);fx('arrive',e.x,e.y,e.id);feed(`âœŠ ${e.name} reached Jantar Mantar for ${MUDDAS[e.mud].e} ${MUDDAS[e.mud].n}! Dharna shuru!`,'#ffcc80');if(e.ctl==='human')pfx(e,'arrived',bonus);}}
     e.holdT+=dt;meterAdd(dt*.75*(S.contested?.4:1));e.holdAcc+=dt;if(e.holdAcc>=1){e.holdAcc-=1;const mult=1+Math.min(3,e.holdT/20);addScore(e,Math.round((3*mult+e.followers.length*.3)*(e.fasting?2:1)));}
     for(const m of[15,30,60,90,120,180,240])if(e.holdMs<m&&e.holdT>=m){e.holdMs=m;if(e.ctl==='human')pfx(e,'hold',m);feed(`ðŸ”¥ ${e.name} has held the dharna for ${m}s!`,'#ffab40');addStreak(e,40);}}
    else e.inPlaza=false;}}
 }
 function stepCrowd(dt,R){
  let pin=0,npcIn=0;for(const e of S.ents){if(e.mode==='sit'){e.sitT-=dt;if(e.sitT<=0)e.state='gone';}if(e.team==='P'&&e.state==='active'){if(e.inPlaza&&isPlayerish(e))pin++;else if(e.ctl==='npc'&&d2(e.x,e.y,JM.x,JM.y)<JM.r*JM.r)npcIn++;}if(e.ttl!==undefined){e.ttl-=dt;if(e.ttl<=0)e.state='gone';}}
  S.pin=pin;if(S.tick%15===0){let n=0,cn=0;query(JM.x,JM.y,JM.r+40,o=>{if(o.state!=='active')return;if(o.team==='P')n++;else if(o.team==='C'&&o.stun<=0)cn++;});S.jmCrowd=n;S.contested=cn>=2;if(n>=5)query(JM.x,JM.y,JM.r+40,o=>{if(o.team==='C'&&o.ctl==='human'&&o.state==='active'&&o.stun<=0)addScore(o,1);});}meterAdd(dt*Math.min(.28,npcIn*.014));
  if(pin||npcIn>=8){S.calm=0;S.waveT-=dt;if(S.waveT<=0){S.wave++;S.waveT=25;const n=Math.min(12,2+S.wave+pin+(paceRatio()>1.3?2:0)),g=GATE_DEFS[(Math.random()*GATE_DEFS.length)|0];for(let i=0;i<n;i++)spawnCop('rover',{look:1,temp:1,ttl:45,x:g.ix+rand(-30,30),y:g.iy+rand(-30,30)});fx('event',0,0,'wave',S.wave);}}
  else{S.calm+=dt;if(S.calm>15){S.wave=0;S.waveT=6;}}
  for(const e of S.ents)if(e.team==='P'&&e.ctl==='npc'&&e.state==='active'&&e.mode!=='sit'&&d2(e.x,e.y,JM.x,JM.y)<JM.r*JM.r*.5&&e.mode!=='follow'&&e.mode!=='scared'){e.mode='sit';e.sitT=20;e.leader=null;}
  for(const e of S.ents)if(e.followers.length)e.followers=e.followers.filter(f=>f.state==='active'&&f.leader===e);
  if(S.tick%15===0){const hs=S.ents.filter(h=>h.ctl==='human'&&h.state!=='gone');for(const e of S.ents){if(e.mode!=='scared'||e.state!=='active')continue;const seen=hs.some(h=>Math.abs(h.x-e.x)<760&&Math.abs(h.y-e.y)<480);if(e.scT>14)e.state='gone';else if(e.scT>2.5&&!seen){e.home=null;if(Math.random()<.35)e.state='gone';else{e.mode='free';e.fleeT=0;e.sprint=false;e.noZone=false;}}}
   S.ents=S.ents.filter(e=>e.state!=='gone');let nP=0,nLead=0,nFree=0;for(const e of S.ents){if(e.team==='P'&&e.ctl==='npc'){nP++;if(e.mode==='lead')nLead++;if(e.mode==='free')nFree++;}}npcPCountCache=nP;
   for(const pk of S.pockets){pk.members=pk.members.filter(m=>m.state==='active'&&m.mode==='idle');pk.refill-=.5;if(pk.refill<=0){pk.refill=rand(2.5,4.5);if(pk.members.length<6&&nP<opts.npcCap)addPocketMember(pk);}}
   if(nLead<opts.npcLeaders&&Math.random()<.2)spawnLeader();
   if(nFree<14&&nP<opts.npcCap){const sp=spawnPointP();const e=mk({team:'P',mode:'free'});place(e,sp.x,sp.y);}}
 }
 function hottest(){let best=null,bs=0;for(let i=0;i<GATE_DEFS.length;i++){const s=S.gates[i].nPush*3+S.gates[i].crowd;if(s>bs){bs=s;best={x:GATE_DEFS[i].ox,y:GATE_DEFS[i].oy};}}for(const b of S.bars){const s=b.nPush*3;if(s>bs){bs=s;best={x:b.x,y:b.y};}}return best||{x:ZONE.x+ZONE.R+160,y:ZONE.y-60};}
 // ------------------------------------------------------------------ snapshots
 const dirCode=f=>{const c=Math.cos(f),s=Math.sin(f);if(Math.abs(c)>Math.abs(s)*1.05)return c<0?3:2;return s>0?0:1;};
 function entFlags(e){let f=0;if(e.moving)f|=1;if(e.gassed>0&&e.gamT<=0)f|=2;if(e.stun>0)f|=4;if(e.ghost>0)f|=8;if(e.mode==='sit'||(e.team==='P'&&!e.moving&&d2(e.x,e.y,JM.x,JM.y)<JM.r*JM.r))f|=16;if(e.mode==='lead'||(e.ctl!=='npc'&&e.team==='P'&&e.followers.length>=3))f|=32;if(e.state==='escort')f|=128;if(e.ctl==='human')f|=256;if(e.ctl==='bot')f|=512;if(e.chaiT>0)f|=1024;if(e.sprint&&e.moving)f|=2048;if(e.mode==='idle')f|=4096;if(e.gamT>0)f|=8192;if(e.dispT>0)f|=16384;if(e.wetT>0)f|=32768;if(e.flyT>0)f|=65536;if(e.mode==='scared')f|=131072;if(e.state==='carried')f|=262144;if(e.team==='P'&&e.state==='active'&&onWall(e))f|=2097152;if(e.fasting)f|=1048576;if(e.carrying)f|=524288;return f;}
 const TYPE={P:0,C:1,N:2};
 const entRow=(e,extraFlags)=>[e.id,TYPE[e.team],Math.round(e.x),Math.round(e.y),dirCode(e.face),entFlags(e)|(extraFlags||0),e.look,e.crew?(e.crew.cd<=0?1:0):wantedLvl(e),e.mud,e.esc?Math.round(e.esc.t*100):0,e.swingT>0?Math.round(e.swingT*100):0,e.followers.length];
 // Snapshots are built as plain data: arrays and objects of numbers and strings, never live sim objects, because the
 // server's codec (shared/snapcodec.js) keeps each player's last snapshot to diff against. Whatever is the same for
 // every client this tick (entity rows, room-wide state, minimap, leaderboard, names) is built once per tick and reused.
 let SC=null;const KEEP={};
 // a section equal to the one built last tick returns that same object, so the codec can skip it by reference
 function keep(name,v){const s=JSON.stringify(v),k=KEEP[name];if(k&&k.s===s)return k.v;KEEP[name]={s,v:JSON.parse(s)};return KEEP[name].v;}
 function shared(){if(SC&&SC.tick===S.tick)return SC;
  const R=S.round;let tm=-1,tb=0;R.mud.forEach((v,i)=>{if(v>tb){tb=v;tm=i;}});
  const sec={g:keep('g',S.gates.map(g=>[g.up?1:0,Math.round(g.hp),Math.round(g.nPush*10),Math.round(g.nHold*10),Math.round(g.armor),Math.round(g.rebuild*100)]))};
  if(S.vip.length)sec.vip=keep('vip',S.vip.map(v=>[Math.round(v.x),Math.round(v.y),v.dir]));
  sec.rd=keep('rd',[Math.ceil(R.t),Math.floor(R.meter),R.target,R.det,R.over?1:0,R.winner||'',Math.ceil(R.overT),R.num,tm,S.trend,S.wave,S.pin?Math.ceil(S.waveT):-1,R.arr,S.tally.P,S.tally.C,S.jmCrowd||0]);
  sec.ev=keep('ev',Object.keys(S.ev).map(k=>[k,Math.ceil(S.ev[k].t),S.ev[k].m]));
  if(S.ev.vajra)sec.vj=keep('vj',[Math.round(S.ev.vajra.x),Math.round(S.ev.vajra.y)]);
  sec.cl=keep('cl',Object.keys(S.closed));
  const byId=new Map(),special=[],cops=[];
  for(const e of S.ents){byId.set(e.id,e);if(e.state==='escort'||e.state==='arrived'||e.state==='carried')special.push(e);if(e.team==='C'&&e.state==='active'&&e.stun<=0)cops.push(e);}
  SC={tick:S.tick,sec,byId,special,cops,bm:null,mm:null,mmIds:null,lb:null,names:null};return SC;}
 const rowOf=e=>{if(e._sk!==SC){e._sk=SC;e._rs=entRow(e);}return e._rs;};
 const barRow=b=>{if(b._sk!==SC){b._sk=SC;b._rs=[b.id,Math.round(b.x),Math.round(b.y),Math.round(b.ang*1000),Math.round(b.len),b.up?1:0,Math.round(b.hp),b.max,Math.round(b.nPush*10),Math.round(b.nHold*10),b.check?(b.cordon?2:1):0,Math.round(b.armor)];}return b._rs;};
 const r2=v=>Math.round(v*100)/100; // like +v.toFixed(2), several times faster
 // timers as whole numbers (|0 keeps them integer-typed: arrays of them are much cheaper for the codec to diff)
 const cd10=v=>v>0?Math.ceil(v*10)|0:0,cd1=v=>v>0?Math.ceil(v)|0:0;
 function snapshotData(pid,view,cl){
  const sc=shared();
  const me=sc.byId.get(pid);const cx=me?me.x:ZONE.x,cy=me?me.y:ZONE.y;const hw=clamp(view&&view.w||1200,400,2200)/2+120,hh=clamp(view&&view.h||900,300,1600)/2+160;
  const x0=cx-hw,x1=cx+hw,y0=cy-hh,y1=cy+hh;const inV=(x,y,m)=>x>x0-m&&x<x1+m&&y>y0-m&&y<y1+m;
  // rows for the things in view (a loop, not filter().map(): one array instead of two)
  const near=(L,m,row)=>{const A=[];for(let i=0;i<L.length;i++){const v=L[i];if(inV(v.x,v.y,m))A.push(row(v));}return A;};
  const E=[];
  // every entity in a grid cell the view touches (walking the non-empty cells is cheaper than looking up each cell)
  const gx0=(x0/64)|0,gx1=(x1/64)|0,gy0=(y0/64)|0,gy1=(y1/64)|0;
  for(const a of S.cells)if(a.gx>=gx0&&a.gx<=gx1&&a.gy>=gy0&&a.gy<=gy1)for(let i=0;i<a.length;i++)E.push(rowOf(a[i]));
  for(const e of sc.special)if(inV(e.x,e.y,0))E.push(entRow(e,e.state==='escort'?128:e.state==='carried'?262144:16));
  const o={t:'s',tk:S.tick,e:E,...sc.sec};
  const B=[];for(const b of S.bars)if(inV(b.x,b.y,b.len))B.push(barRow(b));o.b=B;
  if(!cl||cl.barsVer!==S.barsVer){if(sc.bm===null)sc.bm=keep('bm',S.bars.map(b=>[b.id,Math.round(b.x),Math.round(b.y),b.up?1:0,b.check?1:0]));o.bm=sc.bm;if(cl)cl.barsVer=S.barsVer;}
  o.c=near(S.cans,140,c=>[c.id,Math.round(c.x),Math.round(c.y),Math.round(c.h),Math.round(c.r),c.kicks<1&&c.age<2.6&&c.state==='land'?1:0]);
  o.r=near(S.riders,60,r=>[r.id,Math.round(r.x),Math.round(r.y),dirCode(Math.atan2(r.vy,r.vx)),r.carry?r.carry.look:-1,r.brand,r.carry?r.carry.mud:0]);
  o.bus=near(S.buses,120,b=>[b.id,Math.round(b.x),Math.round(b.y),dirCode(Math.atan2(b.vy,b.vx)),b.count,b.state==='load'?1:0,b.bmax?Math.round(100*b.bhp/b.bmax):-1,busLeaves(b)]);
  o.k=near(S.pickups,30,k=>[k.id,Math.round(k.x),Math.round(k.y),k.type]);
  o.wc=near(S.cannons||[],120,w=>[w.id,Math.round(w.x),Math.round(w.y),Math.round(w.ang*100),w.spray>0?1:0,Math.round((w.sang||0)*100)]);
  o.mk=near(S.monkeys,30,m=>[Math.round(m.x),Math.round(m.y),m.run>0?1:0,m.carry,Math.round(m.vx)]);
  // S.fx is in tick order: start from the end and stop at what this player has already had (the last ~2 ticks, not 60)
  const since=cl?cl.fxTick:S.tick-1;const fxs=[],F=S.fx;let f0=F.length;while(f0>0&&F[f0-1].t>since)f0--;
  for(let i=f0;i<F.length;i++){const f=F[i];if(f.k==='feed'||f.k==='event'||f.k==='round'||f.k==='over'||(f.k==='arrive'&&f.a===pid)||inV(f.x,f.y,200))fxs.push(f._r||(f._r=[f.k,f.x,f.y,f.a,f.b,f.c]));}if(cl)cl.fxTick=S.tick;
  o.fx=fxs;
   if(me){const m={id:me.id,x:r2(me.x),y:r2(me.y),vx:r2(me.vx),vy:r2(me.vy),ack:me.ack,st:me.state,team:me.team,mud:me.mud,sc:Math.floor(me.score),k:me.followers.length,ks:me.followers.filter(f=>f.mud===me.mud).length,sm:Math.round(speedMult(me)*1000)/1000,sta:Math.round(me.sta),ti:me.tired?1:0,hb:cd10(me.hbCd),hc:cd10(me.hideCd),smx:Math.round(me.strgMax||10),cd:[cd10(me.abCd),cd10(me.eCd),cd10(me.gasCd),cd10(me.swingCd),cd10(me.megaCd)],bf:[cd1(me.chaiT),cd1(me.gamT),cd1(me.pbT),cd1(me.reelT)],stk:Math.floor(me.streak),wl:wantedLvl(me),live:(me.reelT>0||liveNear(me))?1:0,push:me.pushing?(me.pushing.gi!==undefined?[S.gates[me.pushing.gi].nPush,S.gates[me.pushing.gi].nHold]:[me.pushing.nPush,me.pushing.nHold]).map(v=>Math.round(v*10)):null,best:Math.round(me.best),hold:+(me.holdT||0).toFixed(1),inP:me.inPlaza?1:0,mult:+(1+Math.min(3,(me.holdT||0)/20)).toFixed(1),stats:{...me.stats},look:me.look,spawn:me.spawnName||''};
   if(me.state==='active')m.ctx=me.team==='P'?ctxOf(me).k:(METRO.some(o=>d2(me.x,me.y,o.x,o.y)<70*70)?7:0);
   if(me.team==='P'&&me.state==='active'){let h=null,hd=1100*1100;for(const o of sc.cops){if(o.state!=='active'||o.stun>0)continue;const dd=d2(o.x,o.y,me.x,me.y);if((o.tgt===me||dd<230*230)&&dd<hd){hd=dd;h=o;}}if(h)m.hunt=[h.id,Math.round(h.x),Math.round(h.y)];}
   if(me.team==='P'&&m.ctx===2){const st=METRO.find(o=>d2(me.x,me.y,o.x,o.y)<70*70);const to=st&&metroDest(st);m.metroTo=to?to.n:'';}
   if(me.carrying&&me.carryBus)m.carry=[Math.round(me.carryBus.x),Math.round(me.carryBus.y)];
   if(me.mis)m.mis=me.mis.map(q=>[q.txt,Math.min(q.n,Math.floor(cnt(me,q.k)-q.base)),q.n,q.rew]);
   if(me.kafC)m.lag=me.kafC;
   if(me.fasting)m.fast=+me.fastT.toFixed(1);
   if(me.state==='carried'){m.strg=Math.round(me.struggle||0);m.resc=+(me.resc||0).toFixed(2);}
   if(me.state==='hidden')m.hide=[Math.ceil(me.hideT),me.hideSpot?me.hideSpot.n:''];
   if(me.state==='bus'){const b=S.buses.find(b=>b.humans.includes(me));if(b)m.bus=[b.dest.n,Math.round(b.dest.x),Math.round(b.dest.y),busLeaves(b)];}
   // [kafila answering the call, kafila size] while the van is still loading
   if((me.state==='bus'||me.state==='escort')&&me.esc&&me.esc.bus&&me.esc.bus.state==='load')m.call=[callN(me),me.followers.length];
   o.me=m;
   if(me.fxq&&me.fxq.length){o.pf=me.fxq;me.fxq=[];}}
  // minimap: every 6 ticks, on the same ticks for everyone, and the same rows for everyone (mi = which one is you), so
  // the codec diffs it once per room. Row field 4 used to mark you; it stays 0 for clients that still read it.
  if(!cl||cl.mmT===undefined||((S.tick/6)|0)!==((cl.mmT/6)|0)){if(sc.mm===null){const rows=[],ids=[];for(const e of S.ents)if(isPlayerish(e)&&(e.state==='active'||e.state==='riding')){rows.push([Math.round(e.x/4),Math.round(e.y/4),e.team==='P'?0:1,e.ctl==='human'?1:0,0,wantedLvl(e)]);ids.push(e.id);}sc.mm=keep('mm',rows);sc.mmIds=ids;}
   o.mm=sc.mm;o.mi=sc.mmIds.indexOf(pid);if(cl)cl.mmT=S.tick;}
  if(!cl||S.tick-(cl.lbT||0)>=30){if(sc.lb===null)sc.lb=keep('lb',S.ents.filter(isPlayerish).sort((a,b)=>b.score-a.score).slice(0,12).map(e=>[e.id,e.name,Math.floor(e.score),e.team,e.ctl==='bot'?1:0,wantedLvl(e),e.mud,e.followers.length]));o.lb=sc.lb;if(cl)cl.lbT=S.tick;}
  if(!cl||cl.namesVer!==S.namesVer){if(sc.names===null)sc.names=keep('names',S.ents.filter(e=>e.name).map(e=>[e.id,e.name,e.team,e.ctl==='human'?1:e.ctl==='bot'?2:0,e.mud]));o.names=sc.names;if(cl)cl.namesVer=S.namesVer;}
  return o;}
 const snapshotJSON=(pid,view,cl)=>JSON.stringify(snapshotData(pid,view,cl));
 // object form, for offline play and tests
 function snapshot(pid,view,cl){const o=JSON.parse(snapshotJSON(pid,view,cl));o.t=S.tick;delete o.tk;return o;}
 function staticInfo(){return{pockets:N.POCKETS.map(p=>[p.x,p.y,p.type,p.label,p.mud]),spawnsP:N.SPAWNS_P.map(s=>[s.n,s.x,s.y]),spawnsC:N.SPAWNS_C.map(s=>[s.n,s.x,s.y]),quick:QUICK};}
 function stats(){const c=teamCounts();let humans=0;for(const e of S.ents)if(e.ctl==='human'&&e.state!=='gone')humans++;return{humans,P:c.P,C:c.C,ents:S.ents.length,round:S.round?S.round.num:0};}
 S.wave=0;S.waveT=12;S.calm=0;S.pin=0;S.round={t:opts.roundTime,arr:0,meter:0,target:8,det:0,over:false,num:0,mud:new Array(NM).fill(0)};
 newRound();
 return{step,addPlayer,removePlayer,setTeam,input,idleSeconds,snapshot,snapshotData,snapshotJSON,staticInfo,stats,S,DT,startEvent};
}
return{createSim,DT};
});


