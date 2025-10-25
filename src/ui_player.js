
import { AppState } from "./state.js";
import { makeDraggable, addMinimizer } from "./draggable.js";
import { listOutputs } from "./midi.js";


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
      if(!(st & 0x80)){ 
        i--; st = run;
      } else {
        run = st;
      }
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
        let a = dv.getUint8(i++), b = (type===0xC0||type===0xD0)?0:dv.getUint8(i++);
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
  for(const tr of smf.tracks){
    for(const e of tr) events.push(e);
  }
  events.sort((a,b)=>a.tick-b.tick);
  
  let tempo = 500000;
  const mapped = [];
  for(const e of events){
    if(e.type==="meta" && e.meta===0x51 && e.data && e.data.length===3){
      tempo = (e.data[0]<<16)|(e.data[1]<<8)|e.data[2];
      mapped.push({kind:"tempo", tick:e.tick, tempo}); 
    }else if(typeof e.type==="number"){
      mapped.push({kind:"midi", tick:e.tick, type:e.type, ch:e.ch, a:e.a, b:e.b});
    }
  }
  
  const div = smf.division & 0x7FFF;
  let lastTick = 0, curTempo = 500000, tSec = 0;
  const out = [];
  let idx = 0;
  while(idx < mapped.length){
    const e = mapped[idx];
    const dt = e.tick - lastTick;
    tSec += (dt * (curTempo/1e6)) / div;
    lastTick = e.tick;
    if(e.kind==="tempo"){
      curTempo = e.tempo;
    }else{
      out.push({...e, time:tSec});
    }
    idx++;
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

  function send(evt){
    const out = currentOut(); if(!out) return;
    if(evt.type===0x90){ 
      out.send([0x90|evt.ch, (evt.a+transpose)&127, evt.b]);
      active.set((evt.ch<<8)|evt.a, [(evt.a+transpose)&127, evt.ch]);
    }else if(evt.type===0x80){ 
      const key = (evt.ch<<8)|evt.a;
      const entry = active.get(key) || [(evt.a+transpose)&127, evt.ch];
      out.send([0x80|entry[1], entry[0], 0]);
      active.delete(key);
    }else if(evt.type===0xB0){ 
      out.send([0xB0|evt.ch, evt.a, evt.b]);
    }else if(evt.type===0xC0){ 
      out.send([0xC0|evt.ch, evt.a]);
    }else if(evt.type===0xE0){ 
      out.send([0xE0|evt.ch, evt.a, evt.b]);
    }
  }
  function allNotesOff(){
    const out = currentOut(); if(!out) return;
    for(let ch=0;ch<16;ch++) out.send([0xB0|ch, 123, 0]);
  }

  function seek(seconds){
    
    playing=false;
    if(rafId) cancelAnimationFrame(rafId);
    allNotesOff();
    startPos = Math.max(0, Math.min(seconds, duration()));
    
    cursor = events.findIndex(e=>e.time>=startPos);
    if(cursor<0) cursor = events.length;
  }
  function duration(){
    return events.length? events[events.length-1].time : 0;
  }
  function setTempoMul(f){ tempoMul = Math.max(0.25, Math.min(4, f||1)); }
  function setTranspose(semi){ transpose = Math.max(-36, Math.min(36, semi|0)); }

  function _tick(){
    if(!playing){ return; }
    const t = (timeNow()-startT)*tempoMul + startPos;
    
    while(cursor < events.length && events[cursor].time <= t){
      send(events[cursor++]);
    }
    if(cursor >= events.length){
      playing=false; allNotesOff(); return;
    }
    rafId = requestAnimationFrame(_tick);
  }
  function play(){
    if(playing) return;
    playing=true;
    startT = timeNow();
    rafId = requestAnimationFrame(_tick);
  }
  function pause(){
    if(!playing) return;
    const t = (timeNow()-startT)*tempoMul + startPos;
    playing=false;
    if(rafId) cancelAnimationFrame(rafId);
    startPos = t;
    allNotesOff();
  }
  function stop(){
    playing=false;
    if(rafId) cancelAnimationFrame(rafId);
    startPos = 0;
    cursor = 0;
    allNotesOff();
  }
  function loadBuffer(buf){
    const smf = parseSMF(buf);
    events = buildEventList(smf);
    startPos = 0;
    cursor = 0;
    return {duration: duration()};
  }

  return { play, pause, stop, seek, setTempoMul, setTranspose, loadBuffer, duration, isPlaying:()=>playing, currentTime: ()=> (playing ? (performance.now()/1000 - startT)*tempoMul + startPos : startPos) };
}

