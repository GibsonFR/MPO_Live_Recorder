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
      const val=(e.sustain===true)?127 : Number.isFinite(e.value)?(e.value>=64?127:0) : Number.isFinite(e.v)?(e.v>=64?127:0) : 127;
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
