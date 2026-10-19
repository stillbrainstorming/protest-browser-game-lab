// Shared, deterministic world data + physics. Loaded by the Node server (require) and the browser (window.World).
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.World=factory();})(typeof self!=='undefined'?self:this,function(){
'use strict';
const TAU=Math.PI*2;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const d2=(ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return dx*dx+dy*dy;};
// Math.hypot is several times slower than this (it guards against overflow, which world coordinates never reach)
const hypot=(x,y)=>Math.sqrt(x*x+y*y);
const dist=(ax,ay,bx,by)=>hypot(ax-bx,ay-by);
const angDiff=(a,b)=>{let d=(a-b)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};
const norm=(x,y)=>{const m=hypot(x,y);return m>1e-6?{x:x/m,y:y/m}:{x:0,y:0};};
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function segDist(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;const l=dx*dx+dy*dy;let t=l?((px-ax)*dx+(py-ay)*dy)/l:0;t=clamp(t,0,1);return hypot(px-(ax+dx*t),py-(ay+dy*t));}
function shade(hex,k){const n=parseInt(hex.slice(1),16),r=n>>16,g=n>>8&255,b=n&255;const f=v=>clamp(Math.round(k<0?v*(1+k):v+(255-v)*k),0,255);return'#'+((1<<24)|(f(r)<<16)|(f(g)<<8)|f(b)).toString(16).slice(1);}

const WORLD=6000;
const CP={x:3000,y:2000};
const JM={x:3300,y:2950,r:150};
const ZONE={x:3300,y:2950,R:340};
const ROADS=[
 {n:'Sansad Marg',w:56,p:[[3060,2556],[3110,2900],[3220,3340]]},
 {n:'Janpath',w:58,p:[[2905,2552],[2860,3200],[2860,3900]]},
 {n:'Jantar Mantar Rd',w:48,p:[[2877,2950],[4024,2950]]},
 {n:'Kartavya Path',w:84,p:[[1650,3900],[4040,3900]]},
 {n:'Barakhamba Rd',w:52,p:[[3507,2237],[3720,2357]]},
 {n:'Tilak Marg',w:52,p:[[3838,2483],[4300,3640]]},
 {n:'ITO Rd',w:52,p:[[3888,2420],[4600,2650]]},
 {n:'Vikas Marg',w:60,p:[[4600,2650],[5200,2650],[6000,2650]]},
 {n:'Minto Rd',w:56,p:[[3000,1440],[3000,1000],[3400,700],[4300,620]]},
 {n:'Pusa Rd',w:56,p:[[2440,2000],[1500,1700],[500,1600]]},
 {n:'Lodhi Rd',w:50,p:[[2860,4500],[5200,4500]]},
 {n:'Aurobindo Marg',w:54,p:[[2860,3900],[2860,4500],[2500,5400],[2420,5700]]},
 {n:'Mathura Rd',w:56,p:[[4470,4100],[4800,4500],[5200,5000]]},
 {n:'Ring Road',w:72,p:[[500,500],[5200,500],[5200,5400],[500,5400],[500,500]]},
 {n:'GT Karnal Rd',w:56,p:[[3000,1000],[2000,500],[1800,0]]},
 {n:'Rohtak Rd',w:56,p:[[1500,1700],[500,1100],[0,950]]},
 {n:'Dhaula Kuan Rd',w:56,p:[[1650,3900],[1000,4400],[500,4600]]},
 {n:'Gurgaon Rd',w:56,p:[[1000,4400],[300,6000]]},
 {n:'Ashoka Rd',w:44,p:[[2860,3250],[3230,3420]]},
 {n:'Baba Kharak Singh Marg',w:48,p:[[2540,2420],[2905,2552]]},
 {n:'JLN Marg',w:44,p:[[3330,1560],[3560,1420]]},
 {n:'Noida Link',w:56,p:[[5200,4000],[6000,4000]]},
 {n:'Asaf Ali Rd',w:44,p:[[3000,1250],[4000,1050],[4600,1100]]},
 {n:'Outer Ring Rd',w:56,p:[[1500,1700],[1500,5000],[4500,5400]]},
];
for(let k=0;k<8;k++){const a=(k+.5)*TAU/8;ROADS.push({n:'',w:30,spoke:1,p:[[CP.x+Math.cos(a)*225,CP.y+Math.sin(a)*225],[CP.x+Math.cos(a)*560,CP.y+Math.sin(a)*560]]});}
const RINGS=[{x:3000,y:2000,r:225,w:40},{x:3000,y:2000,r:385,w:46},{x:3000,y:2000,r:560,w:60},{x:4300,y:3900,r:260,w:50},{x:3800,y:2400,r:90,w:44}];
for(const r of ROADS){r.L=[];r.len=0;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;r.p.forEach(([x,y],i)=>{x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);if(i){const[px,py]=r.p[i-1];const l=hypot(x-px,y-py);r.L.push(l);r.len+=l;}});r.bb=[x0-r.w,y0-r.w,x1+r.w,y1+r.w];}
const ROADBY={};for(const r of ROADS)if(r.n)ROADBY[r.n]=r;
function roadPointAt(r,frac){let x=frac*r.len;for(let i=0;i<r.L.length;i++){if(x<=r.L[i]||i===r.L.length-1){const t=clamp(x/r.L[i],0,1);const[ax,ay]=r.p[i],[bx,by]=r.p[i+1];return{x:ax+(bx-ax)*t,y:ay+(by-ay)*t,ang:Math.atan2(by-ay,bx-ax),w:r.w,i,t};}x-=r.L[i];}}
function randomRoadPos(rnd,filter){const roads=ROADS.filter(r=>!r.spoke&&(!filter||filter(r)));const tot=roads.reduce((s,r)=>s+r.len,0);let x=rnd()*tot;for(const r of roads){if(x<r.len){const p=roadPointAt(r,x/r.len);return Object.assign(p,{road:r});}x-=r.len;}const r=roads[0];return Object.assign(roadPointAt(r,0),{road:r});}
const riverL=y=>5420+70*Math.sin(y/520)+40*Math.sin(y/170+1);
const onBridge=y=>Math.abs(y-2650)<36||Math.abs(y-4000)<36;
const inRiver=(x,y)=>{const rl=riverL(y);return x>rl&&x<rl+300&&!onBridge(y);};
const PARKS=[
 {t:'c',x:3000,y:2000,r:205},
 {t:'r',x:1650,y:3770,w:2390,h:80},{t:'r',x:1650,y:3950,w:2390,h:80},
 {t:'c',x:4300,y:3900,r:235},
 {t:'r',x:3400,y:4620,w:620,h:380,n:'LODHI GARDEN'},
 {t:'r',x:1700,y:2200,w:700,h:1100,forest:1,n:'DELHI RIDGE'},
 {t:'r',x:3380,y:1180,w:360,h:230,ground:1,n:'RAMLILA MAIDAN'},
 {t:'c',x:3800,y:2400,r:68},
 {t:'r',x:4800,y:950,w:330,h:450,n:'RAJ GHAT'},
 {t:'r',x:2000,y:4650,w:420,h:300},
 {t:'r',x:2150,y:520,w:420,h:260,n:'DU NORTH CAMPUS'},
 {t:'r',x:1300,y:4950,w:420,h:330,n:'JNU'},
];
// dance spots: the open middle of big parks (Lodhi Garden, Raj Ghat, JNU, DU North Campus)
const DANCES=[{x:3710,y:4810,song:'Laung da lashkara'},{x:4965,y:1175,song:'Lollipop lagelu'},{x:1510,y:5115,song:'Rinkiya ke papa'},{x:2360,y:650,song:'Chhath ke geet'}];
const LANDX=[[1250,3500,1550,4300],[1720,3620,2080,3780],[1720,4020,2080,4180],[3170,3300,3640,3640],[4320,480,4800,820],[3970,870,4130,1030],[2360,5660,2480,5820],[4580,4930,4820,5170],[2560,2560,2760,2760]];
const DEST=[{n:'Burari Ground',x:1700,y:230},{n:'Bawana Police Station',x:230,y:850},{n:'Narela Stadium',x:760,y:200},{n:'Kapashera Border',x:260,y:5760},{n:'Jharoda Kalan',x:200,y:3350},{n:'Badarpur Border',x:4800,y:5800},{n:'Ghazipur Border',x:5920,y:2250}];
const METRO=[['Rajiv Chowk',3000,2000],['Patel Chowk',2990,2690],['Central Secretariat',2950,3680],['Mandi House',3700,2500],['ITO',4560,2770],['Chandni Chowk',3900,760],['Kashmere Gate',4300,330],['AIIMS',3000,5020],['Lajpat Nagar',4200,5020],['Rajouri Garden',900,2700],['Dwarka',330,4350],['Rohini West',900,1250],['Noida Sec-18',5900,4300],['Hauz Khas',2650,5200],['Vishwavidyalaya',2350,880]].map(([n,x,y])=>({n,x,y}));
for(const m of METRO){for(let it=0;it<6;it++){let mv=false;
 for(const r of ROADS)for(let i=0;i<r.L.length;i++){const[a,b]=r.p[i],[c2,d]=r.p[i+1];const need=r.w/2+46,dd=segDist(m.x,m.y,a,b,c2,d);if(dd<need){const L=hypot(c2-a,d-b)||1,nx=-(d-b)/L,ny=(c2-a)/L,side=((m.x-a)*nx+(m.y-b)*ny)>=0?1:-1;m.x+=nx*side*(need-dd+2);m.y+=ny*side*(need-dd+2);mv=true;}}
 for(const g of RINGS){const d=hypot(m.x-g.x,m.y-g.y),need=g.w/2+46;if(Math.abs(d-g.r)<need){const t=(d<g.r?g.r-need:g.r+need)/(d||1);m.x=g.x+(m.x-g.x)*t;m.y=g.y+(m.y-g.y)*t;mv=true;}}
 if(!mv)break;}}
const MCLOSE=['Patel Chowk','Central Secretariat','Rajiv Chowk','Mandi House','ITO','Vishwavidyalaya'];
const BANGLA={x:2650,y:2660};
const ASSEMBLY=[['DU North Campus',2350,700],['Singhu Border',1850,110],['Tikri Border',110,1000],['Ghazipur Border',5930,2650],['JNU',1500,5150],['Ramlila Maidan',3560,1330],['Laxmi Nagar',5800,3420],['Lajpat Nagar',4260,5100],['Mukherjee Nagar',1250,700],['Kalkaji',4900,5300]].map(([n,x,y])=>({n,x,y}));
const PSTATIONS=[['Parliament St PS',3560,3260],['Tilak Marg PS',4060,3330],['CP Police Station',3000,1380],['Mandir Marg PS',2450,2330],['Police HQ, ITO',4720,2860],['Kamla Market PS',3760,1250]].map(([n,x,y])=>({n,x,y}));
const CHECK_DEFS=[['Janpath',.12,'Janpath'],['Jantar Mantar Rd',.86,'Jantar Mantar Rd'],['Ashoka Rd',.4,'Ashoka Rd'],['Baba Kharak Singh Marg',.5,'Baba Kharak Singh Marg'],['Barakhamba Rd',.5,'Barakhamba Rd'],['Tilak Marg',.25,'Tilak Marg'],['Minto Rd',.3,'Minto Bridge'],['GT Karnal Rd',.45,'GT Karnal Rd'],['Pusa Rd',.45,'Pusa Rd'],['Rohtak Rd',.4,'Rohtak Rd'],['Dhaula Kuan Rd',.4,'Dhaula Kuan'],['Aurobindo Marg',.3,'Aurobindo Marg'],['Kartavya Path',.55,'Kartavya Path'],['ITO Rd',.55,'ITO Crossing'],['Vikas Marg',.45,'ITO Bridge'],['Lodhi Rd',.35,'Lodhi Rd'],['Mathura Rd',.4,'Mathura Rd'],['Asaf Ali Rd',.5,'Asaf Ali Rd']];
const CHECKS=CHECK_DEFS.map(([rn,f,name],i)=>{const p=roadPointAt(ROADBY[rn],f);return{i,name,x:p.x,y:p.y,ang:p.ang+Math.PI/2,len:p.w+70};});

function blocked(x,y,rad){
 const rl=riverL(y);if(x+rad>rl-30&&x-rad<rl+330)return true;
 if(x>rl+300)return false;
 for(const r of ROADS){for(let i=0;i<r.L.length;i++){const[a,b]=r.p[i],[c,d]=r.p[i+1];if(segDist(x,y,a,b,c,d)<r.w/2+rad+16)return true;}}
 for(const g of RINGS){const d=hypot(x-g.x,y-g.y);if(Math.abs(d-g.r)<g.w/2+rad+16||d<g.r)return true;}
 if(hypot(x-CP.x,y-CP.y)<600+rad)return true;
 for(const p of PARKS){if(p.t==='c'){if(hypot(x-p.x,y-p.y)<p.r+rad)return true;}else if(x+rad>p.x&&x-rad<p.x+p.w&&y+rad>p.y&&y-rad<p.y+p.h)return true;}
 for(const b of LANDX)if(x+rad>b[0]&&x-rad<b[2]&&y+rad>b[1]&&y-rad<b[3])return true;
 if(hypot(x-ZONE.x,y-ZONE.y)<ZONE.R+90+rad)return true;
 for(const m of METRO)if(hypot(x-m.x,y-m.y)<60+rad)return true;
 for(const m of DEST)if(hypot(x-m.x,y-m.y)<110+rad)return true;
 for(const m of ASSEMBLY)if(hypot(x-m.x,y-m.y)<90+rad)return true;
 for(const m of PSTATIONS)if(hypot(x-m.x,y-m.y)<70+rad)return true;
 return false;
}
const SHOPS=['SHARMA SWEETS','GUPTA XEROX','BANSAL CHAI','RAJU DHABA','KUMAR MOBILE','JAIN MEDICAL','PARATHE WALA','TENT HOUSE','IAS COACHING','LAXMI JEWELLERS','TIWARI TAILORS','JUICE CORNER','BITTU TIKKI','AGARWAL STORE','SINGH AUTO','KACHORI WALA','CYBER CAFE','PG FOR BOYS','MOMOS POINT','PHOTOSTAT','LASSI BHANDAR','GYM & FITNESS','SHIV DHABA','KIRANA STORE','BARRICADE ON RENT','CHHOLE KULCHE','VIP TAILORS','JOSHI ELECTRICALS'];
const POSTERS=['UPSC 100% SELECTION*','DR. GUPTA CLINIC','NO PARKING','SECURITY ZONE AHEAD','STARTUP CHAI HUB','LADKA ASPIRANT HAI','RENT: 1BHK ₹45K','JOIN MY TELEGRAM','DIWALI SALE 90% OFF','COMMUNITY SUPPORT ONLY','CHACHA JI KA NUMBER?','PAMPHLETS AVAILABLE ₹99'];
const SIGNC=['#c62828','#1565c0','#2e7d32','#ef6c00','#6a1b9a','#00838f','#ad1457','#f9a825'];
const BUILD=[],TREES=[];
(function gen(){
 const R=mulberry32(1947);const occ=new Set();
 const pal=['#efe4cc','#e8d6b5','#f2e9d8','#dccbb0','#eadfd0','#e7c9a9','#d9d2c4','#f0d9c0','#e3e0d6','#f4c7a5','#d8e4e8','#f3d6d6'];
 for(let k=0;k<9000&&BUILD.length<2200;k++){
  const w=56+R()*76,h=46+R()*60,x=R()*WORLD,y=R()*WORLD,cx=x+w/2,cy=y+h/2,rad=Math.max(w,h)/2;
  const key=((cx/110)|0)+','+((cy/110)|0);if(occ.has(key))continue;
  if(blocked(cx,cy,rad))continue;
  if(BUILD.some(b=>x<b.x+b.w+34&&x+w+34>b.x&&y<b.y+b.h+34&&y+h+34>b.y))continue;
  occ.add(key);
  const floors=2+((R()*4)|0);const c=pal[(R()*pal.length)|0];
  BUILD.push({x,y,w,h,H:floors*15+8,c,roof:shade(c,-.06),wall:shade(c,-.16),shop:w>66&&R()<.8?SHOPS[(R()*SHOPS.length)|0]:null,poster:R()<.3?POSTERS[(R()*POSTERS.length)|0]:null,sign:SIGNC[(R()*SIGNC.length)|0],tank:R()<.75,tx:R(),ty:R(),dish:R()<.3,solar:R()<.15,laundry:R()<.35,ac:R(),paan:R()<.5,seed:(R()*1e9)|0});
 }
 for(const p of PARKS){if(p.ground)continue;const area=p.t==='c'?Math.PI*p.r*p.r:p.w*p.h;const n=Math.floor(area/(p.forest?4500:11000));for(let i=0;i<n;i++){let x,y;if(p.t==='c'){const a=R()*TAU,r2=Math.sqrt(R())*(p.r-20);x=p.x+Math.cos(a)*r2;y=p.y+Math.sin(a)*r2;}else{x=p.x+15+R()*(p.w-30);y=p.y+15+R()*(p.h-30);}if(METRO.some(m=>dist(m.x,m.y,x,y)<90)||DANCES.some(d=>dist(d.x,d.y,x,y)<140))continue;TREES.push({x,y,s:.8+R()*(p.forest?.7:.5),v:(R()*3)|0});}}
 for(let x=1680;x<4020;x+=90){TREES.push({x,y:3800,s:.8,v:0},{x,y:4010,s:.8,v:0});}
 for(let k=0;k<420;k++){const x=R()*WORLD,y=R()*WORLD;if(!blocked(x,y,16)&&dist(x,y,ZONE.x,ZONE.y)>ZONE.R+120)TREES.push({x,y,s:.7+R()*.5,v:(R()*3)|0});}
 // east of the river blocked() skips the road test, so a building could sit on Vikas Marg at the bridge mouth:
 // prune those afterwards (a post-pass keeps the seeded layout of everything else unchanged)
 for(let i=BUILD.length-1;i>=0;i--){const b=BUILD[i],cx=b.x+b.w/2,cy=b.y+b.h/2;if(cx<=riverL(cy)+300)continue;const rad=Math.max(b.w,b.h)/2;
  if(ROADS.some(r=>{for(let j=0;j<r.L.length;j++){const[ax,ay]=r.p[j],[bx,by]=r.p[j+1];if(segDist(cx,cy,ax,ay,bx,by)<r.w/2+rad+16)return true;}return false;}))BUILD.splice(i,1);}
})();
const BG=200,BIDX=new Map();
for(const b of BUILD){for(let cx=(b.x/BG)|0;cx<=((b.x+b.w)/BG|0);cx++)for(let cy=(b.y/BG)|0;cy<=((b.y+b.h)/BG|0);cy++){const k=cx*100+cy;if(!BIDX.has(k))BIDX.set(k,[]);BIDX.get(k).push(b);}}
function nearBuildings(x,y){const cx=(x/BG)|0,cy=(y/BG)|0,out=[];for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const a=BIDX.get((cx+i)*100+cy+j);if(a)for(const b of a)if(out.indexOf(b)<0)out.push(b);}return out;}
function pointInBuilding(x,y,m){const a=BIDX.get(((x/BG)|0)*100+((y/BG)|0));if(!a)return false;for(const b of a)if(x>b.x-m&&x<b.x+b.w+m&&y>b.y-m&&y<b.y+b.h+m)return true;return false;}
function collideBuildings(p){const cx=(p.x/BG)|0,cy=(p.y/BG)|0;const fx=p.x-cx*BG,fy=p.y-cy*BG;const a=BIDX.get(cx*100+cy);
 // neighbours only when near a cell edge (picked before anything moves p)
 const l=fx<p.r?BIDX.get((cx-1)*100+cy):null,r=fx>BG-p.r?BIDX.get((cx+1)*100+cy):null,t=fy<p.r?BIDX.get(cx*100+cy-1):null,bo=fy>BG-p.r?BIDX.get(cx*100+cy+1):null;
 if(a)collideList(p,a);if(l)collideList(p,l);if(r)collideList(p,r);if(t)collideList(p,t);if(bo)collideList(p,bo);}