export function mountPlayerUI(){
  const box = document.createElement("div");
  Object.assign(box.style, {
    position:"fixed", left:"12px", top:"12px", zIndex:999999,
    background:"rgba(17,17,17,.95)", color:"#eee", padding:"10px",
    borderRadius:"10px", fontFamily:"system-ui", minWidth:"420px", maxWidth:"520px",
    boxShadow:"0 10px 30px rgba(0,0,0,.6)"
  });
  box.innerHTML = `
    <style>
      .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;user-select:none;cursor:pointer}
      .mo-btn:hover{background:#353535}
      .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}
      .mo-input{background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px}
      .mo-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .mo-col{display:flex;flex-direction:column;gap:4px}
      #drop{border:1px dashed #555;padding:12px;border-radius:8px;text-align:center;opacity:.9}
      #drop.drag{background:#202020}
      #filelist{max-height:140px;overflow:auto;border:1px solid #333;border-radius:8px;padding:6px}
      #seek{width:100%}
      #hdr{display:flex;align-items:center;gap:8px;user-select:none}
    </style>
    <div id="hdr">
      <strong>MIDI Player</strong>
      <span id="status" class="mo-chip" style="margin-left:auto;background:#444">idle</span>
    </div>
    <div id="drop">Drop MIDI files here (.mid)</div>
    <div class="mo-col" style="margin-top:8px">
      <label>Files</label>
      <select id="files" class="mo-input" size="4"></select>
    </div>
    <div class="mo-row" style="margin-top:8px">
      <button id="play" class="mo-btn">Play</button>
      <button id="pause" class="mo-btn">Pause</button>
      <button id="stop" class="mo-btn">Stop</button>
      <span class="mo-chip"><span id="cur">0:00</span> / <span id="dur">0:00</span></span>
    </div>
    <div class="mo-row" style="margin-top:8px">
      <input id="seek" type="range" min="0" max="1000" value="0">
    </div>
    <div class="mo-row" style="margin-top:8px">
      <label>Tempo</label>
      <input id="tempo" type="range" min="25" max="400" value="100">
      <span id="tempoVal" class="mo-chip">1.00×</span>
      <label style="margin-left:12px">Transpose</label>
      <input id="transpose" type="range" min="-24" max="24" value="0">
      <span id="transVal" class="mo-chip">0</span>
    </div>
`;

  const hdr = box.querySelector("#hdr");
  addMinimizer(box, hdr, "player");
  document.body.appendChild(box);
  makeDraggable(box, hdr);

  const drop = box.querySelector("#drop");
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

  

  const player = makePlayer();
  let duration = 0;
  let uiTickId = null;

  function fmt(t){
    t = Math.max(0, t|0);
    const m = Math.floor(t/60), s = t%60;
    return `${m}:${s.toString().padStart(2,"0")}`;
  }
  function setStatus(t, ok){ status.textContent=t; status.style.background = ok?"#264a2f":"#444"; }

  function startUiTick(){
  if(uiTickId) cancelAnimationFrame(uiTickId);
  const loop = ()=>{
    const d = Math.max(0, player.duration());
    const t = Math.max(0, Math.min(d, player.currentTime()));
    curEl.textContent = fmt(Math.round(t));
    durEl.textContent = fmt(Math.round(d));
    
    if(!seek._dragging){
      seek.value = String(d ? Math.round((t/d)*1000) : 0);
    }
    uiTickId = requestAnimationFrame(loop);
  };
  uiTickId = requestAnimationFrame(loop);
}

  
  const fileStore = new Map(); 
  box.addEventListener("dragover", e=>{ e.preventDefault(); });
  drop.addEventListener("dragover", e=>{ e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", ()=> drop.classList.remove("drag"));
  drop.addEventListener("drop", e=>{
    e.preventDefault(); drop.classList.remove("drag");
    const fl = e.dataTransfer?.files;
    if(!fl || !fl.length) return;
    for(const f of fl){
      if(!/\.mid(i)?$/i.test(f.name)) continue;
      const fr = new FileReader();
      fr.onload = ()=>{
        fileStore.set(f.name, fr.result);
        const opt = document.createElement("option");
        opt.value=f.name; opt.textContent=f.name;
        files.appendChild(opt);
        setStatus("loaded", true);
      };
      fr.readAsArrayBuffer(f);
    }
  });

  function loadSelected(){
    const name = files.value;
    const buf = fileStore.get(name);
    if(!buf){ setStatus("no file", false); return; }
    try{
      const info = player.loadBuffer(buf);
      duration = player.duration();
      durEl.textContent = fmt(Math.round(duration));
      seek.value = "0";
      setStatus("ready", true);
    }catch(err){
      console.error(err);
      setStatus("parse error", false);
    }
  }

  files.addEventListener("change", loadSelected);

  
  playBtn.addEventListener("click", ()=>{
    if(!fileStore.size){ setStatus("drop a file", false); return; }
    if(!files.value){ files.selectedIndex=0; loadSelected(); }
    player.play();
    setStatus("playing", true);
  });
  pauseBtn.addEventListener("click", ()=>{ player.pause(); setStatus("paused", false); });
  stopBtn.addEventListener("click", ()=>{ player.stop(); setStatus("stopped", false); });

  seek.addEventListener("input", ()=>{
    const pos = (parseInt(seek.value,10)/1000) * (duration||0);
    
  seek.addEventListener("mousedown", ()=> seek._dragging = true);
  seek.addEventListener("mouseup", ()=> seek._dragging = false);
  seek.addEventListener("touchstart", ()=> seek._dragging = true, {passive:true});
  seek.addEventListener("touchend", ()=> seek._dragging = false, {passive:true});

player.seek(pos);
    curEl.textContent = fmt(Math.round(pos));
    AppState._lastPlayTime = pos;
  });

  tempo.addEventListener("input", ()=>{
    const mul = parseInt(tempo.value,10)/100;
    player.setTempoMul(mul);
    tempoVal.textContent = mul.toFixed(2)+"×";
  });

  trans.addEventListener("input", ()=>{
    const semi = parseInt(trans.value,10)|0;
    player.setTranspose(semi);
    transVal.textContent = String(semi);
  });

  startUiTick();
}
