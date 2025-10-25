import { pc, now } from "./utils.js";
import { EngineCfg } from "./state.js";

const KRUM_MAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KRUM_MIN=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

function rotate(a,k){const n=a.length,out=new Array(n);for(let i=0;i<n;i++)out[(i+k)%n]=a[i];return out;}
function dot(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function norm(a){return Math.sqrt(dot(a,a));}
function corr(a,b){const na=norm(a),nb=norm(b);if(na===0||nb===0)return 0;return dot(a,b)/(na*nb);}

export function windowedEvents(P){
  const evs=(P?.events||[]).filter(e=>e.type!=='cc');
  if(!EngineCfg.windowMs||!evs.length) return evs;
  const maxT=evs[evs.length-1].t|0; const t0=Math.max(0,maxT-EngineCfg.windowMs);
  return evs.filter(e=>e.t>=t0);
}

export function pcHistogramHeld(P,tNow){
  const evs=windowedEvents(P); if(!evs.length) return new Array(12).fill(0);
  const on=new Map(), held=new Map(); let sustain=false;
  const cc64=(P?.events||[]).filter(e=>e.type==='cc'&&e.cc===64);
  if(cc64.length){
    const last=cc64[cc64.length-1]; const abs=(P.t0!=null?P.t0+last.t:now());
    if(abs>(tNow-400)) sustain=(last.val>=64);
  }
  for(const e of evs){
    if(e.type==='on'){ on.set(e.note,e.t); }
    else if(e.type==='off'){
      const tOn=on.get(e.note);
      if(tOn!=null){ const dur=(e.t-tOn); held.set(e.note,(held.get(e.note)||0)+Math.max(10,dur)); on.delete(e.note); }
    }
  }
  on.forEach((tOn,n)=>{
    const extra=sustain?EngineCfg.sustainExtendMs:30;
    const dur=Math.max(10,(evs[evs.length-1].t-tOn)+extra);
    held.set(n,(held.get(n)||0)+dur);
  });
  const pcw=new Array(12).fill(0);
  held.forEach((w,n)=>{
    const vel=(P.active?.get(n)?.vel)||0.7;
    const bonus=(n<=EngineCfg.lowSplit?1.8:1.0);
    pcw[pc(n)]+=w*bonus*(0.6+0.6*vel);
  });
  return pcw;
}

export function estimateScale(pcw){
  let best={type:'maj',root:0,c:-1};
  for(let r=0;r<12;r++){
    const cMaj=corr(pcw,rotate(KRUM_MAJ,r));
    const cMin=corr(pcw,rotate(KRUM_MIN,r));
    if(cMaj>best.c) best={type:'maj',root:r,c:cMaj};
    if(cMin>best.c) best={type:'min',root:r,c:cMin};
  }
  const isMinor=best.type==='min';
  const scale=(isMinor?[0,2,3,5,7,8,10]:[0,2,4,5,7,9,11]).map(x=>pc(x+best.root));
  return {rootPc:best.root,isMinor,scale,conf:best.c};
}

export function estimateTempoSwing(evs,prevBpm,prevSwing){
  const ons=evs.filter(e=>e.type==='on').map(e=>e.t).sort((a,b)=>a-b);
  if(ons.length<6) return {bpm:prevBpm||EngineCfg.defaultBpm,swing:prevSwing??EngineCfg.human.swingDefault};
  const iois=[]; for(let i=1;i<ons.length;i++){ const d=ons[i]-ons[i-1]; if(d>EngineCfg.minIOI&&d<EngineCfg.maxIOI) iois.push(d); }
  if(!iois.length) return {bpm:prevBpm||EngineCfg.defaultBpm,swing:prevSwing??EngineCfg.human.swingDefault};
  const s=iois.slice().sort((a,b)=>a-b), med=s[(s.length/2)|0];
  let bpm=60000/Math.max(120,Math.min(900,med));
  if(bpm<55) bpm*=2; if(bpm>170) bpm/=2;
  if(prevBpm) bpm=prevBpm*(1-EngineCfg.smoothTempo)+bpm*EngineCfg.smoothTempo;

  const beat=60000/Math.max(40,Math.min(220,bpm));
  const eighth=beat/2;
  const phases=ons.map(t=>(t/eighth)%2);
  let sumUp=0,cntUp=0;
  for(const ph of phases){
    const p=ph%2; const dUp=Math.abs(p-1); const dDown=Math.min(p,2-p);
    if(dUp<dDown){ sumUp+=(1-dUp); cntUp++; }
  }
  let swing=prevSwing??EngineCfg.human.swingDefault;
  if(cntUp>0){ const upAvg=sumUp/cntUp; const target=0.5+Math.min(0.16,upAvg*0.22); swing=swing*0.8+target*0.2; }
  return {bpm,swing:Math.max(0.5,Math.min(0.7,swing))};
}

export function rhythmGrid8(evs,bpm,swing){
  const beat=60000/Math.max(40,Math.min(220,bpm));
  const a=beat/2*swing, b=beat/2*(2-2*swing);
  const slots=[]; let t=0; for(let i=0;i<8;i++){ slots.push({i,t}); t+= (i%2?b:a); }
  const dens=new Array(8).fill(0);
  const ons=evs.filter(e=>e.type==='on').map(e=>e.t);
  const cycle=slots[7].t + (7%2?b:a);
  for(const ot of ons){
    const m=((ot%cycle)+cycle)%cycle;
    let bi=0,bd=1e9;
    for(const s of slots){ const d=Math.abs(m-s.t); if(d<bd){bd=d;bi=s.i;} }
    const w=Math.max(0.1,1-(bd/(beat*0.5)));
    dens[bi]+=w;
  }
  const max=Math.max(1,...dens);
  return dens.map(x=>x/max);
}


export function updateAnalysis(P){
  const tNow = performance.now ? performance.now() : Date.now();
  const evs=windowedEvents(P);
  const pcw=pcHistogramHeld(P,tNow);
  const {bpm,swing}=estimateTempoSwing(evs,P.analysis?.bpm,P.analysis?.swing);
  const scaleEst=estimateScale(pcw);

  const prevRoot=P.analysis?.rootPc ?? scaleEst.rootPc;
  const alpha=0.25;
  const rootPc=(Math.round(prevRoot*(1-alpha)+scaleEst.rootPc*alpha)%12+12)%12;

  
  const sum = pcw.reduce((a,b)=>a+b,0) || 1;
  const pcwN = pcw.map(x => x / sum);

  P.analysis = {
    bpm, swing,
    rootPc, isMinor:scaleEst.isMinor,
    scale:scaleEst.scale, conf:scaleEst.conf
  };
  P.vis = P.vis || {};
  P.vis.pcw   = pcwN;
  P.vis.grid8 = rhythmGrid8(evs,bpm,swing);
  return P.analysis;
}
