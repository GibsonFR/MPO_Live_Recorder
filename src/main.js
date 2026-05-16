import { AppState } from "./state.js";
import { makeDraggable, addMinimizer } from "./draggable.js";
import { requestMIDI, listOutputs, setOutputById, midiName } from "./midi.js";
import { hookWebSocket, hookWorkerMessages } from "./sniffer.js";
import { mountRecorderUI } from "./ui_recorder.js";
import { mountPlayerUI } from "./ui_player.js";
import { mountReactiveColorUI } from "./ui_reactive_color.js";
import { mountSynthesiaTrainerUI } from "./ui_synthesia_trainer.js";
import { mountToolsDock } from "./ui_dock.js";


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

const MIDI_OUT_PREF_KEY = "mo_live_last_midi_output_v2";

function normalizeMidiLabel(v){
  return String(v || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 #+._-]/g, "")
    .trim();
}

function getOutputSignature(o){
  return {
    id: o?.id || "",
    name: o?.name || "",
    manufacturer: o?.manufacturer || "",
    label: midiName(o)
  };
}

function loadLastMidiOutput(){
  try { return JSON.parse(localStorage.getItem(MIDI_OUT_PREF_KEY) || "null"); }
  catch { return null; }
}

function saveLastMidiOutput(o){
  if(!o) return;
  try { localStorage.setItem(MIDI_OUT_PREF_KEY, JSON.stringify(getOutputSignature(o))); }
  catch {}
}

function scoreOutputMatch(o, pref){
  if(!o || !pref) return 0;
  if(pref.id && o.id === pref.id) return 1000;

  const name = normalizeMidiLabel(o.name);
  const manu = normalizeMidiLabel(o.manufacturer);
  const label = normalizeMidiLabel(midiName(o));
  const pName = normalizeMidiLabel(pref.name);
  const pManu = normalizeMidiLabel(pref.manufacturer);
  const pLabel = normalizeMidiLabel(pref.label);

  let score = 0;
  if(pLabel && label === pLabel) score += 500;
  if(pName && name === pName) score += 300;
  if(pManu && manu === pManu) score += 120;
  if(pName && label.includes(pName)) score += 90;
  if(pLabel && label.includes(pLabel)) score += 80;
  if(pName && pName.includes(name) && name.length > 2) score += 45;
  if(pLabel && pLabel.includes(label) && label.length > 2) score += 35;
  return score;
}

function pickPreferredOutput(arr){
  if(!arr.length) return null;
  const pref = loadLastMidiOutput();
  if(!pref) return arr[0];

  let best = arr[0];
  let bestScore = scoreOutputMatch(best, pref);
  for(const o of arr.slice(1)){
    const score = scoreOutputMatch(o, pref);
    if(score > bestScore){ best = o; bestScore = score; }
  }
  return bestScore > 0 ? best : arr[0];
}

function setOutStatus(t, ok){ st.textContent=t; st.style.background=ok?"#264a2f":"#742626"; }
function fillOutputs(){
  sel.innerHTML="";
  const arr=listOutputs();
  if(arr.length===0){
    const opt=document.createElement("option"); opt.value=""; opt.textContent="(no MIDI outputs)";
    sel.appendChild(opt); sel.disabled=true; test.disabled=true; setOutStatus("no output", false); return;
  }
  sel.disabled=false;
  arr.forEach(o=>{ const opt=document.createElement("option"); opt.value=o.id; opt.textContent=midiName(o); sel.appendChild(opt); });

  const pick = pickPreferredOutput(arr) || arr[0];
  sel.value = pick.id;
  setOutputById(pick.id);
  saveLastMidiOutput(pick);

  const pref = loadLastMidiOutput();
  const restored = pref && scoreOutputMatch(pick, pref) > 0;
  test.disabled=false;
  setOutStatus((restored ? "↻ " : "→ ") + midiName(pick), true);
}
req.onclick=()=>{ requestMIDI(fillOutputs).then(()=>{ fillOutputs(); }).catch(()=>setOutStatus("WebMIDI unsupported",false)); };
rescan.onclick=()=>{ fillOutputs(); };
sel.onchange=()=>{
  const out = setOutputById(sel.value);
  if(out) saveLastMidiOutput(out);
  const label=sel.options[sel.selectedIndex]?.textContent||"(none)";
  setOutStatus("→ "+label,true);
};
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

setOutStatus("restoring...", true);
requestMIDI(fillOutputs)
  .then(()=>fillOutputs())
  .catch(()=>setOutStatus("click Request MIDI", false));


let recorderPanel = null;
let playerPanel = null;
let reactivePanel = null;
let trainerPanel = null;
let midiOutPanel = { box: outBox };

try{ recorderPanel = mountRecorderUI(); }catch(e){ console.warn('recorder-ui failed', e); }
try{ hookWebSocket(); }catch(e){ console.warn('sniffer failed', e); }
try{ hookWorkerMessages(); }catch(e){ console.warn('worker sniffer failed', e); }
try{ playerPanel = mountPlayerUI(); }catch(e){ console.warn('player-ui failed', e); }
try{ reactivePanel = mountReactiveColorUI(); }catch(e){ console.warn('reactive-color-ui failed', e); }
try{ trainerPanel = mountSynthesiaTrainerUI(); }catch(e){ console.warn('synthesia-trainer-ui failed', e); }

try{
  mountToolsDock([
    { id: 'midi-out', label: 'MIDI Out', icon: '⇢', box: midiOutPanel?.box },
    { id: 'player', label: 'Player', icon: '▶', box: playerPanel?.box },
    { id: 'recorder', label: 'Recorder', icon: '●', box: recorderPanel?.box },
    { id: 'reactive-color', label: 'Color', icon: '✦', box: reactivePanel?.box },
    { id: 'trainer', label: 'Trainer', icon: '◆', box: trainerPanel?.box }
  ]);
}catch(e){ console.warn('tools-dock failed', e); }
