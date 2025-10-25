import { EngineCfg } from "./state.js";

export function roleRange(role){ return (EngineCfg?.ranges?.[role]) || (EngineCfg?.ranges?.bass) || {min:36,max:84}; }
export function roleMinGap(role){ return (EngineCfg?.minGapMs?.[role]) || 120; }
export function roleVel(role){
  const r=(EngineCfg?.human?.vel?.[role]) || [56,82];
  return Math.max(42,Math.min(110,Math.round(r[0]+(r[1]-r[0])*(0.55+(Math.random()*0.24-0.12)) )))/127;
}
export function roleDur(role,bpm){
  const beat=60000/Math.max(40,Math.min(220,bpm));
  if(role==='bass') return Math.min(beat*0.95,520);
  if(role==='mid')  return Math.min(beat*0.65,340);
  return Math.min(beat*0.5,280);
}


export function responseProb(d){
  const x=Math.max(0,Math.min(1,d));
  return Math.min(0.85, 1/(1+Math.exp(-8*(x-0.45))));
}
