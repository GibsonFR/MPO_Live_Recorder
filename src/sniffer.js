import { AppState, getPlayer } from "./state.js";
import { now } from "./utils.js";

const TD=(typeof TextDecoder!=="undefined")?new TextDecoder():null;

const arrVal=(o,keys)=>{ for(const k of keys){ if(Array.isArray(o?.[k])) return o[k]; } return null; };
const idVal=o=> o.playerId ?? o.player ?? o.pid ?? o.id;
const eventsVal=o=> arrVal(o,["events","evts","e"]);

function parseSIOFrames(str){
  const out=[]; let i=0;
  while(i<str.length){
    if(str.charAt(i)==='4' && str.charAt(i+1)==='2'){
      let j=i+2; while(j<str.length && str.charAt(j)!=='[') j++; if(j>=str.length) break;
      let d=0,k=j; for(;k<str.length;k++){ const c=str.charAt(k); if(c==='[') d++; else if(c===']'){ d--; if(d===0){ k++; break; } } }
      try{ out.push(JSON.parse(str.slice(j,k))); }catch{}
      i=k; continue;
    } i++;
  }
  return out;
}
function extractBatches(frame){
  const res=[];
  try{
    if(Array.isArray(frame)){
      if(frame[0]==="pianoBatch"){
        const pl=frame[1];
        if(Array.isArray(pl)) pl.forEach(x=>{ const id=idVal(x), ev=eventsVal(x); if(id&&ev) res.push({playerId:id, events:ev, t:x.t??x.ts??x.tISO??null}); });
        else if(pl && typeof pl==="object"){ const id=idVal(pl), ev=eventsVal(pl); if(id&&ev) res.push({playerId:id, events:ev, t:pl.t??pl.ts??pl.tISO??null}); }
      }
    }else if(frame && typeof frame==="object"){
      const pid=idVal(frame), evs=eventsVal(frame);
      if(pid && evs){ res.push({playerId:pid, events:evs, t:frame.t??frame.ts??frame.tISO??null}); return res; }
      const label=frame.type||frame.evt||frame.op||frame.event, payload=frame.payload??frame.data;
      if(label==="pianoBatch"){
        if(Array.isArray(payload)) payload.forEach(x=>{ const id=idVal(x), ev=eventsVal(x); if(id&&ev) res.push({playerId:id, events:ev, t:x.t??x.ts??x.tISO??null}); });
        else if(payload && typeof payload==="object"){ const id=idVal(payload), ev=eventsVal(payload); if(id&&ev) res.push({playerId:id, events:ev, t:payload.t??payload.ts??payload.tISO??null}); }
      }else{
        const id=idVal(frame), evs=eventsVal(frame);
        if(id&&evs) res.push({playerId:id, events:evs, t:frame.t??frame.ts??frame.tISO??null});
      }
    }
  }catch{}
  return res;
}
function normEvents(arr){
  const out=[]; if(!Array.isArray(arr)) return out;
  for(const e of arr){
    const name=String(e.name||e.n||"").toUpperCase();
    const ts=(e.timestamp??e.ts??e.time??e.tms??0)|0;
    if (name==="SUSTAIN" || name.includes("SUSTAIN") || e.cc===64 || e.control===64){
      const raw = (e.value ?? e.v ?? e.val);
      let val;
      if (e.sustain === true) { val = 127; }
      else if (e.sustain === false) { val = 0; }
      else if (Number.isFinite(raw)) { val = Math.max(0, Math.min(127, raw|0)); }
      else { val = 0; }
      out.push({type:'cc',cc:64,val,ts}); continue;
    }
    if (name==="NOTE_ON" || name==="ON" || e.on===1 || e.down===true){
      const note=(e.note??e.n??e.k??e.key)|0; if(note<0||note>127) continue;
      const vel=((e.velocity??e.v??e.vel??127)|0)/127;
      out.push({type:'on', note, vel, ts}); continue;
    }
    if (name==="NOTE_OFF" || name==="OFF" || e.off===1 || e.up===true){
      const note=(e.note??e.n??e.k??e.key)|0; if(note<0||note>127) continue;
      out.push({type:'off', note, ts}); continue;
    }
  }
  return out;
}

