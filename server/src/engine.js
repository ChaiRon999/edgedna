/* EdgeDNA engine: setup classifier, execution scoring and behaviour flags.
   Shared with the browser demo (docs/index.html). */
/* ---------- helpers ---------- */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const sum=(a,f)=>a.reduce((s,x)=>s+f(x),0);
const avg=(a,f)=>a.length?sum(a,f)/a.length:0;
const loc=(n,d=0)=>Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const usd=(n,d=0)=>(n<0?'-':'')+'$'+loc(n,d);
const susd=(n,d=0)=>(n>0.0000001?'+':n<-0.0000001?'-':'')+'$'+loc(n,d);
const sgn=n=>n>0?'pos':n<0?'neg':'';
const al=(h,a)=>{h=h.trim();const n=parseInt(h.slice(1),16);return `rgba(${n>>16},${n>>8&255},${n&255},${a})`};
function rng(s){return()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const gauss=r=>{let u=0;while(!u)u=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*r())};
const DAY=864e5,TFM=5;
const dkey=t=>new Date(t).toISOString().slice(0,10);
const fdt=t=>new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'});
const fhold=m=>m<60?Math.round(m)+'m':(m/60).toFixed(1)+'h';

/* ---------- reference data ---------- */
const MARKETS=[
 {id:'binance|BTCUSDT',sym:'BTC',base:118000,w:.38,dec:1,k:0,spr:.2,depth:2.5e6},
 {id:'binance|ETHUSDT',sym:'ETH',base:4200,w:.27,dec:2,k:1.3,spr:.4,depth:1.2e6},
 {id:'binance|SOLUSDT',sym:'SOL',base:190,w:.16,dec:2,k:2.1,spr:1.1,depth:4e5},
 {id:'binance|XRPUSDT',sym:'XRP',base:2.9,w:.07,dec:4,k:3.4,spr:1.8,depth:2.5e5},
 {id:'binance|DOGEUSDT',sym:'DOGE',base:.24,w:.06,dec:5,k:4.2,spr:2.2,depth:2e5},
 {id:'binance|AVAXUSDT',sym:'AVAX',base:38,w:.06,dec:2,k:5.5,spr:2.6,depth:1.5e5}];
const mkOf=id=>MARKETS.find(m=>m.id===id);
const pxFmt=(m,v)=>loc(v,m.dec);
const pickW=(r,arr,wi)=>{let x=r(),a=0;for(const it of arr){a+=it[wi]??it.w;if(x<=a)return it}return arr[0]};
const hourW=h=>.4+2*Math.exp(-(((h-14)/3)**2))+1.2*Math.exp(-(((h-2)/2.5)**2))+1.2*Math.exp(-(((h-26)/2.5)**2));
const HW=[...Array(24)].map((_,h)=>hourW(h)),HS=HW.reduce((a,b)=>a+b,0);
function pickHour(r){let x=r()*HS;for(let h=0;h<24;h++){x-=HW[h];if(x<=0)return h}return 23}
const priceAt=(m,t)=>{const d=t/DAY;return m.base*(1+.07*Math.sin(d/9+m.k)+.03*Math.sin(d/3.1+m.k*2))};
const sessF=h=>(h>=21||h<7)?1.7:h<12?1.1:h<17?.85:1.2;
const sessOf=h=>h<7?'Asia (00–07)':h<12?'London (07–12)':h<17?'New York (12–17)':'Late (17–24)';
const SESS=['Asia (00–07)','London (07–12)','New York (12–17)','Late (17–24)'];

