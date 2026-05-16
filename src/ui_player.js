import { AppState } from "./state.js";
import { makeDraggable, addMinimizer } from "./draggable.js";
import { listOutputs } from "./midi.js";

const MIDI_DB_NAME = "mo_midi_library_v1";
const MIDI_STORE = "files";

function openMidiDb(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(MIDI_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(MIDI_STORE)){
        db.createObjectStore(MIDI_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbTx(mode, fn){
  const db = await openMidiDb();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(MIDI_STORE, mode);
    const store = tx.objectStore(MIDI_STORE);
    let result;
    try { result = fn(store); } catch(e){ reject(e); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }).finally(()=>db.close());
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
async function libraryPut(entry){ return dbTx("readwrite", store => store.put(entry)); }
async function libraryDelete(id){ return dbTx("readwrite", store => store.delete(id)); }
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
        const lenv = readVar(dv,i); i+=lenv.len + lenv.val;
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

function buildEventList(smf){
  const events = [];
  for(const tr of smf.tracks) for(const e of tr) events.push(e);
  events.sort((a,b)=>a.tick-b.tick);
  let tempo = 500000;
  const mapped = [];
  for(const e of events){
    if(e.type==="meta" && e.meta===0x51 && e.data && e.data.length===3){
      tempo = (e.data[0]<<16)|(e.data[1]<<8)|e.data[2];
      mapped.push({kind:"tempo", tick:e.tick, tempo});
    } else if(typeof e.type==="number") {
      mapped.push({kind:"midi", tick:e.tick, type:e.type, ch:e.ch, a:e.a, b:e.b});
    }
  }
  const div = smf.division & 0x7FFF;
  let lastTick = 0, curTempo = 500000, tSec = 0;
  const out = [];
  for(const e of mapped){
    const dt = e.tick - lastTick;
    tSec += (dt * (curTempo/1e6)) / div;
    lastTick = e.tick;
    if(e.kind==="tempo") curTempo = e.tempo;
    else out.push({...e, time:tSec});
  }
  return out;
}

function makePlayer(){
  let events = [];
  let playing = false;
  let startT = 0;
  let startPos = 0;
  let tempoMul = 1;
  let transpose = 0;
  let cursor = 0;
  let rafId = null;
  const active = new Map();

  function currentOut(){ return AppState.midi.out; }
  function timeNow(){ return performance.now()/1000; }
  function duration(){ return events.length ? events[events.length-1].time : 0; }
  function currentTime(){ return playing ? (timeNow()-startT)*tempoMul + startPos : startPos; }
  function clampPos(v){ return Math.max(0, Math.min(Number(v)||0, duration())); }
  function resetClock(pos=currentTime()){
    startPos = clampPos(pos);
    startT = timeNow();
  }

  function send(evt){
    const out = currentOut(); if(!out) return;
    if(evt.type===0x90){
      const note = Math.max(0, Math.min(127, (evt.a+transpose)|0));
      const key = (evt.ch<<8)|evt.a;
      if(evt.b > 0){
        out.send([0x90|evt.ch, note, evt.b]);
        active.set(key, [note, evt.ch]);
      } else {
        const entry = active.get(key) || [note, evt.ch];
        out.send([0x80|entry[1], entry[0], 0]);
        active.delete(key);
      }
    } else if(evt.type===0x80){
      const key = (evt.ch<<8)|evt.a;
      const entry = active.get(key) || [Math.max(0, Math.min(127, (evt.a+transpose)|0)), evt.ch];
      out.send([0x80|entry[1], entry[0], 0]);
      active.delete(key);
    } else if(evt.type===0xB0){
      out.send([0xB0|evt.ch, evt.a, evt.b]);
    } else if(evt.type===0xC0){
      out.send([0xC0|evt.ch, evt.a]);
    } else if(evt.type===0xE0){
      out.send([0xE0|evt.ch, evt.a, evt.b]);
    }
  }

  function allNotesOff(){
    const out = currentOut(); if(!out) { active.clear(); return; }
    active.forEach(([note,ch])=> out.send([0x80|ch, note, 0]));
    active.clear();
    for(let ch=0; ch<16; ch++){
      out.send([0xB0|ch, 64, 0]);
      out.send([0xB0|ch, 123, 0]);
      out.send([0xB0|ch, 120, 0]);
    }
  }

  function setCursorFor(pos){
    cursor = events.findIndex(e=>e.time>=pos);
    if(cursor < 0) cursor = events.length;
  }

  function seek(seconds){
    const wasPlaying = playing;
    playing = false;
    if(rafId) cancelAnimationFrame(rafId);
    allNotesOff();
    startPos = clampPos(seconds);
    setCursorFor(startPos);
    if(wasPlaying) play();
  }

  function _tick(){
    if(!playing) return;
    const t = currentTime();
    while(cursor < events.length && events[cursor].time <= t){
      send(events[cursor++]);
    }
    if(cursor >= events.length){
      playing = false;
      startPos = duration();
      allNotesOff();
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(_tick);
  }

  function play(){
    if(!events.length) return;
    if(playing) return;
    if(cursor >= events.length || startPos >= duration() - 0.01){
      startPos = 0;
      cursor = 0;
    }
    playing = true;
    startT = timeNow();
    if(rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(_tick);
  }

  function pause(){
    if(!playing) return;
    const t = currentTime();
    playing = false;
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
    startPos = clampPos(t);
    allNotesOff();
  }

  function stop(){
    playing = false;
    if(rafId) cancelAnimationFrame(rafId);
    rafId = null;
    startPos = 0;
    cursor = 0;
    allNotesOff();
  }

  function setTempoMul(f){
    const pos = currentTime();
    tempoMul = Math.max(0.25, Math.min(4, Number(f)||1));
    resetClock(pos);
  }

  function setTranspose(semi){
    transpose = Math.max(-36, Math.min(36, Number(semi)|0));
    allNotesOff();
  }

  function loadBuffer(buf){
    stop();
    const smf = parseSMF(buf);
    events = buildEventList(smf);
    startPos = 0;
    cursor = 0;
    return { duration: duration(), events: events.length };
  }

  return { play, pause, stop, seek, setTempoMul, setTranspose, loadBuffer, duration, isPlaying:()=>playing, currentTime };
}

export function mountPlayerUI(){
  const box = document.createElement("div");
  Object.assign(box.style, {
    position:"fixed", left:"12px", top:"12px", zIndex:999999,
    background:"rgba(17,17,17,.95)", color:"#eee", padding:"10px",
    borderRadius:"10px", fontFamily:"system-ui", width:"560px", maxWidth:"calc(100vw - 24px)",
    boxShadow:"0 10px 30px rgba(0,0,0,.6)", resize:"both", overflow:"hidden"
  });
  box.innerHTML = `
    <style>
      .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;user-select:none;cursor:pointer}
      .mo-btn:hover{background:#353535}.mo-btn.active{background:#2f8f55}
      .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}
      .mo-input{background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px}
      .mo-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mo-col{display:flex;flex-direction:column;gap:4px}
      #drop{border:1px dashed #555;padding:10px;border-radius:8px;text-align:center;opacity:.9}
      #drop.drag{background:#202020}.lib-row{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center}.lib-meta{font-size:11px;opacity:.65}
      #files{width:100%;height:126px}#seek{width:100%}#hdr{display:flex;align-items:center;gap:8px;user-select:none;cursor:move}
    </style>
    <div id="hdr"><strong>MIDI Player</strong><span id="status" class="mo-chip" style="margin-left:auto;background:#444">idle</span></div>
    <div id="body" style="max-height:calc(76vh - 45px);overflow:auto;padding-right:4px">
      <div id="drop" style="margin-top:8px">Drop MIDI files here (.mid / .midi)</div>
      <input id="pick" type="file" accept=".mid,.midi,audio/midi" multiple style="display:none">
      <div class="mo-row" style="margin-top:8px"><button id="browse" class="mo-btn">Add MIDI</button><button id="deleteFile" class="mo-btn">Delete</button><button id="renameFile" class="mo-btn">Rename</button><button id="reloadLib" class="mo-btn">Refresh</button></div>
      <div class="mo-col" style="margin-top:8px"><label>Library</label><select id="files" class="mo-input" size="6"></select></div>
      <div class="mo-row" style="margin-top:8px"><button id="play" class="mo-btn">Play</button><button id="pause" class="mo-btn">Pause</button><button id="stop" class="mo-btn">Stop</button><span class="mo-chip"><span id="cur">0:00</span> / <span id="dur">0:00</span></span></div>
      <div class="mo-row" style="margin-top:8px"><input id="seek" type="range" min="0" max="1000" value="0"></div>
      <div class="mo-row" style="margin-top:8px"><label>Tempo</label><input id="tempo" type="range" min="25" max="400" value="100"><span id="tempoVal" class="mo-chip">1.00×</span><label style="margin-left:12px">Transpose</label><input id="transpose" type="range" min="-24" max="24" value="0"><span id="transVal" class="mo-chip">0</span></div>
      <div class="mo-row" style="margin-top:8px"><label><input id="autoPause" type="checkbox" checked> Auto-pause when tab is hidden</label></div>
    </div>`;

  const hdr = box.querySelector("#hdr");
  addMinimizer(box, hdr, "player");
  document.body.appendChild(box);
  makeDraggable(box, hdr);

  const drop = box.querySelector("#drop");
  const pick = box.querySelector("#pick");
  const files = box.querySelector("#files");
  const status = box.querySelector("#status");
  const playBtn = box.querySelector("#play");
  const pauseBtn = box.querySelector("#pause");
  const stopBtn = box.querySelector("#stop");
  const curEl = box.querySelector("#cur");
  const durEl = box.querySelector("#dur");
  const seek = box.querySelector("#seek");
  const tempo = box.querySelector("#tempo");
  const tempoVal = box.querySelector("#tempoVal");
  const trans = box.querySelector("#transpose");
  const transVal = box.querySelector("#transVal");
  const autoPause = box.querySelector("#autoPause");

  const player = makePlayer();
  let duration = 0;
  let uiTickId = null;
  let library = [];
  let loadedId = null;
  let hiddenAutoPaused = false;

  function fmt(t){ t = Math.max(0, Math.floor(t||0)); const m=Math.floor(t/60), s=t%60; return `${m}:${s.toString().padStart(2,"0")}`; }
  function setStatus(t, ok){ status.textContent=t; status.style.background = ok?"#264a2f":"#444"; }
  function refreshButtons(){ playBtn.classList.toggle("active", player.isPlaying()); pauseBtn.classList.toggle("active", !player.isPlaying() && duration>0); }

  function startUiTick(){
    if(uiTickId) cancelAnimationFrame(uiTickId);
    const loop = ()=>{
      const d = Math.max(0, player.duration());
      const t = Math.max(0, Math.min(d, player.currentTime()));
      curEl.textContent = fmt(t); durEl.textContent = fmt(d);
      if(!seek._dragging) seek.value = String(d ? Math.round((t/d)*1000) : 0);
      refreshButtons();
      uiTickId = requestAnimationFrame(loop);
    };
    uiTickId = requestAnimationFrame(loop);
  }

  function fileId(name, size, lastModified){ return `${name}::${size}::${lastModified || 0}`; }
  async function loadLibrary(){
    try{
      library = await libraryList();
      files.innerHTML = "";
      for(const item of library){
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.name;
        opt.title = `${item.name} — ${Math.round((item.size||0)/1024)} KB`;
        files.appendChild(opt);
      }
      if(loadedId && library.some(x=>x.id===loadedId)) files.value = loadedId;
      else if(files.options.length && !files.value) files.selectedIndex = 0;
      setStatus(library.length ? "library ready" : "empty library", !!library.length);
    }catch(e){ console.error(e); setStatus("library error", false); }
  }
  async function addFiles(fileList){
    for(const f of fileList){
      if(!/\.mid(i)?$/i.test(f.name)) continue;
      const data = await f.arrayBuffer();
      const id = fileId(f.name, f.size, f.lastModified);
      await libraryPut({ id, name:f.name, size:f.size, addedAt:Date.now(), data });
      loadedId = id;
    }
    await loadLibrary();
    files.value = loadedId || files.value;
    await loadSelected();
  }
  async function loadSelected(){
    const id = files.value;
    if(!id){ setStatus("no file", false); return; }
    const item = await libraryGet(id);
    if(!item?.data){ setStatus("missing file", false); return; }
    try{
      const info = player.loadBuffer(item.data);
      loadedId = id; duration = player.duration();
      durEl.textContent = fmt(duration); seek.value = "0";
      setStatus(`ready · ${item.name}`, true);
    }catch(err){ console.error(err); setStatus("parse error", false); }
  }

  box.addEventListener("dragover", e=>e.preventDefault());
  drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", ()=> drop.classList.remove("drag"));
  drop.addEventListener("drop", async e=>{ e.preventDefault(); drop.classList.remove("drag"); if(e.dataTransfer?.files?.length) await addFiles(e.dataTransfer.files); });
  box.querySelector("#browse").onclick = () => pick.click();
  pick.onchange = async () => { if(pick.files?.length) await addFiles(pick.files); pick.value = ""; };
  box.querySelector("#reloadLib").onclick = loadLibrary;
  box.querySelector("#deleteFile").onclick = async ()=>{ const id=files.value; if(!id) return; await libraryDelete(id); if(id===loadedId){ player.stop(); loadedId=null; duration=0; } await loadLibrary(); };
  box.querySelector("#renameFile").onclick = async ()=>{
    const id=files.value; if(!id) return;
    const item=await libraryGet(id); if(!item) return;
    const name=prompt("New MIDI name", item.name); if(!name) return;
    item.name=name.trim(); item.renamedAt=Date.now(); await libraryPut(item); await loadLibrary(); files.value=id;
  };
  files.addEventListener("change", loadSelected);

  playBtn.addEventListener("click", async ()=>{
    if(!library.length){ setStatus("add a MIDI file", false); return; }
    if(!loadedId || loadedId !== files.value) await loadSelected();
    player.play(); setStatus("playing", true);
  });
  pauseBtn.addEventListener("click", ()=>{ player.pause(); setStatus("paused", false); });
  stopBtn.addEventListener("click", ()=>{ player.stop(); setStatus("stopped", false); });

  seek.addEventListener("mousedown", ()=> seek._dragging = true);
  seek.addEventListener("mouseup", ()=> { seek._dragging = false; });
  seek.addEventListener("touchstart", ()=> seek._dragging = true, {passive:true});
  seek.addEventListener("touchend", ()=> seek._dragging = false, {passive:true});
  seek.addEventListener("input", ()=>{
    const pos = (parseInt(seek.value,10)/1000) * (duration||0);
    player.seek(pos);
    curEl.textContent = fmt(pos);
    AppState._lastPlayTime = pos;
  });

  tempo.addEventListener("input", ()=>{ const mul = parseInt(tempo.value,10)/100; player.setTempoMul(mul); tempoVal.textContent = mul.toFixed(2)+"×"; });
  trans.addEventListener("input", ()=>{ const semi = parseInt(trans.value,10)|0; player.setTranspose(semi); transVal.textContent = String(semi); });
  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden && autoPause.checked && player.isPlaying()){
      player.pause(); hiddenAutoPaused = true; setStatus("auto-paused", false);
    } else if(!document.hidden && hiddenAutoPaused){
      hiddenAutoPaused = false;
      setStatus("paused", false);
    }
  });

  loadLibrary();
  startUiTick();
  return { box };
}