function batchKey(b){
  const evs=Array.isArray(b.events)?b.events:[]; let min=Infinity,max=-Infinity;
  for(const e of evs){ const t=(e.timestamp??e.ts??e.tms??e.time??0)|0; if(t<min) min=t; if(t>max) max=t; }
  const pid=b.playerId??b.player??b.pid??b.id??'?'; const c=evs.length|0;
  return `${pid}|${b.t||b.ts||b.tISO||'?'}|${c}|${min}-${max}`;
}

function noteOn(P,absMs,note,vel){
  if(P.t0==null) P.t0=absMs;
  if(AppState.record && P.recStart==null) P.recStart=absMs;
  const base=P.recStart ?? P.t0, rel=Math.max(0,absMs-base);
  if(P.active.has(note)){ const tOff=Math.max(0,rel-0.1); P.events.push({t:tOff,type:'off',note,vel:0}); }
  P.active.set(note,{tOn:rel,vel});
  P.events.push({t:rel,type:'on',note,vel});
}
function noteOff(P,absMs,note){
  if(P.t0==null) P.t0=absMs;
  const base=P.recStart ?? P.t0, rel=Math.max(0,absMs-base);
  if(P.active.has(note)) P.active.delete(note);
  P.events.push({t:rel,type:'off',note,vel:0});
}

export function handleMessageData(data){
  AppState.stats.frames++;
  if(typeof data==="string"){
    const frames=parseSIOFrames(data);
    if(frames.length){ for(const fr of frames){ const batches=extractBatches(fr); for(const b of batches) ingestBatch(b,"WS"); } return; }
    try{
      const obj=JSON.parse(data); const arr=Array.isArray(obj)?obj:[obj];
      for(const fr of arr){ const batches=extractBatches(fr); for(const b of batches) ingestBatch(b,"WS"); }
      return;
    }catch{}
    const lines=data.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    for(const ln of lines){ try{ const o=JSON.parse(ln); const batches=extractBatches(o); for(const b of batches) ingestBatch(b,"WS"); }catch{} }
    return;
  }
  if(data instanceof ArrayBuffer){
    if(TD){ try{ const txt=TD.decode(new Uint8Array(data)); if(txt) handleMessageData(txt);}catch{} }
    return;
  }
  if(typeof Blob!=="undefined" && data instanceof Blob){
    const fr=new FileReader(); fr.onload=function(){ handleMessageData(String(fr.result||"")); };
    try{ fr.readAsText(data.slice(0,16384)); }catch{}
  }
}

function ingestBatch(b, pathTag){
  AppState.path=pathTag||AppState.path;
  const key=batchKey(b); if(AppState.dedupe.has(key)) return; AppState.dedupe.add(key);
  const pid=String(b.playerId ?? b.player ?? b.pid ?? b.id ?? "unknown");
  const P=getPlayer(pid);
  const evs=normEvents(b.events); if(!evs.length) return;
  const baseAbs=(b.t!=null?b.t:null), firstTs=evs[0].ts;
  for(const e of evs){
    const abs=(baseAbs!=null)?(baseAbs-firstTs+e.ts):(now()+(e.ts-firstTs));
    if(e.type==='cc' && e.cc===64){
      if(P.t0==null) P.t0=abs;
      if(AppState.record && P.recStart==null) P.recStart=abs;
      const base=P.recStart ?? P.t0, rel=Math.max(0,abs-base);
      P.events.push({t:rel,type:'cc',cc:64,val:(e.val|0)});
      continue;
    }
    if(e.type==='on'){ noteOn(P,abs,e.note,e.vel); continue; }
    if(e.type==='off'){ noteOff(P,abs,e.note); continue; }
  }
  P.seen += evs.length; P.last=now();
  AppState.stats.pb++;
}