function collideList(p,L){for(let i=0;i<L.length;i++){const b=L[i];const nx=clamp(p.x,b.x,b.x+b.w),ny=clamp(p.y,b.y,b.y+b.h);const dx=p.x-nx,dy=p.y-ny,dd=dx*dx+dy*dy;if(dd<p.r*p.r){if(dd>1e-6){const d=Math.sqrt(dd);p.x+=dx/d*(p.r-d);p.y+=dy/d*(p.r-d);}else{const l=p.x-b.x,r=b.x+b.w-p.x,t=p.y-b.y,bo=b.y+b.h-p.y,m=Math.min(l,r,t,bo);if(m===l)p.x=b.x-p.r;else if(m===r)p.x=b.x+b.w+p.r;else if(m===t)p.y=b.y-p.r;else p.y=b.y+b.h+p.r;}}}}

// ----- inner ring gates (where roads cross the Security Zone fence)
const GATE_DEFS=[];
(function(){for(const r of ROADS){if(r.spoke)continue;for(let i=0;i<r.L.length;i++){const[ax,ay]=r.p[i],[bx,by]=r.p[i+1];const st=Math.ceil(r.L[i]/4);let prev=null;
 for(let k=0;k<=st;k++){const t=k/st,x=ax+(bx-ax)*t,y=ay+(by-ay)*t;const s=hypot(x-ZONE.x,y-ZONE.y)>ZONE.R?1:-1;
  if(prev!==null&&s!==prev){const ang=Math.atan2(y-ZONE.y,x-ZONE.x);if(!GATE_DEFS.some(g=>Math.abs(angDiff(g.ang,ang))<.25)){const nx=Math.cos(ang),ny=Math.sin(ang),w=r.w+28;const dirs=['East','South','West','North'];
   GATE_DEFS.push({ang,w,road:r.n,nx,ny,tx:-ny,ty:nx,x:ZONE.x+nx*ZONE.R,y:ZONE.y+ny*ZONE.R,ox:ZONE.x+nx*(ZONE.R+60),oy:ZONE.y+ny*(ZONE.R+60),ix:ZONE.x+nx*(ZONE.R-60),iy:ZONE.y+ny*(ZONE.R-60),half:(w/2)/ZONE.R,name:dirs[((Math.round(ang/(Math.PI/2))%4)+4)%4]});}}prev=s;}}}
 GATE_DEFS.sort((a,b)=>a.ang-b.ang);})();
