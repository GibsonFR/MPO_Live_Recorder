function setVisible(item, visible){
  if(!item || !item.box) return;
  item.box.style.display = visible ? "" : "none";
  item.button?.classList.toggle("mo-dock-active", visible);
  try{ localStorage.setItem("mo:panel:" + item.id, visible ? "1" : "0"); }catch(e){}
}

function isVisible(item){
  return item?.box && item.box.style.display !== "none";
}

function defaultPosition(box, item, index){
  if(!box || box.dataset.moDockPositioned === "1") return;
  const left = 92;
  const top = 180 + Math.min(index, 2) * 18;
  Object.assign(box.style, {
    left: left + "px",
    top: top + "px",
    right: "auto",
    bottom: "auto"
  });
  box.dataset.moDockPositioned = "1";
}

export function mountToolsDock(items){
  if(document.getElementById("mo-tools-dock")) return;

  const dock = document.createElement("div");
  dock.id = "mo-tools-dock";
  dock.innerHTML = `
    <style>
      #mo-tools-dock{
        position:fixed;
        left:92px;
        top:118px;
        z-index:999998;
        display:flex;
        align-items:center;
        gap:6px;
        padding:7px;
        border-radius:12px;
        background:rgba(17,17,17,.88);
        color:#eee;
        font-family:system-ui,-apple-system,Segoe UI,sans-serif;
        box-shadow:0 8px 24px rgba(0,0,0,.45);
        border:1px solid rgba(255,255,255,.08);
        backdrop-filter:blur(5px);
        user-select:none;
      }
      #mo-tools-dock .mo-dock-title{
        font-weight:700;
        opacity:.88;
        margin:0 4px;
        cursor:move;
      }
      #mo-tools-dock button{
        background:#2b2b2b;
        color:#eee;
        border:1px solid #444;
        border-radius:9px;
        padding:6px 9px;
        cursor:pointer;
        font-size:12px;
        line-height:1;
      }
      #mo-tools-dock button:hover{background:#383838}
      #mo-tools-dock button.mo-dock-active{
        background:#2f8f55;
        border-color:#43b573;
        color:#fff;
      }
      #mo-tools-dock #moDockAllOff{background:#3a2525}
      #mo-tools-dock #moDockAllOff:hover{background:#522d2d}
      #mo-tools-dock.mo-dock-compact .mo-dock-label{display:none}
      #mo-tools-dock.mo-dock-compact{left:88px;top:112px;flex-direction:column;align-items:stretch}
      #mo-tools-dock.mo-dock-compact .mo-dock-title{display:none}
    </style>
    <span id="moDockDrag" class="mo-dock-title">MPO Tools</span>
    <div id="moDockButtons" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"></div>
    <button id="moDockAllOff" title="Close all panels">×</button>
    <button id="moDockCompact" title="Compact dock">▦</button>
  `;
  document.body.appendChild(dock);

  const buttons = dock.querySelector("#moDockButtons");
  const normalized = items.filter(x => x && x.box);

  normalized.forEach((item, index) => {
    defaultPosition(item.box, item, index);
    const btn = document.createElement("button");
    btn.innerHTML = `<span>${item.icon || "▣"}</span> <span class="mo-dock-label">${item.label}</span>`;
    btn.title = item.label;
    buttons.appendChild(btn);
    item.button = btn;

    let open = false;
    try{ open = localStorage.getItem("mo:panel:" + item.id) === "1"; }catch(e){}
    if(item.defaultOpen && localStorage.getItem("mo:panel:" + item.id) == null) open = true;
    setVisible(item, open);

    btn.addEventListener("click", () => {
      setVisible(item, !isVisible(item));
    });
  });

  dock.querySelector("#moDockAllOff").onclick = () => {
    normalized.forEach(item => setVisible(item, false));
  };

  dock.querySelector("#moDockCompact").onclick = () => {
    dock.classList.toggle("mo-dock-compact");
    try{ localStorage.setItem("mo:dock:compact", dock.classList.contains("mo-dock-compact") ? "1" : "0"); }catch(e){}
  };

  try{
    if(localStorage.getItem("mo:dock:compact") === "1") dock.classList.add("mo-dock-compact");
  }catch(e){}

  let dragging=false, sx=0, sy=0, ox=0, oy=0;
  const handle=dock.querySelector("#moDockDrag");
  handle.addEventListener("mousedown", e=>{
    dragging=true; sx=e.clientX; sy=e.clientY;
    const r=dock.getBoundingClientRect(); ox=r.left; oy=r.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", e=>{
    if(!dragging) return;
    dock.style.left = Math.max(8, Math.min(window.innerWidth-80, ox + e.clientX - sx)) + "px";
    dock.style.top = Math.max(8, Math.min(window.innerHeight-40, oy + e.clientY - sy)) + "px";
    dock.style.right = "auto";
    dock.style.bottom = "auto";
  });
  window.addEventListener("mouseup", ()=> dragging=false);

  return { dock, items: normalized };
}