export function hookWebSocket(){
  const RealWS=window.WebSocket; if(!RealWS) return;
  if(!RealWS.prototype.__mo_hooked__){
    const origAdd=RealWS.prototype.addEventListener;
    RealWS.prototype.addEventListener=function(type,listener,opts){
      if(type==="message" && typeof listener==="function"){
        const wrapped=(ev)=>{ try{AppState.stats.taps++; handleMessageData(ev.data);}catch{} return listener.call(this,ev); };
        return origAdd.call(this,type,wrapped,opts);
      }
      return origAdd.call(this,type,listener,opts);
    };
    const desc=Object.getOwnPropertyDescriptor(RealWS.prototype,"onmessage")||{};
    Object.defineProperty(RealWS.prototype,"onmessage",{configurable:true,enumerable:true,
      get:desc.get?desc.get:function(){return this.__mo_on__||null;},
      set:function(fn){
        if(typeof fn==="function"){ const wrapped=(ev)=>{ try{AppState.stats.taps++; handleMessageData(ev.data);}catch{} return fn.call(this,ev); };
          this.__mo_on__=wrapped; this.addEventListener("message",wrapped);
        } else { this.__mo_on__=null; }
      }
    });
    const origSend=RealWS.prototype.send;
    RealWS.prototype.send=function(){
      try{
        if(!this.__mo_attached__){
          this.addEventListener("message",(ev)=>{ try{AppState.stats.taps++; handleMessageData(ev.data);}catch{} });
          Object.defineProperty(this,"__mo_attached__",{value:true});
        }
      }catch{}
      return origSend.apply(this,arguments);
    };
    Object.defineProperty(RealWS.prototype,"__mo_hooked__",{value:true});
  }
  if(!window.__mo_ws_ctor__){
    function WSWrap(url,protocols){
      const ws=(protocols!==undefined)? new RealWS(url,protocols) : new RealWS(url);
      try{ ws.addEventListener("message",(ev)=>{ try{AppState.stats.taps++; handleMessageData(ev.data);}catch{} }); Object.defineProperty(ws,"__mo_attached__",{value:true}); }catch{}
      return ws;
    }
    WSWrap.prototype=RealWS.prototype; Object.setPrototypeOf(WSWrap,RealWS);
    window.WebSocket=WSWrap; Object.defineProperty(window,"__mo_ws_ctor__",{value:true});
  }
}

// New MPO network update: rendered live notes are now sent to the MIDI render worker.
// The old WebSocket sniffer is kept, and this hook repairs recording by parsing
// Worker.postMessage({type:'startEffect'|'stopEffect', note, effects:[{opts:{velocity,colors}}]}).
const __moWorker = {
  hooked:false,
  originalPost:null,
  activeByNote:new Map()
};

const __moColorOwners = {
  lastScan: 0,
  byColor: new Map()
};

// Performance guard: mapping rendered-worker notes back to players requires DOM/color scans.
// When Reactive Note Color is ON, your own color changes constantly and this scan can
// become expensive/noisy. In that case we skip color ownership mapping and group worker
// rendered notes in a stable fallback row.
const __moWorkerPerf = {
  colorScanMs: 2500,
  skipColorMappingWhenReactive: true
};

function normalizeHexColor(c){
  if(!c) return null;
  let s=String(c).trim();
  const hex=s.match(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/);
  if(hex) return "#"+hex[1].toLowerCase();
  const rgb=s.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if(rgb){
    const h=n=>Math.max(0,Math.min(255,Number(n)|0)).toString(16).padStart(2,"0");
    return "#"+h(rgb[1])+h(rgb[2])+h(rgb[3]);
  }
  return null;
}

