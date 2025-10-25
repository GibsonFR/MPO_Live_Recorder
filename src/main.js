import { AppState } from "./state.js";
import { makeDraggable, addMinimizer } from "./draggable.js";
import { requestMIDI, listOutputs, setOutputById, midiName } from "./midi.js";
import { hookWebSocket } from "./sniffer.js";
import { mountRecorderUI } from "./ui_recorder.js";
import { mountMonitorUI } from "./ui_monitor.js";
import { mountPlayerUI } from "./ui_player.js";


const outBox = document.createElement("div");
Object.assign(outBox.style, {
  position: "fixed",
  left: "12px",
  bottom: "12px",
  zIndex: 999999,
  background: "rgba(17,17,17,.95)",
  color: "#eee",
  padding: "10px",
  borderRadius: "10px",
  fontFamily: "system-ui",
  minWidth: "320px",
  boxShadow: "0 10px 30px rgba(0,0,0,.6)",
});
outBox.innerHTML = `
  <style>
    .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px}
    .mo-btn:hover{background:#353535}
    .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}
  </style>
  <div id="hdr" style="display:flex;align-items:center;gap:8px;cursor:move">
    <strong>MIDI Output</strong>
    <span id="st" class="mo-chip" style="margin-left:auto;background:#444">idle</span>
  </div>
  <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
    <button id="req" class="mo-btn">Request MIDI</button>
    <button id="rescan" class="mo-btn">Rescan</button>
    <select id="sel" style="flex:1;min-width:160px;background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px"></select>
    <button id="test" class="mo-btn">Test</button>
  </div>
`;
document.body.appendChild(outBox);
const __hdr = outBox.querySelector("#hdr") || outBox.firstElementChild;
addMinimizer(outBox, __hdr, "midi-out");
makeDraggable(outBox, __hdr); 

const st = outBox.querySelector("#st");
const req = outBox.querySelector("#req");
const rescan = outBox.querySelector("#rescan");
const sel = outBox.querySelector("#sel");
const test = outBox.querySelector("#test");

function setOutStatus(t, ok){ st.textContent=t; st.style.background=ok?"#264a2f":"#742626"; }
function fillOutputs(){
  sel.innerHTML="";
  const arr=listOutputs();
  if(arr.length===0){
    const opt=document.createElement("option"); opt.value=""; opt.textContent="(no MIDI outputs)";
    sel.appendChild(opt); sel.disabled=true; test.disabled=true; return;
  }
  sel.disabled=false;
  arr.forEach(o=>{ const opt=document.createElement("option"); opt.value=o.id; opt.textContent=midiName(o); sel.appendChild(opt); });
  const pick=arr[0]; sel.value=pick.id; setOutputById(pick.id);
  test.disabled=false; setOutStatus("→ "+midiName(pick), true);
}
req.onclick=()=>{ requestMIDI(fillOutputs).then(()=>{ setOutStatus("ready",true); fillOutputs(); }).catch(()=>setOutStatus("WebMIDI unsupported",false)); };
rescan.onclick=fillOutputs;
sel.onchange=()=>{ setOutputById(sel.value); const label=sel.options[sel.selectedIndex]?.textContent||"(none)"; setOutStatus("→ "+label,true); };
test.onclick=async ()=>{
  try{
    const out=AppState.midi.out; if(!out){ setOutStatus("no output", false); return; }
    await out.open();
    const notes=[60,64,67];
    for(let i=0;i<notes.length;i++){
      out.send([0x90, notes[i]&127, 100]);
      setTimeout(()=>out.send([0x80, notes[i]&127, 0]), 200+i*10);
      await new Promise(r=>setTimeout(r, 180));
    }
    setOutStatus("test ok", true);
  }catch(e){ setOutStatus("test failed", false); console.warn(e); }
};


try{ mountRecorderUI(); }catch(e){ console.warn('recorder-ui failed', e); }
try{ mountMonitorUI(); }catch(e){ console.warn('monitor-ui failed', e); }
try{ hookWebSocket(); }catch(e){ console.warn('sniffer failed', e); }
try{ mountPlayerUI(); }catch(e){ console.warn('player-ui failed', e); }