function gateAtAngle(a,margin){for(let i=0;i<GATE_DEFS.length;i++){const g=GATE_DEFS[i];if(Math.abs(angDiff(a,g.ang))<g.half-margin)return i;}return -1;}

// ----- shared movement (server simulation + client prediction use the same code)
// gateDown: array of booleans per gate; bars: [{x1,y1,tx,ty,nx,ny,len,x,y,up}]
function zoneConstrain(p,px,py,gateDown){if(p.noZone)return;
 const dx=p.x-ZONE.x,dy=p.y-ZONE.y,d=hypot(dx,dy)||1,band=p.r+9;
 if(Math.abs(d-ZONE.R)>=band)return;
 const gi=gateAtAngle(Math.atan2(dy,dx),p.r/ZONE.R);
 if(gi>=0&&(p.team!=='P'||gateDown[gi]))return;
 if(gi<0&&p.team==='P')return; // protesters climb the wall (slowly, see climbing in the sim); closed gates still block
 const pd=hypot(px-ZONE.x,py-ZONE.y);const nd=ZONE.R+(pd<ZONE.R?-band:band);
 p.x=ZONE.x+dx/d*nd;p.y=ZONE.y+dy/d*nd;
}
function barClosest(b,x,y){const t=clamp((x-b.x1)*b.tx+(y-b.y1)*b.ty,0,b.len);return{x:b.x1+b.tx*t,y:b.y1+b.ty*t,t};}
function barConstrain(p,px,py,bars){if(p.team!=='P')return;for(let i=0;i<bars.length;i++){const b=bars[i];if(!b.up)continue;if(d2(p.x,p.y,b.x,b.y)>(b.len/2+30)**2)continue;const t=clamp((p.x-b.x1)*b.tx+(p.y-b.y1)*b.ty,0,b.len),qx=b.x1+b.tx*t,qy=b.y1+b.ty*t;const dx=p.x-qx,dy=p.y-qy,d=hypot(dx,dy),m=p.r+7;if(d<m){const side=Math.sign((px-b.x)*b.nx+(py-b.y)*b.ny)||1;const end=t<=0||t>=b.len;const nx=end&&d>0?dx/d:b.nx*side,ny=end&&d>0?dy/d:b.ny*side;p.x=qx+nx*m;p.y=qy+ny*m;}}}
// move a body one step. wx,wy: desired direction (|w|<=1); spd: px/s
function moveBody(p,wx,wy,spd,dt,gateDown,bars){
 const k=Math.min(1,dt*12);p.vx+=(wx*spd-p.vx)*k;p.vy+=(wy*spd-p.vy)*k;
 const px=p.x,py=p.y;p.x+=p.vx*dt+(p.sx||0);p.y+=p.vy*dt+(p.sy||0);
 collideBuildings(p);zoneConstrain(p,px,py,gateDown);barConstrain(p,px,py,bars);
 p.x=clamp(p.x,30,WORLD-30);p.y=clamp(p.y,30,WORLD-30);
 return hypot(p.x-px,p.y-py);
}
const SPEED={P:150,C:150,sprint:1.45};