function extractColorsFromText(s){
  const out=[];
  if(!s) return out;
  const text=String(s);
  for(const m of text.matchAll(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/g)) out.push("#"+m[1].toLowerCase());
  for(const m of text.matchAll(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) out.push(normalizeHexColor(m[0]));
  return out.filter(Boolean);
}

function cleanPlayerName(txt){
  let s=String(txt||"")
    .replace(/[🔒👁️👤🎹🎧🎵🎶✅✓✕×▾▴⚙️🗑️]+/g," ")
    .replace(/\s+/g," ")
    .trim();
  if(!s) return null;
  // Keep the first plausible name token/segment. Player rows usually expose only the name.
  s=s.split(/\s{2,}|\n|\r|\t| joined | left | as /i)[0].trim();
  s=s.replace(/^(player|spectator)\s*/i,"").trim();
  if(!s || s.length>48) return null;
  return s;
}

function ownText(el){
  let out="";
  try{
    for(const n of el.childNodes||[]){
      if(n.nodeType===Node.TEXT_NODE) out += " "+n.textContent;
    }
  }catch{}
  return out.trim();
}

function looksLikeSinglePlayerName(s){
  s=cleanPlayerName(s);
  if(!s) return false;
  if(/^(zoom|live|recording|recorder|export|reset|clear|midi|player|room|server|joined|left|switched|spectator|normal|velocity|transposition)$/i.test(s)) return false;
  if(/room|recorder|export|reset|joined|left|switched|spectator|server|message/i.test(s)) return false;
  if(s.length<2 || s.length>36) return false;
  // Reject concatenated rows such as ZoomGuest_6769LeZozoGuest_2051.
  const guestCount=(s.match(/Guest_/g)||[]).length;
  if(guestCount>1) return false;
  if(/ZoomGuest_/i.test(s)) return false;
  if(/Guest_\d+\w+/i.test(s) && !/^Guest_\d+$/i.test(s)) return false;
  if(/Guest_/i.test(s) && !/^Guest_/i.test(s)) return false;
  // Avoid strings that look like several names glued together.
  if(/[a-z][A-Z][a-z].*[A-Z][a-z]/.test(s) && s.length>18 && !/[_\s-]/.test(s)) return false;
  return true;
}

function extractNameFromRow(row){
  if(!row) return null;

  const direct=cleanPlayerName(ownText(row));
  if(looksLikeSinglePlayerName(direct)) return direct;

  const candidates=[];
  try{
    for(const el of row.querySelectorAll("span,div,p,b,strong,a")){
      const r=el.getBoundingClientRect?.();
      if(!r || r.width<2 || r.height<2) continue;
      const t=cleanPlayerName(ownText(el) || el.textContent || "");
      if(looksLikeSinglePlayerName(t)) candidates.push({t, area:r.width*r.height});
    }
  }catch{}

  if(candidates.length){
    candidates.sort((a,b)=>a.area-b.area);
    return candidates[0].t;
  }

  const clone=row.cloneNode(true);
  clone.querySelectorAll?.("button,svg,img,input,select,.square,[class*='square'],[class*='lock'],[class*='icon'],[class*='badge']").forEach(x=>x.remove());
  const txt=cleanPlayerName(clone.innerText || clone.textContent || row.innerText || row.textContent);
  return looksLikeSinglePlayerName(txt) ? txt : null;
}

function findNearbyNameByGeometry(colorEl){
  const cr=colorEl.getBoundingClientRect?.();
  if(!cr || cr.width<=0 || cr.height<=0) return null;
  const cy=cr.top+cr.height/2;
  const cx=cr.left+cr.width/2;
  const candidates=[];

  let scope=null;
  try{
    scope=colorEl.closest?.(".players,[class*='players'],.overlay,[class*='overlay']") || document.body;
  }catch{ scope=document.body; }

  let all=[];
  try{ all=[...scope.querySelectorAll("span,div,p,b,strong,a")]; }catch{}

  for(const el of all){
    if(el===colorEl || colorEl.contains?.(el) || el.contains?.(colorEl)) continue;
    const r=el.getBoundingClientRect?.();
    if(!r || r.width<4 || r.height<4) continue;
    if(r.height>36 || r.width>220) continue;

    const txt=cleanPlayerName(ownText(el) || el.textContent || "");
    if(!looksLikeSinglePlayerName(txt)) continue;

    const ey=r.top+r.height/2;
    const ex=r.left+r.width/2;
    const dy=Math.abs(ey-cy);
    if(dy>22) continue;

    const dx=Math.abs(ex-cx);
    candidates.push({txt, score:dy*10+dx, dy, dx});
  }

  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]?.txt || null;
}

function nameFromColorElement(el){
  // Prefer the real per-player row, but only if it is visually small enough to be one row.
  let row = el.closest?.(".player-row") || el.closest?.("[class*='player-row']") || null;
  if(row){
    const rr=row.getBoundingClientRect?.();
    const txt=(row.innerText||row.textContent||"").trim();
    if((!rr || rr.height<=52) && txt.length<140){
      const n=extractNameFromRow(row);
      if(n) return n;
    }
  }

  // Otherwise walk upward and choose the nearest small ancestor, not the whole players container.
  let cur=el;
  for(let i=0;i<6 && cur?.parentElement;i++){
    cur=cur.parentElement;
    const r=cur.getBoundingClientRect?.();
    const txt=(cur.innerText||cur.textContent||"").trim();
    if(!r || !txt) continue;
    if(r.height<=52 && r.width<=280 && txt.length<120){
      const n=extractNameFromRow(cur);
      if(n) return n;
    }
  }

  // Last resort: visual matching on the same horizontal row.
  return findNearbyNameByGeometry(el);
}

