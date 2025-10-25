import { NOTE_NAMES } from "./utils.js";
import { makeDraggable, addMinimizer } from "./draggable.js";
import { AppState, EngineCfg } from "./state.js";
import { updateAnalysis } from "./analysis.js";
import { tickAccompaniment, initAccompaniment } from "./accomp.js";


if (typeof AppState !== "object") window.AppState = {};
AppState.players ??= new Map();
AppState.midi ??= { out: null };
AppState.accompOpts ??= {
  enabled: true,
  role: "pads",
  follow: true,
  humanize: (EngineCfg?.human?.jitter ?? 7)
};


AppState.__logBuffer ??= [];
AppState.__logStartedAt ??= (performance.now?performance.now():Date.now());
AppState.__logEnabled ??= false;
AppState.__logAutoDownload ??= { enabled:false, delaySec:60, t0:0 };

AppState.__logPush = (type, payload = {}) => {
  if (!AppState.__logEnabled) return;
  const t = performance.now ? performance.now() : Date.now();
  const rec = { t, type, ...payload };
  AppState.__logBuffer.push(rec);
  if (AppState.__logBuffer.length > 20000) AppState.__logBuffer.shift();
};

function downloadLogNow(filename = null){
  const data = {
    startedAt: AppState.__logStartedAt,
    now: (performance.now?performance.now():Date.now()),
    events: AppState.__logBuffer
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ts = new Date().toISOString().replace(/[:.]/g,"-");
  a.download = filename || `mo-live-log-${ts}.json`;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
}


function theme(){
  const dark = AppState?.uiTheme==="dark" || (AppState?.uiTheme!=="light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return dark
    ? {bg:"rgba(17,17,17,.96)", fg:"#eee", mid:"#2c2c2c", sub:"#aaa", acc1:"#6fa7ff", acc2:"#9ad5b3"}
    : {bg:"rgba(250,250,250,.98)", fg:"#111", mid:"#e4e4e4", sub:"#444", acc1:"#2f6fff", acc2:"#1a915e"};
}
function drawBar(ctx, values, labels, color){
  const t=theme(); const W=ctx.canvas.width,H=ctx.canvas.height;
  ctx.clearRect(0,0,W,H); ctx.fillStyle=t.bg; ctx.fillRect(0,0,W,H);
  const pad=10; const bins=values.length; const binW=Math.floor((W-2*pad)/bins);
  for(let i=0;i<bins;i++){
    const x=pad+i*binW;
    ctx.fillStyle=t.mid; ctx.fillRect(x,10,binW-4,H-22);
    const h=Math.round((values[i]||0)*(H-26));
    ctx.fillStyle=color; ctx.fillRect(x,H-12-h,binW-4,h);
    if(labels){ ctx.fillStyle=t.sub; ctx.font="11px system-ui"; ctx.fillText(String(labels[i]??""), x+2, H-2); }
  }
}


export function mountMonitorUI(){
  const t=theme();
  const box=document.createElement("div");
  Object.assign(box.style,{
    position:"fixed", right:"12px", bottom:"12px", zIndex:999999, minWidth:"460px",
    color:t.fg, fontFamily:"system-ui", background:t.bg, borderRadius:"12px",
    padding:"10px", boxShadow:"0 10px 30px rgba(0,0,0,.35)", backdropFilter:"blur(6px)"
  });
  box.innerHTML=`
    <div id="hdr" style="display:flex;align-items:center;gap:8px;user-select:none;cursor:move">
      <strong>Live Monitor</strong>
      <span id="midiBadge" style="margin-left:auto;padding:3px 8px;border-radius:10px;border:1px solid ${t.mid}">MIDI: —</span>
    </div>

    <div style="display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap">
      <label>Player</label>
      <select id="sel" style="flex:1;min-width:160px;background:transparent;color:${t.fg};border:1px solid ${t.mid};border-radius:8px;padding:6px"></select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px">
        <input id="acOn" type="checkbox"> Accomp
      </label>
      <select id="role" style="min-width:110px;background:transparent;color:${t.fg};border:1px solid ${t.mid};border-radius:8px;padding:6px">
        <option value="pads">Pads</option>
        <option value="bass">Bass</option>
        <option value="arps">Arps</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px">
        <input id="follow" type="checkbox" checked> Follow
      </label>
      <button id="test" style="margin-left:auto;border:1px solid ${t.mid};background:transparent;border-radius:8px;padding:6px 10px;color:${t.fg}">Test</button>
    </div>

    <div style="display:flex;gap:10px;margin-top:8px;align-items:center">
      <label style="font-size:12px;width:74px">Humanize</label>
      <input id="human" type="range" min="0" max="25" step="1" style="flex:1" />
      <span id="humanv" style="font-size:12px;width:38px;text-align:right">—</span>
    </div>

    <!-- Scope / fenêtre d'analyse -->
    <div style="display:flex;gap:10px;margin-top:6px;align-items:center">
      <label style="font-size:12px;width:74px">Scope</label>
      <input id="scope" type="range" min="2000" max="20000" step="1000" style="flex:1" />
      <span id="scopev" style="font-size:12px;width:48px;text-align:right">—</span>
    </div>

    <div id="statline" style="margin-top:6px;font-size:12px;opacity:.9">—</div>
    <div style="margin-top:8px"><canvas id="pc"   width="440" height="82" style="background:transparent;border:1px solid ${t.mid};border-radius:8px"></canvas></div>
    <div style="margin-top:8px"><canvas id="grid" width="440" height="82" style="background:transparent;border:1px solid ${t.mid};border-radius:8px"></canvas></div>

    <div style="margin-top:10px;border-top:1px solid ${t.mid};padding-top:8px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <strong style="font-size:12px">Logging</strong>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px">
          <input id="logOn" type="checkbox"> Enable
        </label>
        <span id="logCount" style="font-size:12px;opacity:.9">events: 0</span>
        <button id="logDl" style="border:1px solid ${t.mid};background:transparent;border-radius:8px;padding:6px 10px;color:${t.fg}">Download JSON</button>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-left:auto">
          <input id="autoDl" type="checkbox"> Auto-download
        </label>
        <input id="autoDelay" type="number" min="5" max="600" value="60" style="width:68px;background:transparent;color:${t.fg};border:1px solid ${t.mid};border-radius:6px;padding:4px 6px" />
        <span id="autoLeft" style="font-size:12px;opacity:.8">—</span>
      </div>
    </div>
  `;
  document.body.appendChild(box);
  const __hdr = box.querySelector("#hdr") || box.firstElementChild;
  addMinimizer(box, __hdr, "monitor");
  makeDraggable(box, __hdr);

  const sel=box.querySelector("#sel");
  const acOn=box.querySelector("#acOn");
  const role=box.querySelector("#role");
  const follow=box.querySelector("#follow");
  const human=box.querySelector("#human");
  const humanv=box.querySelector("#humanv");
  const scope=box.querySelector("#scope");
  const scopev=box.querySelector("#scopev");
  const statline=box.querySelector("#statline");
  const pcCtx=box.querySelector("#pc").getContext("2d");
  const gridCtx=box.querySelector("#grid").getContext("2d");
  const testBtn=box.querySelector("#test");
  const midiBadge=box.querySelector("#midiBadge");

  const logOn=box.querySelector("#logOn");
  const logDl=box.querySelector("#logDl");
  const logCount=box.querySelector("#logCount");
  const autoDl=box.querySelector("#autoDl");
  const autoDelay=box.querySelector("#autoDelay");
  const autoLeft=box.querySelector("#autoLeft");

  
  acOn.checked   = !!AppState.accompOpts?.enabled;
  role.value     = AppState.accompOpts?.role || "pads";
  follow.checked = AppState.accompOpts?.follow ?? true;
  human.value    = String(AppState.accompOpts?.humanize ?? (EngineCfg?.human?.jitter ?? 7));
  humanv.textContent = human.value;

  scope.value = String((EngineCfg?.windowMs ?? 12000));
  scopev.textContent = `${Math.round(Number(scope.value)/1000)}s`;

  logOn.checked = !!AppState.__logEnabled;
  autoDl.checked = !!AppState.__logAutoDownload.enabled;
  autoDelay.value = String(AppState.__logAutoDownload.delaySec ?? 60);

  acOn.onchange = () => { AppState.accompOpts ??= {}; AppState.accompOpts.enabled = acOn.checked; };
  role.onchange = () => { AppState.accompOpts ??= {}; AppState.accompOpts.role = role.value; };
  follow.onchange = () => { AppState.accompOpts ??= {}; AppState.accompOpts.follow = follow.checked; };
  human.oninput = () => { AppState.accompOpts ??= {}; AppState.accompOpts.humanize = Number(human.value); humanv.textContent = human.value; };

  scope.oninput = () => {
    const v = Math.max(2000, Math.min(20000, Number(scope.value)||12000));
    if (EngineCfg) EngineCfg.windowMs = v;
    scopev.textContent = `${Math.round(v/1000)}s`;
  };

  logOn.onchange = () => {
    AppState.__logEnabled = logOn.checked;
    if (logOn.checked) {
      AppState.__logBuffer = [];
      AppState.__logStartedAt = performance.now ? performance.now() : Date.now();
    }
  };
  logDl.onclick = () => downloadLogNow();
  autoDl.onchange = () => {
    AppState.__logAutoDownload.enabled = autoDl.checked;
    AppState.__logAutoDownload.t0 = (performance.now?performance.now():Date.now());
    AppState.__logAutoDownload.delaySec = Math.max(5, Math.min(600, Number(autoDelay.value)||60));
  };
  autoDelay.oninput = () => {
    AppState.__logAutoDownload.delaySec = Math.max(5, Math.min(600, Number(autoDelay.value)||60));
  };

  
  testBtn.onclick = ()=>{
    const out=AppState?.midi?.out;
    if(!out){ alert("Aucune sortie MIDI détectée."); return; }
    const now = performance.now ? performance.now() : Date.now();
    AppState.__lastMidiOutAt = now;
    const base = 60; 
    try{
      out.send([0x90, base, 100]); out.send([0x90, base+4, 100]); out.send([0x90, base+7, 100]);
      setTimeout(()=>{ try{ out.send([0x80, base, 0]); out.send([0x80, base+4, 0]); out.send([0x80, base+7, 0]); }catch{} }, 450);
    }catch{}
  };

  function refreshSel(){
    const cur=sel.value;
    sel.innerHTML="";
    const ids=[...AppState.players.keys()];
    for(const id of ids){
      const opt=document.createElement("option"); opt.value=id; opt.textContent=String(id); sel.appendChild(opt);
    }
    if(ids.length) sel.value = ids.includes(cur) ? cur : ids[0];
  }
  setInterval(refreshSel,900);

  function currentPlayerId(){
    if(!follow.checked) return sel.value;
    let bestId=null,bestScore=-1e9; const now=performance.now?performance.now():Date.now();
    AppState.players.forEach((P,id)=>{
      const evs=(P.events||[]).filter(e=>e.type!=='cc');
      const score=(evs.length?now-evs[evs.length-1].t:1e9); const s=-score + evs.length*10;
      if(s>bestScore){bestScore=s; bestId=id;}
    });
    return bestId ?? sel.value;
  }

  function ensureInit(P){ if(!P.accomp) initAccompaniment(P); }

  function midiStatus(){
    const out = AppState?.midi?.out || null;
    const last = AppState?.__lastMidiOutAt || 0;
    const now = performance.now ? performance.now() : Date.now();
    const ago = now - last;
    if(!midiBadge) return;
    if(!out){ midiBadge.textContent = "MIDI: none"; midiBadge.style.opacity = 0.7; return; }
    midiBadge.textContent = ago < 2000 ? "MIDI: active" : "MIDI: idle";
    midiBadge.style.opacity = 1.0;
  }

  function logStatus(){
    logCount.textContent = `events: ${AppState.__logBuffer.length}`;
    if (AppState.__logAutoDownload.enabled) {
      const now = performance.now ? performance.now() : Date.now();
      const dt = (now - (AppState.__logAutoDownload.t0||now)) / 1000;
      const left = Math.max(0, Math.ceil((AppState.__logAutoDownload.delaySec||60) - dt));
      autoLeft.textContent = left ? `auto in ${left}s` : "downloading…";
      if (left === 0) {
        AppState.__logAutoDownload.enabled = false;
        autoDl.checked = false;
        downloadLogNow();
      }
    } else {
      autoLeft.textContent = "—";
    }
  }

  function render(){
    midiStatus();
    logStatus();

    const id=currentPlayerId() || [...AppState.players.keys()][0];
    if(id && sel.value!==id && follow.checked) sel.value=id;

    const P=AppState.players.get(id);
    if(P){
      const a=updateAnalysis(P);
      ensureInit(P);

      drawBar(pcCtx, P.vis.pcw, Array.from({length:12},(_,i)=>NOTE_NAMES[i]), theme().acc1);
      drawBar(gridCtx, P.vis.grid8, Array.from({length:8},(_,i)=>i+1), theme().acc2);
      statline.textContent = `${Math.round(a.bpm)} bpm • swing ${(a.swing||0).toFixed(2)} • ${NOTE_NAMES[a.rootPc]} ${a.isMinor?"min":"maj"}`;

      tickAccompaniment(id,P);
    }

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  return box;
}
