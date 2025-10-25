export const PPQ = 480;
export const TEMPO_USPQN = 500000;
export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
export const clamp = (v,a,b)=>v<a?a:(v>b?b:v);
export const pc = n=>((n%12)+12)%12;
export const now = ()=>Date.now();

function vlq(n){const o=[];let v=n&0x7F;o.unshift(v);while((n>>=7)){v=(n&0x7F)|0x80;o.unshift(v);}return o;}
const tbytes=s=>Array.from(new TextEncoder().encode(String(s||"")));
const ticksFromMs=ms=>Math.max(0,Math.round((ms/1000)*(PPQ*2)));

export function buildSMF(events,name){
  if(!events.length) return null;
  const order={on:0,cc:1,off:2};
  const evs=events.slice().sort((a,b)=>a.t===b.t?(order[a.type]-order[b.type]):(a.t-b.t));
  const tr=[], pushDelta=(dt)=>{const d=vlq(dt);for(let i=0;i<d.length;i++) tr.push(d[i]);},
        pushMeta=(dt,ty,bytes)=>{pushDelta(dt); tr.push(0xFF,ty,bytes.length,...bytes);};
  pushMeta(0,0x03,tbytes(name||"player"));
  pushMeta(0,0x51,[(TEMPO_USPQN>>>16)&255,(TEMPO_USPQN>>>8)&255,TEMPO_USPQN&255]);
  let lastTk=0;
  for(const e of evs){
    const tk=ticksFromMs(e.t), dt=Math.max(0,tk-lastTk); lastTk=tk; pushDelta(dt);
    if(e.type==='on'){ tr.push(0x90, e.note&127, clamp(Math.round((e.vel??1)*127),1,127)); }
    else if(e.type==='off'){ tr.push(0x80, e.note&127, 0); }
    else if(e.type==='cc'){ tr.push(0xB0, (e.cc|0)&127, clamp((e.val|0),0,127)); }
  }
  pushDelta(0); tr.push(0xFF,0x2F,0);
  const trLen=tr.length;
  const trHdr=[0x4D,0x54,0x72,0x6B,(trLen>>>24)&255,(trLen>>>16)&255,(trLen>>>8)&255,trLen&255];
  const hdr=[0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(PPQ>>8)&255,PPQ&255];
  return new Blob([new Uint8Array(hdr),new Uint8Array(trHdr),new Uint8Array(tr)],{type:"audio/midi"});
}

export function downloadBlob(blob,name){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},2000);
}