/* ---------- candle building (long coordinates; shorts are mirrored) ---------- */
const candle=(o,c,wu,wd)=>({o,c,h:Math.max(o,c)+wu,l:Math.min(o,c)-wd});
function mkBase(r,atr,n,drift,start){
  const c=[];let p=start;
  for(let i=0;i<n;i++){
    const cl=p+(drift+gauss(r)*.55)*atr;
    c.push(candle(p,cl,(Math.abs(gauss(r))*.22+.05)*atr,(Math.abs(gauss(r))*.22+.05)*atr));p=cl;
  }
  return c;
}
function pivots(c,from,to,k=2){
  const hi=[],lo=[];
  for(let i=Math.max(k,from);i<=Math.min(c.length-1-k,to);i++){
    let H=true,Lw=true;
    for(let j=1;j<=k;j++){if(!(c[i].h>c[i-j].h&&c[i].h>c[i+j].h))H=false;if(!(c[i].l<c[i-j].l&&c[i].l<c[i+j].l))Lw=false}
    if(H)hi.push(i);if(Lw)lo.push(i);
  }
  return{hi,lo};
}
const atrOf=(c,end,n=14)=>{let s=0,k=0;for(let i=Math.max(0,end-n+1);i<=end;i++){s+=c[i].h-c[i].l;k++}return s/k};
function vwapArr(c){let pv=0,vv=0;return c.map(x=>{const v=Math.max(1e-9,x.h-x.l)*(1+Math.abs(x.c-x.o)/Math.max(1e-9,x.h-x.l));pv+=v*(x.h+x.l+x.c)/3;vv+=v;return pv/vv})}
function emaArr(c,n){const a=2/(n+1),o=[];let e=c[0].c;c.forEach((x,i)=>{e=i?e+a*(x.c-e):x.c;o.push(e)});return o}
const last=c=>c[c.length-1];
const TEMPL={
  sweep(r,atr,q){
    const c=mkBase(r,atr,34,-.05,0);
    const pv=pivots(c,2,c.length-3),lv=pv.lo.length?Math.min(...pv.lo.slice(-4).map(i=>c[i].l)):Math.min(...c.slice(-15).map(x=>x.l));
    const p=last(c).c,lowS=lv-(.3+.5*r())*atr,cl=lv+(.12+.25*r())*atr;
    c.push({o:p,c:cl,h:Math.max(p,cl)+.1*atr,l:lowS});
    const nRec=[0,1,3][q];
    for(let i=0;i<nRec;i++){const a=last(c).c;c.push(candle(a,a+(.35+.4*r()+q*.25)*atr,.12*atr,.08*atr))}
    return{c,E:c.length-1,stopPx:lowS-.2*atr};
  },
  fvg(r,atr,q){
    const c=mkBase(r,atr,34,0,0);const p=last(c).c;
    const A=candle(p,p+.25*atr,.15*atr,.15*atr);c.push(A);
    const B=candle(A.c,A.c+(2+.7*r())*atr,.1*atr,.1*atr);c.push(B);
    const C={o:B.c,c:B.c+.4*atr,l:B.c-(.1+.3*r())*atr,h:B.c+.5*atr};c.push(C);
    const top=C.l,gap=top-A.h,tgt=[top-.2*atr,top-gap*.55,top+(.7+.8*r())*atr][q];
    const steps=2+Math.floor(r()*2);let a=C.c;
    for(let i=1;i<=steps;i++){const t=C.c+(tgt-C.c)*(i/steps);const cl=i===steps?tgt:t+gauss(r)*.1*atr;c.push({o:a,c:cl,h:Math.max(a,cl)+.1*atr,l:Math.min(a,cl)-(i===steps&&q<2?.12:.06)*atr});a=cl}
    return{c,E:c.length-1,stopPx:A.h-.25*atr};
  },
  ob(r,atr,q){
    const c=mkBase(r,atr,34,-.1,0);const p=last(c).c;
    const O=candle(p,p-(.5+.5*r())*atr,.12*atr,.15*atr);c.push(O);
    for(let i=0;i<3;i++){const a=last(c).c;c.push(candle(a,a+(1+.6*r())*atr,.1*atr,.08*atr))}
    const hi=O.o,lo=O.l,tgt=[hi-(.05+.2*r())*atr,(hi+lo)/2,hi+(.8+.7*r())*atr][q];
    const steps=3+Math.floor(r()*3);let a=last(c).c;
    for(let i=1;i<=steps;i++){const cl=i===steps?tgt:a+(tgt-a)*(1/(steps-i+1))+gauss(r)*.1*atr;c.push({o:a,c:cl,h:Math.max(a,cl)+.1*atr,l:Math.min(a,cl)-(i===steps&&q<2?.15:.06)*atr});a=cl}
    return{c,E:c.length-1,stopPx:O.l-.2*atr};
  },
  structure(r,atr,q){
    const choch=r()<.5,c=mkBase(r,atr,34,choch?-.14:.12,0);
    const pv=pivots(c,2,c.length-3),hs=pv.hi.slice(-5);
    const H=hs.length?Math.max(...hs.map(i=>c[i].h)):Math.max(...c.slice(-14).map(x=>x.h));
    let a=last(c).c;
    for(let i=0;i<2;i++){const cl=H-(i?.35+.2*r():.6+.3*r())*atr;c.push(candle(a,cl,.1*atr,.1*atr));a=cl}
    const brk=H+(.25+.25*r())*atr;c.push(candle(a,brk,.1*atr,.05*atr));
    const ent=H+[.15,.55,1.4][q]*atr;
    c.push(candle(brk,(brk+ent)/2,.1*atr,.1*atr));c.push({o:(brk+ent)/2,c:ent,h:(brk+ent)/2+.08*atr,l:ent-.1*atr});
    return{c,E:c.length-1,stopPx:H-1.0*atr};
  },
  pullback(r,atr,q){
    const c=mkBase(r,atr,36,.13,0);const ema=emaArr(c,20),e=last(ema);
    const tgt=e+[.1,.5,1.3][q]*atr;let a=last(c).c;
    for(let i=1;i<=3;i++){const cl=a+(tgt-a)/(4-i)+gauss(r)*.08*atr;c.push({o:a,c:cl,h:Math.max(a,cl)+.1*atr,l:Math.min(a,cl)-.1*atr});a=cl}
    c.push(candle(a,a+.3*atr,.1*atr,.12*atr));
    return{c,E:c.length-1,stopPx:e-1.0*atr};
  },
  breakout(r,atr,q){
    const c=mkBase(r,atr,30,0,0);const H=Math.max(...c.slice(-18).map(x=>x.h));let a=last(c).c;
    const ap=H-(.35+.2*r())*atr;c.push({o:a,c:ap,h:Math.max(a,ap)+.08*atr,l:Math.min(a,ap)-.1*atr});a=ap;
    const cl=H+(.25+.2*r()+[0,.35,1.1][q])*atr;c.push({o:a,c:cl,h:cl+.08*atr,l:a-.05*atr});
    return{c,E:c.length-1,stopPx:H-.9*atr};
  },
  retest(r,atr,q){
    const c=mkBase(r,atr,28,0,0);const H=Math.max(...c.slice(-16).map(x=>x.h));let a=last(c).c;
    const b=H+(.9+.4*r())*atr;c.push({o:a,c:b,h:b+.1*atr,l:a-.05*atr});a=b;
    const b2=b+(.3+.3*r())*atr;c.push(candle(a,b2,.1*atr,.1*atr));a=b2;
    const tgt=H+[.05,.35,.9][q]*atr,n=3;
    for(let i=1;i<=n;i++){const cl=a+(tgt-a)/(n-i+1);c.push({o:a,c:cl,h:Math.max(a,cl)+.08*atr,l:Math.min(a,cl)-(i===n?.12:.06)*atr});a=cl}
    const en=a+(.2+.15*r())*atr;c.push({o:a,c:en,h:en+.08*atr,l:a-.06*atr});
    return{c,E:c.length-1,stopPx:H-.8*atr};
  },
  range(r,atr,q){
    const c=[],L=0,Hh=(3.6+r())*atr,mid=Hh/2,per=12+Math.floor(r()*3);let p=mid;
    for(let i=0;i<30;i++){const cl=mid+(Hh/2-.15*atr)*Math.cos(i*2*Math.PI/per)+gauss(r)*.12*atr;c.push({o:p,c:cl,h:Math.max(p,cl)+(.05+.15*r())*atr,l:Math.min(p,cl)-(.05+.15*r())*atr});p=cl}
    const tgt=L+[.1,.35,.8][q]*atr;let a=p;
    const steps=Math.max(2,Math.round((a-tgt)/(.6*atr)));
    for(let i=1;i<=steps;i++){const cl=a+(tgt-a)/(steps-i+1);c.push({o:a,c:cl,h:Math.max(a,cl)+.08*atr,l:Math.min(a,cl)-.08*atr});a=cl}
    const en=a+.2*atr;c.push({o:a,c:en,h:en+.08*atr,l:a-.1*atr});
    return{c,E:c.length-1,stopPx:L-.6*atr};
  },
  meanrev(r,atr,q){
    const c=mkBase(r,atr,30,0,0);let a=last(c).c;
    for(let i=0;i<4;i++){const cl=a-(1.05+.4*r())*atr;c.push({o:a,c:cl,h:a+.06*atr,l:cl-.08*atr});a=cl}
    const lo=Math.min(...c.slice(-4).map(x=>x.l)),en=a+[.45,.25,.1][q]*atr;c.push({o:a,c:en,h:en+.06*atr,l:a-.12*atr});
    return{c,E:c.length-1,stopPx:Math.min(lo,last(c).l)-.3*atr};
  },
  vwap(r,atr,q){
    const c=mkBase(r,atr,30,-.04,0);const vw=vwapArr(c),v=last(vw);let a=last(c).c;
    if(a>v-.5*atr){const d=a-(v-.8*atr);for(const x of c.slice(-6)){x.o-=d*.5;x.c-=d*.5;x.h-=d*.5;x.l-=d*.5}a=last(c).c}
    const v2=last(vwapArr(c)),tgt=v2+[.1,.3,.75][q]*atr,mid=(a+tgt)/2;
    c.push({o:a,c:mid,h:mid+.08*atr,l:a-.06*atr});c.push({o:mid,c:tgt,h:tgt+.08*atr,l:mid-.06*atr});
    return{c,E:c.length-1,stopPx:v2-.8*atr};
  },
  ema(r,atr,q){
    const c=mkBase(r,atr,34,0,0);let e=last(emaArr(c,20)),a=last(c).c;
    const up=e+(.9+.3*r())*atr;for(let i=1;i<=3;i++){const cl=a+(up-a)/(4-i);c.push({o:a,c:cl,h:cl+.08*atr,l:Math.min(a,cl)-.06*atr});a=cl}
    c.push(candle(a,a+.2*atr,.08*atr,.08*atr));a+=.2*atr;
    e=last(emaArr(c,20));const dip=e+[.05,.2,.5][q]*atr;c.push({o:a,c:dip+.15*atr,h:a+.06*atr,l:dip});a=dip+.15*atr;
    e=last(emaArr(c,20));const en=Math.max(a,e)+[.15,.3,.55][q]*atr;c.push({o:a,c:en,h:en+.08*atr,l:a-.05*atr});
    return{c,E:c.length-1,stopPx:e-.9*atr};
  },
  chase(r,atr){
    const c=mkBase(r,atr,36,0,0);
    for(let i=0;i<3;i++){const a=last(c).c;c.push(candle(a,a+(1.1+.5*r())*atr,.08*atr,.06*atr))}
    const en=last(c).c;return{c,E:c.length-1,stopPx:en-(1+1.5*r())*atr};
  },
  none(r,atr){
    const c=mkBase(r,atr,40,(r()-.5)*.1,0);const en=last(c).c;return{c,E:c.length-1,stopPx:en-(1+1.5*r())*atr};
  }
};
const TPLS=[['sweep',.11,.67],['ob',.11,.66],['fvg',.12,.67],['structure',.07,.62],['retest',.08,.68],['breakout',.08,.6],['range',.07,.62],['pullback',.06,.63],['meanrev',.05,.56],['vwap',.05,.62],['ema',.06,.6],['chase',.08,.36],['none',.06,.44]];
const TP=k=>TPLS.find(x=>x[0]===k);
function holdPath(r,e,s,x0,mfeD,H,atr,hard){
  const pk=Math.max(0,Math.min(H-2,Math.floor(H*(.3+.4*r())))),out=[];let p=e;
  for(let i=0;i<H;i++){
    let tgt=i<=pk?e+mfeD*((i+1)/(pk+1)):(e+mfeD)+(x0-(e+mfeD))*((i-pk)/(H-1-pk));
    if(i<H-1)tgt+=gauss(r)*.2*atr;
    if(!hard&&i<H-1)tgt=Math.max(tgt,s+.15*atr);
    if(i===H-1)tgt=x0;
    let h=Math.max(p,tgt)+(.05+.2*r())*atr,l=Math.min(p,tgt)-(.05+.2*r())*atr;
    if(!hard&&i<H-1)l=Math.max(l,s+.05*atr);
    if(i===pk)h=Math.max(h,e+mfeD);
    out.push({o:p,c:tgt,h,l});p=tgt;
  }
  return out;
}

