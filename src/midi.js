import { clamp } from "./utils.js";
import { AppState } from "./state.js";

export function requestMIDI(onChange){
  if(!navigator.requestMIDIAccess) return Promise.reject(new Error("no-webmidi"));
  return navigator.requestMIDIAccess({sysex:false}).then(access=>{
    AppState.midi.access=access;
    access.onstatechange=()=>onChange&&onChange();
    return access;
  });
}
export function listOutputs(){
  const arr=[];
  const ma=AppState.midi.access; if(!ma) return arr;
  try{ ma.outputs.forEach(o=>arr.push(o)); }catch{
    const it=ma.outputs&&ma.outputs.values&&ma.outputs.values();
    if(it){ for(const v of it) arr.push(v); }
  }
  return arr;
}
export function setOutputById(id){
  const ma=AppState.midi.access; if(!ma) return null;
  let out=ma.outputs.get?ma.outputs.get(id):null;
  if(!out){ try{ ma.outputs.forEach(o=>{ if(o.id===id) out=o; }); }catch{} }
  AppState.midi.out=out||null;
  return AppState.midi.out;
}
export function midiName(o){ if(!o) return "(none)"; return ((o.manufacturer?o.manufacturer+" ":"")+(o.name||o.id||"(unnamed)")); }

export function sendNoteOn(note,vel){
  const out=AppState.midi.out; if(!out) return;
  out.send([0x90,(note|0)&127,clamp(Math.round((vel==null?1:vel)*127),1,127)]);
}
export function sendNoteOff(note){
  const out=AppState.midi.out; if(!out) return;
  out.send([0x80,(note|0)&127,0]);
}
export function sendAllNotesOff(){
  const out=AppState.midi.out; if(!out) return;
  for(let n=0;n<128;n++) out.send([0x80,n&127,0]);
}
export function sendSustain(flag){
  const out=AppState.midi.out; if(!out) return;
  out.send([0xB0,64,flag?127:0]);
}