// ----- MUDDAS: every protester fights for one cause
const MUDDAS=[
 {k:'paper',n:'Paper Leak',e:'ðŸ“š',c:'#1565c0',sl:['NO PAPER|LEAK!','EXAM|BACHAO','RE-EXAM|KARAO'],ch:['Paper leak band karo!','Hamara saal wapas do!','Exam bachao, desh bachao!']},
 {k:'jobs',n:'Berozgari',e:'ðŸ’¼',c:'#6a1b9a',sl:['NAUKRI|DO','DEGREE HAI|JOB NAHI','VACANCY|KAB?'],ch:['Naukri do, jumla nahi!','PhD kiya, ab pakode tal raha hoon!','Vacancy nikalo!']},
 {k:'e20',n:'E20 Petrol',e:'â›½',c:'#2e7d32',sl:['MILEAGE|WAPAS DO','E20|NAHI CHAHIYE','ENGINE|BACHAO'],ch:['Mileage wapas do!','Meri bike ko ganne ka juice mat pilao!','E20 hatao, engine bachao!']},
 {k:'vote',n:'Vote Chori',e:'ðŸ—³ï¸',c:'#ad1457',sl:['MERA VOTE|KAHAN?','VOTER LIST|DIKHAO','NAAM|KATA KYUN?'],ch:['Mera naam list se gayab!','Vote hamara, list tumhari?','Dadaji ko list se mat hatao!']},
 {k:'aqi',n:'Saans (AQI)',e:'ðŸ˜·',c:'#607d8b',sl:['SAANS|LENE DO','AQI|999?!','HAWA|SAAF KARO'],ch:['Saans lene do!','Hawa saaf karo!','Mask pehen ke naara laga raha hoon!']},
 {k:'msp',n:'MSP',e:'ðŸŒ¾',c:'#f9a825',sl:['MSP|GUARANTEE','KISAN|EKTA','FASAL KA|DAAM DO'],ch:['MSP ki guarantee do!','Kisan ekta zindabad!','Fasal ka daam do!']},
 {k:'pension',n:'Purani Pension',e:'ðŸ‘´',c:'#795548',sl:['PURANI|PENSION','OPS|BAHAAL KARO','BUDHAPE KA|SAHARA'],ch:['Purani pension bahaal karo!','35 saal naukri ki, pension do!','Budhape ka sahara chahiye!']},
 {k:'roads',n:'Gaddhe',e:'ðŸ•³ï¸',c:'#5d4037',sl:['GADDHE|BHARO','ROAD YA|POOL?','SADAK|DO'],ch:['Gaddhe bharo!','Har baarish mein Venice ban jaata hai!','Road tax diya, gaddha mila!']},
 {k:'price',n:'Mehngai',e:'ðŸ…',c:'#d32f2f',sl:['TAMATAR|â‚¹200?!','CYLINDER|SASTA KARO','MEHNGAI|DAAYAN'],ch:['Tamatar sasta karo!','Cylinder â‚¹1100? Sach mein?','Mehngai daayan khaaye jaat hai!']},
];
// pocket type -> preferred mudda
const POCKET_MUDDA={coaching:0,college:1,hostel:0,petrol:2,polling:3,park:4,dhaba:5,pension:6,busstop:7,mandi:8,chai:-1};
// ----- interactive street stalls, construction sites, monkeys
const STALLS=[],SITES=[];
(function(){const R=mulberry32(2026);const types=['golgappa','tanker','selfie','sulabh','paan'];let ti=0;
 for(let k=0;k<4000&&STALLS.length<20;k++){const p=randomRoadPos(R,r=>!r.spoke&&r.n!=='Ring Road');const nx=-Math.sin(p.ang),ny=Math.cos(p.ang),s=R()<.5?1:-1;const x=p.x+nx*s*(p.w/2+30),y=p.y+ny*s*(p.w/2+30);
  if(x<150||y<150||x>WORLD-150||y>WORLD-150||pointInBuilding(x,y,26)||inRiver(x,y)||dist(x,y,ZONE.x,ZONE.y)<ZONE.R+180||dist(x,y,ZONE.x,ZONE.y)>2800)continue;
  if(STALLS.some(q=>dist(q.x,q.y,x,y)<330)||CHECKS.some(c=>dist(c.x,c.y,x,y)<160)||METRO.some(m=>dist(m.x,m.y,x,y)<90))continue;STALLS.push({i:STALLS.length,x,y,type:types[ti++%types.length]});}
 for(let k=0;k<3000&&SITES.length<5;k++){const p=randomRoadPos(R,r=>!r.spoke&&r.w>=50);const d=dist(p.x,p.y,ZONE.x,ZONE.y);if(d<700||d>2600)continue;if(SITES.some(q=>dist(q.x,q.y,p.x,p.y)<700)||CHECKS.some(c=>dist(c.x,c.y,p.x,p.y)<250)||STALLS.some(q=>dist(q.x,q.y,p.x,p.y)<150))continue;SITES.push({x:p.x,y:p.y,r:80,ang:p.ang});}})();