/* ---------- trade generator ---------- */
let SEQ=1;
function makeTrade(r,a,bal,open,riskOv,revenge){
  const m=pickW(r,MARKETS,'w'),dir=r()<.55?1:-1;
  const tp=revenge?(r()<.6?TP('chase'):TP('none')):pickW(r,TPLS,1);
  const qx=r(),q=qx<.45?0:qx<.8?1:2;
  const hold0=Math.exp(Math.log(35)+gauss(r)*.9),H=clamp(Math.round(hold0/TFM),2,26),hold=H*TFM;
  const live=open==null;if(live)open=Date.now()-hold*6e4;
  const P0=priceAt(m,open),atr=P0*.0022*(.8+.5*r());
  const b=TEMPL[tp[0]](r,atr,q),off=P0,c=b.c.map(x=>({o:x.o+off,c:x.c+off,h:x.h+off,l:x.l+off}));
  const E=b.E,e=c[E].c;
  const u=r();let stopPx=b.stopPx+off,kind='struct';
  if(u<.2){stopPx=e-(.55+.3*r())*atr;kind='tight'}else if(u<.3){stopPx=e-(3.4+.8*r())*atr;kind='wide'}
  stopPx=Math.min(stopPx,e-.5*atr);const sd=Math.min(e-stopPx,4.2*atr);stopPx=e-sd;
  const dt=new Date(open),hr=dt.getUTCHours(),dow=dt.getUTCDay();
  const hEdge=.12*Math.exp(-(((hr-14)/2.5)**2))-.08*Math.exp(-(((hr-4)/2)**2));
  const p=clamp(tp[2]+hEdge+((dow===0||dow===6)?-.05:0)+(kind==='tight'?-.06:0)+(q===0?.04:q===2?-.09:0)+(revenge?-.1:0),.2,.8);
  const win=r()<p;
  let R=win?.7-Math.log(1-r())*.95:-(1+(r()<.12?r()*.5:0));
  if(!win&&r()<(revenge?.22:tp[0]==='chase'?.08:.02))R=-(1.9+r()*1.1);
  R=clamp(R,-3,5.5);
  const x0=e+R*sd,hard=R<-1.6;
  const mfeD=win?Math.abs(R)*sd*(1+r()*.9):sd*(r()<.25?1.05+r()*1.2:r()*.7);
  const hp=holdPath(r,e,stopPx,x0,Math.max(mfeD,.1*atr),H,atr,hard);
  let cc=c.concat(hp),st=stopPx,ex=x0,en=e,dd=sd;
  if(dir<0){const mir=v=>2*P0-v;cc=cc.map(x=>({o:mir(x.o),c:mir(x.c),h:mir(x.l),l:mir(x.h)}));st=mir(stopPx);ex=mir(x0);en=mir(e)}
  const size=(riskOv||bal*a.risk*(.7+.6*r()))/dd,risk=size*dd,notional=size*en;
  const sf=sessF(hr)*(r()<.06?2+1.5*r():1)*(.85+.3*r()),spreadBps=m.spr*sf;
  const limit=r()<.25&&tp[0]!=='chase',role=limit?'maker':'taker';
  const imp=notional/m.depth*6;
  const slipE=limit?-.1*r():.5*spreadBps+imp+Math.abs(gauss(r))*.3;
  const stopExit=R<0,xr=r(),exitRole=(!stopExit&&xr<.5)?'maker':'taker';
  const slipX=stopExit?.6*spreadBps+imp*1.3+Math.abs(gauss(r))*.5:exitRole==='maker'?-.05*r():.5*spreadBps+imp+Math.abs(gauss(r))*.3;
  const fillEntry=en*(1+dir*slipE/1e4),fillExit=ex*(1-dir*slipX/1e4);
  const gross=(ex-en)*size*dir,actual=(fillExit-fillEntry)*size*dir;
  const fee=notional*((role==='maker'?1:2.5)+(exitRole==='maker'?1:2.5))/1e4,fund=notional*.0001*(hold/480)*(dir>0?1:-.4);
  const pnl=actual-fee-fund;
  return{id:(live?'L':'H')+(SEQ++),mk:m.id,side:dir>0?'long':'short',dir,size,entry:en,exit:ex,fillEntry,fillExit,stopPx:st,
    open,close:open+hold*6e4,hold,gross,slipUsd:gross-actual,fee,fund,pnl,risk,R:pnl/risk,lev:[3,5,10,20][Math.floor(r()*4)],
    spreadBps,spreadRatio:sf,slipE,slipX,role,exitRole,orderType:limit?'limit':'market',candles:cc,E,truth:tp[0],flags:[]};
}
function genHistory(a){
  const r=rng(a.seed),out=[];let bal=a.start;
  const today=new Date();today.setUTCHours(0,0,0,0);
  for(let d=89;d>=1;d--){
    const base=today.getTime()-d*DAY,dow=new Date(base).getUTCDay();
    if(r()<.14)continue;
    let n=1+Math.floor(r()*4.2);if(dow===0||dow===6)n=Math.max(1,n-1);
    const hrs=[...Array(n)].map(()=>pickHour(r)).sort((x,y)=>x-y);
    for(const h of hrs){
      const t=makeTrade(r,a,bal,base+h*36e5+Math.floor(r()*36e5));out.push(t);bal+=t.pnl;
      if(t.pnl<0&&r()<.3){const t2=makeTrade(r,a,bal,t.close+Math.floor((3+r()*11)*6e4),t.risk*(1.3+.5*r()),true);out.push(t2);bal+=t2.pnl}
    }
  }
  return out.sort((x,y)=>x.close-y.close);
}

