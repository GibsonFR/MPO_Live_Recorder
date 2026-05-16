(() => {
  // mnt/data/color_work/src/state.js
  var AppState = {
    record: false,
    path: "\u2014",
    stats: { frames: 0, pb: 0, taps: 0 },
    players: /* @__PURE__ */ new Map(),
    dedupe: /* @__PURE__ */ new Set(),
    midi: { access: null, out: null }
  };
  function getPlayer(id) {
    let p = AppState.players.get(id);
    if (p) return p;
    p = {
      t0: null,
      recStart: null,
      events: [],
      active: /* @__PURE__ */ new Map(),
      seen: 0,
      last: 0,
      analysis: null,
      accomp: { enabled: false, role: "bass", prevNote: null, prevDeg: null, refrac: 0, active: /* @__PURE__ */ new Set(), tempo: 110, rhythm: { swing: 0.54, grid8: Array(8).fill(0) } },
      model: { degLog: [], maxLog: 64, ngram: /* @__PURE__ */ new Map(), pcCooldown: new Array(12).fill(0) },
      vis: { pcw: new Array(12).fill(0), lastOuts: [], lastDeg: null, planned: [] }
    };
    AppState.players.set(id, p);
    return p;
  }

  // mnt/data/color_work/src/draggable.js
  function makeDraggable(panel, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
    const down = (e) => {
      const p = e.touches ? e.touches[0] : e;
      drag = true;
      sx = p.clientX;
      sy = p.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      document.addEventListener("mousemove", move, { passive: false });
      document.addEventListener("mouseup", up, { passive: false });
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", up, { passive: false });
      e.preventDefault();
    };
    const move = (e) => {
      if (!drag) return;
      const p = e.touches ? e.touches[0] : e;
      const nx = ox + (p.clientX - sx), ny = oy + (p.clientY - sy);
      Object.assign(panel.style, { left: Math.max(8, Math.min(window.innerWidth - 80, nx)) + "px", top: Math.max(8, Math.min(window.innerHeight - 60, ny)) + "px", right: "auto", bottom: "auto" });
      e.preventDefault();
    };
    const up = () => {
      drag = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
    };
    handle.style.cursor = "move";
    handle.addEventListener("mousedown", down, { passive: false });
    handle.addEventListener("touchstart", down, { passive: false });
  }
  function addMinimizer(panel, header, storageKey) {
    if (!panel || !header) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Minimize";
    btn.setAttribute("aria-label", "Minimize panel");
    btn.textContent = "\u2013";
    btn.style.cssText = "margin-left:8px;background:#2b2b2b;color:#eee;border:1px solid #444;padding:4px 8px;border-radius:8px;cursor:pointer";
    let body = panel.querySelector(":scope > .__body");
    if (!body) {
      body = document.createElement("div");
      body.className = "__body";
      const nodes = [];
      let n = header.nextSibling;
      while (n) {
        const nx = n.nextSibling;
        nodes.push(n);
        n = nx;
      }
      nodes.forEach((node) => body.appendChild(node));
      panel.appendChild(body);
    }
    const KEY = "mo:min:" + storageKey;
    function setMin(min) {
      body.style.display = min ? "none" : "";
      btn.textContent = min ? "+" : "\u2013";
      try {
        localStorage.setItem(KEY, min ? "1" : "0");
      } catch (e) {
      }
    }
    let initMin = false;
    try {
      initMin = localStorage.getItem(KEY) === "1";
    } catch (e) {
    }
    setMin(initMin);
    btn.addEventListener("click", () => setMin(body.style.display !== "none"));
    header.appendChild(btn);
    return { button: btn };
  }

  // mnt/data/color_work/src/utils.js
  var PPQ = 480;
  var TEMPO_USPQN = 5e5;
  var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  var now = () => Date.now();
  function vlq(n) {
    const o = [];
    let v = n & 127;
    o.unshift(v);
    while (n >>= 7) {
      v = n & 127 | 128;
      o.unshift(v);
    }
    return o;
  }
  var tbytes = (s) => Array.from(new TextEncoder().encode(String(s || "")));
  var ticksFromMs = (ms) => Math.max(0, Math.round(ms / 1e3 * (PPQ * 2)));
  function buildSMF(events, name) {
    if (!events.length) return null;
    const order = { on: 0, cc: 1, off: 2 };
    const evs = events.slice().sort((a, b) => a.t === b.t ? order[a.type] - order[b.type] : a.t - b.t);
    const tr = [], pushDelta = (dt) => {
      const d = vlq(dt);
      for (let i = 0; i < d.length; i++) tr.push(d[i]);
    }, pushMeta = (dt, ty, bytes) => {
      pushDelta(dt);
      tr.push(255, ty, bytes.length, ...bytes);
    };
    pushMeta(0, 3, tbytes(name || "player"));
    pushMeta(0, 81, [TEMPO_USPQN >>> 16 & 255, TEMPO_USPQN >>> 8 & 255, TEMPO_USPQN & 255]);
    let lastTk = 0;
    for (const e of evs) {
      const tk = ticksFromMs(e.t), dt = Math.max(0, tk - lastTk);
      lastTk = tk;
      pushDelta(dt);
      if (e.type === "on") {
        tr.push(144, e.note & 127, clamp(Math.round((e.vel ?? 1) * 127), 1, 127));
      } else if (e.type === "off") {
        tr.push(128, e.note & 127, 0);
      } else if (e.type === "cc") {
        tr.push(176, (e.cc | 0) & 127, clamp(e.val | 0, 0, 127));
      }
    }
    pushDelta(0);
    tr.push(255, 47, 0);
    const trLen = tr.length;
    const trHdr = [77, 84, 114, 107, trLen >>> 24 & 255, trLen >>> 16 & 255, trLen >>> 8 & 255, trLen & 255];
    const hdr = [77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8 & 255, PPQ & 255];
    return new Blob([new Uint8Array(hdr), new Uint8Array(trHdr), new Uint8Array(tr)], { type: "audio/midi" });
  }
  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2e3);
  }

  // mnt/data/color_work/src/midi.js
  function requestMIDI(onChange) {
    if (!navigator.requestMIDIAccess) return Promise.reject(new Error("no-webmidi"));
    return navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      AppState.midi.access = access;
      access.onstatechange = () => onChange && onChange();
      return access;
    });
  }
  function listOutputs() {
    const arr = [];
    const ma = AppState.midi.access;
    if (!ma) return arr;
    try {
      ma.outputs.forEach((o) => arr.push(o));
    } catch {
      const it = ma.outputs && ma.outputs.values && ma.outputs.values();
      if (it) {
        for (const v of it) arr.push(v);
      }
    }
    return arr;
  }
  function setOutputById(id) {
    const ma = AppState.midi.access;
    if (!ma) return null;
    let out = ma.outputs.get ? ma.outputs.get(id) : null;
    if (!out) {
      try {
        ma.outputs.forEach((o) => {
          if (o.id === id) out = o;
        });
      } catch {
      }
    }
    AppState.midi.out = out || null;
    return AppState.midi.out;
  }
  function midiName(o) {
    if (!o) return "(none)";
    return (o.manufacturer ? o.manufacturer + " " : "") + (o.name || o.id || "(unnamed)");
  }
  function sendNoteOff(note) {
    const out = AppState.midi.out;
    if (!out) return;
    out.send([128, (note | 0) & 127, 0]);
  }
  function sendAllNotesOff() {
    const out = AppState.midi.out;
    if (!out) return;
    for (let n = 0; n < 128; n++) out.send([128, n & 127, 0]);
  }
  function sendSustain(flag) {
    const out = AppState.midi.out;
    if (!out) return;
    out.send([176, 64, flag ? 127 : 0]);
  }

  // mnt/data/color_work/src/sniffer.js
  var TD = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  var arrVal = (o, keys) => {
    for (const k of keys) {
      if (Array.isArray(o?.[k])) return o[k];
    }
    return null;
  };
  var idVal = (o) => o.playerId ?? o.player ?? o.pid ?? o.id;
  var eventsVal = (o) => arrVal(o, ["events", "evts", "e"]);
  function parseSIOFrames(str) {
    const out = [];
    let i = 0;
    while (i < str.length) {
      if (str.charAt(i) === "4" && str.charAt(i + 1) === "2") {
        let j = i + 2;
        while (j < str.length && str.charAt(j) !== "[") j++;
        if (j >= str.length) break;
        let d = 0, k = j;
        for (; k < str.length; k++) {
          const c = str.charAt(k);
          if (c === "[") d++;
          else if (c === "]") {
            d--;
            if (d === 0) {
              k++;
              break;
            }
          }
        }
        try {
          out.push(JSON.parse(str.slice(j, k)));
        } catch {
        }
        i = k;
        continue;
      }
      i++;
    }
    return out;
  }
  function extractBatches(frame) {
    const res = [];
    try {
      if (Array.isArray(frame)) {
        if (frame[0] === "pianoBatch") {
          const pl = frame[1];
          if (Array.isArray(pl)) pl.forEach((x) => {
            const id = idVal(x), ev = eventsVal(x);
            if (id && ev) res.push({ playerId: id, events: ev, t: x.t ?? x.ts ?? x.tISO ?? null });
          });
          else if (pl && typeof pl === "object") {
            const id = idVal(pl), ev = eventsVal(pl);
            if (id && ev) res.push({ playerId: id, events: ev, t: pl.t ?? pl.ts ?? pl.tISO ?? null });
          }
        }
      } else if (frame && typeof frame === "object") {
        const pid = idVal(frame), evs = eventsVal(frame);
        if (pid && evs) {
          res.push({ playerId: pid, events: evs, t: frame.t ?? frame.ts ?? frame.tISO ?? null });
          return res;
        }
        const label = frame.type || frame.evt || frame.op || frame.event, payload = frame.payload ?? frame.data;
        if (label === "pianoBatch") {
          if (Array.isArray(payload)) payload.forEach((x) => {
            const id = idVal(x), ev = eventsVal(x);
            if (id && ev) res.push({ playerId: id, events: ev, t: x.t ?? x.ts ?? x.tISO ?? null });
          });
          else if (payload && typeof payload === "object") {
            const id = idVal(payload), ev = eventsVal(payload);
            if (id && ev) res.push({ playerId: id, events: ev, t: payload.t ?? payload.ts ?? payload.tISO ?? null });
          }
        } else {
          const id = idVal(frame), evs2 = eventsVal(frame);
          if (id && evs2) res.push({ playerId: id, events: evs2, t: frame.t ?? frame.ts ?? frame.tISO ?? null });
        }
      }
    } catch {
    }
    return res;
  }
  function normEvents(arr) {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (const e of arr) {
      const name = String(e.name || e.n || "").toUpperCase();
      const ts = (e.timestamp ?? e.ts ?? e.time ?? e.tms ?? 0) | 0;
      if (name === "SUSTAIN" || name.includes("SUSTAIN") || e.cc === 64 || e.control === 64) {
        const raw = e.value ?? e.v ?? e.val;
        let val;
        if (e.sustain === true) {
          val = 127;
        } else if (e.sustain === false) {
          val = 0;
        } else if (Number.isFinite(raw)) {
          val = Math.max(0, Math.min(127, raw | 0));
        } else {
          val = 0;
        }
        out.push({ type: "cc", cc: 64, val, ts });
        continue;
      }
      if (name === "NOTE_ON" || name === "ON" || e.on === 1 || e.down === true) {
        const note = (e.note ?? e.n ?? e.k ?? e.key) | 0;
        if (note < 0 || note > 127) continue;
        const vel = ((e.velocity ?? e.v ?? e.vel ?? 127) | 0) / 127;
        out.push({ type: "on", note, vel, ts });
        continue;
      }
      if (name === "NOTE_OFF" || name === "OFF" || e.off === 1 || e.up === true) {
        const note = (e.note ?? e.n ?? e.k ?? e.key) | 0;
        if (note < 0 || note > 127) continue;
        out.push({ type: "off", note, ts });
        continue;
      }
    }
    return out;
  }
  function batchKey(b) {
    const evs = Array.isArray(b.events) ? b.events : [];
    let min = Infinity, max = -Infinity;
    for (const e of evs) {
      const t = (e.timestamp ?? e.ts ?? e.tms ?? e.time ?? 0) | 0;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    const pid = b.playerId ?? b.player ?? b.pid ?? b.id ?? "?";
    const c = evs.length | 0;
    return `${pid}|${b.t || b.ts || b.tISO || "?"}|${c}|${min}-${max}`;
  }
  function noteOn(P, absMs, note, vel) {
    if (P.t0 == null) P.t0 = absMs;
    if (AppState.record && P.recStart == null) P.recStart = absMs;
    const base = P.recStart ?? P.t0, rel = Math.max(0, absMs - base);
    if (P.active.has(note)) {
      const tOff = Math.max(0, rel - 0.1);
      P.events.push({ t: tOff, type: "off", note, vel: 0 });
    }
    P.active.set(note, { tOn: rel, vel });
    P.events.push({ t: rel, type: "on", note, vel });
  }
  function noteOff(P, absMs, note) {
    if (P.t0 == null) P.t0 = absMs;
    const base = P.recStart ?? P.t0, rel = Math.max(0, absMs - base);
    if (P.active.has(note)) P.active.delete(note);
    P.events.push({ t: rel, type: "off", note, vel: 0 });
  }
  function handleMessageData(data) {
    AppState.stats.frames++;
    if (typeof data === "string") {
      const frames = parseSIOFrames(data);
      if (frames.length) {
        for (const fr of frames) {
          const batches = extractBatches(fr);
          for (const b of batches) ingestBatch(b, "WS");
        }
        return;
      }
      try {
        const obj = JSON.parse(data);
        const arr = Array.isArray(obj) ? obj : [obj];
        for (const fr of arr) {
          const batches = extractBatches(fr);
          for (const b of batches) ingestBatch(b, "WS");
        }
        return;
      } catch {
      }
      const lines = data.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (const ln of lines) {
        try {
          const o = JSON.parse(ln);
          const batches = extractBatches(o);
          for (const b of batches) ingestBatch(b, "WS");
        } catch {
        }
      }
      return;
    }
    if (data instanceof ArrayBuffer) {
      if (TD) {
        try {
          const txt = TD.decode(new Uint8Array(data));
          if (txt) handleMessageData(txt);
        } catch {
        }
      }
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      const fr = new FileReader();
      fr.onload = function() {
        handleMessageData(String(fr.result || ""));
      };
      try {
        fr.readAsText(data.slice(0, 16384));
      } catch {
      }
    }
  }
  function ingestBatch(b, pathTag) {
    AppState.path = pathTag || AppState.path;
    const key = batchKey(b);
    if (AppState.dedupe.has(key)) return;
    AppState.dedupe.add(key);
    const pid = String(b.playerId ?? b.player ?? b.pid ?? b.id ?? "unknown");
    const P = getPlayer(pid);
    const evs = normEvents(b.events);
    if (!evs.length) return;
    const baseAbs = b.t != null ? b.t : null, firstTs = evs[0].ts;
    for (const e of evs) {
      const abs = baseAbs != null ? baseAbs - firstTs + e.ts : now() + (e.ts - firstTs);
      if (e.type === "cc" && e.cc === 64) {
        if (P.t0 == null) P.t0 = abs;
        if (AppState.record && P.recStart == null) P.recStart = abs;
        const base = P.recStart ?? P.t0, rel = Math.max(0, abs - base);
        P.events.push({ t: rel, type: "cc", cc: 64, val: e.val | 0 });
        continue;
      }
      if (e.type === "on") {
        noteOn(P, abs, e.note, e.vel);
        continue;
      }
      if (e.type === "off") {
        noteOff(P, abs, e.note);
        continue;
      }
    }
    P.seen += evs.length;
    P.last = now();
    AppState.stats.pb++;
  }
  function hookWebSocket() {
    const RealWS = window.WebSocket;
    if (!RealWS) return;
    if (!RealWS.prototype.__mo_hooked__) {
      const origAdd = RealWS.prototype.addEventListener;
      RealWS.prototype.addEventListener = function(type, listener, opts) {
        if (type === "message" && typeof listener === "function") {
          const wrapped = (ev) => {
            try {
              AppState.stats.taps++;
              handleMessageData(ev.data);
            } catch {
            }
            return listener.call(this, ev);
          };
          return origAdd.call(this, type, wrapped, opts);
        }
        return origAdd.call(this, type, listener, opts);
      };
      const desc = Object.getOwnPropertyDescriptor(RealWS.prototype, "onmessage") || {};
      Object.defineProperty(RealWS.prototype, "onmessage", {
        configurable: true,
        enumerable: true,
        get: desc.get ? desc.get : function() {
          return this.__mo_on__ || null;
        },
        set: function(fn) {
          if (typeof fn === "function") {
            const wrapped = (ev) => {
              try {
                AppState.stats.taps++;
                handleMessageData(ev.data);
              } catch {
              }
              return fn.call(this, ev);
            };
            this.__mo_on__ = wrapped;
            this.addEventListener("message", wrapped);
          } else {
            this.__mo_on__ = null;
          }
        }
      });
      const origSend = RealWS.prototype.send;
      RealWS.prototype.send = function() {
        try {
          if (!this.__mo_attached__) {
            this.addEventListener("message", (ev) => {
              try {
                AppState.stats.taps++;
                handleMessageData(ev.data);
              } catch {
              }
            });
            Object.defineProperty(this, "__mo_attached__", { value: true });
          }
        } catch {
        }
        return origSend.apply(this, arguments);
      };
      Object.defineProperty(RealWS.prototype, "__mo_hooked__", { value: true });
    }
    if (!window.__mo_ws_ctor__) {
      let WSWrap = function(url, protocols) {
        const ws = protocols !== void 0 ? new RealWS(url, protocols) : new RealWS(url);
        try {
          ws.addEventListener("message", (ev) => {
            try {
              AppState.stats.taps++;
              handleMessageData(ev.data);
            } catch {
            }
          });
          Object.defineProperty(ws, "__mo_attached__", { value: true });
        } catch {
        }
        return ws;
      };
      WSWrap.prototype = RealWS.prototype;
      Object.setPrototypeOf(WSWrap, RealWS);
      window.WebSocket = WSWrap;
      Object.defineProperty(window, "__mo_ws_ctor__", { value: true });
    }
  }
  var __moWorker = {
    hooked: false,
    originalPost: null,
    activeByNote: /* @__PURE__ */ new Map()
  };
  var __moColorOwners = {
    lastScan: 0,
    byColor: /* @__PURE__ */ new Map()
  };
  var __moWorkerPerf = {
    colorScanMs: 2500,
    skipColorMappingWhenReactive: true
  };
  function normalizeHexColor(c) {
    if (!c) return null;
    let s = String(c).trim();
    const hex2 = s.match(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/);
    if (hex2) return "#" + hex2[1].toLowerCase();
    const rgb = s.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (rgb) {
      const h = (n) => Math.max(0, Math.min(255, Number(n) | 0)).toString(16).padStart(2, "0");
      return "#" + h(rgb[1]) + h(rgb[2]) + h(rgb[3]);
    }
    return null;
  }
  function extractColorsFromText(s) {
    const out = [];
    if (!s) return out;
    const text = String(s);
    for (const m of text.matchAll(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/g)) out.push("#" + m[1].toLowerCase());
    for (const m of text.matchAll(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) out.push(normalizeHexColor(m[0]));
    return out.filter(Boolean);
  }
  function cleanPlayerName(txt) {
    let s = String(txt || "").replace(/[🔒👁️👤🎹🎧🎵🎶✅✓✕×▾▴⚙️🗑️]+/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return null;
    s = s.split(/\s{2,}|\n|\r|\t| joined | left | as /i)[0].trim();
    s = s.replace(/^(player|spectator)\s*/i, "").trim();
    if (!s || s.length > 48) return null;
    return s;
  }
  function ownText(el) {
    let out = "";
    try {
      for (const n of el.childNodes || []) {
        if (n.nodeType === Node.TEXT_NODE) out += " " + n.textContent;
      }
    } catch {
    }
    return out.trim();
  }
  function looksLikeSinglePlayerName(s) {
    s = cleanPlayerName(s);
    if (!s) return false;
    if (/^(zoom|live|recording|recorder|export|reset|clear|midi|player|room|server|joined|left|switched|spectator|normal|velocity|transposition)$/i.test(s)) return false;
    if (/room|recorder|export|reset|joined|left|switched|spectator|server|message/i.test(s)) return false;
    if (s.length < 2 || s.length > 36) return false;
    const guestCount = (s.match(/Guest_/g) || []).length;
    if (guestCount > 1) return false;
    if (/ZoomGuest_/i.test(s)) return false;
    if (/Guest_\d+\w+/i.test(s) && !/^Guest_\d+$/i.test(s)) return false;
    if (/Guest_/i.test(s) && !/^Guest_/i.test(s)) return false;
    if (/[a-z][A-Z][a-z].*[A-Z][a-z]/.test(s) && s.length > 18 && !/[_\s-]/.test(s)) return false;
    return true;
  }
  function extractNameFromRow(row) {
    if (!row) return null;
    const direct = cleanPlayerName(ownText(row));
    if (looksLikeSinglePlayerName(direct)) return direct;
    const candidates = [];
    try {
      for (const el of row.querySelectorAll("span,div,p,b,strong,a")) {
        const r = el.getBoundingClientRect?.();
        if (!r || r.width < 2 || r.height < 2) continue;
        const t = cleanPlayerName(ownText(el) || el.textContent || "");
        if (looksLikeSinglePlayerName(t)) candidates.push({ t, area: r.width * r.height });
      }
    } catch {
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.area - b.area);
      return candidates[0].t;
    }
    const clone = row.cloneNode(true);
    clone.querySelectorAll?.("button,svg,img,input,select,.square,[class*='square'],[class*='lock'],[class*='icon'],[class*='badge']").forEach((x) => x.remove());
    const txt = cleanPlayerName(clone.innerText || clone.textContent || row.innerText || row.textContent);
    return looksLikeSinglePlayerName(txt) ? txt : null;
  }
  function findNearbyNameByGeometry(colorEl) {
    const cr = colorEl.getBoundingClientRect?.();
    if (!cr || cr.width <= 0 || cr.height <= 0) return null;
    const cy = cr.top + cr.height / 2;
    const cx = cr.left + cr.width / 2;
    const candidates = [];
    let scope = null;
    try {
      scope = colorEl.closest?.(".players,[class*='players'],.overlay,[class*='overlay']") || document.body;
    } catch {
      scope = document.body;
    }
    let all = [];
    try {
      all = [...scope.querySelectorAll("span,div,p,b,strong,a")];
    } catch {
    }
    for (const el of all) {
      if (el === colorEl || colorEl.contains?.(el) || el.contains?.(colorEl)) continue;
      const r = el.getBoundingClientRect?.();
      if (!r || r.width < 4 || r.height < 4) continue;
      if (r.height > 36 || r.width > 220) continue;
      const txt = cleanPlayerName(ownText(el) || el.textContent || "");
      if (!looksLikeSinglePlayerName(txt)) continue;
      const ey = r.top + r.height / 2;
      const ex = r.left + r.width / 2;
      const dy = Math.abs(ey - cy);
      if (dy > 22) continue;
      const dx = Math.abs(ex - cx);
      candidates.push({ txt, score: dy * 10 + dx, dy, dx });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.txt || null;
  }
  function nameFromColorElement(el) {
    let row = el.closest?.(".player-row") || el.closest?.("[class*='player-row']") || null;
    if (row) {
      const rr = row.getBoundingClientRect?.();
      const txt = (row.innerText || row.textContent || "").trim();
      if ((!rr || rr.height <= 52) && txt.length < 140) {
        const n = extractNameFromRow(row);
        if (n) return n;
      }
    }
    let cur = el;
    for (let i = 0; i < 6 && cur?.parentElement; i++) {
      cur = cur.parentElement;
      const r = cur.getBoundingClientRect?.();
      const txt = (cur.innerText || cur.textContent || "").trim();
      if (!r || !txt) continue;
      if (r.height <= 52 && r.width <= 280 && txt.length < 120) {
        const n = extractNameFromRow(cur);
        if (n) return n;
      }
    }
    return findNearbyNameByGeometry(el);
  }
  function scanColorOwners() {
    const t = now();
    if (t - __moColorOwners.lastScan < __moWorkerPerf.colorScanMs) return __moColorOwners.byColor;
    __moColorOwners.lastScan = t;
    const next = new Map(__moColorOwners.byColor);
    const selectors = [
      ".player-row .square",
      "[class*='player-row'] [class*='square']",
      ".players .square",
      "[style*='--player-first-color']"
    ].join(",");
    let els = [];
    try {
      els = [...document.querySelectorAll(selectors)];
    } catch {
    }
    for (const el of els) {
      let name = nameFromColorElement(el);
      if (!name) continue;
      const st2 = el.getAttribute("style") || "";
      let computed = "";
      try {
        const cs = getComputedStyle(el);
        computed = [cs.getPropertyValue("--player-first-color"), cs.background, cs.backgroundColor, cs.backgroundImage].join(" ");
      } catch {
      }
      const colors = [...extractColorsFromText(st2), ...extractColorsFromText(computed)];
      for (const color of colors) {
        if (color) next.set(color, "player:" + name);
      }
    }
    __moColorOwners.byColor = next;
    return next;
  }
  function workerPlayerIdFromStart(msg) {
    try {
      if (__moWorkerPerf.skipColorMappingWhenReactive && window.__MO_REACTIVE_COLOR_ENABLED__) return "worker:rendered";
    } catch {
    }
    const effect = Array.isArray(msg?.effects) ? msg.effects[0] : null;
    const opts = effect?.opts || {};
    const color = normalizeHexColor(Array.isArray(opts.colors) ? opts.colors[0] : null);
    if (color) {
      const owner = scanColorOwners().get(color);
      if (owner) return owner;
    }
    return "worker:rendered";
  }
  function parseWorkerRenderEvent(msg) {
    if (!msg || typeof msg !== "object") return null;
    if (msg.type === "startEffect" && msg.note != null) {
      const effect = Array.isArray(msg.effects) ? msg.effects[0] : null;
      const opts = effect?.opts || {};
      const color = Array.isArray(opts.colors) ? opts.colors[0] : null;
      let vel = Number(opts.velocity ?? msg.velocity ?? 64);
      if (!Number.isFinite(vel)) vel = 64;
      if (vel > 1) vel = vel / 127;
      return { type: "on", note: (Number(msg.note) | 0) & 127, vel: Math.max(0.01, Math.min(1, vel)), color, pid: workerPlayerIdFromStart(msg) };
    }
    if (msg.type === "stopEffect" && msg.note != null) {
      return { type: "off", note: (Number(msg.note) | 0) & 127 };
    }
    return null;
  }
  function ingestWorkerRenderMessage(msg) {
    const ev = parseWorkerRenderEvent(msg);
    if (!ev) return;
    AppState.stats.frames++;
    AppState.stats.taps++;
    AppState.path = "Worker";
    const abs = now();
    if (ev.type === "on") {
      const P = getPlayer(ev.pid);
      noteOn(P, abs, ev.note, ev.vel);
      P.seen++;
      P.last = abs;
      if (!__moWorker.activeByNote.has(ev.note)) __moWorker.activeByNote.set(ev.note, []);
      __moWorker.activeByNote.get(ev.note).push(ev.pid);
      AppState.stats.pb++;
      return;
    }
    if (ev.type === "off") {
      const stack = __moWorker.activeByNote.get(ev.note);
      const pid = stack && stack.length ? stack.shift() : "worker:rendered";
      if (stack && !stack.length) __moWorker.activeByNote.delete(ev.note);
      const P = getPlayer(pid);
      noteOff(P, abs, ev.note);
      P.seen++;
      P.last = abs;
      AppState.stats.pb++;
    }
  }
  function hookWorkerMessages() {
    try {
      window.__MO_WORKER_RECORDER_PERF__ = __moWorkerPerf;
    } catch {
    }
    if (__moWorker.hooked) return;
    if (!window.Worker || !Worker.prototype?.postMessage) return;
    __moWorker.originalPost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(data, transfer) {
      try {
        ingestWorkerRenderMessage(data);
      } catch (e) {
        console.warn("MO worker recorder failed", e);
      }
      return __moWorker.originalPost.call(this, data, transfer);
    };
    __moWorker.hooked = true;
  }

  // mnt/data/color_work/src/ui_recorder.js
  function mountRecorderUI() {
    const box = document.createElement("div");
    Object.assign(box.style, { position: "fixed", right: "12px", top: "12px", zIndex: 999999, minWidth: "420px", color: "#eee", fontFamily: "system-ui", background: "rgba(17,17,17,.95)", borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,.6)", maxHeight: "70vh", overflow: "hidden" });
    box.innerHTML = `
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
      frames:<b id="f">0</b> \u2022 pb:<b id="pb">0</b> \u2022 taps:<b id="t">0</b> \u2022 path:<b id="path">\u2014</b>
    </div>
    <div id="players" style="margin-top:8px;border:1px solid #333;border-radius:8px;padding:6px;max-height:48vh;overflow:auto;font-size:12px"></div>
  `;
    document.body.appendChild(box);
    const __hdr2 = box.querySelector("#hdr") || box.firstElementChild;
    addMinimizer(box, __hdr2, "recorder");
    makeDraggable(box, __hdr2);
    const expAll = box.querySelector("#expAll"), clr = box.querySelector("#clear"), f = box.querySelector("#f"), pb = box.querySelector("#pb"), t = box.querySelector("#t"), path = box.querySelector("#path"), players = box.querySelector("#players");
    const rowMap = /* @__PURE__ */ new Map();
    function counters() {
      f.textContent = String(AppState.stats.frames);
      pb.textContent = String(AppState.stats.pb);
      t.textContent = String(AppState.stats.taps);
      path.textContent = AppState.path;
    }
    function ensureRow(id) {
      let R = rowMap.get(id);
      if (R) return R;
      const row = document.createElement("div");
      row.className = "row";
      row.setAttribute("data-id", id);
      row.innerHTML = `
      <code style="background:#111;padding:2px 6px;border-radius:6px">${id}</code>
      <span class="seen">seen:0</span>
      <span class="ev">\u2022 ev:0</span>
      <span class="act">\u2022 act:0</span>
      <span class="last">\u2022 last:\u2014s</span>
      <span class="an mo-chip" style="margin-left:auto;opacity:.9">\u2014</span>
      <div class="btns" style="display:flex;gap:6px;margin-left:auto">
        <button class="mo-btn save">Export</button>
        <button class="mo-btn reset">Reset</button>
      </div>`;
      const els = {
        row,
        seen: row.querySelector(".seen"),
        ev: row.querySelector(".ev"),
        act: row.querySelector(".act"),
        last: row.querySelector(".last"),
        an: row.querySelector(".an"),
        save: row.querySelector(".save"),
        reset: row.querySelector(".reset")
      };
      players.appendChild(row);
      rowMap.set(id, els);
      els.save.onclick = () => exportOne(id);
      els.reset.onclick = () => {
        const P = AppState.players.get(id);
        if (!P) return;
        P.events.length = 0;
        P.active.forEach((_, n) => sendNoteOff(n));
        P.active.clear();
        P._lastOnIdx = 0;
        P.vis.lastOuts = [];
        updateRow(id, P);
      };
      return els;
    }
    function updateRow(id, P) {
      const R = ensureRow(id);
      R.seen.textContent = `seen:${P.seen}`;
      R.ev.textContent = `\u2022 ev:${P.events.length}`;
      R.act.textContent = `\u2022 act:${P.active.size}`;
      R.last.textContent = `\u2022 last:${P.last ? ((now() - P.last) / 1e3).toFixed(1) + "s" : "\u2014s"}`;
      let an = "\u2014";
      if (P.analysis) {
        const { bpm, swing, scale, rootPc } = P.analysis;
        an = `${Math.round(bpm)}bpm \u2022 sw:${swing.toFixed(2)} \u2022 key:${scale}/${rootPc}`;
      }
      R.an.textContent = an;
      R.row.classList.toggle("row-live", now() - P.last < 800);
    }
    function exportOne(id) {
      const P = AppState.players.get(id);
      if (!P || !P.events.length) return;
      const blob = buildSMF(P.events);
      downloadBlob(blob, `player-${id}-${Date.now()}.mid`);
    }
    expAll.onclick = () => {
      AppState.players.forEach((_p, id) => exportOne(id));
    };
    clr.onclick = () => {
      sendSustain(false);
      sendAllNotesOff();
      AppState.players.clear();
      AppState.dedupe.clear();
      players.innerHTML = "";
      rowMap.clear();
    };
    setInterval(() => {
      AppState.players.forEach((p, id) => updateRow(id, p));
      expAll.disabled = [...AppState.players.values()].every((p) => !p.events.length && !p.active.size);
      counters();
    }, 400);
    return { box };
  }

  // mnt/data/color_work/src/ui_player.js
  function readUint16(dv, off) {
    return dv.getUint8(off) << 8 | dv.getUint8(off + 1);
  }
  function readUint32(dv, off) {
    return dv.getUint8(off) << 24 | dv.getUint8(off + 1) << 16 | dv.getUint8(off + 2) << 8 | dv.getUint8(off + 3);
  }
  function readVar(dv, off) {
    let val = 0, i = off, b;
    do {
      b = dv.getUint8(i++);
      val = val << 7 | b & 127;
    } while (b & 128);
    return { val, len: i - off };
  }
  function parseSMF(buf) {
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "MThd") throw new Error("Invalid MIDI");
    const headerLen = readUint32(dv, 4);
    const format = readUint16(dv, 8);
    const ntrks = readUint16(dv, 10);
    const division = readUint16(dv, 12);
    let off = 8 + headerLen;
    const tracks = [];
    for (let t = 0; t < ntrks; t++) {
      if (String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3)) !== "MTrk") throw new Error("Bad track");
      const len = readUint32(dv, off + 4);
      const tend = off + 8 + len;
      let i = off + 8, run = 0, tick = 0;
      const evts = [];
      while (i < tend) {
        const d = readVar(dv, i);
        i += d.len;
        tick += d.val;
        let st2 = dv.getUint8(i++);
        if (!(st2 & 128)) {
          i--;
          st2 = run;
        } else {
          run = st2;
        }
        if (st2 === 255) {
          const type = dv.getUint8(i++);
          const lenv = readVar(dv, i);
          i += lenv.len;
          const data = new Uint8Array(buf, i, lenv.val);
          i += lenv.val;
          evts.push({ tick, type: "meta", meta: type, data });
        } else if (st2 === 240 || st2 === 247) {
          const lenv = readVar(dv, i);
          i += lenv.len + lenv.val;
        } else {
          const type = st2 & 240, ch = st2 & 15;
          let a = dv.getUint8(i++), b = type === 192 || type === 208 ? 0 : dv.getUint8(i++);
          evts.push({ tick, type, ch, a, b });
        }
      }
      tracks.push(evts);
      off = tend;
    }
    return { format, division, tracks };
  }
  function buildEventList(smf) {
    const events = [];
    for (const tr of smf.tracks) {
      for (const e of tr) events.push(e);
    }
    events.sort((a, b) => a.tick - b.tick);
    let tempo = 5e5;
    const mapped = [];
    for (const e of events) {
      if (e.type === "meta" && e.meta === 81 && e.data && e.data.length === 3) {
        tempo = e.data[0] << 16 | e.data[1] << 8 | e.data[2];
        mapped.push({ kind: "tempo", tick: e.tick, tempo });
      } else if (typeof e.type === "number") {
        mapped.push({ kind: "midi", tick: e.tick, type: e.type, ch: e.ch, a: e.a, b: e.b });
      }
    }
    const div = smf.division & 32767;
    let lastTick = 0, curTempo = 5e5, tSec = 0;
    const out = [];
    let idx = 0;
    while (idx < mapped.length) {
      const e = mapped[idx];
      const dt = e.tick - lastTick;
      tSec += dt * (curTempo / 1e6) / div;
      lastTick = e.tick;
      if (e.kind === "tempo") {
        curTempo = e.tempo;
      } else {
        out.push({ ...e, time: tSec });
      }
      idx++;
    }
    return out;
  }
  function makePlayer() {
    let events = [];
    let playing = false;
    let startT = 0;
    let startPos = 0;
    let tempoMul = 1;
    let transpose = 0;
    let cursor = 0;
    let rafId = null;
    const active = /* @__PURE__ */ new Map();
    function currentOut() {
      return AppState.midi.out;
    }
    function timeNow() {
      return performance.now() / 1e3;
    }
    function send(evt) {
      const out = currentOut();
      if (!out) return;
      if (evt.type === 144) {
        out.send([144 | evt.ch, evt.a + transpose & 127, evt.b]);
        active.set(evt.ch << 8 | evt.a, [evt.a + transpose & 127, evt.ch]);
      } else if (evt.type === 128) {
        const key = evt.ch << 8 | evt.a;
        const entry = active.get(key) || [evt.a + transpose & 127, evt.ch];
        out.send([128 | entry[1], entry[0], 0]);
        active.delete(key);
      } else if (evt.type === 176) {
        out.send([176 | evt.ch, evt.a, evt.b]);
      } else if (evt.type === 192) {
        out.send([192 | evt.ch, evt.a]);
      } else if (evt.type === 224) {
        out.send([224 | evt.ch, evt.a, evt.b]);
      }
    }
    function allNotesOff() {
      const out = currentOut();
      if (!out) return;
      active.forEach(([note, ch]) => {
        out.send([128 | ch, note, 0]);
      });
      active.clear();
      for (let ch = 0; ch < 16; ch++) {
        out.send([176 | ch, 64, 0]);
        out.send([176 | ch, 123, 0]);
        out.send([176 | ch, 120, 0]);
      }
    }
    function seek(seconds) {
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      allNotesOff();
      startPos = Math.max(0, Math.min(seconds, duration()));
      cursor = events.findIndex((e) => e.time >= startPos);
      if (cursor < 0) cursor = events.length;
    }
    function duration() {
      return events.length ? events[events.length - 1].time : 0;
    }
    function setTempoMul(f) {
      tempoMul = Math.max(0.25, Math.min(4, f || 1));
    }
    function setTranspose(semi) {
      transpose = Math.max(-36, Math.min(36, semi | 0));
    }
    function _tick() {
      if (!playing) {
        return;
      }
      const t = (timeNow() - startT) * tempoMul + startPos;
      while (cursor < events.length && events[cursor].time <= t) {
        send(events[cursor++]);
      }
      if (cursor >= events.length) {
        playing = false;
        allNotesOff();
        return;
      }
      rafId = requestAnimationFrame(_tick);
    }
    function play() {
      if (playing) return;
      playing = true;
      startT = timeNow();
      rafId = requestAnimationFrame(_tick);
    }
    function pause() {
      if (!playing) return;
      const t = (timeNow() - startT) * tempoMul + startPos;
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      startPos = t;
      allNotesOff();
    }
    function stop() {
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      startPos = 0;
      cursor = 0;
      allNotesOff();
    }
    function loadBuffer(buf) {
      const smf = parseSMF(buf);
      events = buildEventList(smf);
      startPos = 0;
      cursor = 0;
      return { duration: duration() };
    }
    return { play, pause, stop, seek, setTempoMul, setTranspose, loadBuffer, duration, isPlaying: () => playing, currentTime: () => playing ? (performance.now() / 1e3 - startT) * tempoMul + startPos : startPos };
  }
  function mountPlayerUI() {
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      left: "12px",
      top: "12px",
      zIndex: 999999,
      background: "rgba(17,17,17,.95)",
      color: "#eee",
      padding: "10px",
      borderRadius: "10px",
      fontFamily: "system-ui",
      minWidth: "420px",
      maxWidth: "520px",
      boxShadow: "0 10px 30px rgba(0,0,0,.6)"
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
      <span id="tempoVal" class="mo-chip">1.00\xD7</span>
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
    function fmt(t) {
      t = Math.max(0, t | 0);
      const m = Math.floor(t / 60), s = t % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    }
    function setStatus(t, ok) {
      status.textContent = t;
      status.style.background = ok ? "#264a2f" : "#444";
    }
    function startUiTick() {
      if (uiTickId) cancelAnimationFrame(uiTickId);
      const loop = () => {
        const d = Math.max(0, player.duration());
        const t = Math.max(0, Math.min(d, player.currentTime()));
        curEl.textContent = fmt(Math.round(t));
        durEl.textContent = fmt(Math.round(d));
        if (!seek._dragging) {
          seek.value = String(d ? Math.round(t / d * 1e3) : 0);
        }
        uiTickId = requestAnimationFrame(loop);
      };
      uiTickId = requestAnimationFrame(loop);
    }
    const fileStore = /* @__PURE__ */ new Map();
    box.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      const fl = e.dataTransfer?.files;
      if (!fl || !fl.length) return;
      for (const f of fl) {
        if (!/\.mid(i)?$/i.test(f.name)) continue;
        const fr = new FileReader();
        fr.onload = () => {
          fileStore.set(f.name, fr.result);
          const opt = document.createElement("option");
          opt.value = f.name;
          opt.textContent = f.name;
          files.appendChild(opt);
          setStatus("loaded", true);
        };
        fr.readAsArrayBuffer(f);
      }
    });
    function loadSelected() {
      const name = files.value;
      const buf = fileStore.get(name);
      if (!buf) {
        setStatus("no file", false);
        return;
      }
      try {
        const info = player.loadBuffer(buf);
        duration = player.duration();
        durEl.textContent = fmt(Math.round(duration));
        seek.value = "0";
        setStatus("ready", true);
      } catch (err) {
        console.error(err);
        setStatus("parse error", false);
      }
    }
    files.addEventListener("change", loadSelected);
    playBtn.addEventListener("click", () => {
      if (!fileStore.size) {
        setStatus("drop a file", false);
        return;
      }
      if (!files.value) {
        files.selectedIndex = 0;
        loadSelected();
      }
      player.play();
      setStatus("playing", true);
    });
    pauseBtn.addEventListener("click", () => {
      player.pause();
      setStatus("paused", false);
    });
    stopBtn.addEventListener("click", () => {
      player.stop();
      setStatus("stopped", false);
    });
    seek.addEventListener("input", () => {
      const pos = parseInt(seek.value, 10) / 1e3 * (duration || 0);
      seek.addEventListener("mousedown", () => seek._dragging = true);
      seek.addEventListener("mouseup", () => seek._dragging = false);
      seek.addEventListener("touchstart", () => seek._dragging = true, { passive: true });
      seek.addEventListener("touchend", () => seek._dragging = false, { passive: true });
      player.seek(pos);
      curEl.textContent = fmt(Math.round(pos));
      AppState._lastPlayTime = pos;
    });
    tempo.addEventListener("input", () => {
      const mul = parseInt(tempo.value, 10) / 100;
      player.setTempoMul(mul);
      tempoVal.textContent = mul.toFixed(2) + "\xD7";
    });
    trans.addEventListener("input", () => {
      const semi = parseInt(trans.value, 10) | 0;
      player.setTranspose(semi);
      transVal.textContent = String(semi);
    });
    startUiTick();
    return { box };
  }

  // mnt/data/color_work/src/ui_reactive_color.js
  var PREF_ENDPOINT = "/api/mpo/users/@me/preferences";
  var TD2 = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  var variants = {
    spectral: [350, 18, 42, 58, 85, 145, 190, 225, 265, 300],
    fire: [350, 5, 18, 32, 46, 55, 28, 8],
    sunset: [330, 345, 3, 18, 35, 52, 300, 275],
    candy: [330, 305, 280, 205, 175, 145, 55, 25],
    arcade: [0, 38, 58, 118, 178, 205, 258, 300],
    magma: [345, 358, 12, 25, 38, 52, 18, 330],
    aurora: [285, 245, 205, 175, 145, 95, 55, 315],
    royal: [265, 245, 220, 195, 175, 48, 30, 320],
    cyber: [195, 285, 315, 170, 220, 300, 45, 10],
    chaos: [330, 35, 210, 115, 285, 55, 175, 5],
    monoPink: [315, 320, 325, 330, 335, 305, 295, 345]
  };
  var PRESETS = {
    vivid: {
      label: "Note \u2192 Spectrum",
      desc: "Chaque note/pitch-class choisit une couleur. Palette compl\xE8te avec rouges/jaunes.",
      patch: { variant: "spectral", mode: "note", sendEveryMs: 420, minAlpha: 85, maxAlpha: 255, usePitch: true, useVelocity: true, useDensity: false, useChordSize: true, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: false, smoothColor: false, jitter: false, hueShift: 0, satBoost: 1.55, lightBoost: 1.22, smoothing: 0.55 }
    },
    warm: {
      label: "Grave/aigu \u2192 Fire",
      desc: "La hauteur pilote la couleur : graves rouges, aigus jaune/orange.",
      patch: { variant: "fire", mode: "pitch", sendEveryMs: 450, minAlpha: 95, maxAlpha: 255, usePitch: true, useVelocity: true, useDensity: false, useChordSize: true, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: false, smoothColor: true, jitter: false, hueShift: 0, satBoost: 1.7, lightBoost: 1.25, smoothing: 0.32 }
    },
    rainbow: {
      label: "Note \u2192 Rainbow",
      desc: "Chaque note saute dans une palette tr\xE8s contrast\xE9e.",
      patch: { variant: "arcade", mode: "note", sendEveryMs: 400, minAlpha: 80, maxAlpha: 255, usePitch: true, useVelocity: true, useDensity: false, useChordSize: true, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: true, smoothColor: false, jitter: false, hueShift: 0, satBoost: 1.65, lightBoost: 1.2, smoothing: 1 }
    },
    performance: {
      label: "Stable performance",
      desc: "Couleur stable par accord, moins de requ\xEAtes, moins de calcul.",
      patch: { variant: "chaos", mode: "chord", sendEveryMs: 500, minAlpha: 70, maxAlpha: 245, usePitch: true, useVelocity: true, useDensity: false, useChordSize: true, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: false, smoothColor: true, jitter: false, hueShift: 0, satBoost: 1.35, lightBoost: 1.15, smoothing: 0.45 }
    },
    soft: {
      label: "Grave/aigu \u2192 Pastel",
      desc: "La hauteur pilote une palette douce.",
      patch: { variant: "candy", mode: "pitch", sendEveryMs: 750, minAlpha: 45, maxAlpha: 170, usePitch: true, useVelocity: true, useDensity: false, useChordSize: false, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: false, smoothColor: true, jitter: false, hueShift: 0, satBoost: 0.85, lightBoost: 1, smoothing: 0.2 }
    },
    bassRedHighGold: {
      label: "Grave rouge \u2192 aigu or",
      desc: "La hauteur pilote une palette chaude : rouge vers or.",
      patch: { variant: "magma", mode: "pitch", sendEveryMs: 430, minAlpha: 80, maxAlpha: 255, usePitch: true, useVelocity: true, useDensity: false, useChordSize: true, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: false, smoothColor: true, jitter: false, hueShift: 0, satBoost: 1.65, lightBoost: 1.22, smoothing: 0.28 }
    },
    velocityHeat: {
      label: "V\xE9locit\xE9 \u2192 Heat",
      desc: "La v\xE9locit\xE9/intensit\xE9 pilote la couleur : faible froid, fort chaud.",
      patch: { variant: "spectral", mode: "velocity", sendEveryMs: 380, minAlpha: 55, maxAlpha: 255, usePitch: false, useVelocity: true, useDensity: true, useChordSize: false, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: false, smoothColor: true, jitter: false, hueShift: 0, satBoost: 1.6, lightBoost: 1.3, smoothing: 0.35 }
    },
    chaos: {
      label: "Dissonance \u2192 Chaos",
      desc: "La tension/dissonance pilote une palette flashy.",
      patch: { variant: "cyber", mode: "tension", sendEveryMs: 450, minAlpha: 100, maxAlpha: 255, usePitch: true, useVelocity: true, useDensity: true, useChordSize: true, useAlpha: true, useHexColor: true, invertPitch: false, randomizePalette: true, smoothColor: false, jitter: true, hueShift: 0, satBoost: 1.8, lightBoost: 1.38, smoothing: 1 }
    }
  };
  var C = {
    enabled: false,
    preset: "vivid",
    variant: "spectral",
    mode: "note",
    sendEveryMs: 420,
    minAlpha: 85,
    maxAlpha: 255,
    usePitch: true,
    useVelocity: true,
    useDensity: false,
    useChordSize: true,
    useAlpha: true,
    useHexColor: true,
    invertPitch: false,
    randomizePalette: false,
    smoothColor: false,
    jitter: false,
    hueShift: 0,
    satBoost: 1.55,
    lightBoost: 1.22,
    smoothing: 0.55,
    minNote: 21,
    maxNote: 108,
    decayMs: 1600
  };
  var S = {
    hooked: false,
    originalSend: null,
    notes: [],
    active: /* @__PURE__ */ new Map(),
    lastNote: 60,
    lastVelocity: 0.7,
    intensity: 0,
    density: 0,
    lastSend: 0,
    sending: false,
    lastColor: "#ff3366dd",
    smoothRgb: null,
    smoothAlpha: null,
    panel: null,
    status: null,
    preview: null,
    presetDesc: null,
    expertBody: null
  };
  function setReactiveGlobalFlag() {
    try {
      window.__MO_REACTIVE_COLOR_ENABLED__ = !!C.enabled;
    } catch {
    }
  }
  var now2 = () => performance.now();
  var hex = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  var avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  var lerp = (a, b, t) => a + (b - a) * t;
  function hslToRgb(h, s, l) {
    h = (h % 360 + 360) % 360 / 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;
    const hue2rgb = (p2, q2, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
      if (t < 1 / 2) return q2;
      if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
      return p2;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
  }
  function shortestHueLerp(a, b, t) {
    let d = (b - a + 540) % 360 - 180;
    return a + d * t;
  }
  function hashText(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function chordSignature(chord) {
    return [...new Set(chord.map((n) => (Math.round(n.note) % 12 + 12) % 12))].sort((a, b) => a - b).join("-");
  }
  function tension(chord) {
    const pcs = [...new Set(chord.map((n) => (Math.round(n.note) % 12 + 12) % 12))];
    let t = 0;
    for (let i = 0; i < pcs.length; i++) for (let j = i + 1; j < pcs.length; j++) {
      const d = Math.abs(pcs[i] - pcs[j]), iv = Math.min(d, 12 - d);
      if ([1, 2, 6].includes(iv)) t += 0.22;
      if ([3, 4, 8, 9].includes(iv)) t += 0.08;
      if ([5, 7].includes(iv)) t += 0.03;
    }
    return clamp(t, 0, 1);
  }
  function computeIntensity() {
    const t = now2();
    S.notes = S.notes.filter((e) => t - e.t < C.decayMs);
    const recent = S.notes.filter((e) => t - e.t < 1e3);
    const rate = clamp(recent.length / 28, 0, 1);
    const av = recent.length ? avg(recent.map((e) => e.velocity)) : 0;
    const size = clamp(S.active.size / 10, 0, 1);
    S.density = rate;
    let intensity = 0.18;
    if (C.useVelocity) intensity += av * 0.34;
    if (C.useDensity) intensity += rate * 0.28;
    if (C.useChordSize) intensity += size * 0.25;
    S.intensity = clamp(intensity, 0, 1);
  }
  function getChord(fallback) {
    const active = [...S.active.values()];
    if (active.length) return active.map((x) => ({ note: x.note, velocity: x.velocity }));
    if (fallback?.length) return fallback;
    return [{ note: S.lastNote, velocity: S.lastVelocity }];
  }
  function paletteHue(pal, pos) {
    const f = clamp(pos, 0, 1) * (pal.length - 1);
    const i = Math.floor(f);
    const r = f - i;
    return shortestHueLerp(pal[i], pal[Math.min(i + 1, pal.length - 1)], r);
  }
  function notePaletteHue(pal, note, chordHash) {
    const pc = (Math.round(note) % 12 + 12) % 12;
    const octaveBand = Math.floor(Math.max(0, Math.round(note) - C.minNote) / 12);
    return pal[(pc + octaveBand * 2 + chordHash % 3) % pal.length];
  }
  function makeColor(chord) {
    computeIntensity();
    const pal = variants[C.variant] || variants.spectral;
    const notes = chord.map((x) => x.note);
    const vels = chord.map((x) => x.velocity ?? 0.7);
    const avNote = avg(notes), avVel = avg(vels), maxNote = Math.max(...notes), minNote = Math.min(...notes);
    let pitch = clamp((avNote - C.minNote) / (C.maxNote - C.minNote), 0, 1);
    if (C.invertPitch) pitch = 1 - pitch;
    const size = clamp(chord.length / 8, 0, 1), spread = clamp((maxNote - minNote) / 36, 0, 1), ten = tension(chord);
    const sig = chordSignature(chord), hash = hashText(sig + ":" + C.variant + ":" + Math.round(avNote));
    let hue;
    if (C.mode === "note") {
      const noteForColor = chord.length > 1 ? Math.round(avg([...new Set(notes.map((n) => Math.round(n)))])) : avNote;
      hue = notePaletteHue(pal, noteForColor, hash);
    } else if (C.mode === "warm") {
      hue = paletteHue(variants.fire, pitch);
    } else if (C.randomizePalette || !C.usePitch) {
      hue = pal[hash % pal.length];
    } else {
      hue = paletteHue(pal, pitch);
    }
    if (C.mode === "velocity") hue = shortestHueLerp(265, 35, avVel);
    if (C.mode === "density") hue = shortestHueLerp(270, 18, S.density);
    if (C.mode === "tension") hue = shortestHueLerp(48, 335, ten);
    if (C.mode === "spread") hue = shortestHueLerp(355, 55, spread);
    if (C.mode === "chord") hue += (hash % 160 - 80) * 0.55;
    if (C.useVelocity) hue += (avVel - 0.5) * 32;
    if (C.useChordSize) hue += size * 20;
    if (C.useDensity) hue += S.density * 18;
    if (C.jitter) hue += (Math.random() * 2 - 1) * 24;
    hue += C.hueShift;
    let sat = (74 + avVel * 20 + ten * 18 + spread * 10) * C.satBoost;
    let light = (34 + S.intensity * 30 + avVel * 12 + size * 6) * C.lightBoost;
    if (chord.length >= 4) {
      sat += 8;
      light += 7;
    }
    let [r, g, b] = hslToRgb(hue, sat, light);
    let alpha = C.maxAlpha;
    if (C.useAlpha) {
      const p = clamp(0.22 + (C.useVelocity ? avVel * 0.36 : 0) + (C.useDensity ? S.density * 0.22 : 0) + (C.useChordSize ? size * 0.2 : 0), 0, 1);
      alpha = lerp(C.minAlpha, C.maxAlpha, p * p * (3 - 2 * p));
    }
    if (C.smoothColor) {
      if (!S.smoothRgb) S.smoothRgb = [r, g, b];
      if (S.smoothAlpha == null) S.smoothAlpha = alpha;
      const sm = clamp(C.smoothing, 0.01, 1);
      S.smoothRgb = [lerp(S.smoothRgb[0], r, sm), lerp(S.smoothRgb[1], g, sm), lerp(S.smoothRgb[2], b, sm)];
      S.smoothAlpha = lerp(S.smoothAlpha, alpha, sm);
      [r, g, b] = S.smoothRgb;
      alpha = S.smoothAlpha;
    }
    if (!C.useHexColor) return `#c41db9${hex(alpha)}`;
    return `#${hex(r)}${hex(g)}${hex(b)}${hex(alpha)}`;
  }
  async function sendPreference(color) {
    if (S.sending) return;
    S.sending = true;
    try {
      const res = await fetch(PREF_ENDPOINT, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colors: [color] })
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      S.lastColor = color;
      updateUI("sent " + color);
    } catch (e) {
      updateUI("error " + e.message);
      console.warn("[MO Reactive Color]", e);
    } finally {
      S.sending = false;
    }
  }
  function recordNote(note, velocity = 0.7, source = "ws") {
    note = Number(note);
    velocity = Number(velocity);
    if (!Number.isFinite(note)) return;
    if (!Number.isFinite(velocity)) velocity = 0.7;
    if (velocity > 1) velocity /= 127;
    note = clamp(note, 0, 127);
    velocity = clamp(velocity, 0.02, 1);
    const t = now2();
    S.lastNote = note;
    S.lastVelocity = velocity;
    S.active.set(note, { note, velocity, t });
    S.notes.push({ t, note, velocity, source });
    computeIntensity();
    maybeSend([{ note, velocity }]);
  }
  function recordOff(note) {
    S.active.delete(Number(note));
  }
  function maybeSend(chord) {
    if (!C.enabled) return;
    const t = now2();
    if (t - S.lastSend < C.sendEveryMs) return;
    S.lastSend = t;
    const c = getChord(chord);
    const color = makeColor(c);
    sendPreference(color);
  }
  function normalizeEvent(e) {
    if (!e) return null;
    if (Array.isArray(e)) {
      const st2 = Number(e[0]), note2 = Number(e[1]), vel = Number(e[2] ?? 0);
      if (!Number.isFinite(st2) || !Number.isFinite(note2)) return null;
      if ((st2 & 240) === 144 && vel > 0) return { type: "on", note: note2, velocity: vel / 127 };
      if ((st2 & 240) === 128 || (st2 & 240) === 144 && vel === 0) return { type: "off", note: note2 };
      return null;
    }
    if (typeof e !== "object") return null;
    const name = String(e.name ?? e.type ?? e.event ?? e.evt ?? e.kind ?? "").toUpperCase();
    const note = e.note ?? e.n ?? e.k ?? e.key ?? e.midi ?? e.pitch ?? e.noteNumber;
    const velocity = e.velocity ?? e.vel ?? e.v ?? e.value ?? e.force ?? 127;
    const on = name === "NOTE_ON" || name === "ON" || name.includes("NOTEON") || name.includes("PRESS") || e.on === true || e.down === true;
    const off = name === "NOTE_OFF" || name === "OFF" || name.includes("NOTEOFF") || name.includes("RELEASE") || e.off === true || e.up === true;
    if (on && note != null) return { type: "on", note: Number(note), velocity: Number(velocity) };
    if (off && note != null) return { type: "off", note: Number(note) };
    return null;
  }
  function scanObj(x, found = [], depth = 0) {
    if (!x || depth > 8) return found;
    const ev = normalizeEvent(x);
    if (ev) {
      found.push(ev);
      return found;
    }
    if (Array.isArray(x)) {
      for (const it of x) scanObj(it, found, depth + 1);
      return found;
    }
    if (typeof x === "object") for (const k of Object.keys(x)) {
      const v = x[k];
      if (v && typeof v === "object") scanObj(v, found, depth + 1);
    }
    return found;
  }
  function extractFrames(str) {
    const out = [];
    let i = 0;
    while (i < str.length) {
      const start = str.indexOf("[", i);
      if (start < 0) break;
      let d = 0, end = -1, qs = false, esc = false;
      for (let j = start; j < str.length; j++) {
        const c = str[j];
        if (qs) {
          if (esc) esc = false;
          else if (c === "\\") esc = true;
          else if (c === '"') qs = false;
          continue;
        }
        if (c === '"') qs = true;
        else if (c === "[") d++;
        else if (c === "]") {
          d--;
          if (d === 0) {
            end = j + 1;
            break;
          }
        }
      }
      if (end < 0) break;
      try {
        out.push(JSON.parse(str.slice(start, end)));
      } catch {
      }
      i = end;
    }
    return out;
  }
  function handleOutgoing(data) {
    try {
      let str = null;
      if (typeof data === "string") str = data;
      else if (data instanceof ArrayBuffer && TD2) str = TD2.decode(new Uint8Array(data));
      else if (ArrayBuffer.isView(data) && TD2) str = TD2.decode(new Uint8Array(data.buffer));
      if (!str) return;
      let found = [];
      for (const fr of extractFrames(str)) scanObj(fr, found, 0);
      if (!found.length) {
        try {
          scanObj(JSON.parse(str), found, 0);
        } catch {
        }
      }
      if (!found.length) return;
      const ons = [];
      for (const ev of found) {
        if (ev.type === "on") {
          recordNote(ev.note, ev.velocity, "ws-out");
          ons.push({ note: ev.note, velocity: ev.velocity });
        } else if (ev.type === "off") recordOff(ev.note);
      }
      if (ons.length > 1) maybeSend(ons);
    } catch (e) {
    }
  }
  function hookSend() {
    if (S.hooked) return;
    const RealWS = window.WebSocket;
    if (!RealWS?.prototype?.send) return;
    S.originalSend = RealWS.prototype.send;
    RealWS.prototype.send = function(data) {
      handleOutgoing(data);
      return S.originalSend.apply(this, arguments);
    };
    S.hooked = true;
  }
  function updateUI(msg) {
    if (S.preview) {
      S.preview.style.background = S.lastColor;
      S.preview.style.boxShadow = `0 0 ${12 + S.intensity * 40}px ${S.lastColor}`;
    }
    if (S.status) S.status.textContent = msg || `${C.enabled ? "ON" : "OFF"} \u2022 ${C.preset} \u2022 ${S.lastColor}`;
    if (S.presetDesc) {
      const p = PRESETS[C.preset];
      S.presetDesc.textContent = p ? p.desc : "Custom expert settings.";
    }
  }
  function bindRange(box, id, key, fmt = (v) => v) {
    const el = box.querySelector("#" + id), val = box.querySelector("#" + id + "Val");
    if (!el) return;
    el.value = C[key];
    if (val) val.textContent = fmt(C[key]);
    el.oninput = () => {
      C[key] = Number(el.value);
      C.preset = "custom";
      if (val) val.textContent = fmt(C[key]);
      updateUI();
    };
  }
  function bindCheck(box, id, key) {
    const el = box.querySelector("#" + id);
    if (!el) return;
    el.checked = !!C[key];
    el.onchange = () => {
      C[key] = el.checked;
      C.preset = "custom";
      if (key === "smoothColor") {
        S.smoothRgb = null;
        S.smoothAlpha = null;
      }
      updateUI();
    };
  }
  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    Object.assign(C, preset.patch, { preset: name });
    S.smoothRgb = null;
    S.smoothAlpha = null;
  }
  function mountReactiveColorUI() {
    hookSend();
    if (document.getElementById("mo-reactive-color")) return;
    const box = document.createElement("div");
    box.id = "mo-reactive-color";
    Object.assign(box.style, { position: "fixed", right: "12px", bottom: "72px", zIndex: 999999, width: "500px", maxWidth: "calc(100vw - 24px)", maxHeight: "74vh", overflow: "hidden", resize: "both", background: "rgba(17,17,17,.95)", color: "#eee", padding: "10px", borderRadius: "10px", fontFamily: "system-ui", boxShadow: "0 10px 30px rgba(0,0,0,.6)" });
    box.innerHTML = `
    <style>
      .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;user-select:none;cursor:pointer}.mo-btn:hover{background:#353535}.mo-btn.active{background:#2f8f55}.mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}.mo-rc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 8px}.mo-rc-grid label{font-size:12px}.mo-rc-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mo-rc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mo-rc-small{font-size:12px;opacity:.72}.mo-preset{font-size:12px;padding:7px 8px;text-align:left;line-height:1.15;min-height:34px}.mo-preset.active{background:#8a2f68;border-color:#d35aae}.mo-rc-preset-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:6px}.mo-rc-palette{display:flex;gap:3px;margin-top:6px}.mo-rc-swatch{height:16px;flex:1;border-radius:4px}
      #mo-rc-body{max-height:calc(74vh - 45px);overflow:auto;padding-right:6px} #mo-rc-body label{display:block;margin-top:6px;margin-bottom:2px} #mo-rc-preview{height:28px;border-radius:8px;background:#ff3366dd;box-shadow:0 0 16px #ff3366dd;margin-top:8px} #mo-rc-expert{display:none;margin-top:8px;border-top:1px solid #333;padding-top:8px} #mo-rc-expert.open{display:block}
    </style>
    <div id="mo-rc-hdr" style="display:flex;gap:8px;align-items:center;cursor:move;user-select:none"><strong>Reactive Note Color</strong><span id="mo-rc-status" class="mo-chip" style="margin-left:auto">OFF</span></div>
    <div id="mo-rc-body" class="__body">
      <div class="mo-rc-row" style="margin-top:8px"><button id="mo-rc-toggle" class="mo-btn">OFF</button><button id="mo-rc-expert-toggle" class="mo-btn">Expert \u25BE</button></div>
      <div class="mo-rc-small" style="margin-top:8px">Preset \u2014 ce qui pilote la couleur</div>
      <div class="mo-rc-preset-grid">${Object.entries(PRESETS).map(([k, p]) => `<button data-preset="${k}" class="mo-btn mo-preset" title="${p.desc.replace(/"/g, "&quot;")}">${p.label}</button>`).join("")}</div>
      <div id="mo-rc-palette" class="mo-rc-palette"></div>
      <div id="mo-rc-preview"></div>
      <div id="mo-rc-expert">
        <div class="mo-rc-two"><div><label>Variant</label><select id="mo-rc-variant" class="mo-btn" style="width:100%">${Object.keys(variants).map((v) => `<option value="${v}">${v}</option>`).join("")}</select></div><div><label>Mode</label><select id="mo-rc-mode" class="mo-btn" style="width:100%"><option value="note">Note jou\xE9e / pitch class</option><option value="chord">Accord / identit\xE9 harmonique</option><option value="pitch">Hauteur moyenne grave \u2192 aigu</option><option value="warm">Hauteur chaude rouge \u2192 or</option><option value="velocity">V\xE9locit\xE9 / intensit\xE9</option><option value="density">Densit\xE9 de notes</option><option value="tension">Dissonance / tension</option><option value="spread">\xC9cart grave-aigu</option></select></div></div>
        <div class="mo-rc-grid" style="margin-top:8px"><label><input id="usePitch" type="checkbox"> pitch</label><label><input id="invertPitch" type="checkbox"> inverser pitch</label><label><input id="useVelocity" type="checkbox"> v\xE9locit\xE9</label><label><input id="useDensity" type="checkbox"> densit\xE9</label><label><input id="useChordSize" type="checkbox"> taille accord</label><label><input id="useAlpha" type="checkbox"> alpha auto</label><label><input id="useHexColor" type="checkbox"> couleur</label><label><input id="randomizePalette" type="checkbox"> palette hash</label><label><input id="jitter" type="checkbox"> variation</label><label><input id="smoothColor" type="checkbox"> lissage</label></div>
        <label>Update server</label><input id="sendEveryMs" type="range" min="250" max="1500" step="10"><div class="mo-rc-small"><span id="sendEveryMsVal"></span> ms</div>
        <label>Alpha min / max</label><div class="mo-rc-two"><input id="minAlpha" type="range" min="0" max="255" step="1"><input id="maxAlpha" type="range" min="0" max="255" step="1"></div><div class="mo-rc-small">min <span id="minAlphaVal"></span> \u2022 max <span id="maxAlphaVal"></span></div>
        <label>Hue shift</label><input id="hueShift" type="range" min="-180" max="180" step="1"><div class="mo-rc-small"><span id="hueShiftVal"></span>\xB0</div>
        <div class="mo-rc-two"><div><label>Saturation</label><input id="satBoost" type="range" min="0.3" max="2" step="0.01"><div class="mo-rc-small"><span id="satBoostVal"></span>x</div></div><div><label>Light</label><input id="lightBoost" type="range" min="0.3" max="2" step="0.01"><div class="mo-rc-small"><span id="lightBoostVal"></span>x</div></div></div>
        <label>Smoothing</label><input id="smoothing" type="range" min="0.01" max="1" step="0.01"><div class="mo-rc-small"><span id="smoothingVal"></span></div>
      </div>
    </div>`;
    document.body.appendChild(box);
    const hdr = box.querySelector("#mo-rc-hdr");
    addMinimizer(box, hdr, "reactive-color");
    makeDraggable(box, hdr);
    S.panel = box;
    S.status = box.querySelector("#mo-rc-status");
    S.preview = box.querySelector("#mo-rc-preview");
    S.presetDesc = box.querySelector("#mo-rc-preset-desc");
    S.expertBody = box.querySelector("#mo-rc-expert");
    box.querySelector("#mo-rc-toggle").onclick = () => {
      C.enabled = !C.enabled;
      setReactiveGlobalFlag();
      sync();
      updateUI();
    };
    box.querySelector("#mo-rc-expert-toggle").onclick = () => {
      S.expertBody.classList.toggle("open");
      box.querySelector("#mo-rc-expert-toggle").textContent = S.expertBody.classList.contains("open") ? "Expert \u25B4" : "Expert \u25BE";
    };
    box.querySelectorAll("[data-preset]").forEach((b) => b.onclick = () => {
      applyPreset(b.dataset.preset);
      sync();
      updateUI("preset " + PRESETS[b.dataset.preset].label);
    });
    box.querySelector("#mo-rc-variant").onchange = (e) => {
      C.variant = e.target.value;
      C.preset = "custom";
      syncPalette();
      updateUI();
    };
    box.querySelector("#mo-rc-mode").onchange = (e) => {
      C.mode = e.target.value;
      C.preset = "custom";
      updateUI();
    };
    ["usePitch", "invertPitch", "useVelocity", "useDensity", "useChordSize", "useAlpha", "useHexColor", "randomizePalette", "jitter", "smoothColor"].forEach((k) => bindCheck(box, k, k));
    ["sendEveryMs", "minAlpha", "maxAlpha", "hueShift", "satBoost", "lightBoost", "smoothing"].forEach((k) => bindRange(box, k, k, (v) => String(v)));
    function syncPalette() {
      const el = box.querySelector("#mo-rc-palette");
      if (!el) return;
      const pal = variants[C.variant] || variants.spectral;
      el.innerHTML = pal.map((h) => {
        const [r, g, b] = hslToRgb(h, 90, 55);
        return `<span class="mo-rc-swatch" style="background:#${hex(r)}${hex(g)}${hex(b)}"></span>`;
      }).join("");
    }
    function sync() {
      box.querySelector("#mo-rc-toggle").textContent = C.enabled ? "ON" : "OFF";
      box.querySelector("#mo-rc-toggle").classList.toggle("active", C.enabled);
      box.querySelector("#mo-rc-variant").value = C.variant;
      box.querySelector("#mo-rc-mode").value = C.mode;
      box.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b.dataset.preset === C.preset));
      ["usePitch", "invertPitch", "useVelocity", "useDensity", "useChordSize", "useAlpha", "useHexColor", "randomizePalette", "jitter", "smoothColor"].forEach((k) => {
        const el = box.querySelector("#" + k);
        if (el) el.checked = !!C[k];
      });
      ["sendEveryMs", "minAlpha", "maxAlpha", "hueShift", "satBoost", "lightBoost", "smoothing"].forEach((k) => {
        const el = box.querySelector("#" + k), val = box.querySelector("#" + k + "Val");
        if (el) el.value = C[k];
        if (val) val.textContent = String(C[k]);
      });
      syncPalette();
    }
    sync();
    setReactiveGlobalFlag();
    updateUI();
    return { box };
  }

  // mnt/data/color_work/src/ui_dock.js
  function setVisible(item, visible) {
    if (!item || !item.box) return;
    item.box.style.display = visible ? "" : "none";
    item.button?.classList.toggle("mo-dock-active", visible);
    try {
      localStorage.setItem("mo:panel:" + item.id, visible ? "1" : "0");
    } catch (e) {
    }
  }
  function isVisible(item) {
    return item?.box && item.box.style.display !== "none";
  }
  function defaultPosition(box, item, index) {
    if (!box || box.dataset.moDockPositioned === "1") return;
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
  function mountToolsDock(items) {
    if (document.getElementById("mo-tools-dock")) return;
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
    <button id="moDockAllOff" title="Close all panels">\xD7</button>
    <button id="moDockCompact" title="Compact dock">\u25A6</button>
  `;
    document.body.appendChild(dock);
    const buttons = dock.querySelector("#moDockButtons");
    const normalized = items.filter((x) => x && x.box);
    normalized.forEach((item, index) => {
      defaultPosition(item.box, item, index);
      const btn = document.createElement("button");
      btn.innerHTML = `<span>${item.icon || "\u25A3"}</span> <span class="mo-dock-label">${item.label}</span>`;
      btn.title = item.label;
      buttons.appendChild(btn);
      item.button = btn;
      let open = false;
      try {
        open = localStorage.getItem("mo:panel:" + item.id) === "1";
      } catch (e) {
      }
      if (item.defaultOpen && localStorage.getItem("mo:panel:" + item.id) == null) open = true;
      setVisible(item, open);
      btn.addEventListener("click", () => {
        setVisible(item, !isVisible(item));
      });
    });
    dock.querySelector("#moDockAllOff").onclick = () => {
      normalized.forEach((item) => setVisible(item, false));
    };
    dock.querySelector("#moDockCompact").onclick = () => {
      dock.classList.toggle("mo-dock-compact");
      try {
        localStorage.setItem("mo:dock:compact", dock.classList.contains("mo-dock-compact") ? "1" : "0");
      } catch (e) {
      }
    };
    try {
      if (localStorage.getItem("mo:dock:compact") === "1") dock.classList.add("mo-dock-compact");
    } catch (e) {
    }
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const handle = dock.querySelector("#moDockDrag");
    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = dock.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      dock.style.left = Math.max(8, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + "px";
      dock.style.top = Math.max(8, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + "px";
      dock.style.right = "auto";
      dock.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => dragging = false);
    return { dock, items: normalized };
  }

  // mnt/data/color_work/src/main.js
  var outBox = document.createElement("div");
  Object.assign(outBox.style, {
    position: "fixed",
    left: "12px",
    bottom: "12px",
    zIndex: 999999,
    background: "rgba(17,17,17,.95)",
    color: "#eee",
    padding: "10px",
    borderRadius: "10px",
    fontFamily: "system-ui",
    minWidth: "320px",
    boxShadow: "0 10px 30px rgba(0,0,0,.6)"
  });
  outBox.innerHTML = `
  <style>
    .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px}
    .mo-btn:hover{background:#353535}
    .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}
  </style>
  <div id="hdr" style="display:flex;align-items:center;gap:8px;cursor:move">
    <strong>MIDI Output</strong>
    <span id="st" class="mo-chip" style="margin-left:auto;background:#444">idle</span>
  </div>
  <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
    <button id="req" class="mo-btn">Request MIDI</button>
    <button id="rescan" class="mo-btn">Rescan</button>
    <select id="sel" style="flex:1;min-width:160px;background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px"></select>
    <button id="test" class="mo-btn">Test</button>
  </div>
`;
  document.body.appendChild(outBox);
  var __hdr = outBox.querySelector("#hdr") || outBox.firstElementChild;
  addMinimizer(outBox, __hdr, "midi-out");
  makeDraggable(outBox, __hdr);
  var st = outBox.querySelector("#st");
  var req = outBox.querySelector("#req");
  var rescan = outBox.querySelector("#rescan");
  var sel = outBox.querySelector("#sel");
  var test = outBox.querySelector("#test");
  function setOutStatus(t, ok) {
    st.textContent = t;
    st.style.background = ok ? "#264a2f" : "#742626";
  }
  function fillOutputs() {
    sel.innerHTML = "";
    const arr = listOutputs();
    if (arr.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no MIDI outputs)";
      sel.appendChild(opt);
      sel.disabled = true;
      test.disabled = true;
      return;
    }
    sel.disabled = false;
    arr.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = midiName(o);
      sel.appendChild(opt);
    });
    const pick = arr[0];
    sel.value = pick.id;
    setOutputById(pick.id);
    test.disabled = false;
    setOutStatus("\u2192 " + midiName(pick), true);
  }
  req.onclick = () => {
    requestMIDI(fillOutputs).then(() => {
      setOutStatus("ready", true);
      fillOutputs();
    }).catch(() => setOutStatus("WebMIDI unsupported", false));
  };
  rescan.onclick = fillOutputs;
  sel.onchange = () => {
    setOutputById(sel.value);
    const label = sel.options[sel.selectedIndex]?.textContent || "(none)";
    setOutStatus("\u2192 " + label, true);
  };
  test.onclick = async () => {
    try {
      const out = AppState.midi.out;
      if (!out) {
        setOutStatus("no output", false);
        return;
      }
      await out.open();
      const notes = [60, 64, 67];
      for (let i = 0; i < notes.length; i++) {
        out.send([144, notes[i] & 127, 100]);
        setTimeout(() => out.send([128, notes[i] & 127, 0]), 200 + i * 10);
        await new Promise((r) => setTimeout(r, 180));
      }
      setOutStatus("test ok", true);
    } catch (e) {
      setOutStatus("test failed", false);
      console.warn(e);
    }
  };
  var recorderPanel = null;
  var playerPanel = null;
  var reactivePanel = null;
  var midiOutPanel = { box: outBox };
  try {
    recorderPanel = mountRecorderUI();
  } catch (e) {
    console.warn("recorder-ui failed", e);
  }
  try {
    hookWebSocket();
  } catch (e) {
    console.warn("sniffer failed", e);
  }
  try {
    hookWorkerMessages();
  } catch (e) {
    console.warn("worker sniffer failed", e);
  }
  try {
    playerPanel = mountPlayerUI();
  } catch (e) {
    console.warn("player-ui failed", e);
  }
  try {
    reactivePanel = mountReactiveColorUI();
  } catch (e) {
    console.warn("reactive-color-ui failed", e);
  }
  try {
    mountToolsDock([
      { id: "midi-out", label: "MIDI Out", icon: "\u21E2", box: midiOutPanel?.box },
      { id: "player", label: "Player", icon: "\u25B6", box: playerPanel?.box },
      { id: "recorder", label: "Recorder", icon: "\u25CF", box: recorderPanel?.box },
      { id: "reactive-color", label: "Color", icon: "\u2726", box: reactivePanel?.box }
    ]);
  } catch (e) {
    console.warn("tools-dock failed", e);
  }
})();