const CCTV=[],HIDES=[];
(function(){const R=mulberry32(777);
 for(let k=0;k<6000&&CCTV.length<70;k++){const p=randomRoadPos(R,r=>!r.spoke);const nx=-Math.sin(p.ang),ny=Math.cos(p.ang),s=R()<.5?1:-1;const x=p.x+nx*s*(p.w/2+16),y=p.y+ny*s*(p.w/2+16);const dz=dist(x,y,ZONE.x,ZONE.y);
  if(x<100||y<100||x>WORLD-100||y>WORLD-100||dz<ZONE.R+60||dz>3400||pointInBuilding(x,y,10)||inRiver(x,y))continue;if(CCTV.some(q=>dist(q.x,q.y,x,y)<340)||STALLS.some(q=>dist(q.x,q.y,x,y)<60)||METRO.some(m=>dist(m.x,m.y,x,y)<80))continue;CCTV.push({i:CCTV.length,x,y});}
 const NAMES=['Aunty ji ka ghar','Sharma ji ka ghar','Boys PG','Mausi ka ghar','Cyber cafe','Coaching centre','Girls hostel','Dhobi ghat','Chai tapri ke peeche','Gupta ji ki dukaan','Barsaati','Dilli Haat godown'];
 for(const [dx,dy] of [[0,110],[100,20],[-100,20],[0,-90]]){const x=BANGLA.x+dx,y=BANGLA.y+dy;if(!pointInBuilding(x,y,8)&&!inRiver(x,y)){HIDES.push({i:0,x,y,n:'Gurdwara Bangla Sahib',g:1});break;}}
 const bs=BUILD.slice().sort(()=>R()-.5);let ni=0;
 for(const b of bs){if(HIDES.length>=18)break;if(b.w<50)continue;const x=b.x+b.w/2,y=b.y+b.h+16;const dz=dist(x,y,ZONE.x,ZONE.y);if(dz<ZONE.R+260||dz>3000||pointInBuilding(x,y,8)||inRiver(x,y))continue;
  if(HIDES.some(q=>dist(q.x,q.y,x,y)<420)||STALLS.some(q=>dist(q.x,q.y,x,y)<70)||CCTV.some(q=>dist(q.x,q.y,x,y)<40))continue;HIDES.push({i:HIDES.length,x,y,n:NAMES[ni++%NAMES.length],g:0});}})();