/* ---------- classifier: reads only candles, direction and the stop ---------- */
const FAM={breakout:'Breakout',retest:'Break & retest',range:'Range / S&R',pullback:'Trend pullback',meanrev:'Mean reversion',sweep:'Liquidity sweep / SFP',ob:'Order block',fvg:'Fair value gap',structure:'Market structure shift',vwap:'VWAP play',ema:'EMA bounce / cross',chase:'Momentum chase / FOMO',none:'No clear setup'};
const FAMGROUP={Classic:['breakout','retest','range','pullback','meanrev'],'ICT / SMC':['sweep','ob','fvg','structure'],Indicators:['vwap','ema'],'Behavior, tracked separately':['chase','none']};
const FAMORDER=['retest','range','meanrev','ob','fvg','sweep','ema','structure','breakout','vwap','pullback'];
function classify(c0,E,dir,stopPx){
  const c=dir>0?c0:c0.map(x=>({o:-x.o,c:-x.c,h:-x.l,l:-x.h}));
  const q=p=>dir>0?p:-p,entry=c[E].c,atr=atrOf(c,E,14),comps=[],marks=[];
  const word=dir>0?'lows':'highs',side=dir>0?'Bullish':'Bearish';
  const pv=pivots(c,2,E-3);
  // liquidity sweep: a fresh local low that undercuts a recent swing low and closes back above it
  for(let a=pv.lo.length-1;a>=Math.max(0,pv.lo.length-6);a--){
    const pi=pv.lo[a],lv=c[pi].l;if(pi<E-32)break;let found=false;
    for(let j=Math.max(pi+2,E-3);j<=E;j++){
      const prior=Math.min(...c.slice(Math.max(0,j-10),j).map(x=>x.l));
      if(lv-c[j].l>=.3*atr&&c[j].c>lv&&c[j].l<=prior){
        const eq=pv.lo.some(k=>k!==pi&&Math.abs(c[k].l-lv)<.2*atr);
        comps.push({k:'sweep',label:'Sweep',sub:eq?`Equal ${word} sweep`:`Swing ${word.slice(0,-1)} sweep`,level:lv,inv:c[j].l,dist:Math.abs(entry-lv)/atr});
        marks.push({i:j,t:'Sweep'});found=true;break;
      }
    }
    if(found)break;
  }
  // order block
  for(let i=E-4;i>=Math.max(1,E-20);i--){
    const o=c[i];if(o.c>=o.o)continue;
    const n3=c.slice(i+1,i+4);if(n3.length<3)continue;
    if(n3[2].c-o.h>=2.0*atr&&n3.every(x=>x.c>x.o)){
      const lo=o.l,hi=o.o,touched=c.slice(i+4,E+1).some(x=>x.l<=hi+.05*atr);
      if(touched&&entry<=hi+.3*atr&&entry>=lo-.3*atr){
        comps.push({k:'ob',label:'OB',sub:`${side} OB retest`,zone:{lo,hi,i0:i},inv:lo-.2*atr,dist:Math.max(0,(hi-entry)/atr)});
        marks.push({i,t:'OB'});break;
      }
    }
  }
  // fair value gap
  for(let i=E-2;i>=Math.max(1,E-16);i--){
    const a=c[i-1],b=c[i],d=c[i+1];
    if(a.h<d.l&&(b.c-b.o)>=1.15*atr&&(d.l-a.h)>=.3*atr){
      const lo=a.h,hi=d.l,touched=c.slice(i+2,E+1).some(x=>x.l<=hi+.05*atr);
      if(touched&&entry>=lo-.3*atr&&entry<=hi+.35*atr){
        const depth=(hi-entry)/(hi-lo);
        comps.push({k:'fvg',label:'FVG',sub:depth>.5?'FVG deep fill':'FVG retest',zone:{lo,hi,i0:i-1},inv:lo-.2*atr,dist:Math.max(0,(hi-entry)/atr)});
        marks.push({i,t:'FVG'});break;
      }
    }
  }
  // market structure (BOS / CHoCH)
  {
    const hiP=pv.hi.filter(k=>k<=E-4);
    for(let a=hiP.length-1;a>=Math.max(0,hiP.length-3);a--){
      const pi=hiP[a],H=c[pi].h;let brk=-1;
      for(let j=pi+2;j<=E-1;j++)if(c[j].c>H+.1*atr){brk=j;break}
      if(brk>=E-8&&brk>0&&Math.abs(entry-H)<=.6*atr&&entry>=H-.3*atr){
        const seq=hiP.slice(-3),lower=seq.length>1&&seq.every((k,ix)=>ix===0||c[k].h<c[seq[ix-1]].h);
        comps.push({k:'structure',label:lower?'CHoCH':'BOS',sub:lower?'CHoCH reversal':'BOS continuation',level:H,inv:H-1.0*atr,dist:Math.abs(entry-H)/atr});
        marks.push({i:brk,t:lower?'CHoCH':'BOS'});break;
      }
    }
  }
  // break & retest and breakout
  {
    const winHi=(a,b)=>Math.max(...c.slice(Math.max(0,a),b).map(x=>x.h)),winLo=(a,b)=>Math.min(...c.slice(Math.max(0,a),b).map(x=>x.l));
    let got=false;
    for(let j=E-10;j<=E-3&&!got;j++){
      if(j<16)continue;const H=winHi(j-16,j),L=winLo(j-16,j);
      if(H-L>5*atr||c[j].c<H+.4*atr||c.slice(j-16,j).some(x=>x.c>H))continue;
      const k=c.slice(j+1,E+1).findIndex(x=>x.l<=H+.4*atr);
      if(k>=0&&entry>=H-.25*atr&&entry<=H+1*atr&&c.slice(j+1,E+1).every(x=>x.c>H-.35*atr)){
        comps.push({k:'retest',label:'Retest',sub:'Break & retest',level:H,inv:H-.8*atr,dist:Math.abs(entry-H)/atr});marks.push({i:j,t:'Break'});marks.push({i:j+1+k,t:'Retest'});got=true}
    }
    if(!got&&E>=20){
      const H=winHi(E-19,E-1),L=winLo(E-19,E-1),firstClose=c.slice(E-19,E).every(x=>x.c<=H+.05*atr);
      if(H-L<=5*atr&&firstClose&&entry>=H+.15*atr&&entry<=H+1.1*atr){comps.push({k:'breakout',label:'Breakout',sub:'Range breakout',level:H,inv:H-.8*atr,dist:Math.abs(entry-H)/atr});marks.push({i:E,t:'Break'})}
    }
  }
  // range / support bounce
  if(E>=26){
    const ema=emaArr(c,20),w=c.slice(E-26,E-1),Hr=Math.max(...w.map(x=>x.h)),Lr=Math.min(...w.map(x=>x.l)),ht=(Hr-Lr)/atr;
    const touches=w.filter(x=>x.l<=Lr+.4*atr).length,flat=Math.abs(ema[E]-ema[E-16])<1*atr;
    if(ht>=2.2&&ht<=7.5&&flat&&touches>=2&&entry-Lr<=1.3*atr&&entry>=Lr-.2*atr&&c[E].c>c[E].o)
      {comps.push({k:'range',label:'Range',sub:'Range low bounce',zone:{lo:Lr,hi:Lr+.4*atr,i0:E-26},inv:Lr-.5*atr,dist:Math.max(0,(entry-Lr-.4*atr)/atr)});marks.push({i:E,t:'Bounce'})}
  }
  // mean reversion
  {
    const ema=emaArr(c,20),lo=Math.min(...c.slice(E-3,E+1).map(x=>x.l));
    if(E>=24&&ema[E]-lo>=2.6*atr&&ema[E]-entry>=1.4*atr&&c[E].c>c[E].o)
      {comps.push({k:'meanrev',label:'Mean reversion',sub:'Overextension fade',level:lo,inv:lo-.3*atr,dist:Math.max(0,(entry-lo)/atr-.3)});marks.push({i:E,t:'Fade'})}
  }
  // VWAP reclaim
  {
    const vw=vwapArr(c);
    if(E>=10&&c[E-2].c<vw[E-2]&&entry>vw[E]&&entry-vw[E]<=.45*atr)
      {comps.push({k:'vwap',label:'VWAP',sub:'VWAP reclaim',level:vw[E],inv:vw[E]-.8*atr,dist:Math.abs(entry-vw[E])/atr})}
  }
  // trend pullback
  {
    const ema=emaArr(c,20);
    if(E>=10&&ema[E]-ema[E-8]>=.55*atr&&Math.abs(entry-ema[E])<=.9*atr&&Math.min(...c.slice(E-4,E+1).map(x=>x.l))<=ema[E]+.35*atr)
      comps.push({k:'pullback',label:'EMA pullback',sub:'EMA pullback',level:ema[E],inv:ema[E]-1.0*atr,dist:Math.abs(entry-ema[E])/atr});
  }
  // EMA bounce / cross (no strong trend)
  {
    const ema=emaArr(c,20),slope=Math.abs(ema[E]-ema[E-8]);
    if(E>=10&&slope<.55*atr&&entry>ema[E]&&entry-ema[E]<=.45*atr&&(c[E-2].c<ema[E-2]||Math.min(c[E].l,c[E-1].l)<=ema[E]+.15*atr))
      comps.push({k:'ema',label:'EMA',sub:c[E-2].c<ema[E-2]?'EMA cross':'EMA bounce',level:ema[E],inv:ema[E]-.9*atr,dist:Math.abs(entry-ema[E])/atr});
  }
  // momentum chase
  const w=c.slice(Math.max(0,E-4),E+1),mnL=Math.min(...w.map(x=>x.l)),mxH=Math.max(...w.map(x=>x.h));
  const legMove=(entry-mnL)/atr,legPos=(entry-mnL)/Math.max(1e-9,mxH-mnL),chase=legMove>=2.4&&legPos>=.8;
  comps.sort((x,y)=>FAMORDER.indexOf(x.k)-FAMORDER.indexOf(y.k));
  let family,primary=comps[0];
  if(primary)family=primary.k;else if(chase)family='chase';else family='none';
  const ink=primary?primary.inv:null,beyond=ink!=null&&(dir>0?stopPx:-stopPx)<=ink+.05*atr;
  const zn=comps.find(x=>x.zone)?.zone||null,lvl=primary&&primary.level!=null?primary.level:(comps.find(x=>x.level!=null)||{}).level??null;
  const back=v=>v==null?null:q(v);
  const zone=zn?(dir>0?{lo:zn.lo,hi:zn.hi,i0:zn.i0}:{lo:-zn.hi,hi:-zn.lo,i0:zn.i0}):null;
  return{family,name:FAM[family],sub:primary?primary.sub:family==='chase'?'Chase after displacement':null,comps,
    names:comps.map(x=>x.label),zone,level:back(lvl),marks,dist:primary?primary.dist:null,legPos,chase,atr,stopBeyond:beyond,
    confidence:primary?Math.min(.95,.55+.13*comps.length):family==='chase'?.7:.5};
}

