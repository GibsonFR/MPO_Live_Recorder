import { AppState, getPlayer } from "./state.js";
import { buildSMF, downloadBlob, now } from "./utils.js";
import { makeDraggable, addMinimizer } from "./draggable.js";
import { sendNoteOff, sendSustain, sendAllNotesOff } from "./midi.js";

export function mountRecorderUI(){
  const box=document.createElement("div");
  Object.assign(box.style,{position:"fixed",right:"12px",top:"12px",zIndex:999999,minWidth:"420px",color:"#eee",fontFamily:"system-ui",background:"rgba(17,17,17,.95)",borderRadius:"10px",boxShadow:"0 10px 30px rgba(0,0,0,.6)",maxHeight:"70vh",overflow:"hidden"});
  box.innerHTML=`
    <style>
      .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;user-select:none}
      .mo-btn:hover{background:#353535}
      .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}
      .row{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;min-height:34px}
      .row-live{outline:2px solid #1a915e;border-radius:10px;background:linear-gradient(90deg, rgba(26,145,94,0.12), transparent)}
    </style>
    <div id="hdr" style="display:flex;align-items:center;gap:8px;user-select:none;cursor:move">
      <strong>Room Recorder</strong>
      <span id="st" class="mo-chip" style="margin-left:auto;background:#264a2f">live</span>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px;align-items:center;flex-wrap:wrap">
      <button id="expAll" class="mo-btn">Export all</button>
      <button id="clear" class="mo-btn">Clear</button>
    </div>
    <div style="margin-top:6px;font-size:12px;opacity:.85">
      frames:<b id="f">0</b> • pb:<b id="pb">0</b> • taps:<b id="t">0</b> • path:<b id="path">—</b>
    </div>
    <div id="players" style="margin-top:8px;border:1px solid #333;border-radius:8px;padding:6px;max-height:48vh;overflow:auto;font-size:12px"></div>
  `;
  document.body.appendChild(box);

  const __hdr = box.querySelector("#hdr") || box.firstElementChild;
  addMinimizer(box, __hdr, "recorder");
  makeDraggable(box, __hdr);

  const expAll=box.querySelector("#expAll"),
        clr=box.querySelector("#clear"),
        f=box.querySelector("#f"),
        pb=box.querySelector("#pb"),
        t=box.querySelector("#t"),
        path=box.querySelector("#path"),
        players=box.querySelector("#players");

  const rowMap=new Map();

  function counters(){ f.textContent=String(AppState.stats.frames); pb.textContent=String(AppState.stats.pb); t.textContent=String(AppState.stats.taps); path.textContent=AppState.path; }

  function ensureRow(id){
    let R=rowMap.get(id); if(R) return R;
    const row=document.createElement("div"); row.className="row"; row.setAttribute("data-id",id);
    row.innerHTML=`
      <code style="background:#111;padding:2px 6px;border-radius:6px">${id}</code>
      <span class="seen">seen:0</span>
      <span class="ev">• ev:0</span>
      <span class="act">• act:0</span>
      <span class="last">• last:—s</span>
      <span class="an mo-chip" style="margin-left:auto;opacity:.9">—</span>
      <div class="btns" style="display:flex;gap:6px;margin-left:auto">
        <button class="mo-btn save">Export</button>
        <button class="mo-btn reset">Reset</button>
      </div>`;
    const els={row,seen:row.querySelector(".seen"),ev:row.querySelector(".ev"),act:row.querySelector(".act"),
               last:row.querySelector(".last"),an:row.querySelector(".an"),
               save:row.querySelector(".save"),reset:row.querySelector(".reset")};
    players.appendChild(row); rowMap.set(id,els);

    els.save.onclick=()=>exportOne(id);
    els.reset.onclick=()=>{
      const P=AppState.players.get(id); if(!P) return;
      P.events.length=0;
      P.active.forEach((_,n)=>sendNoteOff(n)); P.active.clear();
      P._lastOnIdx=0; P.vis.lastOuts=[];
      updateRow(id,P);
    };

    return els;
  }

  function updateRow(id,P){
    const R=ensureRow(id);
    R.seen.textContent=`seen:${P.seen}`;
    R.ev.textContent=`• ev:${P.events.length}`;
    R.act.textContent=`• act:${P.active.size}`;
    R.last.textContent=`• last:${P.last?((now()-P.last)/1000).toFixed(1)+'s':'—s'}`;
    let an="—";
    if(P.analysis){
      const {bpm, swing, scale, rootPc} = P.analysis;
      an=`${Math.round(bpm)}bpm • sw:${swing.toFixed(2)} • key:${scale}/${rootPc}`;
    }
    R.an.textContent=an;
    R.row.classList.toggle("row-live", (now()-P.last)<800);
  }

  function exportOne(id){
    const P=AppState.players.get(id); if(!P || !P.events.length) return;
    const blob=buildSMF(P.events);
    downloadBlob(blob, `player-${id}-${Date.now()}.mid`);
  }

  expAll.onclick=()=>{ AppState.players.forEach((_p,id)=>exportOne(id)); };

  clr.onclick=()=>{
    sendSustain(false); sendAllNotesOff();
    AppState.players.clear(); AppState.dedupe.clear(); players.innerHTML=""; rowMap.clear();
  };

  setInterval(()=>{
    AppState.players.forEach((p,id)=>updateRow(id,p));
    expAll.disabled=[...AppState.players.values()].every(p=>!p.events.length && !p.active.size);
    counters();
  },400);

  return {box};
}
