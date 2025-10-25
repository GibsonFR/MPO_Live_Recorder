import { AppState, EngineCfg } from "./state.js";
import { pc } from "./utils.js";
import { roleRange, roleMinGap, roleVel, roleDur, responseProb } from "./rhythm.js";
import { sendNoteOn, sendNoteOff } from "./midi.js";


function logEvt(type, data = {}) {
  try { const push = AppState && AppState.__logPush; if (typeof push === "function") push(type, data); } catch (_) {}
}


function noteInRangeFromPc(targetPc, range, bias){
  let n=(bias!=null)?bias:(60 - pc(60) + targetPc);
  const c=Math.round((range.min+range.max)/2);
  if(bias==null) n=c - pc(c) + targetPc;
  while(n<range.min) n+=12;
  while(n>range.max) n-=12;
  return n;
}
function chooseVoiced(prev, pcs, weights, range){
  let best=null,bestScore=-1e9;
  for(let i=0;i<pcs.length;i++){
    const pcv=pcs[i];
    const cand=noteInRangeFromPc(pcv,range,prev);
    const up=cand+12<=range.max?cand+12:cand;
    const dn=cand-12>=range.min?cand-12:cand;
    for(const n of [cand,up,dn]){
      const dist=(prev==null)?0:Math.abs(n-prev);
      const center=-0.015*Math.abs(n-((range.min+range.max)/2));
      const smooth=-0.9*dist;
      const w=Math.log(1+(weights[i]||1));
      const s=1.0*w+smooth+center+(Math.random()*0.5-0.25);
      if(s>bestScore){bestScore=s; best=n;}
    }
  }
  return best;
}

function currentJitter(){
  const ui = AppState?.accompOpts?.humanize;
  return (ui!=null?ui:(EngineCfg?.human?.jitter ?? 7));
}

function emitNote(P,note,vel,durMs,delayMs, meta){
  const out=AppState?.midi?.out;
  if(!out){ logEvt("emit.skip.no_midi", { note, vel, durMs, delayMs, meta }); return; }

  const jitter=(Math.random()*2*currentJitter()-currentJitter());
  const when=Math.max(0,(delayMs??0)+((EngineCfg?.human?.latency)||0) + jitter);
  const tNow = performance.now ? performance.now() : Date.now();

  setTimeout(()=>{
    try{ sendNoteOn(note,Math.round(vel*127)); }catch{}
    P.accomp.active.add(note);
    P.vis = P.vis || {};
    P.vis.lastOuts = P.vis.lastOuts || [];
    P.vis.lastOuts.push(note); if(P.vis.lastOuts.length>8) P.vis.lastOuts.shift();
    AppState.__lastMidiOutAt = performance.now ? performance.now() : Date.now();
    logEvt("emit.note_on", { note, vel, durMs, delayMs: when, meta });

    setTimeout(()=>{
      try{ sendNoteOff(note); }catch{}
      P.accomp.active.delete(note);
      logEvt("emit.note_off", { note, meta });
    }, Math.max(40,durMs+(Math.random()*20-10)));
  }, when);

  logEvt("emit.scheduled", { at:(tNow+when), note, vel, durMs, meta });
}

function playChordVoiced(P, pcs, range, vel, holdMs, meta){
  const voiced=[];
  for(let i=0;i<pcs.length;i++){
    const n=chooseVoiced(P.accomp.prevChord?.[i] ?? P.accomp.prevNote, [pcs[i]], [1], range);
    voiced.push(n);
  }
  P.accomp.prevChord=voiced.slice();
  const uniq=[...new Set(voiced)];
  logEvt("emit.chord", { voiced: uniq, holdMs, meta });
  for(const n of uniq) emitNote(P,n,vel,holdMs,0,meta);
}


export function initAccompaniment(P){
  P.accomp = P.accomp || {};
  P.accomp.prevNote = null;
  P.accomp.prevChord = null;
  P.accomp.active = new Set();

  
  P.accomp.phaseT0 = null;      
  P.accomp.lastSlot = -1;       
  P.accomp.measureNotes = 0;    
  P.accomp.__lastEmitAt = 0;

  logEvt("accomp.init", { playerId: P.id ?? null });
}

function getBarTiming(bpm, swing){
  const beat = 60000/Math.max(40,Math.min(220,bpm));
  const eighth = beat/2;
  const a = eighth * swing;
  const b = eighth * (2 - 2*swing);
  const slotDur = [a,b,a,b,a,b,a,b];
  const barLen = slotDur.reduce((s,x)=>s+x,0);
  const cum = []; let t=0; for(let i=0;i<8;i++){ cum.push(t); t+=slotDur[i]; }
  return { beat, slotDur, barLen, cum };
}
function slotAt(tInBar, cum){
  for(let i=7;i>=0;i--){ if(tInBar >= cum[i]) return i; }
  return 0;
}