/* ---------- analysis and scoring ---------- */
function analyze(t){
  t.cls=classify(t.candles,t.E,t.dir,t.stopPx);
  const sd=Math.abs(t.entry-t.stopPx);t.stopATR=sd/t.cls.atr;
  let mfe=0,mae=0;
  for(let k=t.E+1;k<t.candles.length;k++){const x=t.candles[k];mfe=Math.max(mfe,t.dir>0?x.h-t.entry:t.entry-x.l);mae=Math.max(mae,t.dir>0?t.entry-x.l:x.h-t.entry)}
  t.mfeR=mfe/sd;t.maeR=mae/sd;const mv=(t.exit-t.entry)*t.dir;t.eff=mv>0&&mfe>0?clamp(mv/mfe,0,1):0;
}
const BASE={sweep:72,ob:72,fvg:68,structure:62,pullback:60,retest:74,breakout:64,range:66,meanrev:58,vwap:64,ema:60,chase:22,none:12};
const STOPNAME={sweep:'sweep wick',ob:'order block',fvg:'gap',structure:'broken level',pullback:'EMA',retest:'retest level',breakout:'breakout level',range:'range low',meanrev:'swing low',vwap:'VWAP',ema:'EMA'};
const gradeOf=s=>s>=85?'S':s>=72?'A':s>=58?'B':s>=44?'C':'D';
function scoreTrade(t){
  const cl=t.cls,f=t.flags,fam=cl.family,win=t.pnl>0,m=mkOf(t.mk);
  const setup=clamp(BASE[fam]+Math.max(0,cl.comps.length-1)*9,0,100);
  let ent=fam==='none'?38:fam==='chase'?clamp(100*(1-cl.legPos)+10,0,40):100-52*clamp((cl.dist||0)/1.5,0,1);
  ent=clamp(ent-clamp(t.slipE-1.5,0,6)*3-clamp(t.spreadRatio-1.4,0,3)*7,0,100);
  let rk=68;if(cl.stopBeyond)rk+=20;if(t.stopATR<1)rk-=24;if(t.stopATR>3.4)rk-=10;if(t.R<-1.75)rk-=34;rk=clamp(rk,0,100);
  const mg=t.R<-1.75?15:win?40+60*t.eff:t.mfeR>=1?28:64;
  const dc=100-(f.includes('revenge')?40:0)-(f.includes('over')?25:0)-(f.includes('stop')?35:0);
  t.sc={setup,entry:ent,risk:rk,mgmt:mg,disc:dc};
  t.score=.25*setup+.25*ent+.2*rk+.15*mg+.15*dc;t.grade=gradeOf(t.score);
  const S=[],W=[],d=cl.dist;
  if(setup>=75)S.push({c:'setup',w:setup,t:`Clean ${cl.names.join(' + ')} setup`});
  if(d!=null&&d<=.4&&fam!=='chase')S.push({c:'zone',w:82,t:`Entered ${d.toFixed(1)} ATR from the ${cl.zone?'zone edge':'key level'}`});
  if(t.role==='taker'&&t.slipE<=1)S.push({c:'fill',w:70,t:`Filled within ${Math.max(0,t.slipE).toFixed(1)} bps of the expected price`});
  if(t.role==='maker')S.push({c:'maker',w:66,t:'Maker entry, no spread crossed'});
  if(cl.stopBeyond&&t.stopATR>=1)S.push({c:'stop',w:76,t:`Stop sat beyond the ${STOPNAME[fam]||'structure'}`});
  if(win&&t.eff>=.75)S.push({c:'exit',w:86,t:`Captured ${Math.round(t.eff*100)}% of the move`});
  if(!f.length)S.push({c:'clean',w:40,t:'Followed your rules'});
  if(fam==='chase')W.push({c:'chase',w:95,t:`Chased: entered ${Math.round(cl.legPos*100)}% up the impulse leg`});
  if(fam==='none')W.push({c:'nosetup',w:90,t:'No recognizable setup before entry'});
  if(d!=null&&d>=.9&&fam!=='chase')W.push({c:'late',w:80,t:`Entry ${d.toFixed(1)} ATR from the edge, so the stop had to be wider`});
  if(t.slipE>3)W.push({c:'slip',w:75,t:`Paid ${t.slipE.toFixed(1)} bps slippage (${usd(t.size*t.entry*t.slipE/1e4,2)})`});
  if(t.spreadRatio>1.6)W.push({c:'spread',w:70,t:`Spread was ${t.spreadBps.toFixed(1)} bps, ${t.spreadRatio.toFixed(1)}× normal for ${m.sym}`});
  if(t.stopATR<1)W.push({c:'tight',w:72,t:`Stop only ${t.stopATR.toFixed(1)} ATR away, inside normal candle noise`});
  if(!cl.stopBeyond&&fam!=='none'&&fam!=='chase'&&t.stopATR>=1)W.push({c:'loose',w:55,t:'Stop was not beyond the level that invalidates the idea'});
  if(!win&&t.mfeR>=1)W.push({c:'gaveback',w:88,t:`Peaked at +${t.mfeR.toFixed(1)}R and closed ${t.R.toFixed(1)}R`});
  if(win&&t.eff<.4)W.push({c:'early',w:60,t:`Only ${Math.round(t.eff*100)}% of the move captured`});
  if(f.includes('revenge'))W.push({c:'revenge',w:100,t:'Revenge re-entry: opened minutes after a loss at larger size'});
  if(f.includes('over'))W.push({c:'over',w:85,t:'Overtrading: 4th trade of the day or later'});
  if(f.includes('stop'))W.push({c:'stopv',w:100,t:`Stop not honored, closed at ${t.R.toFixed(1)}R`});
  S.sort((a,b)=>b.w-a.w);W.sort((a,b)=>b.w-a.w);t.ins={str:S,weak:W};
}
const FLAGS={revenge:'Revenge re-entry',stop:'Stop violated',over:'Overtrading'};
function detectFlags(TR){
  const o=TR.slice().sort((a,b)=>a.open-b.open),perDay={};
  o.forEach((x,i)=>{
    x.flags=[];let prev=null;
    for(let j=0;j<i;j++){const y=o[j];if(y.close<=x.open&&(!prev||y.close>prev.close))prev=y}
    if(prev&&prev.pnl<0&&x.open-prev.close<=15*6e4&&x.risk>=1.2*prev.risk)x.flags.push('revenge');
    if(x.pnl/x.risk<-1.75)x.flags.push('stop');
    const k=dkey(x.open);perDay[k]=(perDay[k]||0)+1;if(perDay[k]>=4)x.flags.push('over');
  });
}
function rescore(TR){detectFlags(TR);TR.forEach(scoreTrade)}


/* ---------- Node export ---------- */
if(typeof module!=='undefined')module.exports={classify,analyze,scoreTrade,detectFlags,rescore,gradeOf,FAM,FAMGROUP,FLAGS,genHistory,makeTrade,rng,MARKETS,mkOf};