function scanColorOwners(){
  const t=now();
  if(t-__moColorOwners.lastScan<__moWorkerPerf.colorScanMs) return __moColorOwners.byColor;
  __moColorOwners.lastScan=t;

  const next=new Map(__moColorOwners.byColor);
  const selectors=[
    ".player-row .square",
    "[class*='player-row'] [class*='square']",
    ".players .square",
    "[style*='--player-first-color']"
  ].join(",");

  let els=[];
  try{ els=[...document.querySelectorAll(selectors)]; }catch{}

  for(const el of els){
    let name=nameFromColorElement(el);
    if(!name) continue;
    const st=el.getAttribute("style")||"";
    let computed="";
    try{
      const cs=getComputedStyle(el);
      computed=[cs.getPropertyValue("--player-first-color"), cs.background, cs.backgroundColor, cs.backgroundImage].join(" ");
    }catch{}
    const colors=[...extractColorsFromText(st), ...extractColorsFromText(computed)];
    for(const color of colors){
      if(color) next.set(color, "player:"+name);
    }
  }

  __moColorOwners.byColor=next;
  return next;
}

function workerPlayerIdFromStart(msg){
  try{
    if(__moWorkerPerf.skipColorMappingWhenReactive && window.__MO_REACTIVE_COLOR_ENABLED__) return "worker:rendered";
  }catch{}
  const effect = Array.isArray(msg?.effects) ? msg.effects[0] : null;
  const opts = effect?.opts || {};
  const color = normalizeHexColor(Array.isArray(opts.colors) ? opts.colors[0] : null);
  if(color){
    const owner = scanColorOwners().get(color);
    if(owner) return owner;
  }
  // Unknown worker-rendered notes are grouped in one stable row, never by color.
  return "worker:rendered";
}

function parseWorkerRenderEvent(msg){
  if(!msg || typeof msg!=="object") return null;
  if(msg.type === "startEffect" && msg.note != null){
    const effect = Array.isArray(msg.effects) ? msg.effects[0] : null;
    const opts = effect?.opts || {};
    const color = Array.isArray(opts.colors) ? opts.colors[0] : null;
    let vel = Number(opts.velocity ?? msg.velocity ?? 64);
    if(!Number.isFinite(vel)) vel = 64;
    if(vel > 1) vel = vel / 127;
    return {type:"on", note:(Number(msg.note)|0)&127, vel:Math.max(0.01, Math.min(1, vel)), color, pid:workerPlayerIdFromStart(msg)};
  }
  if(msg.type === "stopEffect" && msg.note != null){
    return {type:"off", note:(Number(msg.note)|0)&127};
  }
  return null;
}

function ingestWorkerRenderMessage(msg){
  const ev = parseWorkerRenderEvent(msg);
  if(!ev) return;
  AppState.stats.frames++;
  AppState.stats.taps++;
  AppState.path = "Worker";
  const abs = now();
  if(ev.type === "on"){
    const P = getPlayer(ev.pid);
    noteOn(P, abs, ev.note, ev.vel);
    P.seen++;
    P.last = abs;
    if(!__moWorker.activeByNote.has(ev.note)) __moWorker.activeByNote.set(ev.note, []);
    __moWorker.activeByNote.get(ev.note).push(ev.pid);
    AppState.stats.pb++;
    return;
  }
  if(ev.type === "off"){
    const stack = __moWorker.activeByNote.get(ev.note);
    const pid = stack && stack.length ? stack.shift() : "worker:rendered";
    if(stack && !stack.length) __moWorker.activeByNote.delete(ev.note);
    const P = getPlayer(pid);
    noteOff(P, abs, ev.note);
    P.seen++;
    P.last = abs;
    AppState.stats.pb++;
  }
}

export function hookWorkerMessages(){
  try{ window.__MO_WORKER_RECORDER_PERF__ = __moWorkerPerf; }catch{}
  if(__moWorker.hooked) return;
  if(!window.Worker || !Worker.prototype?.postMessage) return;
  __moWorker.originalPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(data, transfer){
    try{ ingestWorkerRenderMessage(data); }catch(e){ console.warn("MO worker recorder failed", e); }
    return __moWorker.originalPost.call(this, data, transfer);
  };
  __moWorker.hooked = true;
}