export function tickAccompaniment(playerId, P){
  if(!P){ logEvt("tick.skip.no_player"); return; }
  const opts = (AppState && AppState.accompOpts) ? AppState.accompOpts : { enabled:false, role:"pads" };
  if (!opts.enabled){ logEvt("tick.skip.disabled"); return; }

  const out = AppState?.midi?.out;
  if(!out){ logEvt("tick.skip.no_midi"); return; }

  const role = opts.role || "pads";
  const bpm = Math.max(40,Math.min(220,P.analysis?.bpm || (EngineCfg?.defaultBpm)||110));
  const swing = P.analysis?.swing ?? (EngineCfg?.human?.swingDefault ?? 0.58);
  const { beat, slotDur, barLen, cum } = getBarTiming(bpm, swing);

  const now = performance.now ? performance.now() : Date.now();

  if(P.accomp.phaseT0 == null){
    P.accomp.phaseT0 = now;
    P.accomp.lastSlot = -1;
    P.accomp.measureNotes = 0;
    logEvt("clock.anchor", { t0: P.accomp.phaseT0, bpm, swing, barLen, slotDur });
  }

  let tBar = (now - P.accomp.phaseT0) % barLen;
  if (tBar < 0) tBar += barLen;

  const slot = slotAt(tBar, cum);
  if (slot === P.accomp.lastSlot){ logEvt("tick.same_slot", { slot }); return; }

  if (slot === 0 && P.accomp.lastSlot !== -1) {
    P.accomp.measureNotes = 0;
    logEvt("clock.new_bar");
  }
  P.accomp.lastSlot = slot;

  const dens = P.vis?.grid8 || new Array(8).fill(0);
  const d = dens[slot] || 0;
  const baseP = responseProb(d);
  const p = Math.max(0.18, baseP);

  if (P.accomp.measureNotes >= 2){ logEvt("gate.measure_limit", { slot }); return; }
  if (Math.random() < 0.25){ logEvt("gate.rest", { slot }); return; }
  if (Math.random() > p){ logEvt("gate.prob", { slot, prob:p, dens:d }); return; }

  const minGap = Math.max(roleMinGap(role), (slotDur[slot] * 0.8));
  if ((now - P.accomp.__lastEmitAt) < minGap){
    logEvt("gate.refractory", { slot, since:(now-P.accomp.__lastEmitAt), needed:minGap });
    return;
  }

  const range = roleRange(role);
  const rootPc = P.analysis?.rootPc ?? 0;
  const isMinor = !!P.analysis?.isMinor;
  const vel = role==="pads" ? 0.70 : role==="bass" ? 0.80 : 0.65;
  const meta = { role, slot, bpm, swing, rootPc, isMinor };

  if(role==="bass"){
    const deg = (Math.random()<0.25 ? 7 : 0);
    const pcs = [pc(rootPc + deg)];
    const n = chooseVoiced(P.accomp.prevNote, pcs, [1], range);
    const hold = Math.min(beat*0.95, 520);
    const lead = (slot%2===0 && Math.random()<0.3) ? -Math.min(40, slotDur[slot]*0.25) : 0;
    logEvt("emit.plan.bass", { note:n, hold, lead, range, ...meta });
    emitNote(P,n,vel,hold, lead, meta);
    P.accomp.prevNote = n;
    P.accomp.measureNotes++;
  } else if(role==="arps"){
    const tri = isMinor ? [rootPc, pc(rootPc+3), pc(rootPc+7)] : [rootPc, pc(rootPc+4), pc(rootPc+7)];
    const n = chooseVoiced(P.accomp.prevNote, tri, [1,1,1], range);
    logEvt("emit.plan.arp", { note:n, range, ...meta });
    emitNote(P,n,vel,Math.min(beat*0.5,300), 0, meta);
    P.accomp.prevNote = n;
    P.accomp.measureNotes++;
  } else {
    const tri = isMinor ? [rootPc, pc(rootPc+3), pc(rootPc+7)] : [rootPc, pc(rootPc+4), pc(rootPc+7)];
    logEvt("emit.plan.pad", { tri, range, hold: Math.min(beat*1.5, 900), ...meta });
    playChordVoiced(P, tri, range, vel, Math.min(beat*1.5, 900), meta);
    P.accomp.measureNotes++;
  }

  P.accomp.__lastEmitAt = now;
}
