export function makeDraggable(panel, handle){
  let sx=0,sy=0,ox=0,oy=0,drag=false;
  const down=e=>{
    const p=(e.touches?e.touches[0]:e);
    drag=true; sx=p.clientX; sy=p.clientY;
    const r=panel.getBoundingClientRect(); ox=r.left; oy=r.top;
    document.addEventListener("mousemove",move,{passive:false});
    document.addEventListener("mouseup",up,{passive:false});
    document.addEventListener("touchmove",move,{passive:false});
    document.addEventListener("touchend",up,{passive:false});
    e.preventDefault();
  };
  const move=e=>{
    if(!drag) return;
    const p=(e.touches?e.touches[0]:e);
    const nx=ox+(p.clientX-sx), ny=oy+(p.clientY-sy);
    Object.assign(panel.style,{left:Math.max(8,Math.min(window.innerWidth-80,nx))+"px",top:Math.max(8,Math.min(window.innerHeight-60,ny))+"px",right:"auto",bottom:"auto"});
    e.preventDefault();
  };
  const up=()=>{
    drag=false;
    document.removeEventListener("mousemove",move);
    document.removeEventListener("mouseup",up);
    document.removeEventListener("touchmove",move);
    document.removeEventListener("touchend",up);
  };
  handle.style.cursor="move";
  handle.addEventListener("mousedown",down,{passive:false});
  handle.addEventListener("touchstart",down,{passive:false});
}


export function addMinimizer(panel, header, storageKey){
  if(!panel || !header) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = "Minimize";
  btn.setAttribute("aria-label","Minimize panel");
  btn.textContent = "–";
  btn.style.cssText = "margin-left:8px;background:#2b2b2b;color:#eee;border:1px solid #444;padding:4px 8px;border-radius:8px;cursor:pointer";
  
  let body = panel.querySelector(":scope > .__body");
  if(!body){
    body = document.createElement("div");
    body.className = "__body";
    const nodes = [];
    let n = header.nextSibling;
    while(n){
      const nx = n.nextSibling;
      nodes.push(n);
      n = nx;
    }
    nodes.forEach(node => body.appendChild(node));
    panel.appendChild(body);
  }
  const KEY = "mo:min:"+storageKey;
  function setMin(min){
    body.style.display = min ? "none" : "";
    btn.textContent = min ? "+" : "–";
    try{ localStorage.setItem(KEY, min ? "1" : "0"); }catch(e){}
  }
  let initMin = false;
  try{ initMin = localStorage.getItem(KEY) === "1"; }catch(e){}
  setMin(initMin);
  btn.addEventListener("click", ()=> setMin(body.style.display !== "none"));
  header.appendChild(btn);
  return {button: btn};
}
