import { makeDraggable, addMinimizer } from "./draggable.js";

const MIDI_DB_NAME = "mo_midi_library_v1";
const MIDI_STORE = "files";
const TRAINER_PREF_KEY = "mo_synthesia_trainer_prefs_v1";

function openMidiDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(MIDI_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(MIDI_STORE)) db.createObjectStore(MIDI_STORE, { keyPath:"id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function libraryList(){
  const db = await openMidiDb();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(MIDI_STORE, "readonly");
    const req = tx.objectStore(MIDI_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)));
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}
async function libraryGet(id){
  const db = await openMidiDb();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(MIDI_STORE, "readonly");
    const req = tx.objectStore(MIDI_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function readUint16(dv, off){ return (dv.getUint8(off)<<8)|dv.getUint8(off+1); }
function readUint32(dv, off){ return (dv.getUint8(off)<<24)|(dv.getUint8(off+1)<<16)|(dv.getUint8(off+2)<<8)|dv.getUint8(off+3); }
function readVar(dv, off){
  let val=0, i=off, b;
  do { b = dv.getUint8(i++); val = (val<<7) | (b & 0x7F); } while(b & 0x80);
  return {val, len:i-off};
}
function parseSMF(buf){
  const dv = new DataView(buf);
  if(String.fromCharCode(dv.getUint8(0),dv.getUint8(1),dv.getUint8(2),dv.getUint8(3))!=="MThd") throw new Error("Invalid MIDI");
  const headerLen = readUint32(dv,4);
  const format = readUint16(dv,8);
  const ntrks = readUint16(dv,10);
  const division = readUint16(dv,12);
  let off = 8 + headerLen;
  const tracks = [];
  for(let t=0;t<ntrks;t++){
    if(String.fromCharCode(dv.getUint8(off),dv.getUint8(off+1),dv.getUint8(off+2),dv.getUint8(off+3))!=="MTrk") throw new Error("Bad track");
    const len = readUint32(dv, off+4);
    const tend = off+8+len;
    let i = off+8, run = 0, tick = 0;
    const evts = [];
    while(i < tend){
      const d = readVar(dv, i); i += d.len; tick += d.val;
      let st = dv.getUint8(i++);
      if(!(st & 0x80)){ i--; st = run; } else { run = st; }
      if(st === 0xFF){
        const type = dv.getUint8(i++);
        const lenv = readVar(dv,i); i+=lenv.len;
        const data = new Uint8Array(buf, i, lenv.val);
        i += lenv.val;
        evts.push({tick, type:"meta", meta:type, data});
      } else if(st === 0xF0 || st === 0xF7){
        const lenv = readVar(dv,i); i += lenv.len + lenv.val;
      } else {
        const type = st & 0xF0, ch = st & 0x0F;
        const a = dv.getUint8(i++);
        const b = (type===0xC0||type===0xD0)?0:dv.getUint8(i++);
        evts.push({tick, type, ch, a, b});
      }
    }
    tracks.push(evts);
    off = tend;
  }
  return {format, division, tracks};
}
function buildTimedEvents(smf){
  const events = [];
  for(const tr of smf.tracks) for(const e of tr) events.push(e);
  events.sort((a,b)=>a.tick-b.tick);
  const div = smf.division & 0x7FFF;
  let lastTick = 0, curTempo = 500000, tSec = 0;
  const out = [];
  for(const e of events){
    const dt = e.tick - lastTick;
    tSec += (dt * (curTempo/1e6)) / div;
    lastTick = e.tick;
    if(e.type === "meta" && e.meta === 0x51 && e.data?.length === 3){
      curTempo = (e.data[0]<<16)|(e.data[1]<<8)|e.data[2];
      continue;
    }
    if(typeof e.type === "number") out.push({...e, time:tSec});
  }
  return out;
}
function midiToNotes(buf){
  const smf = parseSMF(buf);
  const evs = buildTimedEvents(smf);
  const active = new Map();
  const notes = [];
  for(const e of evs){
    if(e.type === 0x90 && e.b > 0){
      const key = `${e.ch}:${e.a}:${active.size}`;
      if(!active.has(`${e.ch}:${e.a}`)) active.set(`${e.ch}:${e.a}`, []);
      active.get(`${e.ch}:${e.a}`).push({ key, note:e.a, ch:e.ch, velocity:e.b, start:e.time });
    } else if(e.type === 0x80 || (e.type === 0x90 && e.b === 0)){
      const stack = active.get(`${e.ch}:${e.a}`);
      if(stack?.length){
        const n = stack.shift();
        n.end = e.time;
        n.duration = Math.max(0.03, n.end - n.start);
        notes.push(n);
      }
    }
  }
  const end = evs.length ? evs[evs.length-1].time : 0;
  for(const stack of active.values()) for(const n of stack){
    n.end = end;
    n.duration = Math.max(0.03, n.end - n.start);
    notes.push(n);
  }
  notes.sort((a,b)=>a.start-b.start || a.note-b.note);
  return notes;
}
function groupNotes(notes, windowMs=90){
  const win = Math.max(0.01, Number(windowMs||90)/1000);
  const steps = [];
  let cur = null;
  for(const n of notes){
    if(!cur || Math.abs(n.start - cur.start) > win){
      cur = { start:n.start, notes:[n], required:new Set([n.note]), played:new Set(), wrong:[], done:false };
      steps.push(cur);
    } else {
      cur.notes.push(n);
      cur.required.add(n.note);
    }
  }
  for(const s of steps){
    s.end = Math.max(...s.notes.map(n=>n.end));
    s.velocity = Math.round(s.notes.reduce((a,n)=>a+n.velocity,0)/s.notes.length);
    s.name = chordName([...s.required]);
  }
  return steps;
}

const NOTE_NAMES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
function noteLabel(n){ return NOTE_NAMES[((n%12)+12)%12] + (Math.floor(n/12)-1); }

const QWERTY_NOTE_KEYS = (() => {
  const map = new Map();
  const rows = [
    { base: 48, keys: ["z","s","x","d","c","v","g","b","h","n","j","m",",","l",".",";","/"] },
    { base: 60, keys: ["q","2","w","3","e","r","5","t","6","y","7","u","i","9","o","0","p","[","=","]"] }
  ];
  for(const row of rows){
    row.keys.forEach((key, i) => map.set(row.base + i, key));
  }
  return map;
})();

function qwertyKeyForNote(note){
  note = Number(note);
  if(QWERTY_NOTE_KEYS.has(note)) return QWERTY_NOTE_KEYS.get(note);
  const candidates = [];
  for(let n=note; n>=21; n-=12) if(QWERTY_NOTE_KEYS.has(n)) candidates.push({key:QWERTY_NOTE_KEYS.get(n), shift:n-note});
  for(let n=note; n<=108; n+=12) if(QWERTY_NOTE_KEYS.has(n)) candidates.push({key:QWERTY_NOTE_KEYS.get(n), shift:n-note});
  if(!candidates.length) return "—";
  candidates.sort((a,b)=>Math.abs(a.shift)-Math.abs(b.shift));
  const c = candidates[0];
  if(c.shift === 0) return c.key;
  return c.key + (c.shift > 0 ? ` (-${c.shift/12}oct)` : ` (+${Math.abs(c.shift)/12}oct)`);
}
function keyHintForNote(note, layout="qwerty"){
  if(layout === "qwerty") return qwertyKeyForNote(note);
  return "—";
}
function pc(n){ return ((n%12)+12)%12; }
function chordName(notes){
  if(!notes?.length) return "—";
  const pcs = [...new Set(notes.map(pc))].sort((a,b)=>a-b);
  if(pcs.length===1) return NOTE_NAMES[pcs[0]];
  const templates = [
    ["maj", [0,4,7]], ["min", [0,3,7]], ["dim", [0,3,6]], ["aug", [0,4,8]],
    ["sus2", [0,2,7]], ["sus4", [0,5,7]], ["7", [0,4,7,10]],
    ["maj7", [0,4,7,11]], ["min7", [0,3,7,10]], ["mMaj7", [0,3,7,11]],
    ["add9", [0,2,4,7]], ["6", [0,4,7,9]], ["m6", [0,3,7,9]],
  ];
  const setEq = (a,b)=> a.length===b.length && a.every(x=>b.includes(x));
  for(const root of pcs){
    const rel = pcs.map(x=>(x-root+12)%12).sort((a,b)=>a-b);
    for(const [suffix, tmpl] of templates){
      if(setEq(rel, tmpl)) return NOTE_NAMES[root] + suffix;
    }
  }
  if(pcs.length > 4) return "Cluster";
  return pcs.map(x=>NOTE_NAMES[x]).join("/");
}

function loadPrefs(){ try{ return JSON.parse(localStorage.getItem(TRAINER_PREF_KEY)||"{}"); }catch{ return {}; } }
function savePrefs(p){ try{ localStorage.setItem(TRAINER_PREF_KEY, JSON.stringify(p)); }catch{} }

export function mountSynthesiaTrainerUI(){
  const box = document.createElement("div");
  Object.assign(box.style, {
    position:"fixed", left:"130px", top:"150px", zIndex:999999,
    background:"rgba(17,17,17,.95)", color:"#eee", padding:"10px",
    borderRadius:"12px", fontFamily:"system-ui,-apple-system,Segoe UI,sans-serif", width:"560px",
    maxWidth:"calc(100vw - 24px)", boxShadow:"0 10px 30px rgba(0,0,0,.6)", resize:"both", overflow:"hidden"
  });
  box.innerHTML = `
    <style>
      #mo-trainer-root .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px}
      #mo-trainer-root .mo-btn:hover{background:#383838} #mo-trainer-root .mo-btn.active{background:#2f8f55;border-color:#43b573}
      #mo-trainer-root .mo-input{background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px;font-size:12px}
      #mo-trainer-root .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px;font-size:12px}
      #mo-trainer-root .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px}
      #mo-trainer-root label{font-size:12px;opacity:.9}
      #mo-trainer-overlay{position:fixed;inset:0;z-index:999990;pointer-events:none;display:none}
      #mo-trainer-overlay .ghost{position:absolute;bottom:0;border-radius:8px 8px 4px 4px;background:rgba(95,155,255,.42);border:1px solid rgba(170,210,255,.85);box-shadow:0 0 18px rgba(110,180,255,.8);overflow:visible}
      #mo-trainer-overlay .ghostHint{position:absolute;left:50%;top:-24px;transform:translateX(-50%);min-width:18px;padding:2px 6px;border-radius:8px;background:rgba(10,10,10,.88);border:1px solid rgba(255,255,255,.24);color:#fff;font-size:12px;font-weight:800;text-align:center;text-shadow:0 1px 3px #000;white-space:nowrap}
      #mo-trainer-overlay .ghost.done{background:rgba(80,235,140,.55);border-color:rgba(150,255,190,.95)}
      #mo-trainer-overlay .ghost.wrong{background:rgba(255,70,70,.45);border-color:rgba(255,150,150,.95)}
      #moTrainerKeyboard{height:36px;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,.12),rgba(255,255,255,.04));position:relative;margin-top:8px;overflow:visible}
      #moTrainerKeyboard .keyDot{position:absolute;top:5px;width:6px;height:26px;border-radius:4px;background:#555;opacity:.75;transform:translateX(-50%)}
      #moTrainerKeyboard .keyDot.need{background:#5f9bff;box-shadow:0 0 10px #5f9bff;opacity:1}
      #moTrainerKeyboard .keyDot.hit{background:#55f098;box-shadow:0 0 10px #55f098;opacity:1}
      #moTrainerKeyboard .keyDot.bad{background:#ff4f4f;box-shadow:0 0 10px #ff4f4f;opacity:1}
      #moTrainerKeyboard .keyText{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;color:#dbe8ff;text-shadow:0 1px 3px #000;white-space:nowrap;pointer-events:none}
    </style>
    <div id="mo-trainer-root">
      <div id="hdr" style="display:flex;align-items:center;gap:8px;cursor:move;user-select:none"><strong>Synthesia Trainer</strong><span id="status" class="mo-chip" style="margin-left:auto;background:#444">idle</span></div>
      <div id="body" style="max-height:70vh;overflow:auto;padding-right:4px">
        <div class="row"><select id="midiSelect" class="mo-input" style="flex:1;min-width:220px"></select><button id="refresh" class="mo-btn">Refresh</button><button id="load" class="mo-btn">Load</button></div>
        <div class="row"><button id="start" class="mo-btn">Start</button><button id="pause" class="mo-btn">Pause</button><button id="back" class="mo-btn">Back</button><button id="skip" class="mo-btn">Skip</button><button id="reset" class="mo-btn">Reset</button></div>
        <div class="row"><label>Mode</label><select id="mode" class="mo-input"><option value="chord">Chord gate</option><option value="note">Note by note</option><option value="arp">Arpeggio memory</option></select><label>Keyboard</label><select id="keyHints" class="mo-input"><option value="off">No key hints</option><option value="qwerty">QWERTY hints</option></select><label><input id="ghost" type="checkbox" checked> Ghost overlay</label><label><input id="listenMidi" type="checkbox"> WebMIDI input</label></div>
        <div class="row"><label>Chord window</label><input id="chordWin" type="range" min="20" max="650" value="90"><span id="chordWinVal" class="mo-chip">90 ms</span><label>Tolerance</label><input id="tol" type="range" min="0" max="12" value="0"><span id="tolVal" class="mo-chip">exact</span></div>
        <details id="calibration" style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;opacity:.85">Overlay calibration</summary><div class="row"><label>X offset</label><input id="overlayX" type="range" min="-80" max="80" value="0"><span id="overlayXVal" class="mo-chip">0 px</span><label>Scale</label><input id="overlayScale" type="range" min="0.920" max="1.080" step="0.001" value="1"><span id="overlayScaleVal" class="mo-chip">1.000×</span></div><div class="row"><label>White offset</label><input id="whiteX" type="range" min="-20" max="20" value="0"><span id="whiteXVal" class="mo-chip">0 px</span><label>Black offset</label><input id="blackX" type="range" min="-20" max="20" value="0"><span id="blackXVal" class="mo-chip">0 px</span></div></details>
        <div id="moTrainerKeyboard"></div>
        <div class="row"><span class="mo-chip">Step <span id="idx">0</span>/<span id="total">0</span></span><span class="mo-chip">Accuracy <span id="acc">100%</span></span><span class="mo-chip">Streak <span id="streak">0</span></span></div>
        <div id="current" style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);font-size:13px;line-height:1.5"></div>
        <div id="hint" style="margin-top:8px;font-size:12px;opacity:.7">Load a MIDI from the Player library, then play the highlighted note or chord. Best used alone or with WebMIDI input enabled.</div>
      </div>
    </div>`;
  document.body.appendChild(box);
  const overlay = document.createElement("div"); overlay.id = "mo-trainer-overlay"; document.body.appendChild(overlay);

  const hdr=box.querySelector("#hdr"); addMinimizer(box,hdr,"synthesia-trainer"); makeDraggable(box,hdr);
  const $=s=>box.querySelector(s);
  const midiSelect=$("#midiSelect"), status=$("#status"), startBtn=$("#start"), pauseBtn=$("#pause"), ghost=$("#ghost"), listenMidi=$("#listenMidi"), keyHints=$("#keyHints"), modeSel=$("#mode"), chordWin=$("#chordWin"), chordWinVal=$("#chordWinVal"), tol=$("#tol"), tolVal=$("#tolVal"), overlayX=$("#overlayX"), overlayXVal=$("#overlayXVal"), overlayScale=$("#overlayScale"), overlayScaleVal=$("#overlayScaleVal"), whiteX=$("#whiteX"), whiteXVal=$("#whiteXVal"), blackX=$("#blackX"), blackXVal=$("#blackXVal"), current=$("#current"), idxEl=$("#idx"), totalEl=$("#total"), accEl=$("#acc"), streakEl=$("#streak"), keyboard=$("#moTrainerKeyboard");

  const prefs = Object.assign({mode:"chord", chordWin:90, tolerance:0, ghost:true, listenMidi:false, keyHints:"qwerty", lastMidiId:"", overlayX:0, overlayScale:1, whiteX:0, blackX:0}, loadPrefs());
  modeSel.value=prefs.mode; chordWin.value=prefs.chordWin; tol.value=prefs.tolerance; ghost.checked=!!prefs.ghost; listenMidi.checked=!!prefs.listenMidi; keyHints.value = prefs.keyHints || "qwerty"; overlayX.value = String(prefs.overlayX || 0); overlayScale.value = String(prefs.overlayScale || 1); whiteX.value = String(prefs.whiteX || 0); blackX.value = String(prefs.blackX || 0);

  let library=[], notes=[], steps=[], stepIndex=0, running=false, good=0, bad=0, streak=0, midiAccess=null;
  let originalWorkerPost = null;
  const recentRendered = new Map();

  function setStatus(t, ok=false){ status.textContent=t; status.style.background=ok?"#264a2f":"#444"; }
  function saveUiPrefs(){ savePrefs({mode:modeSel.value, chordWin:Number(chordWin.value), tolerance:Number(tol.value), ghost:ghost.checked, listenMidi:listenMidi.checked, keyHints:keyHints.value, overlayX:Number(overlayX.value)||0, overlayScale:Number(overlayScale.value)||1, whiteX:Number(whiteX.value)||0, blackX:Number(blackX.value)||0, lastMidiId:midiSelect.value || prefs.lastMidiId || ""}); }
  function noteOk(played, target){ const semis=Number(tol.value)||0; return Math.abs(played-target)<=semis || (semis===12 && pc(played)===pc(target)); }
  function currentStep(){ return steps[stepIndex] || null; }
  function fmtNotes(ns){ return [...ns].sort((a,b)=>a-b).map(noteLabel).join(" · "); }
  function fmtKeyHints(ns){
    if(keyHints.value === "off") return "—";
    return [...ns].sort((a,b)=>a-b).map(n=>`${noteLabel(n)} = ${keyHintForNote(n, keyHints.value)}`).join(" · ");
  }
  function updateKeyboard(){
    keyboard.innerHTML = "";
    const s = currentStep();
    const req = s ? [...s.required] : [];
    const played = s ? [...s.played] : [];
    for(let n=21;n<=108;n++){
      if(n%2===0 && n<108) continue;
      const d=document.createElement("div"); d.className="keyDot";
      if(req.includes(n)) {
        d.classList.add(played.includes(n)?"hit":"need");
        if(keyHints.value !== "off"){
          const lab = document.createElement("span");
          lab.className = "keyText";
          lab.textContent = keyHintForNote(n, keyHints.value);
          d.appendChild(lab);
        }
      }
      d.style.left = `${((n-21)/(108-21))*100}%`;
      d.style.height = ([1,3,6,8,10].includes(pc(n)) ? 18 : 26) + "px";
      d.style.opacity = [1,3,6,8,10].includes(pc(n)) ? ".9" : ".55";
      keyboard.appendChild(d);
    }
  }
  const WHITE_PCS = new Set([0,2,4,5,7,9,11]);
  const BLACK_PCS = new Set([1,3,6,8,10]);
  let cachedPianoRect = null;
  let cachedPianoAt = 0;

  function isBlackKey(n){ return BLACK_PCS.has(pc(n)); }
  function whiteIndexBefore(note){
    let count = 0;
    for(let n=21; n<note; n++) if(WHITE_PCS.has(pc(n))) count++;
    return count;
  }
  function whiteIndexOf(note){
    let count = 0;
    for(let n=21; n<=note; n++){
      if(WHITE_PCS.has(pc(n))){
        if(n===note) return count;
        count++;
      }
    }
    return Math.max(0, whiteIndexBefore(note));
  }

  function unionRects(rects){
    const left = Math.min(...rects.map(r=>r.left));
    const top = Math.min(...rects.map(r=>r.top));
    const right = Math.max(...rects.map(r=>r.right));
    const bottom = Math.max(...rects.map(r=>r.bottom));
    return {left, top, right, bottom, width:right-left, height:bottom-top};
  }

  function findChatLeft(){
    let best = null;
    for(const el of document.querySelectorAll("input, textarea, [contenteditable='true'], div, aside, section")){
      const r = el.getBoundingClientRect();
      if(r.width < 170 || r.width > 430) continue;
      if(r.height < window.innerHeight * 0.45) continue;
      if(r.left < window.innerWidth * 0.55) continue;
      if(r.right < window.innerWidth - 40) continue;
      const txt = (el.getAttribute?.("placeholder") || el.textContent || "").toLowerCase();
      const looksChat = txt.includes("message") || txt.includes("joined the room") || txt.includes("server") || r.right > window.innerWidth - 12;
      if(!looksChat) continue;
      if(!best || r.left < best.left) best = r;
    }
    return best?.left || null;
  }

  function findPianoRect(){
    const t = performance.now();
    if(cachedPianoRect && t - cachedPianoAt < 250) return cachedPianoRect;

    const keySelectors = [
      ".piano-key", ".key", "[data-key]", "[data-note]", "[data-midi]",
      ".white-key", ".black-key", "[class*='piano'][class*='key']"
    ].join(",");

    const rects = [];
    for(const el of document.querySelectorAll(keySelectors)){
      const r = el.getBoundingClientRect();
      if(!r || r.width < 2 || r.height < 18) continue;
      if(r.bottom < window.innerHeight * 0.55) continue;
      if(r.left < 40 || r.right > window.innerWidth + 20) continue;
      const cs = getComputedStyle(el);
      if(cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      rects.push(r);
    }

    if(rects.length >= 20){
      cachedPianoRect = unionRects(rects);
      cachedPianoAt = t;
      return cachedPianoRect;
    }

    const chatLeft = findChatLeft();
    const left = 84;
    const right = Math.max(left + 600, (chatLeft || (window.innerWidth - 16)) - 4);
    const height = Math.min(128, Math.max(92, window.innerHeight * 0.125));
    const bottom = window.innerHeight - 16;
    cachedPianoRect = { left, right, top:bottom-height, bottom, width:right-left, height };
    cachedPianoAt = t;
    return cachedPianoRect;
  }

  function calibratedRect(rect){
    const scale = Math.max(0.92, Math.min(1.08, Number(overlayScale.value) || 1));
    const x = Number(overlayX.value) || 0;
    const cx = rect.left + rect.width / 2;
    const width = rect.width * scale;
    return { ...rect, left: cx - width / 2 + x, right: cx + width / 2 + x, width };
  }

  function noteCenterX(note, rect){
    const whiteW = rect.width / 52;
    if(!isBlackKey(note)){
      return rect.left + (whiteIndexOf(note) + 0.5) * whiteW + (Number(whiteX?.value)||0);
    }
    const prevWhite = whiteIndexBefore(note);
    return rect.left + prevWhite * whiteW + (Number(blackX?.value)||0);
  }

  function renderOverlay(){
    overlay.style.display = ghost.checked && running ? "block" : "none";
    overlay.innerHTML = "";
    const s=currentStep(); if(!s) return;
    const pianoRect = calibratedRect(findPianoRect());
    const notes=[...s.required].sort((a,b)=>a-b);
    const baseHeight = modeSel.value==="arp" ? 74 : 112;
    notes.forEach((n,i)=>{
      const g=document.createElement("div"); g.className="ghost";
      if(s.played.has(n)) g.classList.add("done");
      const black = isBlackKey(n);
      const center = noteCenterX(n, pianoRect);
      const w = Math.max(black ? 8 : 12, (pianoRect.width/52) * (black ? .55 : .82));
      const h = Math.max(34, baseHeight - i*8);
      g.style.position = "fixed";
      g.style.left = `${Math.round(center - w/2)}px`;
      g.style.top = `${Math.round(pianoRect.top - h)}px`;
      g.style.width = `${Math.round(w)}px`;
      g.style.height = `${Math.round(h)}px`;
      g.style.background = s.played.has(n) ? "rgba(80,235,140,.55)" : colorForNote(n, s);
      if(keyHints.value !== "off"){
        const hint = document.createElement("div");
        hint.className = "ghostHint";
        hint.textContent = keyHintForNote(n, keyHints.value);
        g.appendChild(hint);
      }
      overlay.appendChild(g);
    });
  }
  function colorForNote(n, s){
    if(s.required.size > 1) return "rgba(180,100,255,.42)";
    const hue = 260 - ((n-21)/(108-21))*220;
    return `hsla(${hue},90%,60%,.46)`;
  }
  function updateUI(){
    const s=currentStep();
    idxEl.textContent = steps.length ? String(stepIndex+1) : "0";
    totalEl.textContent = String(steps.length);
    accEl.textContent = `${Math.round((good/Math.max(1,good+bad))*100)}%`;
    streakEl.textContent = String(streak);
    startBtn.classList.toggle("active", running);
    current.innerHTML = s ? `
      <div><b>${s.name}</b></div>
      <div>Required: ${fmtNotes(s.required)}</div>
      <div style="font-size:13px;font-weight:700;color:#dbe8ff">Keyboard keys: ${fmtKeyHints(s.required)}</div>
      <div>Played: ${s.played.size ? fmtNotes(s.played) : "—"}</div>
      <div>Velocity: ${s.velocity} · Time: ${s.start.toFixed(2)}s</div>
    ` : "No MIDI loaded.";
    updateKeyboard(); renderOverlay(); saveUiPrefs();
  }
  function rebuildSteps(){
    const win = Number(chordWin.value)||90;
    const grouped = groupNotes(notes, win);
    if(modeSel.value === "note"){
      steps = notes.map(n=>({start:n.start,end:n.end,notes:[n],required:new Set([n.note]),played:new Set(),wrong:[],done:false,velocity:n.velocity,name:noteLabel(n.note)}));
    } else {
      steps = grouped.map(s=>({...s, required:new Set(s.required), played:new Set(), wrong:[], done:false}));
    }
    stepIndex=0; good=0; bad=0; streak=0;
    totalEl.textContent=String(steps.length);
    updateUI();
  }
  async function refreshLibrary(){
    try{
      const previous = midiSelect.value || prefs.lastMidiId || "";
      library = await libraryList();
      midiSelect.innerHTML="";
      for(const item of library){
        const opt=document.createElement("option");
        opt.value=item.id;
        opt.textContent=item.name;
        opt.title = item.name;
        midiSelect.appendChild(opt);
      }
      if(library.length){
        const wanted = library.find(x=>x.id===previous) || library[0];
        midiSelect.value = wanted.id;
        prefs.lastMidiId = wanted.id;
      }
      setStatus(library.length ? `library ready · ${library.length}` : "empty library", !!library.length);
      saveUiPrefs();
    }catch(e){
      console.error("[Synthesia Trainer] refresh library failed", e);
      setStatus("library error", false);
    }
  }
  async function loadSelected(){
    if(!midiSelect.value){
      await refreshLibrary();
    }
    const id = midiSelect.value || library[0]?.id;
    if(!id){ setStatus("no MIDI in library", false); return; }
    midiSelect.value = id;
    const item=await libraryGet(id); if(!item?.data){ setStatus("missing MIDI", false); return; }
    try{
      notes = midiToNotes(item.data);
      prefs.lastMidiId = id;
      saveUiPrefs();
      rebuildSteps();
      setStatus(`${notes.length} notes loaded`, true);
    }
    catch(e){ console.error(e); setStatus("parse error", false); }
  }
  function advance(){
    const s=currentStep(); if(s) s.done=true;
    stepIndex = Math.min(steps.length, stepIndex+1);
    if(stepIndex>=steps.length){ running=false; setStatus("finished", true); }
    updateUI();
  }
  function playedNote(note, velocity=0.7, source="rendered"){
    if(!running || !steps.length) return;
    const key = `${note}:${source}`;
    const t = performance.now();
    if(recentRendered.has(key) && t-recentRendered.get(key)<55) return;
    recentRendered.set(key,t);
    const s=currentStep(); if(!s) return;
    let match = null;
    for(const target of s.required){ if(!s.played.has(target) && noteOk(note,target)){ match=target; break; } }
    if(match!=null){ s.played.add(match); good++; streak++; setStatus("correct", true); }
    else { s.wrong.push({note, velocity, t:Date.now()}); bad++; streak=0; setStatus(`wrong: ${noteLabel(note)}`, false); }
    const all = [...s.required].every(n=>s.played.has(n));
    updateUI();
    if(all) setTimeout(advance, modeSel.value==="arp" ? 90 : 130);
  }
  function patchWorker(){
    if(originalWorkerPost) return;
    originalWorkerPost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(data, transfer){
      try{
        if(data?.type === "startEffect" && data.note != null){
          const eff = Array.isArray(data.effects) ? data.effects[0] : null;
          const vel = Number(eff?.opts?.velocity ?? 80)/127;
          playedNote(Number(data.note), vel, "worker");
        }
      }catch(e){}
      return originalWorkerPost.call(this, data, transfer);
    };
  }
  async function setupMidiInput(){
    if(!listenMidi.checked || !navigator.requestMIDIAccess) return;
    try{
      midiAccess = await navigator.requestMIDIAccess();
      for(const input of midiAccess.inputs.values()){
        input.onmidimessage = e=>{
          const [st,n,v]=e.data; const cmd=st&0xf0;
          if(cmd===0x90 && v>0) playedNote(n, v/127, "midi");
        };
      }
      setStatus("MIDI input listening", true);
    }catch(e){ setStatus("MIDI input refused", false); }
  }

  $("#refresh").onclick=refreshLibrary;
  $("#load").onclick=loadSelected;
  startBtn.onclick=()=>{ if(!steps.length) return setStatus("load MIDI first", false); running=true; patchWorker(); setupMidiInput(); updateUI(); setStatus("listening", true); };
  pauseBtn.onclick=()=>{ running=false; updateUI(); setStatus("paused", false); };
  $("#back").onclick=()=>{ stepIndex=Math.max(0,stepIndex-1); const s=currentStep(); if(s){ s.played.clear(); s.wrong=[]; } updateUI(); };
  $("#skip").onclick=()=>advance();
  $("#reset").onclick=()=>{ stepIndex=0; good=0; bad=0; streak=0; for(const s of steps){ s.played.clear(); s.wrong=[]; s.done=false; } updateUI(); };
  modeSel.onchange=()=>rebuildSteps();
  chordWin.oninput=()=>{ chordWinVal.textContent=`${chordWin.value} ms`; rebuildSteps(); };
  tol.oninput=()=>{ tolVal.textContent = Number(tol.value)===0 ? "exact" : Number(tol.value)===12 ? "same note name" : `±${tol.value} semis`; updateUI(); };
  overlayX.oninput=()=>{ overlayXVal.textContent = `${overlayX.value} px`; cachedPianoRect = null; updateUI(); };
  overlayScale.oninput=()=>{ overlayScaleVal.textContent = `${Number(overlayScale.value).toFixed(3)}×`; cachedPianoRect = null; updateUI(); };
  whiteX.oninput=()=>{ whiteXVal.textContent = `${whiteX.value} px`; cachedPianoRect = null; updateUI(); };
  blackX.oninput=()=>{ blackXVal.textContent = `${blackX.value} px`; cachedPianoRect = null; updateUI(); };
  ghost.onchange=()=>updateUI();
  keyHints.onchange=()=>updateUI();
  listenMidi.onchange=()=>{ saveUiPrefs(); if(listenMidi.checked) setupMidiInput(); };
  chordWinVal.textContent=`${chordWin.value} ms`; tolVal.textContent = Number(tol.value)===0 ? "exact" : `±${tol.value} semis`; overlayXVal.textContent = `${overlayX.value} px`; overlayScaleVal.textContent = `${Number(overlayScale.value).toFixed(3)}×`; whiteXVal.textContent = `${whiteX.value} px`; blackXVal.textContent = `${blackX.value} px`;

  let dragging=false, dx=0, dy=0;
  hdr.addEventListener("mousedown", e=>{ dragging=true; const r=box.getBoundingClientRect(); dx=e.clientX-r.left; dy=e.clientY-r.top; e.preventDefault(); });
  window.addEventListener("mousemove", e=>{ if(!dragging) return; box.style.left=Math.max(0,Math.min(window.innerWidth-80,e.clientX-dx))+"px"; box.style.top=Math.max(0,Math.min(window.innerHeight-40,e.clientY-dy))+"px"; box.style.right="auto"; box.style.bottom="auto"; });
  window.addEventListener("mouseup", ()=>dragging=false);

  let alignRaf = 0;
  const realign = () => {
    if(alignRaf) return;
    alignRaf = requestAnimationFrame(() => {
      alignRaf = 0;
      cachedPianoRect = null;
      renderOverlay();
      updateKeyboard();
    });
  };
  window.addEventListener("resize", realign, { passive:true });
  window.addEventListener("orientationchange", realign, { passive:true });
  const alignTimer = setInterval(() => {
    if(ghost.checked && running) realign();
  }, 700);

  refreshLibrary(); patchWorker(); updateUI();
  return { box, destroy(){ if(originalWorkerPost) Worker.prototype.postMessage=originalWorkerPost; window.removeEventListener("resize", realign); window.removeEventListener("orientationchange", realign); clearInterval(alignTimer); if(alignRaf) cancelAnimationFrame(alignRaf); overlay.remove(); box.remove(); } };
}
