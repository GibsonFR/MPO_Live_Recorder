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


const MIDI_COLLECTIONS_KEY = "mo_midi_collections_v2";
const MIDI_PLAYER_PREF_KEY = "mo_midi_player_prefs_v2";
const ALL_LIBRARY_ID = "__all__";

function uid(prefix="lib"){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

function loadPlayerPrefs(){
  try { return JSON.parse(localStorage.getItem(MIDI_PLAYER_PREF_KEY) || "{}"); }
  catch { return {}; }
}
function savePlayerPrefs(prefs){
  try { localStorage.setItem(MIDI_PLAYER_PREF_KEY, JSON.stringify(prefs || {})); } catch {}
}

function loadCollections(){
  let cols = [];
  try { cols = JSON.parse(localStorage.getItem(MIDI_COLLECTIONS_KEY) || "[]") || []; }
  catch { cols = []; }
  cols = cols.filter(c => c && c.id && c.id !== ALL_LIBRARY_ID).map(c => ({
    id: String(c.id),
    name: String(c.name || "Library"),
    fileIds: Array.isArray(c.fileIds) ? [...new Set(c.fileIds.map(String))] : [],
    createdAt: c.createdAt || Date.now(),
    updatedAt: c.updatedAt || c.createdAt || Date.now()
  }));
  return cols;
}
function saveCollections(cols){
  try { localStorage.setItem(MIDI_COLLECTIONS_KEY, JSON.stringify(cols || [])); } catch {}
}
function collectionLabel(col, count){
  return `${col.name} (${count})`;
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
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
  let endedCb = null;
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
      if(typeof endedCb === "function") setTimeout(()=>endedCb(), 0);
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

  function setOnEnded(fn){ endedCb = fn; }

  return { play, pause, stop, seek, setTempoMul, setTranspose, loadBuffer, duration, isPlaying:()=>playing, currentTime, setOnEnded };
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
      .mo-btn:hover{background:#353535}.mo-btn.active{background:#2f8f55}.mo-btn.danger{background:#4a2525}.mo-btn.warn{background:#4a3a22}
      .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}
      .mo-input{background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px}
      .mo-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mo-col{display:flex;flex-direction:column;gap:4px}
      .mo-grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mo-mini{font-size:11px;opacity:.68}.mo-sect{margin-top:8px;padding:8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025)}
      #drop{border:1px dashed #555;padding:10px;border-radius:8px;text-align:center;opacity:.9}
      #drop.drag{background:#202020}.lib-row{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center}.lib-meta{font-size:11px;opacity:.65}
      #files{width:100%;height:126px}#seek{width:100%}#hdr{display:flex;align-items:center;gap:8px;user-select:none;cursor:move}
      #collectionSelect{min-width:190px;flex:1}#playlistOrder{min-width:130px}.playlist-on{box-shadow:0 0 0 1px rgba(80,220,140,.45) inset}
    </style>
    <div id="hdr"><strong>MIDI Player</strong><span id="status" class="mo-chip" style="margin-left:auto;background:#444">idle</span></div>
    <div id="body" style="max-height:calc(76vh - 45px);overflow:auto;padding-right:4px">
      <div id="drop" style="margin-top:8px">Drop MIDI files here (.mid / .midi)</div>
      <input id="pick" type="file" accept=".mid,.midi,audio/midi" multiple style="display:none">

      <div class="mo-sect">
        <div class="mo-row"><strong>Libraries</strong><select id="collectionSelect" class="mo-input"></select><button id="newCollection" class="mo-btn">New</button><button id="renameCollection" class="mo-btn">Rename</button><button id="deleteCollection" class="mo-btn danger">Delete</button></div>
        <div class="mo-mini" id="collectionInfo" style="margin-top:5px">All MIDI files</div>
      </div>

      <div class="mo-row" style="margin-top:8px"><button id="browse" class="mo-btn">Add MIDI</button><button id="removeFromCollection" class="mo-btn warn">Remove from library</button><button id="deleteFile" class="mo-btn danger">Delete file</button><button id="renameFile" class="mo-btn">Rename</button><button id="reloadLib" class="mo-btn">Refresh</button></div>
      <div class="mo-col" style="margin-top:8px"><label>Tracks</label><select id="files" class="mo-input" size="6"></select></div>

      <div class="mo-sect" id="playlistBox">
        <div class="mo-row"><strong>Playlist</strong><button id="playlistStart" class="mo-btn">Start</button><button id="playlistStop" class="mo-btn">Stop</button><label><input id="playlistAuto" type="checkbox"> Auto-play</label><select id="playlistOrder" class="mo-input"><option value="order">In order</option><option value="random">Random non-repeat</option></select></div>
        <div class="mo-mini" id="playlistInfo" style="margin-top:5px">Stopped</div>
      </div>

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
  const collectionSelect = box.querySelector("#collectionSelect");
  const collectionInfo = box.querySelector("#collectionInfo");
  const newCollectionBtn = box.querySelector("#newCollection");
  const renameCollectionBtn = box.querySelector("#renameCollection");
  const deleteCollectionBtn = box.querySelector("#deleteCollection");
  const removeFromCollectionBtn = box.querySelector("#removeFromCollection");
  const playlistBox = box.querySelector("#playlistBox");
  const playlistStartBtn = box.querySelector("#playlistStart");
  const playlistStopBtn = box.querySelector("#playlistStop");
  const playlistAuto = box.querySelector("#playlistAuto");
  const playlistOrder = box.querySelector("#playlistOrder");
  const playlistInfo = box.querySelector("#playlistInfo");

  const player = makePlayer();
  let duration = 0;
  let uiTickId = null;
  let library = [];
  let filteredLibrary = [];
  let collections = [];
  let activeCollectionId = loadPlayerPrefs().activeCollectionId || ALL_LIBRARY_ID;
  let loadedId = loadPlayerPrefs().lastTrackId || null;
  let hiddenAutoPaused = false;
  let playlistActive = false;
  let randomQueue = [];
  let loadingTrack = false;

  function fmt(t){ t = Math.max(0, Math.floor(t||0)); const m=Math.floor(t/60), s=t%60; return `${m}:${s.toString().padStart(2,"0")}`; }
  function setStatus(t, ok){ status.textContent=t; status.style.background = ok?"#264a2f":"#444"; }
  function refreshButtons(){ playBtn.classList.toggle("active", player.isPlaying()); pauseBtn.classList.toggle("active", !player.isPlaying() && duration>0); playlistBox.classList.toggle("playlist-on", playlistActive); }
  function prefsPatch(patch){ const p=loadPlayerPrefs(); Object.assign(p, patch); savePlayerPrefs(p); }
  function getActiveCollection(){ return activeCollectionId===ALL_LIBRARY_ID ? {id:ALL_LIBRARY_ID,name:"All MIDI",fileIds:library.map(x=>x.id)} : collections.find(c=>c.id===activeCollectionId); }
  function getFilteredLibrary(){
    if(activeCollectionId===ALL_LIBRARY_ID) return library.slice();
    const col = collections.find(c=>c.id===activeCollectionId);
    if(!col) return [];
    const allowed = new Set(col.fileIds);
    return library.filter(x=>allowed.has(x.id));
  }
  function updatePlaylistInfo(text){
    if(text) playlistInfo.textContent = text;
    else playlistInfo.textContent = playlistActive ? `${playlistOrder.value === "random" ? "Random non-repeat" : "In order"} · ${filteredLibrary.length} track(s)` : "Stopped";
  }

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
      collections = loadCollections();
      if(activeCollectionId !== ALL_LIBRARY_ID && !collections.some(c=>c.id===activeCollectionId)) activeCollectionId = ALL_LIBRARY_ID;

      collectionSelect.innerHTML = "";
      const allOpt = document.createElement("option");
      allOpt.value = ALL_LIBRARY_ID;
      allOpt.textContent = `All MIDI (${library.length})`;
      collectionSelect.appendChild(allOpt);
      for(const col of collections){
        const count = col.fileIds.filter(id=>library.some(f=>f.id===id)).length;
        const opt = document.createElement("option");
        opt.value = col.id;
        opt.textContent = collectionLabel(col, count);
        collectionSelect.appendChild(opt);
      }
      collectionSelect.value = activeCollectionId;

      filteredLibrary = getFilteredLibrary();
      files.innerHTML = "";
      for(const item of filteredLibrary){
        const opt = document.createElement("option");
        opt.value = item.id;
        opt.textContent = item.name;
        opt.title = `${item.name} — ${Math.round((item.size||0)/1024)} KB`;
        files.appendChild(opt);
      }

      if(loadedId && filteredLibrary.some(x=>x.id===loadedId)) files.value = loadedId;
      else if(files.options.length) { files.selectedIndex = 0; }

      const activeCol = getActiveCollection();
      collectionInfo.textContent = activeCollectionId===ALL_LIBRARY_ID ? "All saved MIDI files" : `${activeCol?.name || "Library"} · ${filteredLibrary.length} track(s)`;
      removeFromCollectionBtn.disabled = activeCollectionId===ALL_LIBRARY_ID || !files.value;
      deleteCollectionBtn.disabled = activeCollectionId===ALL_LIBRARY_ID;
      renameCollectionBtn.disabled = activeCollectionId===ALL_LIBRARY_ID;

      setStatus(filteredLibrary.length ? "library ready" : "empty library", !!filteredLibrary.length);
      updatePlaylistInfo();
      prefsPatch({activeCollectionId, lastTrackId: files.value || loadedId || null});
    }catch(e){ console.error(e); setStatus("library error", false); }
  }
  async function addFiles(fileList){
    for(const f of fileList){
      if(!/\.mid(i)?$/i.test(f.name)) continue;
      const data = await f.arrayBuffer();
      const id = fileId(f.name, f.size, f.lastModified);
      await libraryPut({ id, name:f.name, size:f.size, addedAt:Date.now(), data });
      loadedId = id;
      if(activeCollectionId !== ALL_LIBRARY_ID){
        const cols = loadCollections();
        const col = cols.find(c=>c.id===activeCollectionId);
        if(col && !col.fileIds.includes(id)){ col.fileIds.push(id); col.updatedAt = Date.now(); saveCollections(cols); }
      }
    }
    await loadLibrary();
    files.value = loadedId || files.value;
    await loadSelected();
  }
  async function loadSelected(idOverride=null){
    const id = idOverride || files.value;
    if(!id){ setStatus("no file", false); return false; }
    const item = await libraryGet(id);
    if(!item?.data){ setStatus("missing file", false); return false; }
    try{
      loadingTrack = true;
      const info = player.loadBuffer(item.data);
      loadedId = id; duration = player.duration();
      files.value = id;
      durEl.textContent = fmt(duration); seek.value = "0";
      prefsPatch({lastTrackId:id, activeCollectionId});
      setStatus(`ready · ${item.name}`, true);
      return true;
    }catch(err){ console.error(err); setStatus("parse error", false); return false; }
    finally{ loadingTrack = false; }
  }

  box.addEventListener("dragover", e=>e.preventDefault());
  drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", ()=> drop.classList.remove("drag"));
  drop.addEventListener("drop", async e=>{ e.preventDefault(); drop.classList.remove("drag"); if(e.dataTransfer?.files?.length) await addFiles(e.dataTransfer.files); });
  box.querySelector("#browse").onclick = () => pick.click();
  pick.onchange = async () => { if(pick.files?.length) await addFiles(pick.files); pick.value = ""; };
  box.querySelector("#reloadLib").onclick = loadLibrary;
  collectionSelect.onchange = async ()=>{ activeCollectionId = collectionSelect.value || ALL_LIBRARY_ID; randomQueue = []; prefsPatch({activeCollectionId}); await loadLibrary(); };
  newCollectionBtn.onclick = async ()=>{
    const name = prompt("Library name", "New library"); if(!name) return;
    const cols = loadCollections();
    const col = {id:uid("library"), name:name.trim(), fileIds:[], createdAt:Date.now(), updatedAt:Date.now()};
    cols.push(col); saveCollections(cols); activeCollectionId = col.id; await loadLibrary();
  };
  renameCollectionBtn.onclick = async ()=>{
    if(activeCollectionId===ALL_LIBRARY_ID) return;
    const cols = loadCollections(); const col = cols.find(c=>c.id===activeCollectionId); if(!col) return;
    const name = prompt("Library name", col.name); if(!name) return;
    col.name = name.trim(); col.updatedAt = Date.now(); saveCollections(cols); await loadLibrary();
  };
  deleteCollectionBtn.onclick = async ()=>{
    if(activeCollectionId===ALL_LIBRARY_ID) return;
    const col = collections.find(c=>c.id===activeCollectionId); if(!col) return;
    if(!confirm(`Delete library "${col.name}"? MIDI files stay saved.`)) return;
    saveCollections(loadCollections().filter(c=>c.id!==activeCollectionId)); activeCollectionId = ALL_LIBRARY_ID; randomQueue = []; await loadLibrary();
  };
  removeFromCollectionBtn.onclick = async ()=>{
    if(activeCollectionId===ALL_LIBRARY_ID) return;
    const id = files.value; if(!id) return;
    const cols = loadCollections(); const col = cols.find(c=>c.id===activeCollectionId); if(!col) return;
    col.fileIds = col.fileIds.filter(x=>x!==id); col.updatedAt = Date.now(); saveCollections(cols); if(id===loadedId){ player.stop(); loadedId=null; duration=0; } await loadLibrary();
  };
  box.querySelector("#deleteFile").onclick = async ()=>{
    const id=files.value; if(!id) return;
    const item = await libraryGet(id);
    if(!confirm(`Delete "${item?.name || "this MIDI"}" from storage and all libraries?`)) return;
    await libraryDelete(id);
    const cols = loadCollections(); for(const c of cols){ c.fileIds = c.fileIds.filter(x=>x!==id); } saveCollections(cols);
    if(id===loadedId){ player.stop(); loadedId=null; duration=0; }
    await loadLibrary();
  };
  box.querySelector("#renameFile").onclick = async ()=>{
    const id=files.value; if(!id) return;
    const item=await libraryGet(id); if(!item) return;
    const name=prompt("New MIDI name", item.name); if(!name) return;
    item.name=name.trim(); item.renamedAt=Date.now(); await libraryPut(item); await loadLibrary(); files.value=id;
  };
  files.addEventListener("change", ()=>{ prefsPatch({lastTrackId:files.value}); loadSelected(); });

  playBtn.addEventListener("click", async ()=>{
    if(!filteredLibrary.length){ setStatus("add a MIDI file", false); return; }
    if(!loadedId || loadedId !== files.value) await loadSelected();
    player.play(); setStatus("playing", true);
  });
  pauseBtn.addEventListener("click", ()=>{ player.pause(); setStatus("paused", false); });
  stopBtn.addEventListener("click", ()=>{ player.stop(); setStatus("stopped", false); });

  function orderedIds(){ return filteredLibrary.map(x=>x.id); }
  function rebuildRandomQueue(excludeId=null){
    const ids = orderedIds().filter(id=>id!==excludeId);
    randomQueue = shuffle(ids);
  }
  function nextPlaylistId(){
    const ids = orderedIds();
    if(!ids.length) return null;
    if(playlistOrder.value === "random"){
      if(!randomQueue.length) rebuildRandomQueue(loadedId);
      return randomQueue.shift() || ids.find(id=>id!==loadedId) || ids[0];
    }
    const cur = loadedId || files.value;
    const idx = Math.max(0, ids.indexOf(cur));
    return ids[(idx + 1) % ids.length];
  }
  async function playTrackById(id){
    if(!id) return;
    files.value = id;
    const ok = await loadSelected(id);
    if(ok){ player.play(); setStatus("playing", true); updatePlaylistInfo(); }
  }
  async function playNextFromPlaylist(){
    if(!playlistActive || !playlistAuto.checked) return;
    const next = nextPlaylistId();
    if(next) await playTrackById(next);
  }
  player.setOnEnded(()=>{ playNextFromPlaylist(); });

  playlistStartBtn.onclick = async ()=>{
    if(!filteredLibrary.length){ setStatus("playlist empty", false); return; }
    playlistActive = true; playlistAuto.checked = true; randomQueue = [];
    prefsPatch({playlistAuto:true, playlistOrder:playlistOrder.value});
    const id = files.value || filteredLibrary[0]?.id;
    await playTrackById(id);
    updatePlaylistInfo();
  };
  playlistStopBtn.onclick = ()=>{ playlistActive = false; playlistAuto.checked = false; randomQueue = []; prefsPatch({playlistAuto:false}); updatePlaylistInfo("Stopped"); refreshButtons(); };
  playlistAuto.onchange = ()=>{ playlistActive = playlistAuto.checked; prefsPatch({playlistAuto:playlistAuto.checked}); updatePlaylistInfo(); refreshButtons(); };
  playlistOrder.onchange = ()=>{ randomQueue = []; prefsPatch({playlistOrder:playlistOrder.value}); updatePlaylistInfo(); };

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

  const savedPrefs = loadPlayerPrefs();
  playlistAuto.checked = !!savedPrefs.playlistAuto;
  playlistActive = !!savedPrefs.playlistAuto;
  playlistOrder.value = savedPrefs.playlistOrder || "order";
  updatePlaylistInfo();
  loadLibrary();
  startUiTick();
  return { box };
}