const DOORS=[];
(function(){const R=mulberry32(4242);for(const b of BUILD){if(R()<.45)continue;const x=b.x+b.w*(.25+R()*.5),y=b.y+b.h+12;if(pointInBuilding(x,y,6)||inRiver(x,y)||dist(x,y,ZONE.x,ZONE.y)<ZONE.R+120)continue;if(DOORS.some(q=>Math.abs(q.x-x)<120&&Math.abs(q.y-y)<120))continue;DOORS.push({x,y});}})();
const MONKEY_HOMES=[[1400,3540],[1900,3610],[1900,4200],[3420,3660],[4560,860],[1400,4260]];

return {MUDDAS,POCKET_MUDDA,STALLS,SITES,MONKEY_HOMES,CCTV,HIDES,DOORS,DANCES,TAU,clamp,d2,dist,hypot,angDiff,norm,mulberry32,segDist,shade,WORLD,CP,JM,ZONE,ROADS,ROADBY,RINGS,PARKS,LANDX,DEST,METRO,MCLOSE,BANGLA,ASSEMBLY,PSTATIONS,CHECKS,BUILD,TREES,SHOPS,POSTERS,SIGNC,
 riverL,onBridge,inRiver,roadPointAt,randomRoadPos,nearBuildings,pointInBuilding,collideBuildings,GATE_DEFS,gateAtAngle,zoneConstrain,barClosest,barConstrain,moveBody,SPEED};
});


