(() => {
  // mnt/data/playlist_work/src/state.js
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

  // mnt/data/playlist_work/src/draggable.js
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

  // mnt/data/playlist_work/src/utils.js
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

  // mnt/data/playlist_work/src/midi.js
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

  // mnt/data/playlist_work/src/sniffer.js
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
    const hex = s.match(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?/);
    if (hex) return "#" + hex[1].toLowerCase();
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

  // mnt/data/playlist_work/src/ui_recorder.js
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

  // mnt/data/playlist_work/src/ui_player.js
  var MIDI_DB_NAME = "mo_midi_library_v1";
  var MIDI_STORE = "files";
  function openMidiDb() {
    return new Promise((resolve, reject) => {
      const req2 = indexedDB.open(MIDI_DB_NAME, 1);
      req2.onupgradeneeded = () => {
        const db = req2.result;
        if (!db.objectStoreNames.contains(MIDI_STORE)) {
          db.createObjectStore(MIDI_STORE, { keyPath: "id" });
        }
      };
      req2.onsuccess = () => resolve(req2.result);
      req2.onerror = () => reject(req2.error);
    });
  }
  async function dbTx(mode, fn) {
    const db = await openMidiDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MIDI_STORE, mode);
      const store = tx.objectStore(MIDI_STORE);
      let result;
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
  }
  async function libraryList() {
    const db = await openMidiDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MIDI_STORE, "readonly");
      const req2 = tx.objectStore(MIDI_STORE).getAll();
      req2.onsuccess = () => resolve((req2.result || []).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
      req2.onerror = () => reject(req2.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function libraryPut(entry) {
    return dbTx("readwrite", (store) => store.put(entry));
  }
  async function libraryDelete(id) {
    return dbTx("readwrite", (store) => store.delete(id));
  }
  async function libraryGet(id) {
    const db = await openMidiDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MIDI_STORE, "readonly");
      const req2 = tx.objectStore(MIDI_STORE).get(id);
      req2.onsuccess = () => resolve(req2.result || null);
      req2.onerror = () => reject(req2.error);
      tx.oncomplete = () => db.close();
    });
  }
  var MIDI_COLLECTIONS_KEY = "mo_midi_collections_v2";
  var MIDI_PLAYER_PREF_KEY = "mo_midi_player_prefs_v2";
  var ALL_LIBRARY_ID = "__all__";
  function uid(prefix = "lib") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function loadPlayerPrefs() {
    try {
      return JSON.parse(localStorage.getItem(MIDI_PLAYER_PREF_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function savePlayerPrefs(prefs) {
    try {
      localStorage.setItem(MIDI_PLAYER_PREF_KEY, JSON.stringify(prefs || {}));
    } catch {
    }
  }
  function loadCollections() {
    let cols = [];
    try {
      cols = JSON.parse(localStorage.getItem(MIDI_COLLECTIONS_KEY) || "[]") || [];
    } catch {
      cols = [];
    }
    cols = cols.filter((c) => c && c.id && c.id !== ALL_LIBRARY_ID).map((c) => ({
      id: String(c.id),
      name: String(c.name || "Library"),
      fileIds: Array.isArray(c.fileIds) ? [...new Set(c.fileIds.map(String))] : [],
      createdAt: c.createdAt || Date.now(),
      updatedAt: c.updatedAt || c.createdAt || Date.now()
    }));
    return cols;
  }
  function saveCollections(cols) {
    try {
      localStorage.setItem(MIDI_COLLECTIONS_KEY, JSON.stringify(cols || []));
    } catch {
    }
  }
  function collectionLabel(col, count) {
    return `${col.name} (${count})`;
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
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
          const a = dv.getUint8(i++);
          const b = type === 192 || type === 208 ? 0 : dv.getUint8(i++);
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
    for (const tr of smf.tracks) for (const e of tr) events.push(e);
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
    for (const e of mapped) {
      const dt = e.tick - lastTick;
      tSec += dt * (curTempo / 1e6) / div;
      lastTick = e.tick;
      if (e.kind === "tempo") curTempo = e.tempo;
      else out.push({ ...e, time: tSec });
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
    let endedCb = null;
    const active = /* @__PURE__ */ new Map();
    function currentOut() {
      return AppState.midi.out;
    }
    function timeNow() {
      return performance.now() / 1e3;
    }
    function duration() {
      return events.length ? events[events.length - 1].time : 0;
    }
    function currentTime() {
      return playing ? (timeNow() - startT) * tempoMul + startPos : startPos;
    }
    function clampPos(v) {
      return Math.max(0, Math.min(Number(v) || 0, duration()));
    }
    function resetClock(pos = currentTime()) {
      startPos = clampPos(pos);
      startT = timeNow();
    }
    function send(evt) {
      const out = currentOut();
      if (!out) return;
      if (evt.type === 144) {
        const note = Math.max(0, Math.min(127, evt.a + transpose | 0));
        const key = evt.ch << 8 | evt.a;
        if (evt.b > 0) {
          out.send([144 | evt.ch, note, evt.b]);
          active.set(key, [note, evt.ch]);
        } else {
          const entry = active.get(key) || [note, evt.ch];
          out.send([128 | entry[1], entry[0], 0]);
          active.delete(key);
        }
      } else if (evt.type === 128) {
        const key = evt.ch << 8 | evt.a;
        const entry = active.get(key) || [Math.max(0, Math.min(127, evt.a + transpose | 0)), evt.ch];
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
      if (!out) {
        active.clear();
        return;
      }
      active.forEach(([note, ch]) => out.send([128 | ch, note, 0]));
      active.clear();
      for (let ch = 0; ch < 16; ch++) {
        out.send([176 | ch, 64, 0]);
        out.send([176 | ch, 123, 0]);
        out.send([176 | ch, 120, 0]);
      }
    }
    function setCursorFor(pos) {
      cursor = events.findIndex((e) => e.time >= pos);
      if (cursor < 0) cursor = events.length;
    }
    function seek(seconds) {
      const wasPlaying = playing;
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      allNotesOff();
      startPos = clampPos(seconds);
      setCursorFor(startPos);
      if (wasPlaying) play();
    }
    function _tick() {
      if (!playing) return;
      const t = currentTime();
      while (cursor < events.length && events[cursor].time <= t) {
        send(events[cursor++]);
      }
      if (cursor >= events.length) {
        playing = false;
        startPos = duration();
        allNotesOff();
        rafId = null;
        if (typeof endedCb === "function") setTimeout(() => endedCb(), 0);
        return;
      }
      rafId = requestAnimationFrame(_tick);
    }
    function play() {
      if (!events.length) return;
      if (playing) return;
      if (cursor >= events.length || startPos >= duration() - 0.01) {
        startPos = 0;
        cursor = 0;
      }
      playing = true;
      startT = timeNow();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(_tick);
    }
    function pause() {
      if (!playing) return;
      const t = currentTime();
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      startPos = clampPos(t);
      allNotesOff();
    }
    function stop() {
      playing = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      startPos = 0;
      cursor = 0;
      allNotesOff();
    }
    function setTempoMul(f) {
      const pos = currentTime();
      tempoMul = Math.max(0.25, Math.min(4, Number(f) || 1));
      resetClock(pos);
    }
    function setTranspose(semi) {
      transpose = Math.max(-36, Math.min(36, Number(semi) | 0));
      allNotesOff();
    }
    function loadBuffer(buf) {
      stop();
      const smf = parseSMF(buf);
      events = buildEventList(smf);
      startPos = 0;
      cursor = 0;
      return { duration: duration(), events: events.length };
    }
    function setOnEnded(fn) {
      endedCb = fn;
    }
    return { play, pause, stop, seek, setTempoMul, setTranspose, loadBuffer, duration, isPlaying: () => playing, currentTime, setOnEnded };
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
      width: "560px",
      maxWidth: "calc(100vw - 24px)",
      boxShadow: "0 10px 30px rgba(0,0,0,.6)",
      resize: "both",
      overflow: "hidden"
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
      <div class="mo-row" style="margin-top:8px"><label>Tempo</label><input id="tempo" type="range" min="25" max="400" value="100"><span id="tempoVal" class="mo-chip">1.00\xD7</span><label style="margin-left:12px">Transpose</label><input id="transpose" type="range" min="-24" max="24" value="0"><span id="transVal" class="mo-chip">0</span></div>
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
    function fmt(t) {
      t = Math.max(0, Math.floor(t || 0));
      const m = Math.floor(t / 60), s = t % 60;
      return `${m}:${s.toString().padStart(2, "0")}`;
    }
    function setStatus(t, ok) {
      status.textContent = t;
      status.style.background = ok ? "#264a2f" : "#444";
    }
    function refreshButtons() {
      playBtn.classList.toggle("active", player.isPlaying());
      pauseBtn.classList.toggle("active", !player.isPlaying() && duration > 0);
      playlistBox.classList.toggle("playlist-on", playlistActive);
    }
    function prefsPatch(patch) {
      const p = loadPlayerPrefs();
      Object.assign(p, patch);
      savePlayerPrefs(p);
    }
    function getActiveCollection() {
      return activeCollectionId === ALL_LIBRARY_ID ? { id: ALL_LIBRARY_ID, name: "All MIDI", fileIds: library.map((x) => x.id) } : collections.find((c) => c.id === activeCollectionId);
    }
    function getFilteredLibrary() {
      if (activeCollectionId === ALL_LIBRARY_ID) return library.slice();
      const col = collections.find((c) => c.id === activeCollectionId);
      if (!col) return [];
      const allowed = new Set(col.fileIds);
      return library.filter((x) => allowed.has(x.id));
    }
    function updatePlaylistInfo(text) {
      if (text) playlistInfo.textContent = text;
      else playlistInfo.textContent = playlistActive ? `${playlistOrder.value === "random" ? "Random non-repeat" : "In order"} \xB7 ${filteredLibrary.length} track(s)` : "Stopped";
    }
    function startUiTick() {
      if (uiTickId) cancelAnimationFrame(uiTickId);
      const loop = () => {
        const d = Math.max(0, player.duration());
        const t = Math.max(0, Math.min(d, player.currentTime()));
        curEl.textContent = fmt(t);
        durEl.textContent = fmt(d);
        if (!seek._dragging) seek.value = String(d ? Math.round(t / d * 1e3) : 0);
        refreshButtons();
        uiTickId = requestAnimationFrame(loop);
      };
      uiTickId = requestAnimationFrame(loop);
    }
    function fileId(name, size, lastModified) {
      return `${name}::${size}::${lastModified || 0}`;
    }
    async function loadLibrary() {
      try {
        library = await libraryList();
        collections = loadCollections();
        if (activeCollectionId !== ALL_LIBRARY_ID && !collections.some((c) => c.id === activeCollectionId)) activeCollectionId = ALL_LIBRARY_ID;
        collectionSelect.innerHTML = "";
        const allOpt = document.createElement("option");
        allOpt.value = ALL_LIBRARY_ID;
        allOpt.textContent = `All MIDI (${library.length})`;
        collectionSelect.appendChild(allOpt);
        for (const col of collections) {
          const count = col.fileIds.filter((id) => library.some((f) => f.id === id)).length;
          const opt = document.createElement("option");
          opt.value = col.id;
          opt.textContent = collectionLabel(col, count);
          collectionSelect.appendChild(opt);
        }
        collectionSelect.value = activeCollectionId;
        filteredLibrary = getFilteredLibrary();
        files.innerHTML = "";
        for (const item of filteredLibrary) {
          const opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.name;
          opt.title = `${item.name} \u2014 ${Math.round((item.size || 0) / 1024)} KB`;
          files.appendChild(opt);
        }
        if (loadedId && filteredLibrary.some((x) => x.id === loadedId)) files.value = loadedId;
        else if (files.options.length) {
          files.selectedIndex = 0;
        }
        const activeCol = getActiveCollection();
        collectionInfo.textContent = activeCollectionId === ALL_LIBRARY_ID ? "All saved MIDI files" : `${activeCol?.name || "Library"} \xB7 ${filteredLibrary.length} track(s)`;
        removeFromCollectionBtn.disabled = activeCollectionId === ALL_LIBRARY_ID || !files.value;
        deleteCollectionBtn.disabled = activeCollectionId === ALL_LIBRARY_ID;
        renameCollectionBtn.disabled = activeCollectionId === ALL_LIBRARY_ID;
        setStatus(filteredLibrary.length ? "library ready" : "empty library", !!filteredLibrary.length);
        updatePlaylistInfo();
        prefsPatch({ activeCollectionId, lastTrackId: files.value || loadedId || null });
      } catch (e) {
        console.error(e);
        setStatus("library error", false);
      }
    }
    async function addFiles(fileList) {
      for (const f of fileList) {
        if (!/\.mid(i)?$/i.test(f.name)) continue;
        const data = await f.arrayBuffer();
        const id = fileId(f.name, f.size, f.lastModified);
        await libraryPut({ id, name: f.name, size: f.size, addedAt: Date.now(), data });
        loadedId = id;
        if (activeCollectionId !== ALL_LIBRARY_ID) {
          const cols = loadCollections();
          const col = cols.find((c) => c.id === activeCollectionId);
          if (col && !col.fileIds.includes(id)) {
            col.fileIds.push(id);
            col.updatedAt = Date.now();
            saveCollections(cols);
          }
        }
      }
      await loadLibrary();
      files.value = loadedId || files.value;
      await loadSelected();
    }
    async function loadSelected(idOverride = null) {
      const id = idOverride || files.value;
      if (!id) {
        setStatus("no file", false);
        return false;
      }
      const item = await libraryGet(id);
      if (!item?.data) {
        setStatus("missing file", false);
        return false;
      }
      try {
        loadingTrack = true;
        const info = player.loadBuffer(item.data);
        loadedId = id;
        duration = player.duration();
        files.value = id;
        durEl.textContent = fmt(duration);
        seek.value = "0";
        prefsPatch({ lastTrackId: id, activeCollectionId });
        setStatus(`ready \xB7 ${item.name}`, true);
        return true;
      } catch (err) {
        console.error(err);
        setStatus("parse error", false);
        return false;
      } finally {
        loadingTrack = false;
      }
    }
    box.addEventListener("dragover", (e) => e.preventDefault());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", async (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      if (e.dataTransfer?.files?.length) await addFiles(e.dataTransfer.files);
    });
    box.querySelector("#browse").onclick = () => pick.click();
    pick.onchange = async () => {
      if (pick.files?.length) await addFiles(pick.files);
      pick.value = "";
    };
    box.querySelector("#reloadLib").onclick = loadLibrary;
    collectionSelect.onchange = async () => {
      activeCollectionId = collectionSelect.value || ALL_LIBRARY_ID;
      randomQueue = [];
      prefsPatch({ activeCollectionId });
      await loadLibrary();
    };
    newCollectionBtn.onclick = async () => {
      const name = prompt("Library name", "New library");
      if (!name) return;
      const cols = loadCollections();
      const col = { id: uid("library"), name: name.trim(), fileIds: [], createdAt: Date.now(), updatedAt: Date.now() };
      cols.push(col);
      saveCollections(cols);
      activeCollectionId = col.id;
      await loadLibrary();
    };
    renameCollectionBtn.onclick = async () => {
      if (activeCollectionId === ALL_LIBRARY_ID) return;
      const cols = loadCollections();
      const col = cols.find((c) => c.id === activeCollectionId);
      if (!col) return;
      const name = prompt("Library name", col.name);
      if (!name) return;
      col.name = name.trim();
      col.updatedAt = Date.now();
      saveCollections(cols);
      await loadLibrary();
    };
    deleteCollectionBtn.onclick = async () => {
      if (activeCollectionId === ALL_LIBRARY_ID) return;
      const col = collections.find((c) => c.id === activeCollectionId);
      if (!col) return;
      if (!confirm(`Delete library "${col.name}"? MIDI files stay saved.`)) return;
      saveCollections(loadCollections().filter((c) => c.id !== activeCollectionId));
      activeCollectionId = ALL_LIBRARY_ID;
      randomQueue = [];
      await loadLibrary();
    };
    removeFromCollectionBtn.onclick = async () => {
      if (activeCollectionId === ALL_LIBRARY_ID) return;
      const id = files.value;
      if (!id) return;
      const cols = loadCollections();
      const col = cols.find((c) => c.id === activeCollectionId);
      if (!col) return;
      col.fileIds = col.fileIds.filter((x) => x !== id);
      col.updatedAt = Date.now();
      saveCollections(cols);
      if (id === loadedId) {
        player.stop();
        loadedId = null;
        duration = 0;
      }
      await loadLibrary();
    };
    box.querySelector("#deleteFile").onclick = async () => {
      const id = files.value;
      if (!id) return;
      const item = await libraryGet(id);
      if (!confirm(`Delete "${item?.name || "this MIDI"}" from storage and all libraries?`)) return;
      await libraryDelete(id);
      const cols = loadCollections();
      for (const c of cols) {
        c.fileIds = c.fileIds.filter((x) => x !== id);
      }
      saveCollections(cols);
      if (id === loadedId) {
        player.stop();
        loadedId = null;
        duration = 0;
      }
      await loadLibrary();
    };
    box.querySelector("#renameFile").onclick = async () => {
      const id = files.value;
      if (!id) return;
      const item = await libraryGet(id);
      if (!item) return;
      const name = prompt("New MIDI name", item.name);
      if (!name) return;
      item.name = name.trim();
      item.renamedAt = Date.now();
      await libraryPut(item);
      await loadLibrary();
      files.value = id;
    };
    files.addEventListener("change", () => {
      prefsPatch({ lastTrackId: files.value });
      loadSelected();
    });
    playBtn.addEventListener("click", async () => {
      if (!filteredLibrary.length) {
        setStatus("add a MIDI file", false);
        return;
      }
      if (!loadedId || loadedId !== files.value) await loadSelected();
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
    function orderedIds() {
      return filteredLibrary.map((x) => x.id);
    }
    function rebuildRandomQueue(excludeId = null) {
      const ids = orderedIds().filter((id) => id !== excludeId);
      randomQueue = shuffle(ids);
    }
    function nextPlaylistId() {
      const ids = orderedIds();
      if (!ids.length) return null;
      if (playlistOrder.value === "random") {
        if (!randomQueue.length) rebuildRandomQueue(loadedId);
        return randomQueue.shift() || ids.find((id) => id !== loadedId) || ids[0];
      }
      const cur = loadedId || files.value;
      const idx = Math.max(0, ids.indexOf(cur));
      return ids[(idx + 1) % ids.length];
    }
    async function playTrackById(id) {
      if (!id) return;
      files.value = id;
      const ok = await loadSelected(id);
      if (ok) {
        player.play();
        setStatus("playing", true);
        updatePlaylistInfo();
      }
    }
    async function playNextFromPlaylist() {
      if (!playlistActive || !playlistAuto.checked) return;
      const next = nextPlaylistId();
      if (next) await playTrackById(next);
    }
    player.setOnEnded(() => {
      playNextFromPlaylist();
    });
    playlistStartBtn.onclick = async () => {
      if (!filteredLibrary.length) {
        setStatus("playlist empty", false);
        return;
      }
      playlistActive = true;
      playlistAuto.checked = true;
      randomQueue = [];
      prefsPatch({ playlistAuto: true, playlistOrder: playlistOrder.value });
      const id = files.value || filteredLibrary[0]?.id;
      await playTrackById(id);
      updatePlaylistInfo();
    };
    playlistStopBtn.onclick = () => {
      playlistActive = false;
      playlistAuto.checked = false;
      randomQueue = [];
      prefsPatch({ playlistAuto: false });
      updatePlaylistInfo("Stopped");
      refreshButtons();
    };
    playlistAuto.onchange = () => {
      playlistActive = playlistAuto.checked;
      prefsPatch({ playlistAuto: playlistAuto.checked });
      updatePlaylistInfo();
      refreshButtons();
    };
    playlistOrder.onchange = () => {
      randomQueue = [];
      prefsPatch({ playlistOrder: playlistOrder.value });
      updatePlaylistInfo();
    };
    seek.addEventListener("mousedown", () => seek._dragging = true);
    seek.addEventListener("mouseup", () => {
      seek._dragging = false;
    });
    seek.addEventListener("touchstart", () => seek._dragging = true, { passive: true });
    seek.addEventListener("touchend", () => seek._dragging = false, { passive: true });
    seek.addEventListener("input", () => {
      const pos = parseInt(seek.value, 10) / 1e3 * (duration || 0);
      player.seek(pos);
      curEl.textContent = fmt(pos);
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
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && autoPause.checked && player.isPlaying()) {
        player.pause();
        hiddenAutoPaused = true;
        setStatus("auto-paused", false);
      } else if (!document.hidden && hiddenAutoPaused) {
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

  // mnt/data/playlist_work/src/ui_reactive_color.js
  var PREF_ENDPOINT = "/api/mpo/users/@me/preferences";
  var STORE_KEY = "mo_reactive_color_matrix_presets_v2";
  var TD2 = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  var PALETTE_LIBRARY = {
    inferno: ["#180000", "#6f0000", "#ff1800", "#ff6a00", "#ffc400", "#fff45a"],
    royal: ["#070015", "#23005a", "#6616d8", "#c73cff", "#ffb000", "#fff2a0"],
    spectrum: ["#ff003c", "#ff3300", "#ff8a00", "#ffe600", "#67ff00", "#00ffd5", "#008cff", "#553cff", "#b000ff", "#ff3bd5"],
    ghost: ["#e8fbff"],
    velvet: ["#120011", "#50002c", "#a90062", "#ff247d", "#ff8a00", "#ffe05c"],
    aurora: ["#10002b", "#2f00a8", "#0099ff", "#00ffc6", "#62ff77", "#ff4fd8"],
    thunder: ["#050008", "#1b1eff", "#7d00ff", "#ffffff", "#fff200", "#ff0033"],
    prism: ["#ff004c", "#ff7a00", "#ffe600", "#00ff9d", "#00b3ff", "#8a2cff", "#ff3bd5"],
    noir: ["#000000", "#181818", "#777777", "#ffffff"],
    ocean: ["#001029", "#003d7a", "#008cff", "#00e5ff", "#adfff5"],
    acid: ["#0c1400", "#66ff00", "#fff000", "#ff6a00", "#ff00a8"],
    solar: ["#210000", "#900000", "#ff2300", "#ff8a00", "#fff200", "#ffffff"],
    starlight: ["#030012", "#10105a", "#2e6cff", "#9fd8ff", "#ffffff"],
    emerald: ["#00140b", "#005c38", "#00e68a", "#d8ff7a", "#fff7c2"],
    leftRight: ["#ff123f", "#ff7b00", "#ffe600", "#2775ff", "#7a2cff"],
    brass: ["#190800", "#6d2700", "#c76600", "#ffb000", "#fff1a0"],
    ivoryRedBlue: ["#006cff", "#ff1010"],
    handSplit: ["#ff123f", "#ff7b00", "#2b7cff", "#7a2cff"],
    obsidianKeys: ["#f7ead0", "#6d102c"],
    cinema: ["#06020f", "#20104d", "#ff2f5f", "#ffb238", "#fff2b0"],
    neonScanner: ["#00f5ff", "#2166ff", "#8b2cff", "#ff2bd6", "#fff200"],
    monochromeGold: ["#111111", "#2b220e", "#b8892d", "#fff2b0"],
    leftRightElegance: ["#d33b35", "#ffb047", "#316dff", "#9f58ff"]
  };
  var BUILTIN = {
    royal: {
      name: "Royal",
      config: {
        palette: PALETTE_LIBRARY.royal,
        minNote: 24,
        maxNote: 96,
        minAlpha: 90,
        maxAlpha: 255,
        sendEveryMs: 330,
        dynamicRanges: true,
        smoothing: 0.18,
        smoothColor: true,
        basePos: 0.12,
        baseAlpha: 0.78,
        baseSat: 1.25,
        baseLight: 1.08,
        rules: [
          { input: "pitch", output: "palette", amount: 1, curve: "linear", invert: false },
          { input: "velocity", output: "alpha", amount: 0.95, curve: "contrast", invert: false },
          { input: "density", output: "light", amount: 0.35, curve: "soft", invert: false }
        ],
        pattern: { type: "wave", output: "hue", amount: 0.08, periodMs: 5200 }
      }
    },
    inferno: {
      name: "Inferno",
      config: {
        palette: PALETTE_LIBRARY.inferno,
        minNote: 21,
        maxNote: 96,
        minAlpha: 115,
        maxAlpha: 255,
        sendEveryMs: 300,
        dynamicRanges: true,
        smoothing: 0.1,
        smoothColor: true,
        basePos: 0.1,
        baseAlpha: 0.85,
        baseSat: 1.55,
        baseLight: 1.18,
        rules: [
          { input: "lowest", output: "palette", amount: 1, curve: "linear", invert: false },
          { input: "velocity", output: "alpha", amount: 1, curve: "punch", invert: false },
          { input: "velocity", output: "light", amount: 0.55, curve: "contrast", invert: false }
        ],
        pattern: { type: "pulse", output: "light", amount: 0.2, periodMs: 900 }
      }
    },
    spectrum: {
      name: "Spectrum",
      config: {
        palette: PALETTE_LIBRARY.spectrum,
        minNote: 21,
        maxNote: 108,
        minAlpha: 100,
        maxAlpha: 255,
        sendEveryMs: 260,
        dynamicRanges: true,
        smoothing: 1,
        smoothColor: false,
        basePos: 0,
        baseAlpha: 0.9,
        baseSat: 1.45,
        baseLight: 1.15,
        rules: [
          { input: "pitchClass", output: "palette", amount: 1, curve: "linear", invert: false },
          { input: "velocity", output: "alpha", amount: 0.85, curve: "contrast", invert: false },
          { input: "chordSize", output: "light", amount: 0.25, curve: "linear", invert: false }
        ],
        pattern: { type: "off", output: "alpha", amount: 0, periodMs: 1e3 }
      }
    },
    ghost: {
      name: "Ghost",
      config: {
        palette: PALETTE_LIBRARY.ghost,
        minNote: 21,
        maxNote: 108,
        minAlpha: 0,
        maxAlpha: 255,
        sendEveryMs: 260,
        dynamicRanges: true,
        smoothing: 0.12,
        smoothColor: true,
        basePos: 0,
        baseAlpha: 0,
        baseSat: 0.05,
        baseLight: 1.8,
        rules: [
          { input: "velocity", output: "alpha", amount: 1.25, curve: "contrast", invert: false },
          { input: "density", output: "light", amount: 0.28, curve: "soft", invert: false }
        ],
        pattern: { type: "breath", output: "alpha", amount: 0.18, periodMs: 2400 }
      }
    },
    velvet: {
      name: "Velvet",
      config: {
        palette: PALETTE_LIBRARY.velvet,
        minNote: 21,
        maxNote: 108,
        minAlpha: 30,
        maxAlpha: 255,
        sendEveryMs: 260,
        dynamicRanges: true,
        smoothing: 0.1,
        smoothColor: true,
        basePos: 0.12,
        baseAlpha: 0.65,
        baseSat: 1.6,
        baseLight: 1.2,
        rules: [
          { input: "velocity", output: "palette", amount: 1, curve: "contrast", invert: false },
          { input: "velocity", output: "alpha", amount: 1, curve: "contrast", invert: false },
          { input: "velocity", output: "light", amount: 0.65, curve: "punch", invert: false }
        ],
        pattern: { type: "pulse", output: "alpha", amount: 0.2, periodMs: 1300 }
      }
    },
    aurora: {
      name: "Aurora",
      config: {
        palette: PALETTE_LIBRARY.aurora,
        minNote: 21,
        maxNote: 108,
        minAlpha: 35,
        maxAlpha: 255,
        sendEveryMs: 380,
        dynamicRanges: true,
        smoothing: 0.1,
        smoothColor: true,
        basePos: 0.1,
        baseAlpha: 0.45,
        baseSat: 1.2,
        baseLight: 1.05,
        rules: [
          { input: "density", output: "palette", amount: 1, curve: "soft", invert: false },
          { input: "density", output: "alpha", amount: 0.95, curve: "punch", invert: false },
          { input: "highest", output: "hue", amount: 0.16, curve: "linear", invert: false }
        ],
        pattern: { type: "wave", output: "palette", amount: 0.28, periodMs: 6200 }
      }
    },
    thunder: {
      name: "Thunder",
      config: {
        palette: PALETTE_LIBRARY.thunder,
        minNote: 21,
        maxNote: 108,
        minAlpha: 80,
        maxAlpha: 255,
        sendEveryMs: 240,
        dynamicRanges: true,
        smoothing: 1,
        smoothColor: false,
        basePos: 0.1,
        baseAlpha: 0.75,
        baseSat: 1.8,
        baseLight: 1.32,
        rules: [
          { input: "tension", output: "palette", amount: 1, curve: "contrast", invert: false },
          { input: "tension", output: "alpha", amount: 1, curve: "hard", invert: false },
          { input: "spread", output: "light", amount: 0.5, curve: "contrast", invert: false }
        ],
        pattern: { type: "strobe", output: "light", amount: 0.42, periodMs: 720 }
      }
    },
    prism: {
      name: "Prism",
      config: {
        palette: PALETTE_LIBRARY.prism,
        minNote: 21,
        maxNote: 108,
        minAlpha: 95,
        maxAlpha: 255,
        sendEveryMs: 300,
        dynamicRanges: true,
        smoothing: 0.18,
        smoothColor: true,
        basePos: 0.2,
        baseAlpha: 0.78,
        baseSat: 1.45,
        baseLight: 1.12,
        rules: [
          { input: "chordHash", output: "palette", amount: 1, curve: "linear", invert: false },
          { input: "chordSize", output: "alpha", amount: 0.9, curve: "contrast", invert: false },
          { input: "velocity", output: "light", amount: 0.35, curve: "soft", invert: false }
        ],
        pattern: { type: "wave", output: "hue", amount: 0.18, periodMs: 3800 }
      }
    },
    chaos: {
      name: "Chaos",
      config: {
        palette: PALETTE_LIBRARY.spectrum,
        minNote: 21,
        maxNote: 108,
        minAlpha: 130,
        maxAlpha: 255,
        sendEveryMs: 250,
        dynamicRanges: true,
        smoothing: 1,
        smoothColor: false,
        basePos: 0,
        baseAlpha: 0.85,
        baseSat: 1.85,
        baseLight: 1.35,
        rules: [
          { input: "chordHash", output: "palette", amount: 0.85, curve: "linear", invert: false },
          { input: "tension", output: "hue", amount: 0.35, curve: "contrast", invert: false },
          { input: "density", output: "alpha", amount: 1, curve: "hard", invert: false },
          { input: "velocity", output: "light", amount: 0.6, curve: "punch", invert: false }
        ],
        pattern: { type: "blink", output: "palette", amount: 0.4, periodMs: 520 }
      }
    }
  };
  BUILTIN.ivoryEbony = {
    name: "Ivory / Ebony",
    config: {
      palette: ["#f4efe2", "#1b1b24", "#ffffff", "#000000"],
      minNote: 21,
      maxNote: 108,
      minAlpha: 90,
      maxAlpha: 255,
      sendEveryMs: 280,
      dynamicRanges: true,
      smoothing: 0.12,
      smoothColor: true,
      basePos: 0.25,
      baseAlpha: 0.78,
      baseSat: 1.15,
      baseLight: 1.08,
      rules: [
        { input: "blackKeys", output: "palette", amount: 1.2, curve: "contrast", invert: false },
        { input: "whiteKeys", output: "light", amount: 0.45, curve: "soft", invert: false },
        { input: "velocity", output: "alpha", amount: 0.9, curve: "contrast", invert: false }
      ],
      pattern: { type: "breath", output: "alpha", amount: 0.1, periodMs: 1800 }
    }
  };
  BUILTIN.ivoryEbonyStrict = {
    name: "Obsidian Keys",
    config: {
      palette: PALETTE_LIBRARY.obsidianKeys,
      minNote: 21,
      maxNote: 108,
      minAlpha: 140,
      maxAlpha: 255,
      sendEveryMs: 250,
      dynamicRanges: false,
      smoothing: 1,
      smoothColor: false,
      basePos: 0,
      baseAlpha: 0.88,
      baseSat: 1.55,
      baseLight: 1.2,
      harmonyMode: "active",
      arpeggioWindowMs: 120,
      rules: [
        { input: "currentKey", output: "hardPalette", amount: 1, curve: "hard", invert: false },
        { input: "velocity", output: "alpha", amount: 0.65, curve: "contrast", invert: false },
        { input: "velocity", output: "light", amount: 0.25, curve: "punch", invert: false }
      ],
      pattern: { type: "off", output: "alpha", amount: 0, periodMs: 1e3 }
    }
  };
  BUILTIN.leftRightStrict = {
    name: "Split Stage",
    config: {
      palette: PALETTE_LIBRARY.leftRightElegance,
      minNote: 21,
      maxNote: 108,
      minAlpha: 120,
      maxAlpha: 255,
      sendEveryMs: 260,
      dynamicRanges: true,
      smoothing: 0.1,
      smoothColor: true,
      basePos: 0.5,
      baseAlpha: 0.78,
      baseSat: 1.55,
      baseLight: 1.12,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 650,
      rules: [
        { input: "keyboardSide", output: "palette", amount: 1.1, curve: "contrast", invert: false },
        { input: "velocity", output: "alpha", amount: 0.85, curve: "contrast", invert: false },
        { input: "spread", output: "light", amount: 0.35, curve: "soft", invert: false }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.06, periodMs: 3600 }
    }
  };
  BUILTIN.dualHands = {
    name: "Dual Hands",
    config: {
      palette: ["#ff123f", "#ff7b00", "#ffe600", "#2775ff", "#7a2cff"],
      minNote: 21,
      maxNote: 108,
      minAlpha: 95,
      maxAlpha: 255,
      sendEveryMs: 280,
      dynamicRanges: true,
      smoothing: 0.1,
      smoothColor: true,
      basePos: 0.4,
      baseAlpha: 0.78,
      baseSat: 1.55,
      baseLight: 1.12,
      rules: [
        { input: "leftHand", output: "palette", amount: -0.95, curve: "contrast", invert: false },
        { input: "rightHand", output: "palette", amount: 0.95, curve: "contrast", invert: false },
        { input: "velocity", output: "alpha", amount: 0.9, curve: "punch", invert: false },
        { input: "spread", output: "light", amount: 0.4, curve: "soft", invert: false }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.08, periodMs: 3600 }
    }
  };
  BUILTIN.cathedral = {
    name: "Cathedral",
    config: {
      palette: ["#080013", "#1b0652", "#5a2bd8", "#f6d891", "#fff7d7", "#ffffff"],
      minNote: 24,
      maxNote: 100,
      minAlpha: 55,
      maxAlpha: 255,
      sendEveryMs: 360,
      dynamicRanges: true,
      smoothing: 0.12,
      smoothColor: true,
      basePos: 0.18,
      baseAlpha: 0.55,
      baseSat: 1.05,
      baseLight: 1.18,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 950,
      rules: [
        { input: "harmonyMajor", output: "palette", amount: 0.75, curve: "soft", invert: false },
        { input: "harmonyMinor", output: "hue", amount: -0.22, curve: "soft", invert: false },
        { input: "sustain", output: "alpha", amount: 0.85, curve: "soft", invert: false },
        { input: "velocity", output: "light", amount: 0.35, curve: "punch", invert: false }
      ],
      pattern: { type: "breath", output: "alpha", amount: 0.18, periodMs: 3200 }
    }
  };
  BUILTIN.nocturne = {
    name: "Nocturne",
    config: {
      palette: ["#010414", "#071442", "#123d77", "#9eb7ff", "#e8efff"],
      minNote: 21,
      maxNote: 108,
      minAlpha: 20,
      maxAlpha: 215,
      sendEveryMs: 420,
      dynamicRanges: true,
      smoothing: 0.08,
      smoothColor: true,
      basePos: 0.12,
      baseAlpha: 0.35,
      baseSat: 1.15,
      baseLight: 0.92,
      harmonyMode: "memory",
      arpeggioWindowMs: 850,
      rules: [
        { input: "highest", output: "palette", amount: 0.85, curve: "soft", invert: false },
        { input: "leftHand", output: "hue", amount: -0.18, curve: "soft", invert: false },
        { input: "rightHand", output: "light", amount: 0.32, curve: "soft", invert: false },
        { input: "velocity", output: "alpha", amount: 0.75, curve: "soft", invert: false }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.07, periodMs: 7e3 }
    }
  };
  BUILTIN.arpeggioBloom = {
    name: "Arpeggio Bloom",
    config: {
      palette: ["#35004e", "#8b00ff", "#0077ff", "#00ffd5", "#fff000", "#ff7a00"],
      minNote: 21,
      maxNote: 108,
      minAlpha: 70,
      maxAlpha: 255,
      sendEveryMs: 260,
      smoothing: 0.14,
      smoothColor: true,
      basePos: 0.1,
      baseAlpha: 0.65,
      baseSat: 1.45,
      baseLight: 1.16,
      harmonyMode: "memory",
      arpeggioWindowMs: 700,
      rules: [
        { input: "arpeggioDirection", output: "palette", amount: 1.05, curve: "linear", invert: false },
        { input: "arpeggioSpeed", output: "alpha", amount: 0.9, curve: "contrast", invert: false },
        { input: "highest", output: "light", amount: 0.35, curve: "soft", invert: false },
        { input: "velocity", output: "saturation", amount: 0.35, curve: "punch", invert: false }
      ],
      pattern: { type: "wave", output: "palette", amount: 0.18, periodMs: 2600 }
    }
  };
  BUILTIN.jazzClub = {
    name: "Jazz Club",
    config: {
      palette: ["#110009", "#3a1028", "#6b2947", "#b86237", "#d7a64a", "#6841b8"],
      minNote: 24,
      maxNote: 96,
      minAlpha: 85,
      maxAlpha: 245,
      sendEveryMs: 330,
      smoothing: 0.16,
      smoothColor: true,
      basePos: 0.22,
      baseAlpha: 0.62,
      baseSat: 1.35,
      baseLight: 0.98,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 600,
      rules: [
        { input: "blackKeys", output: "palette", amount: 0.65, curve: "contrast", invert: false },
        { input: "tension", output: "hue", amount: 0.24, curve: "soft", invert: false },
        { input: "harmonyDominant", output: "light", amount: 0.38, curve: "contrast", invert: false },
        { input: "velocity", output: "alpha", amount: 0.75, curve: "punch", invert: false }
      ],
      pattern: { type: "breath", output: "light", amount: 0.12, periodMs: 2100 }
    }
  };
  BUILTIN.glass = {
    name: "Glass",
    config: {
      palette: ["#011a2e", "#006caa", "#00d5ff", "#c6fbff", "#ffffff"],
      minNote: 21,
      maxNote: 108,
      minAlpha: 10,
      maxAlpha: 235,
      sendEveryMs: 300,
      smoothing: 0.1,
      smoothColor: true,
      basePos: 0.1,
      baseAlpha: 0.25,
      baseSat: 0.85,
      baseLight: 1.35,
      harmonyMode: "sustainAware",
      arpeggioWindowMs: 800,
      rules: [
        { input: "pitch", output: "palette", amount: 1, curve: "soft", invert: false },
        { input: "velocity", output: "alpha", amount: 1, curve: "contrast", invert: false },
        { input: "sustain", output: "light", amount: 0.42, curve: "soft", invert: false }
      ],
      pattern: { type: "breath", output: "alpha", amount: 0.16, periodMs: 4200 }
    }
  };
  BUILTIN.solarFlare = {
    name: "Solar Flare",
    config: {
      palette: PALETTE_LIBRARY.solar,
      minNote: 21,
      maxNote: 104,
      minAlpha: 95,
      maxAlpha: 255,
      sendEveryMs: 300,
      dynamicRanges: true,
      smoothing: 0.1,
      smoothColor: true,
      basePos: 0.1,
      baseAlpha: 0.55,
      baseSat: 1.75,
      baseLight: 1.25,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 650,
      rules: [
        { input: "velocity", output: "palette", amount: 1.35, curve: "contrast", invert: false },
        { input: "density", output: "alpha", amount: 1.15, curve: "punch", invert: false },
        { input: "chordSize", output: "light", amount: 0.55, curve: "soft", invert: false }
      ],
      pattern: { type: "pulse", output: "light", amount: 0.22, periodMs: 820 }
    }
  };
  BUILTIN.starlight = {
    name: "Starlight",
    config: {
      palette: PALETTE_LIBRARY.starlight,
      minNote: 36,
      maxNote: 108,
      minAlpha: 10,
      maxAlpha: 245,
      sendEveryMs: 360,
      dynamicRanges: true,
      smoothing: 0.08,
      smoothColor: true,
      basePos: 0.05,
      baseAlpha: 0.18,
      baseSat: 1.35,
      baseLight: 1.45,
      harmonyMode: "memory",
      arpeggioWindowMs: 900,
      rules: [
        { input: "highest", output: "palette", amount: 1, curve: "soft", invert: false },
        { input: "velocity", output: "alpha", amount: 1.25, curve: "contrast", invert: false },
        { input: "arpeggioSpeed", output: "light", amount: 0.42, curve: "punch", invert: false }
      ],
      pattern: { type: "breath", output: "alpha", amount: 0.2, periodMs: 2600 }
    }
  };
  BUILTIN.ebonyIvoryPulse = {
    name: "Ebony Pulse",
    config: {
      palette: ["#fff8e8", "#15151c", "#ffffff", "#000000", "#ffcc55"],
      minNote: 21,
      maxNote: 108,
      minAlpha: 70,
      maxAlpha: 255,
      sendEveryMs: 300,
      dynamicRanges: true,
      smoothing: 0.16,
      smoothColor: true,
      basePos: 0.45,
      baseAlpha: 0.62,
      baseSat: 1.1,
      baseLight: 1.1,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 700,
      rules: [
        { input: "blackKeys", output: "palette", amount: 1.3, curve: "contrast", invert: false },
        { input: "whiteKeys", output: "light", amount: 0.55, curve: "soft", invert: false },
        { input: "velocity", output: "alpha", amount: 1, curve: "contrast", invert: false }
      ],
      pattern: { type: "pulse", output: "alpha", amount: 0.12, periodMs: 1200 }
    }
  };
  BUILTIN.leftRightStage = {
    name: "Left / Right Stage",
    config: {
      palette: PALETTE_LIBRARY.leftRight,
      minNote: 21,
      maxNote: 108,
      minAlpha: 90,
      maxAlpha: 255,
      sendEveryMs: 280,
      dynamicRanges: true,
      smoothing: 0.12,
      smoothColor: true,
      basePos: 0.5,
      baseAlpha: 0.72,
      baseSat: 1.55,
      baseLight: 1.16,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 600,
      rules: [
        { input: "leftHand", output: "palette", amount: -1.15, curve: "contrast", invert: false },
        { input: "rightHand", output: "palette", amount: 1.15, curve: "contrast", invert: false },
        { input: "spread", output: "light", amount: 0.55, curve: "soft", invert: false },
        { input: "velocity", output: "alpha", amount: 0.95, curve: "punch", invert: false }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.1, periodMs: 4200 }
    }
  };
  BUILTIN.brassMachine = {
    name: "Brass Machine",
    config: {
      palette: PALETTE_LIBRARY.brass,
      minNote: 28,
      maxNote: 96,
      minAlpha: 80,
      maxAlpha: 255,
      sendEveryMs: 320,
      dynamicRanges: true,
      smoothing: 0.18,
      smoothColor: true,
      basePos: 0.18,
      baseAlpha: 0.65,
      baseSat: 1.35,
      baseLight: 1.1,
      harmonyMode: "memory",
      arpeggioWindowMs: 750,
      rules: [
        { input: "lowest", output: "palette", amount: 0.85, curve: "linear", invert: false },
        { input: "harmonyDominant", output: "light", amount: 0.45, curve: "hard", invert: false },
        { input: "density", output: "alpha", amount: 0.95, curve: "contrast", invert: false }
      ],
      pattern: { type: "saw", output: "palette", amount: 0.16, periodMs: 1800 }
    }
  };
  BUILTIN.cinemaPulse = {
    name: "Cinema Pulse",
    config: {
      palette: PALETTE_LIBRARY.cinema,
      minNote: 21,
      maxNote: 108,
      minAlpha: 80,
      maxAlpha: 255,
      sendEveryMs: 320,
      dynamicRanges: true,
      smoothing: 0.12,
      smoothColor: true,
      basePos: 0.18,
      baseAlpha: 0.62,
      baseSat: 1.35,
      baseLight: 1.05,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 750,
      rules: [
        { input: "velocity", output: "alpha", amount: 0.85, curve: "contrast", invert: false },
        { input: "density", output: "light", amount: 0.45, curve: "soft", invert: false },
        { input: "lowest", output: "palette", amount: 0.55, curve: "linear", invert: false }
      ],
      patterns: [
        { type: "breath", output: "alpha", amount: 0.22, periodMs: 2600 },
        { type: "pulse", output: "light", amount: 0.28, periodMs: 920 }
      ],
      pattern: { type: "breath", output: "alpha", amount: 0.22, periodMs: 2600 }
    }
  };
  BUILTIN.neonScanner = {
    name: "Neon Scanner",
    config: {
      palette: PALETTE_LIBRARY.neonScanner,
      minNote: 21,
      maxNote: 108,
      minAlpha: 110,
      maxAlpha: 255,
      sendEveryMs: 300,
      dynamicRanges: true,
      smoothing: 0.06,
      smoothColor: true,
      basePos: 0.2,
      baseAlpha: 0.8,
      baseSat: 1.65,
      baseLight: 1.18,
      harmonyMode: "memory",
      arpeggioWindowMs: 550,
      rules: [
        { input: "pitchClass", output: "hardPalette", amount: 1, curve: "linear", invert: false },
        { input: "velocity", output: "alpha", amount: 0.8, curve: "contrast", invert: false },
        { input: "tension", output: "hue", amount: 0.22, curve: "punch", invert: false }
      ],
      patterns: [
        { type: "wave", output: "palette", amount: 0.42, periodMs: 1800 },
        { type: "strobe", output: "light", amount: 0.18, periodMs: 640 }
      ],
      pattern: { type: "wave", output: "palette", amount: 0.42, periodMs: 1800 }
    }
  };
  BUILTIN.goldenMetronome = {
    name: "Golden Metronome",
    config: {
      palette: PALETTE_LIBRARY.monochromeGold,
      minNote: 21,
      maxNote: 108,
      minAlpha: 50,
      maxAlpha: 255,
      sendEveryMs: 360,
      dynamicRanges: true,
      smoothing: 0.16,
      smoothColor: true,
      basePos: 0.35,
      baseAlpha: 0.5,
      baseSat: 1.25,
      baseLight: 1.08,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 900,
      rules: [
        { input: "velocity", output: "alpha", amount: 0.65, curve: "contrast", invert: false },
        { input: "sustain", output: "light", amount: 0.35, curve: "soft", invert: false },
        { input: "chordSize", output: "palette", amount: 0.28, curve: "soft", invert: false }
      ],
      patterns: [
        { type: "blink", output: "alpha", amount: 0.26, periodMs: 1200 },
        { type: "saw", output: "hue", amount: 0.08, periodMs: 4800 }
      ],
      pattern: { type: "blink", output: "alpha", amount: 0.26, periodMs: 1200 }
    }
  };
  BUILTIN.leftRightDuel = {
    name: "Left / Right Duel",
    config: {
      palette: PALETTE_LIBRARY.leftRightElegance,
      minNote: 21,
      maxNote: 108,
      minAlpha: 105,
      maxAlpha: 255,
      sendEveryMs: 280,
      dynamicRanges: true,
      smoothing: 0.08,
      smoothColor: true,
      basePos: 0.5,
      baseAlpha: 0.78,
      baseSat: 1.55,
      baseLight: 1.12,
      harmonyMode: "hybrid",
      arpeggioWindowMs: 620,
      rules: [
        { input: "keyboardSide", output: "palette", amount: 1.1, curve: "contrast", invert: false },
        { input: "velocity", output: "alpha", amount: 0.9, curve: "contrast", invert: false },
        { input: "spread", output: "saturation", amount: 0.35, curve: "soft", invert: false }
      ],
      patterns: [
        { type: "wave", output: "hue", amount: 0.1, periodMs: 3600 }
      ],
      pattern: { type: "wave", output: "hue", amount: 0.1, periodMs: 3600 }
    }
  };
  var BLANK_CONFIG = {
    palette: ["#ff003c", "#ff9f00", "#ffee00"],
    minNote: 21,
    maxNote: 108,
    minAlpha: 60,
    maxAlpha: 255,
    sendEveryMs: 420,
    dynamicRanges: true,
    smoothing: 0.3,
    smoothColor: true,
    basePos: 0,
    baseAlpha: 0.75,
    baseSat: 1,
    baseLight: 1,
    rules: [
      { input: "pitch", output: "palette", amount: 1, curve: "linear", invert: false },
      { input: "velocity", output: "alpha", amount: 0.8, curve: "linear", invert: false }
    ],
    pattern: { type: "off", output: "alpha", amount: 0, periodMs: 2e3 }
  };
  var C = { enabled: false, preset: "builtin:royal", customName: "", showMonitor: false, harmonyMode: "hybrid", arpeggioWindowMs: 700, ...structuredClone(BUILTIN.royal.config) };
  var S = {
    hooked: false,
    originalSend: null,
    notes: [],
    active: /* @__PURE__ */ new Map(),
    sustain: 0,
    lastNote: 60,
    lastVelocity: 0.7,
    intensity: 0,
    density: 0,
    lastSend: 0,
    sending: false,
    lastColor: "#7c4dffcc",
    smoothRgb: null,
    smoothAlpha: null,
    lastChord: [],
    lastFeatures: null,
    lastAnalysis: null,
    lastDecision: null,
    panel: null,
    status: null,
    preview: null,
    inspector: null,
    customPresets: {},
    ranges: {}
  };
  var now2 = () => performance.now();
  var avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  var lerp = (a, b, t) => a + (b - a) * t;
  var toHex = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var WHITE_PCS = /* @__PURE__ */ new Set([0, 2, 4, 5, 7, 9, 11]);
  var CHORD_QUALITIES = [
    { name: "maj13", intervals: [0, 4, 7, 11, 2, 9] },
    { name: "m13", intervals: [0, 3, 7, 10, 2, 9] },
    { name: "maj9", intervals: [0, 4, 7, 11, 2] },
    { name: "m9", intervals: [0, 3, 7, 10, 2] },
    { name: "9", intervals: [0, 4, 7, 10, 2] },
    { name: "7", intervals: [0, 4, 7, 10] },
    { name: "maj7", intervals: [0, 4, 7, 11] },
    { name: "m7", intervals: [0, 3, 7, 10] },
    { name: "mMaj7", intervals: [0, 3, 7, 11] },
    { name: "dim7", intervals: [0, 3, 6, 9] },
    { name: "\xF87", intervals: [0, 3, 6, 10] },
    { name: "aug", intervals: [0, 4, 8] },
    { name: "dim", intervals: [0, 3, 6] },
    { name: "sus4", intervals: [0, 5, 7] },
    { name: "sus2", intervals: [0, 2, 7] },
    { name: "m", intervals: [0, 3, 7] },
    { name: "", intervals: [0, 4, 7] },
    { name: "5", intervals: [0, 7] }
  ];
  function noteName(note) {
    const n = Math.round(Number(note) || 0);
    return `${NOTE_NAMES[(n % 12 + 12) % 12]}${Math.floor(n / 12) - 1}`;
  }
  function pcName(pc2) {
    return NOTE_NAMES[(Math.round(pc2) % 12 + 12) % 12];
  }
  function isBlackKey(note) {
    return !WHITE_PCS.has((Math.round(note) % 12 + 12) % 12);
  }
  function detectChord(chord) {
    const notes = [...new Set(chord.map((x) => Math.round(Number(x.note))).filter(Number.isFinite))].sort((a, b) => a - b);
    if (!notes.length) return { name: "\u2014", notes: [], pcs: [], root: null, quality: "", confidence: 0 };
    const pcs = [...new Set(notes.map((n) => (n % 12 + 12) % 12))].sort((a, b) => a - b);
    if (pcs.length === 1) return { name: noteName(notes[0]), notes, pcs, root: pcs[0], quality: "single", confidence: 1 };
    let best = null;
    for (const root of pcs) {
      const rel = pcs.map((pc2) => (pc2 - root + 12) % 12);
      for (const q of CHORD_QUALITIES) {
        const hits = q.intervals.filter((iv) => rel.includes(iv)).length;
        const misses = Math.max(0, q.intervals.length - hits);
        const extras = rel.filter((iv) => !q.intervals.includes(iv)).length;
        const hasRoot = rel.includes(0) ? 0.25 : 0;
        const score = hits / q.intervals.length - extras * 0.16 - misses * 0.08 + hasRoot;
        if (!best || score > best.score) best = { root, quality: q.name, score, hits, extras };
      }
    }
    if (!best || best.score < 0.45) return { name: pcs.map(pcName).join(" "), notes, pcs, root: null, quality: "cluster", confidence: clamp(best?.score || 0, 0, 1) };
    return { name: pcName(best.root) + best.quality, notes, pcs, root: best.root, quality: best.quality || "major", confidence: clamp(best.score, 0, 1) };
  }
  function formatPercent(x) {
    return `${Math.round(clamp(Number(x) || 0, 0, 1) * 100)}%`;
  }
  function setReactiveGlobalFlag() {
    try {
      window.__MO_REACTIVE_COLOR_ENABLED__ = !!C.enabled;
    } catch {
    }
  }
  function loadCustomPresets() {
    try {
      S.customPresets = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch {
      S.customPresets = {};
    }
  }
  function saveCustomPresets() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(S.customPresets));
    } catch {
    }
  }
  function cloneConfig(config) {
    return structuredClone(config);
  }
  function normalizePalette(pal) {
    return (Array.isArray(pal) ? pal : String(pal || "").split(/[\s,;]+/)).map((x) => String(x).trim()).filter(Boolean);
  }
  function hexToRgb(hex) {
    hex = String(hex || "").trim();
    if (!hex.startsWith("#")) hex = "#" + hex;
    if (/^#[0-9a-f]{3}$/i.test(hex)) hex = "#" + hex.slice(1).split("").map((c) => c + c).join("");
    const m = hex.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbToHex(r, g, b, a = 255) {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
  }
  function colorAtPalette(palette, pos) {
    const pal = normalizePalette(palette);
    if (!pal.length) return [255, 255, 255];
    if (pal.length === 1) return hexToRgb(pal[0]);
    const f = clamp(pos, 0, 1) * (pal.length - 1);
    const i = Math.floor(f);
    const t = f - i;
    const a = hexToRgb(pal[i]);
    const b = hexToRgb(pal[Math.min(i + 1, pal.length - 1)]);
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  function boostRgb(rgb, satBoost, lightBoost) {
    let [r, g, b] = rgb.map((x) => clamp(x, 0, 255));
    const grey = (r + g + b) / 3;
    r = grey + (r - grey) * satBoost;
    g = grey + (g - grey) * satBoost;
    b = grey + (b - grey) * satBoost;
    r *= lightBoost;
    g *= lightBoost;
    b *= lightBoost;
    return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
  }
  function applyCurve(x, curve) {
    x = clamp(x, 0, 1);
    if (curve === "soft") return Math.sqrt(x);
    if (curve === "punch") return x * x * (3 - 2 * x);
    if (curve === "contrast") return clamp((x - 0.18) / 0.72, 0, 1);
    if (curve === "hard") return x < 0.42 ? 0 : 1;
    if (curve === "exp") return x * x;
    return x;
  }
  function dynamicFeature(name, value) {
    value = clamp(Number(value) || 0, 0, 1);
    if (!C.dynamicRanges) return value;
    if (!["velocity", "density", "intensity", "tension", "spread", "arpeggioSpeed", "repetition", "chordSize"].includes(name)) return value;
    const r = S.ranges[name] || (S.ranges[name] = { min: value, max: value, t: now2() });
    const relax = 25e-4;
    r.min = Math.min(value, lerp(r.min, value, relax));
    r.max = Math.max(value, lerp(r.max, value, relax));
    const span = r.max - r.min;
    if (span < 0.08) return clamp(value * 1.25, 0, 1);
    return clamp((value - r.min) / span, 0, 1);
  }
  function applyDynamicFeatures(f) {
    const out = { ...f };
    for (const k of ["velocity", "density", "intensity", "tension", "spread", "arpeggioSpeed", "repetition", "chordSize"]) {
      out[k] = dynamicFeature(k, out[k]);
    }
    return out;
  }
  function resetDynamicRanges() {
    S.ranges = {};
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
      const d = Math.abs(pcs[i] - pcs[j]);
      const iv = Math.min(d, 12 - d);
      if ([1, 2, 6].includes(iv)) t += 0.22;
      if ([3, 4, 8, 9].includes(iv)) t += 0.08;
      if ([5, 7].includes(iv)) t += 0.03;
    }
    return clamp(t, 0, 1);
  }
  function computeIntensity() {
    const t = now2();
    S.notes = S.notes.filter((e) => t - e.t < 1600);
    const recent = S.notes.filter((e) => t - e.t < 1e3);
    const rate = clamp(recent.length / 28, 0, 1);
    const av = recent.length ? avg(recent.map((e) => e.velocity)) : 0;
    const size = clamp(S.active.size / 10, 0, 1);
    S.density = rate;
    S.intensity = clamp(0.18 + av * 0.34 + rate * 0.25 + size * 0.23 + S.sustain * 0.12, 0, 1);
  }
  function memoryChord() {
    const t = now2();
    const win = Math.max(40, Number(C.arpeggioWindowMs) || 700);
    const byNote = /* @__PURE__ */ new Map();
    for (const e of S.notes) {
      if (t - e.t <= win) byNote.set(Math.round(e.note), { note: e.note, velocity: e.velocity, t: e.t });
    }
    return [...byNote.values()].sort((a, b) => a.t - b.t).map((x) => ({ note: x.note, velocity: x.velocity, t: x.t }));
  }
  function getChord(fallback) {
    const active = [...S.active.values()].map((x) => ({ note: x.note, velocity: x.velocity, t: x.t }));
    const mem = memoryChord();
    const mode = C.harmonyMode || "hybrid";
    if (mode === "active") return active.length ? active : fallback?.length ? fallback : [{ note: S.lastNote, velocity: S.lastVelocity, t: now2() }];
    if (mode === "memory") return mem.length ? mem : active.length ? active : fallback?.length ? fallback : [{ note: S.lastNote, velocity: S.lastVelocity, t: now2() }];
    if (mode === "sustainAware") {
      if (S.sustain > 0.15 && mem.length) return mem;
      return active.length ? active : fallback?.length ? fallback : [{ note: S.lastNote, velocity: S.lastVelocity, t: now2() }];
    }
    const combined = /* @__PURE__ */ new Map();
    for (const x of [...mem, ...active]) combined.set(Math.round(x.note), x);
    const out = [...combined.values()].sort((a, b) => (a.t || 0) - (b.t || 0));
    return out.length ? out : fallback?.length ? fallback : [{ note: S.lastNote, velocity: S.lastVelocity, t: now2() }];
  }
  function getFeatures(chord) {
    computeIntensity();
    const notes = chord.map((x) => Number(x.note)).filter(Number.isFinite);
    const vels = chord.map((x) => Number(x.velocity ?? 0.7));
    const times = chord.map((x) => Number(x.t ?? now2())).filter(Number.isFinite);
    const minN = Math.min(...notes), maxN = Math.max(...notes), avgN = avg(notes), avVel = avg(vels), sig = chordSignature(chord), hash = hashText(sig + ":" + Math.round(avgN));
    const nrm = (n) => clamp((n - C.minNote) / Math.max(1, C.maxNote - C.minNote), 0, 1);
    const blacks = notes.filter(isBlackKey).length;
    const whites = notes.length - blacks;
    const leftNotes = notes.filter((n) => n < 60).length;
    const rightNotes = notes.filter((n) => n >= 60).length;
    const octaveAvg = clamp((avgN / 12 - 1) / 8, 0, 1);
    const ordered = chord.slice().filter((x) => Number.isFinite(Number(x.note))).sort((a, b) => (a.t || 0) - (b.t || 0));
    const first = ordered[0]?.note ?? avgN, last = ordered[ordered.length - 1]?.note ?? avgN;
    const dir = ordered.length > 1 ? clamp((last - first + 24) / 48, 0, 1) : 0.5;
    const spanT = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
    const arpSpeed = ordered.length > 1 ? clamp(1 - spanT / Math.max(50, Number(C.arpeggioWindowMs) || 700), 0, 1) : 0;
    let repeats = 0;
    const pcCounts = {};
    for (const n of notes) {
      const pc2 = (Math.round(n) % 12 + 12) % 12;
      pcCounts[pc2] = (pcCounts[pc2] || 0) + 1;
      if (pcCounts[pc2] > 1) repeats++;
    }
    const chordInfo = detectChord(chord);
    const q = String(chordInfo.quality || "");
    const harmonyMajor = (q === "major" || q.includes("maj") || q === "") && chordInfo.root != null ? 1 : 0;
    const harmonyMinor = q.includes("m") && !q.includes("maj") ? 1 : 0;
    const harmonyDominant = q === "7" || q === "9" || q.includes("13") ? 1 : 0;
    const harmonySus = q.includes("sus") ? 1 : 0;
    const harmonyCluster = q === "cluster" || chordInfo.confidence < 0.45 ? 1 : 0;
    const base = {
      pitch: nrm(avgN),
      lowest: nrm(minN),
      highest: nrm(maxN),
      pitchClass: (Math.round(avgN) % 12 + 12) % 12 / 11,
      velocity: clamp(avVel, 0, 1),
      density: S.density,
      chordSize: clamp(chord.length / 8, 0, 1),
      intensity: S.intensity,
      tension: tension(chord),
      spread: clamp((maxN - minN) / 36, 0, 1),
      sustain: clamp(S.sustain, 0, 1),
      chordHash: hash % 1e3 / 999,
      time: (Math.sin(now2() / 1e3 * Math.PI * 2) + 1) / 2,
      blackKeys: notes.length ? blacks / notes.length : 0,
      whiteKeys: notes.length ? whites / notes.length : 0,
      leftHand: notes.length ? leftNotes / notes.length : 0,
      rightHand: notes.length ? rightNotes / notes.length : 0,
      octave: octaveAvg,
      noteIdentity: (Math.round(avgN) % 12 + 12) % 12 / 11,
      currentKey: isBlackKey(S.lastNote) ? 1 : 0,
      dominantKey: blacks >= whites ? 1 : 0,
      keyboardSide: clamp((avgN - 48) / 36, 0, 1),
      arpeggioDirection: dir,
      arpeggioSpeed: arpSpeed,
      repetition: notes.length ? clamp(repeats / notes.length, 0, 1) : 0,
      harmonyMajor,
      harmonyMinor,
      harmonyDominant,
      harmonySus,
      harmonyCluster,
      chordConfidence: clamp(chordInfo.confidence || 0, 0, 1)
    };
    return applyDynamicFeatures(base);
  }
  function activePatterns() {
    if (Array.isArray(C.patterns) && C.patterns.length) return C.patterns;
    if (C.pattern && C.pattern.type && C.pattern.type !== "off") return [C.pattern];
    return [];
  }
  function patternValue(type, periodMs) {
    if (!type || type === "off") return 0.5;
    const phase = now2() % Math.max(50, Number(periodMs) || 1e3) / Math.max(50, Number(periodMs) || 1e3);
    if (type === "pulse") return (Math.sin(phase * Math.PI * 2) + 1) / 2;
    if (type === "breath") return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    if (type === "blink") return phase < 0.5 ? 0 : 1;
    if (type === "strobe") return phase < 0.14 ? 1 : 0;
    if (type === "wave") return phase;
    if (type === "saw") return phase;
    return 0.5;
  }
  function applyOutput(out, value, amount, acc) {
    amount = Number(amount);
    if (!Number.isFinite(amount)) amount = 1;
    if (out === "hardPalette") acc.hardPos = amount >= 0 ? value : 1 - value;
    else if (out === "palette") acc.pos += (value - 0.5) * amount;
    else if (out === "alpha") acc.alpha += (value - 0.5) * amount;
    else if (out === "saturation") acc.sat += (value - 0.5) * amount;
    else if (out === "light") acc.light += (value - 0.5) * amount;
    else if (out === "hue") acc.hue += (value - 0.5) * amount;
  }
  function makeColor(chord) {
    const features = getFeatures(chord);
    const chordInfo = detectChord(chord);
    const acc = { pos: Number(C.basePos) || 0, alpha: Number(C.baseAlpha) || 0.75, sat: Number(C.baseSat) || 1, light: Number(C.baseLight) || 1, hue: 0, hardPos: null };
    const ruleTrace = [];
    for (const r of C.rules || []) {
      let raw = features[r.input] ?? 0;
      let v = applyCurve(raw, r.curve);
      if (r.invert) v = 1 - v;
      applyOutput(r.output, v, r.amount, acc);
      ruleTrace.push({ input: r.input, output: r.output, raw, value: v, amount: Number(r.amount) || 0, curve: r.curve || "linear", invert: !!r.invert });
    }
    let patternTrace = [];
    for (const pat of activePatterns()) {
      if (!pat?.type || pat.type === "off") continue;
      let v = patternValue(pat.type, pat.periodMs);
      applyOutput(pat.output, v, pat.amount, acc);
      patternTrace.push({ type: pat.type, output: pat.output, value: v, amount: Number(pat.amount) || 0, periodMs: Number(pat.periodMs) || 0 });
    }
    let pos = acc.hardPos != null ? clamp(acc.hardPos, 0, 1) : (acc.pos % 1 + 1) % 1;
    let rgb = colorAtPalette(C.palette, pos);
    if (acc.hue) rgb = colorAtPalette([rgbToHex(...rgb), ...normalizePalette(C.palette)], ((pos + acc.hue) % 1 + 1) % 1);
    rgb = boostRgb(rgb, clamp(acc.sat, 0.05, 3), clamp(acc.light, 0.05, 3));
    let alpha = lerp(C.minAlpha, C.maxAlpha, clamp(acc.alpha, 0, 1));
    if (C.smoothColor) {
      if (!S.smoothRgb) S.smoothRgb = rgb;
      if (S.smoothAlpha == null) S.smoothAlpha = alpha;
      const sm = clamp(C.smoothing, 0.01, 1);
      S.smoothRgb = [lerp(S.smoothRgb[0], rgb[0], sm), lerp(S.smoothRgb[1], rgb[1], sm), lerp(S.smoothRgb[2], rgb[2], sm)];
      S.smoothAlpha = lerp(S.smoothAlpha, alpha, sm);
      rgb = S.smoothRgb;
      alpha = S.smoothAlpha;
    }
    const color = rgbToHex(rgb[0], rgb[1], rgb[2], alpha);
    S.lastChord = chord.map((n) => ({ note: Number(n.note), velocity: Number(n.velocity ?? 0) }));
    S.lastFeatures = features;
    S.lastAnalysis = { chord: chordInfo, notes: chordInfo.notes.map(noteName), activeCount: S.active.size, harmonyMode: C.harmonyMode || "hybrid", arpeggioWindowMs: Number(C.arpeggioWindowMs) || 700 };
    S.lastDecision = { color, palettePos: pos, hardPalette: acc.hardPos != null, alpha: clamp(alpha / 255, 0, 1), alphaByte: Math.round(clamp(alpha, 0, 255)), saturation: acc.sat, light: acc.light, hueOffset: acc.hue, rules: ruleTrace, pattern: patternTrace };
    return color;
  }
  async function sendPreference(color) {
    if (S.sending) return;
    S.sending = true;
    try {
      const res = await fetch(PREF_ENDPOINT, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ colors: [color] }) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      S.lastColor = color;
      updateUI();
    } catch (e) {
      updateUI("error " + e.message);
      console.warn("[MO Reactive Color]", e);
    } finally {
      S.sending = false;
    }
  }
  function maybeSend(chord) {
    if (!C.enabled) return;
    const t = now2();
    if (t - S.lastSend < C.sendEveryMs) return;
    S.lastSend = t;
    sendPreference(makeColor(getChord(chord)));
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
  function normalizeEvent(e) {
    if (!e) return null;
    if (Array.isArray(e)) {
      const st2 = Number(e[0]), note2 = Number(e[1]), vel = Number(e[2] ?? 0);
      if (!Number.isFinite(st2) || !Number.isFinite(note2)) return null;
      if ((st2 & 240) === 144 && vel > 0) return { type: "on", note: note2, velocity: vel / 127 };
      if ((st2 & 240) === 128 || (st2 & 240) === 144 && vel === 0) return { type: "off", note: note2 };
      if ((st2 & 240) === 176 && note2 === 64) return { type: "sustain", value: vel / 127 };
      return null;
    }
    if (typeof e !== "object") return null;
    const name = String(e.name ?? e.type ?? e.event ?? e.evt ?? e.kind ?? "").toUpperCase();
    const note = e.note ?? e.n ?? e.k ?? e.key ?? e.midi ?? e.pitch ?? e.noteNumber;
    const velocity = e.velocity ?? e.vel ?? e.v ?? e.value ?? e.force ?? 127;
    if (name.includes("SUSTAIN") || e.cc === 64 || e.control === 64) return { type: "sustain", value: Number(velocity) > 1 ? Number(velocity) / 127 : Number(velocity) };
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
        else if (ev.type === "sustain") S.sustain = clamp(ev.value, 0, 1);
      }
      if (ons.length > 1) maybeSend(ons);
    } catch {
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
  function presetList() {
    return { ...Object.fromEntries(Object.entries(BUILTIN).map(([k, v]) => ["builtin:" + k, v])), ...Object.fromEntries(Object.entries(S.customPresets).map(([k, v]) => ["custom:" + k, v])) };
  }
  function applyConfig(config, preset = "custom") {
    Object.assign(C, cloneConfig(config));
    C.preset = preset;
    S.smoothRgb = null;
    S.smoothAlpha = null;
    resetDynamicRanges();
  }
  function palettePreviewHtml(palette) {
    return normalizePalette(palette).map((c) => `<span class="mo-rc-swatch" style="background:${c}" title="${c}"></span>`).join("");
  }
  function renderInspector() {
    if (!S.inspector) return;
    if (!C.showMonitor) {
      S.inspector.style.display = "none";
      return;
    }
    S.inspector.style.display = "block";
    const f = S.lastFeatures;
    const d = S.lastDecision;
    const a = S.lastAnalysis;
    if (!f || !d || !a) {
      S.inspector.innerHTML = `<div class="mo-meter-title">Signal Monitor</div><div class="mo-rc-small">Play notes to see the detected chord and modulation output.</div>`;
      return;
    }
    const strongest = (d.rules || []).slice().sort((x, y) => Math.abs(y.amount * (y.value - 0.5)) - Math.abs(x.amount * (x.value - 0.5))).slice(0, 4);
    const ruleHtml = strongest.length ? strongest.map((r) => `<div class="trace-row"><span>${r.input}</span><b>${formatPercent(r.raw)}</b><span>\u2192 ${r.output}</span></div>`).join("") : '<div class="mo-rc-small">No active modulation rule</div>';
    S.inspector.innerHTML = `
    <div class="monitor-head"><span class="monitor-title">Signal Monitor</span><span class="monitor-color" style="background:${d.color}"></span><code>${d.color}</code></div>
    <div class="monitor-grid">
      <div><span>Chord</span><b>${a.chord.name}</b></div>
      <div><span>Notes</span><b>${a.notes.join(" ") || "\u2014"}</b></div>
      <div><span>Velocity</span><b>${formatPercent(f.velocity)}</b></div>
      <div><span>Density</span><b>${formatPercent(f.density)}</b></div>
      <div><span>Tension</span><b>${formatPercent(f.tension)}</b></div>
      <div><span>Spread</span><b>${formatPercent(f.spread)}</b></div>
      <div><span>Black keys</span><b>${formatPercent(f.blackKeys)}</b></div>
      <div><span>Current key</span><b>${f.currentKey >= 0.5 ? "Black" : "White"}</b></div>
      <div><span>Left / Right</span><b>${formatPercent(f.leftHand)} / ${formatPercent(f.rightHand)}</b></div>
      <div><span>Arp direction</span><b>${formatPercent(f.arpeggioDirection)}</b></div>
      <div><span>Arp speed</span><b>${formatPercent(f.arpeggioSpeed)}</b></div>
      <div><span>Harmony mode</span><b>${a.harmonyMode} / ${a.arpeggioWindowMs}ms</b></div>
      <div><span>Confidence</span><b>${formatPercent(f.chordConfidence)}</b></div>
      <div><span>Palette pos</span><b>${formatPercent(d.palettePos)}</b></div>
      <div><span>Alpha</span><b>${d.alphaByte}</b></div>
    </div>
    <div class="trace-title">Main modulation</div>${ruleHtml}
  `;
  }
  function updateUI(msg) {
    if (S.preview) {
      S.preview.style.background = S.lastColor;
      S.preview.style.boxShadow = `0 0 ${12 + S.intensity * 42}px ${S.lastColor}`;
    }
    if (S.status) S.status.textContent = msg || (C.enabled ? "ON" : "OFF");
    renderInspector();
  }
  var INPUTS = ["pitch", "lowest", "highest", "pitchClass", "noteIdentity", "octave", "currentKey", "dominantKey", "keyboardSide", "velocity", "density", "chordSize", "intensity", "tension", "spread", "sustain", "chordHash", "blackKeys", "whiteKeys", "leftHand", "rightHand", "arpeggioDirection", "arpeggioSpeed", "repetition", "harmonyMajor", "harmonyMinor", "harmonyDominant", "harmonySus", "harmonyCluster", "chordConfidence", "time"];
  var OUTPUTS = ["palette", "hardPalette", "alpha", "saturation", "light", "hue"];
  var INPUT_LABELS = { pitch: "Average pitch", lowest: "Lowest note", highest: "Highest note", pitchClass: "Pitch class", noteIdentity: "Note name", octave: "Octave", currentKey: "Current key black/white", dominantKey: "Dominant key black/white", keyboardSide: "Keyboard side left/right", velocity: "Velocity", density: "Note density", chordSize: "Chord size", intensity: "Overall intensity", tension: "Dissonance", spread: "Bass\u2194treble spread", sustain: "Sustain", chordHash: "Chord identity", blackKeys: "Black-key ratio", whiteKeys: "White-key ratio", leftHand: "Left-hand ratio", rightHand: "Right-hand ratio", arpeggioDirection: "Arpeggio direction", arpeggioSpeed: "Arpeggio speed", repetition: "Repeated notes", harmonyMajor: "Major color", harmonyMinor: "Minor color", harmonyDominant: "Dominant color", harmonySus: "Suspended color", harmonyCluster: "Cluster / unknown", chordConfidence: "Chord confidence", time: "Time / LFO" };
  var OUTPUT_LABELS = { palette: "Palette position (blend)", hardPalette: "Palette slot (hard)", alpha: "Alpha", saturation: "Saturation", light: "Light", hue: "Hue shift" };
  var CURVES = ["linear", "soft", "punch", "contrast", "hard", "exp"];
  function renderPresetButtons(box) {
    const wrap = box.querySelector("#mo-rc-presets");
    const all = presetList();
    wrap.innerHTML = Object.entries(all).map(([key, p]) => `<button class="mo-preset" data-preset="${key}">${p.name}</button>`).join("");
    wrap.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.preset;
        const p = presetList()[key];
        applyConfig(p.config, key);
        sync(box);
        updateUI(p.name);
      };
    });
  }
  function ruleRow(rule, idx) {
    const opt = (arr, val, labels = {}) => arr.map((x) => `<option value="${x}" ${x === val ? "selected" : ""}>${labels[x] || x}</option>`).join("");
    return `<div class="mo-rule" data-i="${idx}">
    <select class="r-input">${opt(INPUTS, rule.input, INPUT_LABELS)}</select>
    <span class="arrow">\u2192</span>
    <select class="r-output">${opt(OUTPUTS, rule.output, OUTPUT_LABELS)}</select>
    <input class="r-amount" type="range" min="-2" max="2" step="0.05" value="${rule.amount}">
    <select class="r-curve">${opt(CURVES, rule.curve || "linear")}</select>
    <label><input class="r-invert" type="checkbox" ${rule.invert ? "checked" : ""}> inv</label>
    <button class="mo-btn small r-del">\xD7</button>
  </div>`;
  }
  function renderRules(box) {
    const list = box.querySelector("#mo-rc-rules");
    list.innerHTML = (C.rules || []).map(ruleRow).join("");
    list.querySelectorAll(".mo-rule").forEach((row) => {
      const i = Number(row.dataset.i);
      const read = () => {
        const r = C.rules[i];
        if (!r) return;
        r.input = row.querySelector(".r-input").value;
        r.output = row.querySelector(".r-output").value;
        r.amount = Number(row.querySelector(".r-amount").value);
        r.curve = row.querySelector(".r-curve").value;
        r.invert = row.querySelector(".r-invert").checked;
        C.preset = "custom";
        syncActiveOnly(box);
      };
      row.querySelectorAll("select,input").forEach((el) => el.onchange = read);
      row.querySelector(".r-del").onclick = () => {
        C.rules.splice(i, 1);
        renderRules(box);
        syncActiveOnly(box);
      };
    });
  }
  function renderPaletteEditor(box) {
    const wrap = box.querySelector("#mo-rc-palette-editor");
    wrap.innerHTML = normalizePalette(C.palette).map((c, i) => `<div class="color-cell"><input type="color" value="${c.slice(0, 7)}" data-i="${i}"><button class="mo-btn small" data-del="${i}">\xD7</button></div>`).join("") + `<button id="mo-rc-add-color" class="mo-btn">+ Color</button>`;
    wrap.querySelectorAll("input[type=color]").forEach((inp) => inp.oninput = () => {
      C.palette[Number(inp.dataset.i)] = inp.value;
      C.preset = "custom";
      syncActiveOnly(box);
    });
    wrap.querySelectorAll("[data-del]").forEach((btn) => btn.onclick = () => {
      C.palette.splice(Number(btn.dataset.del), 1);
      if (!C.palette.length) C.palette = ["#ffffff"];
      renderPaletteEditor(box);
      syncActiveOnly(box);
    });
    wrap.querySelector("#mo-rc-add-color").onclick = () => {
      C.palette.push("#ffffff");
      renderPaletteEditor(box);
      syncActiveOnly(box);
    };
  }
  function patternRow(pat, idx) {
    const opt = (arr, val, labels = {}) => arr.map((x) => `<option value="${x}" ${x === val ? "selected" : ""}>${labels[x] || x}</option>`).join("");
    const patterns = ["off", "pulse", "breath", "blink", "strobe", "wave", "saw"];
    return `<div class="mo-pattern" data-i="${idx}">
    <select class="p-type">${opt(patterns, pat.type || "off")}</select>
    <span class="arrow">\u2192</span>
    <select class="p-output">${opt(OUTPUTS, pat.output || "alpha", OUTPUT_LABELS)}</select>
    <input class="p-amount" type="range" min="-2" max="2" step="0.05" value="${pat.amount ?? 0}">
    <input class="p-period" type="number" min="50" max="20000" step="50" value="${pat.periodMs ?? 2e3}">
    <button class="mo-btn small p-del">\xD7</button>
  </div>`;
  }
  function renderPatterns(box) {
    const list = box.querySelector("#mo-rc-patterns");
    if (!list) return;
    const pats = Array.isArray(C.patterns) ? C.patterns : C.pattern ? [C.pattern] : [];
    list.innerHTML = pats.map(patternRow).join("");
    list.querySelectorAll(".mo-pattern").forEach((row) => {
      const i = Number(row.dataset.i);
      const read = () => {
        if (!Array.isArray(C.patterns)) C.patterns = [];
        C.patterns[i] = { type: row.querySelector(".p-type").value, output: row.querySelector(".p-output").value, amount: Number(row.querySelector(".p-amount").value), periodMs: Number(row.querySelector(".p-period").value) };
        C.pattern = C.patterns[0] || { type: "off", output: "alpha", amount: 0, periodMs: 2e3 };
        C.preset = "custom";
        syncActiveOnly(box);
      };
      row.querySelectorAll("select,input").forEach((el) => el.onchange = read);
      row.querySelector(".p-del").onclick = () => {
        C.patterns.splice(i, 1);
        C.pattern = C.patterns[0] || { type: "off", output: "alpha", amount: 0, periodMs: 2e3 };
        renderPatterns(box);
        syncActiveOnly(box);
      };
    });
  }
  function readExpertNumbers(box) {
    C.minNote = Number(box.querySelector("#minNote").value);
    C.maxNote = Number(box.querySelector("#maxNote").value);
    C.minAlpha = Number(box.querySelector("#minAlpha").value);
    C.maxAlpha = Number(box.querySelector("#maxAlpha").value);
    C.sendEveryMs = Number(box.querySelector("#speed").value);
    C.harmonyMode = box.querySelector("#harmonyMode").value;
    C.arpeggioWindowMs = Number(box.querySelector("#arpeggioWindow").value);
    C.dynamicRanges = box.querySelector("#dynamicRanges").checked;
    C.basePos = Number(box.querySelector("#basePos").value);
    C.baseAlpha = Number(box.querySelector("#baseAlpha").value);
    C.baseSat = Number(box.querySelector("#baseSat").value);
    C.baseLight = Number(box.querySelector("#baseLight").value);
    C.smoothing = Number(box.querySelector("#smoothAmt").value);
    C.smoothColor = box.querySelector("#smoothColor").checked;
    C.patterns = [...box.querySelectorAll(".mo-pattern")].map((row) => ({ type: row.querySelector(".p-type").value, output: row.querySelector(".p-output").value, amount: Number(row.querySelector(".p-amount").value), periodMs: Number(row.querySelector(".p-period").value) }));
    C.pattern = C.patterns[0] || { type: "off", output: "alpha", amount: 0, periodMs: 2e3 };
    C.preset = "custom";
    S.smoothRgb = null;
    S.smoothAlpha = null;
    resetDynamicRanges();
  }
  function fillExpert(box) {
    box.querySelector("#minNote").value = C.minNote;
    box.querySelector("#maxNote").value = C.maxNote;
    box.querySelector("#minAlpha").value = C.minAlpha;
    box.querySelector("#maxAlpha").value = C.maxAlpha;
    box.querySelector("#speed").value = C.sendEveryMs;
    box.querySelector("#harmonyMode").value = C.harmonyMode || "hybrid";
    box.querySelector("#arpeggioWindow").value = C.arpeggioWindowMs || 700;
    box.querySelector("#dynamicRanges").checked = !!C.dynamicRanges;
    box.querySelector("#basePos").value = C.basePos;
    box.querySelector("#baseAlpha").value = C.baseAlpha;
    box.querySelector("#baseSat").value = C.baseSat;
    box.querySelector("#baseLight").value = C.baseLight;
    box.querySelector("#smoothAmt").value = C.smoothing;
    box.querySelector("#smoothColor").checked = !!C.smoothColor;
    renderPatterns(box);
  }
  function syncActiveOnly(box) {
    box.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b.dataset.preset === C.preset));
    box.querySelector("#mo-rc-palette").innerHTML = palettePreviewHtml(C.palette);
    updateUI();
  }
  function sync(box) {
    box.querySelector("#mo-rc-toggle").textContent = C.enabled ? "ON" : "OFF";
    box.querySelector("#mo-rc-toggle").classList.toggle("active", C.enabled);
    box.querySelector("#mo-rc-monitor-toggle").classList.toggle("active", !!C.showMonitor);
    box.querySelector("#mo-rc-current").textContent = presetList()[C.preset]?.name || "Custom";
    syncActiveOnly(box);
    fillExpert(box);
    renderRules(box);
    renderPaletteEditor(box);
  }
  function serializeCurrent(name) {
    return { name, config: cloneConfig({ palette: C.palette, minNote: C.minNote, maxNote: C.maxNote, minAlpha: C.minAlpha, maxAlpha: C.maxAlpha, sendEveryMs: C.sendEveryMs, smoothing: C.smoothing, smoothColor: C.smoothColor, basePos: C.basePos, baseAlpha: C.baseAlpha, baseSat: C.baseSat, baseLight: C.baseLight, rules: C.rules, pattern: C.pattern, patterns: C.patterns, harmonyMode: C.harmonyMode, arpeggioWindowMs: C.arpeggioWindowMs, dynamicRanges: C.dynamicRanges }) };
  }
  function mountReactiveColorUI() {
    hookSend();
    loadCustomPresets();
    if (document.getElementById("mo-reactive-color")) return { box: document.getElementById("mo-reactive-color") };
    const box = document.createElement("div");
    box.id = "mo-reactive-color";
    Object.assign(box.style, { position: "fixed", right: "12px", bottom: "72px", zIndex: 999999, width: "620px", maxWidth: "calc(100vw - 24px)", maxHeight: "76vh", overflow: "hidden", resize: "both", background: "rgba(17,17,17,.96)", color: "#eee", padding: "10px", borderRadius: "10px", fontFamily: "system-ui", boxShadow: "0 10px 30px rgba(0,0,0,.6)" });
    box.innerHTML = `
  <style>
    #mo-reactive-color *{box-sizing:border-box}.mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;user-select:none;cursor:pointer}.mo-btn:hover,.mo-preset:hover{background:#353535}.mo-btn.active{background:#2f8f55}.mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px}.mo-rc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.mo-rc-small{font-size:12px;opacity:.72}.mo-rc-presets{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.mo-preset{background:#242424;color:#eee;border:1px solid #3b3b3b;border-radius:9px;padding:10px 8px;text-align:center;cursor:pointer}.mo-preset.active{background:#67335a;border-color:#d35aae}.mo-rc-palette{display:flex;gap:3px;margin-top:8px}.mo-rc-swatch{height:16px;flex:1;border-radius:4px;border:1px solid rgba(255,255,255,.18)}#mo-rc-body{max-height:calc(76vh - 45px);overflow:auto;padding-right:6px}#mo-rc-preview{height:28px;border-radius:8px;background:#7c4dffcc;box-shadow:0 0 16px #7c4dffcc;margin-top:8px}#mo-rc-inspector{margin-top:8px;padding:8px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:9px}.monitor-head{display:flex;gap:7px;align-items:center}.monitor-title,.mo-meter-title{font-weight:700}.monitor-color{width:18px;height:18px;border-radius:5px;border:1px solid rgba(255,255,255,.25);box-shadow:0 0 12px currentColor}.monitor-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin-top:7px}.monitor-grid div{display:flex;justify-content:space-between;gap:6px;background:rgba(0,0,0,.18);border-radius:6px;padding:4px 6px}.monitor-grid span,.trace-row span{opacity:.65}.trace-title{margin-top:8px;font-weight:700}.trace-row{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}#mo-rc-expert{display:none;margin-top:10px;border-top:1px solid #333;padding-top:10px}#mo-rc-expert.open{display:block}#mo-rc-expert label{font-size:12px;opacity:.84}.expert-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.expert-grid input,.expert-grid select{width:100%;background:#1b1b1b;color:#eee;border:1px solid #3b3b3b;border-radius:8px;padding:6px}.mo-rule{display:grid;grid-template-columns:1.2fr auto 1.2fr 1fr 1fr auto auto;gap:6px;align-items:center;margin:5px 0}.mo-pattern{display:grid;grid-template-columns:1fr auto 1fr 1fr 0.8fr auto;gap:6px;align-items:center;margin:5px 0}.mo-pattern select,.mo-pattern input,.mo-rule select,.mo-rule input{background:#1b1b1b;color:#eee;border:1px solid #3b3b3b;border-radius:7px;padding:5px;width:100%}.small{padding:4px 8px}.color-grid{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.color-cell{display:flex;gap:3px;align-items:center}.color-cell input{width:34px;height:30px;background:none;border:0}.section{margin-top:10px;padding:8px;background:rgba(255,255,255,.035);border-radius:9px}.section-title{font-weight:700;margin-bottom:6px}
  </style>
  <div id="mo-rc-hdr" style="display:flex;gap:8px;align-items:center;cursor:move;user-select:none"><strong>Reactive Note Color</strong><span id="mo-rc-status" class="mo-chip" style="margin-left:auto">OFF</span></div>
  <div id="mo-rc-body">
    <div class="mo-rc-row" style="margin-top:8px"><button id="mo-rc-toggle" class="mo-btn">OFF</button><button id="mo-rc-monitor-toggle" class="mo-btn">Monitor</button><button id="mo-rc-expert-toggle" class="mo-btn">Expert / Custom \u25BE</button></div>
    <div id="mo-rc-current" style="font-weight:700;margin-top:9px"></div><div id="mo-rc-presets" class="mo-rc-presets"></div><div id="mo-rc-palette" class="mo-rc-palette"></div><div id="mo-rc-preview"></div><div id="mo-rc-inspector"></div>
    <div id="mo-rc-expert">
      <div class="mo-rc-row"><button id="blank" class="mo-btn">Blank</button><button id="save" class="mo-btn">Save preset</button><button id="delete" class="mo-btn">Delete custom</button><input id="presetName" placeholder="Preset name" style="flex:1;background:#1b1b1b;color:#eee;border:1px solid #3b3b3b;border-radius:8px;padding:6px"></div>
      <div class="section"><div class="section-title">Palette</div><div id="mo-rc-palette-editor" class="color-grid"></div><div class="mo-rc-row"><button class="mo-btn small" data-lib="inferno">Inferno</button><button class="mo-btn small" data-lib="royal">Royal</button><button class="mo-btn small" data-lib="spectrum">Spectrum</button><button class="mo-btn small" data-lib="aurora">Aurora</button><button class="mo-btn small" data-lib="ghost">Ghost</button><button class="mo-btn small" data-lib="noir">Noir</button><button class="mo-btn small" data-lib="acid">Acid</button><button class="mo-btn small" data-lib="solar">Solar</button><button class="mo-btn small" data-lib="starlight">Starlight</button><button class="mo-btn small" data-lib="brass">Brass</button><button class="mo-btn small" data-lib="obsidianKeys">Obsidian Keys</button><button class="mo-btn small" data-lib="leftRightElegance">Split Stage</button><button class="mo-btn small" data-lib="cinema">Cinema</button><button class="mo-btn small" data-lib="neonScanner">Neon</button><button class="mo-btn small" data-lib="monochromeGold">Gold</button></div></div>
      <div class="section"><div class="section-title">Modulation Matrix</div><div id="mo-rc-rules"></div><button id="addRule" class="mo-btn">+ Add modulation</button></div>
      <div class="section"><div class="section-title">Time Pattern Layers</div><div id="mo-rc-patterns"></div><button id="addPattern" class="mo-btn">+ Add time pattern</button></div>
      <div class="section"><div class="section-title">Base / Range / Performance</div><div class="expert-grid"><label><input id="dynamicRanges" type="checkbox" style="width:auto"> Auto-normalize live ranges</label><label>Base palette pos<input id="basePos" type="number" min="0" max="1" step="0.01"></label><label>Base alpha<input id="baseAlpha" type="number" min="0" max="1" step="0.01"></label><label>Base saturation<input id="baseSat" type="number" min="0.05" max="3" step="0.05"></label><label>Base light<input id="baseLight" type="number" min="0.05" max="3" step="0.05"></label><label>Min note<input id="minNote" type="number" min="0" max="127"></label><label>Max note<input id="maxNote" type="number" min="0" max="127"></label><label>Min alpha<input id="minAlpha" type="number" min="0" max="255"></label><label>Max alpha<input id="maxAlpha" type="number" min="0" max="255"></label><label>Update ms<input id="speed" type="number" min="250" max="2000" step="10"></label><label>Harmony mode<select id="harmonyMode"><option value="active">Active notes only</option><option value="memory">Arpeggio memory</option><option value="sustainAware">Sustain-aware</option><option value="hybrid">Hybrid</option></select></label><label>Arpeggio window ms<input id="arpeggioWindow" type="number" min="80" max="2500" step="10"></label><label>Smoothing<input id="smoothAmt" type="number" min="0.01" max="1" step="0.01"></label><label><input id="smoothColor" type="checkbox" style="width:auto"> Smooth color</label></div></div>
    </div>
  </div>`;
    document.body.appendChild(box);
    const hdr = box.querySelector("#mo-rc-hdr");
    addMinimizer(box, hdr, "reactive-color");
    makeDraggable(box, hdr);
    S.panel = box;
    S.status = box.querySelector("#mo-rc-status");
    S.preview = box.querySelector("#mo-rc-preview");
    S.inspector = box.querySelector("#mo-rc-inspector");
    box.querySelector("#mo-rc-toggle").onclick = () => {
      C.enabled = !C.enabled;
      setReactiveGlobalFlag();
      sync(box);
      updateUI();
    };
    box.querySelector("#mo-rc-monitor-toggle").onclick = () => {
      C.showMonitor = !C.showMonitor;
      sync(box);
      updateUI();
    };
    box.querySelector("#mo-rc-expert-toggle").onclick = () => {
      const ex = box.querySelector("#mo-rc-expert");
      ex.classList.toggle("open");
      box.querySelector("#mo-rc-expert-toggle").textContent = ex.classList.contains("open") ? "Expert / Custom \u25B4" : "Expert / Custom \u25BE";
    };
    box.querySelector("#blank").onclick = () => {
      applyConfig(BLANK_CONFIG, "custom");
      box.querySelector("#presetName").value = "";
      sync(box);
    };
    box.querySelector("#addRule").onclick = () => {
      C.rules.push({ input: "velocity", output: "alpha", amount: 1, curve: "linear", invert: false });
      renderRules(box);
    };
    box.querySelector("#addPattern").onclick = () => {
      if (!Array.isArray(C.patterns)) C.patterns = activePatterns();
      C.patterns.push({ type: "pulse", output: "alpha", amount: 0.2, periodMs: 1200 });
      C.pattern = C.patterns[0];
      renderPatterns(box);
      syncActiveOnly(box);
    };
    box.querySelector("#save").onclick = () => {
      readExpertNumbers(box);
      const name = (box.querySelector("#presetName").value || "Custom").trim();
      const id = name.toLowerCase().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "custom";
      S.customPresets[id] = serializeCurrent(name);
      saveCustomPresets();
      C.preset = "custom:" + id;
      renderPresetButtons(box);
      sync(box);
      updateUI("saved");
    };
    box.querySelector("#delete").onclick = () => {
      if (!String(C.preset).startsWith("custom:")) return;
      delete S.customPresets[C.preset.slice(7)];
      saveCustomPresets();
      applyConfig(BUILTIN.royal.config, "builtin:royal");
      renderPresetButtons(box);
      sync(box);
    };
    box.querySelectorAll("[data-lib]").forEach((btn) => btn.onclick = () => {
      C.palette = [...PALETTE_LIBRARY[btn.dataset.lib]];
      renderPaletteEditor(box);
      syncActiveOnly(box);
    });
    box.querySelectorAll("#mo-rc-expert input,#mo-rc-expert select").forEach((el) => {
      if (!["presetName"].includes(el.id)) el.onchange = () => {
        readExpertNumbers(box);
        syncActiveOnly(box);
      };
    });
    renderPresetButtons(box);
    C.preset = "builtin:royal";
    sync(box);
    setReactiveGlobalFlag();
    updateUI();
    return { box };
  }

  // mnt/data/playlist_work/src/ui_synthesia_trainer.js
  var MIDI_DB_NAME2 = "mo_midi_library_v1";
  var MIDI_STORE2 = "files";
  var TRAINER_PREF_KEY = "mo_synthesia_trainer_prefs_v1";
  function openMidiDb2() {
    return new Promise((resolve, reject) => {
      const req2 = indexedDB.open(MIDI_DB_NAME2, 1);
      req2.onupgradeneeded = () => {
        const db = req2.result;
        if (!db.objectStoreNames.contains(MIDI_STORE2)) db.createObjectStore(MIDI_STORE2, { keyPath: "id" });
      };
      req2.onsuccess = () => resolve(req2.result);
      req2.onerror = () => reject(req2.error);
    });
  }
  async function libraryList2() {
    const db = await openMidiDb2();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MIDI_STORE2, "readonly");
      const req2 = tx.objectStore(MIDI_STORE2).getAll();
      req2.onsuccess = () => resolve((req2.result || []).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
      req2.onerror = () => reject(req2.error);
      tx.oncomplete = () => db.close();
    });
  }
  async function libraryGet2(id) {
    const db = await openMidiDb2();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MIDI_STORE2, "readonly");
      const req2 = tx.objectStore(MIDI_STORE2).get(id);
      req2.onsuccess = () => resolve(req2.result || null);
      req2.onerror = () => reject(req2.error);
      tx.oncomplete = () => db.close();
    });
  }
  function readUint162(dv, off) {
    return dv.getUint8(off) << 8 | dv.getUint8(off + 1);
  }
  function readUint322(dv, off) {
    return dv.getUint8(off) << 24 | dv.getUint8(off + 1) << 16 | dv.getUint8(off + 2) << 8 | dv.getUint8(off + 3);
  }
  function readVar2(dv, off) {
    let val = 0, i = off, b;
    do {
      b = dv.getUint8(i++);
      val = val << 7 | b & 127;
    } while (b & 128);
    return { val, len: i - off };
  }
  function parseSMF2(buf) {
    const dv = new DataView(buf);
    if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "MThd") throw new Error("Invalid MIDI");
    const headerLen = readUint322(dv, 4);
    const format = readUint162(dv, 8);
    const ntrks = readUint162(dv, 10);
    const division = readUint162(dv, 12);
    let off = 8 + headerLen;
    const tracks = [];
    for (let t = 0; t < ntrks; t++) {
      if (String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3)) !== "MTrk") throw new Error("Bad track");
      const len = readUint322(dv, off + 4);
      const tend = off + 8 + len;
      let i = off + 8, run = 0, tick = 0;
      const evts = [];
      while (i < tend) {
        const d = readVar2(dv, i);
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
          const lenv = readVar2(dv, i);
          i += lenv.len;
          const data = new Uint8Array(buf, i, lenv.val);
          i += lenv.val;
          evts.push({ tick, type: "meta", meta: type, data });
        } else if (st2 === 240 || st2 === 247) {
          const lenv = readVar2(dv, i);
          i += lenv.len + lenv.val;
        } else {
          const type = st2 & 240, ch = st2 & 15;
          const a = dv.getUint8(i++);
          const b = type === 192 || type === 208 ? 0 : dv.getUint8(i++);
          evts.push({ tick, type, ch, a, b });
        }
      }
      tracks.push(evts);
      off = tend;
    }
    return { format, division, tracks };
  }
  function buildTimedEvents(smf) {
    const events = [];
    for (const tr of smf.tracks) for (const e of tr) events.push(e);
    events.sort((a, b) => a.tick - b.tick);
    const div = smf.division & 32767;
    let lastTick = 0, curTempo = 5e5, tSec = 0;
    const out = [];
    for (const e of events) {
      const dt = e.tick - lastTick;
      tSec += dt * (curTempo / 1e6) / div;
      lastTick = e.tick;
      if (e.type === "meta" && e.meta === 81 && e.data?.length === 3) {
        curTempo = e.data[0] << 16 | e.data[1] << 8 | e.data[2];
        continue;
      }
      if (typeof e.type === "number") out.push({ ...e, time: tSec });
    }
    return out;
  }
  function midiToNotes(buf) {
    const smf = parseSMF2(buf);
    const evs = buildTimedEvents(smf);
    const active = /* @__PURE__ */ new Map();
    const notes = [];
    for (const e of evs) {
      if (e.type === 144 && e.b > 0) {
        const key = `${e.ch}:${e.a}:${active.size}`;
        if (!active.has(`${e.ch}:${e.a}`)) active.set(`${e.ch}:${e.a}`, []);
        active.get(`${e.ch}:${e.a}`).push({ key, note: e.a, ch: e.ch, velocity: e.b, start: e.time });
      } else if (e.type === 128 || e.type === 144 && e.b === 0) {
        const stack = active.get(`${e.ch}:${e.a}`);
        if (stack?.length) {
          const n = stack.shift();
          n.end = e.time;
          n.duration = Math.max(0.03, n.end - n.start);
          notes.push(n);
        }
      }
    }
    const end = evs.length ? evs[evs.length - 1].time : 0;
    for (const stack of active.values()) for (const n of stack) {
      n.end = end;
      n.duration = Math.max(0.03, n.end - n.start);
      notes.push(n);
    }
    notes.sort((a, b) => a.start - b.start || a.note - b.note);
    return notes;
  }
  function groupNotes(notes, windowMs = 90) {
    const win = Math.max(0.01, Number(windowMs || 90) / 1e3);
    const steps = [];
    let cur = null;
    for (const n of notes) {
      if (!cur || Math.abs(n.start - cur.start) > win) {
        cur = { start: n.start, notes: [n], required: /* @__PURE__ */ new Set([n.note]), played: /* @__PURE__ */ new Set(), wrong: [], done: false };
        steps.push(cur);
      } else {
        cur.notes.push(n);
        cur.required.add(n.note);
      }
    }
    for (const s of steps) {
      s.end = Math.max(...s.notes.map((n) => n.end));
      s.velocity = Math.round(s.notes.reduce((a, n) => a + n.velocity, 0) / s.notes.length);
      s.name = chordName([...s.required]);
    }
    return steps;
  }
  var NOTE_NAMES2 = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  function noteLabel(n) {
    return NOTE_NAMES2[(n % 12 + 12) % 12] + (Math.floor(n / 12) - 1);
  }
  var QWERTY_NOTE_KEYS = (() => {
    const map = /* @__PURE__ */ new Map();
    const rows = [
      { base: 48, keys: ["z", "s", "x", "d", "c", "v", "g", "b", "h", "n", "j", "m", ",", "l", ".", ";", "/"] },
      { base: 60, keys: ["q", "2", "w", "3", "e", "r", "5", "t", "6", "y", "7", "u", "i", "9", "o", "0", "p", "[", "=", "]"] }
    ];
    for (const row of rows) {
      row.keys.forEach((key, i) => map.set(row.base + i, key));
    }
    return map;
  })();
  function qwertyKeyForNote(note) {
    note = Number(note);
    if (QWERTY_NOTE_KEYS.has(note)) return QWERTY_NOTE_KEYS.get(note);
    const candidates = [];
    for (let n = note; n >= 21; n -= 12) if (QWERTY_NOTE_KEYS.has(n)) candidates.push({ key: QWERTY_NOTE_KEYS.get(n), shift: n - note });
    for (let n = note; n <= 108; n += 12) if (QWERTY_NOTE_KEYS.has(n)) candidates.push({ key: QWERTY_NOTE_KEYS.get(n), shift: n - note });
    if (!candidates.length) return "\u2014";
    candidates.sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
    const c = candidates[0];
    if (c.shift === 0) return c.key;
    return c.key + (c.shift > 0 ? ` (-${c.shift / 12}oct)` : ` (+${Math.abs(c.shift) / 12}oct)`);
  }
  function keyHintForNote(note, layout = "qwerty") {
    if (layout === "qwerty") return qwertyKeyForNote(note);
    return "\u2014";
  }
  function pc(n) {
    return (n % 12 + 12) % 12;
  }
  function chordName(notes) {
    if (!notes?.length) return "\u2014";
    const pcs = [...new Set(notes.map(pc))].sort((a, b) => a - b);
    if (pcs.length === 1) return NOTE_NAMES2[pcs[0]];
    const templates = [
      ["maj", [0, 4, 7]],
      ["min", [0, 3, 7]],
      ["dim", [0, 3, 6]],
      ["aug", [0, 4, 8]],
      ["sus2", [0, 2, 7]],
      ["sus4", [0, 5, 7]],
      ["7", [0, 4, 7, 10]],
      ["maj7", [0, 4, 7, 11]],
      ["min7", [0, 3, 7, 10]],
      ["mMaj7", [0, 3, 7, 11]],
      ["add9", [0, 2, 4, 7]],
      ["6", [0, 4, 7, 9]],
      ["m6", [0, 3, 7, 9]]
    ];
    const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    for (const root of pcs) {
      const rel = pcs.map((x) => (x - root + 12) % 12).sort((a, b) => a - b);
      for (const [suffix, tmpl] of templates) {
        if (setEq(rel, tmpl)) return NOTE_NAMES2[root] + suffix;
      }
    }
    if (pcs.length > 4) return "Cluster";
    return pcs.map((x) => NOTE_NAMES2[x]).join("/");
  }
  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(TRAINER_PREF_KEY) || "{}");
    } catch {
      return {};
    }
  }
  function savePrefs(p) {
    try {
      localStorage.setItem(TRAINER_PREF_KEY, JSON.stringify(p));
    } catch {
    }
  }
  function mountSynthesiaTrainerUI() {
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      left: "130px",
      top: "150px",
      zIndex: 999999,
      background: "rgba(17,17,17,.95)",
      color: "#eee",
      padding: "10px",
      borderRadius: "12px",
      fontFamily: "system-ui,-apple-system,Segoe UI,sans-serif",
      width: "560px",
      maxWidth: "calc(100vw - 24px)",
      boxShadow: "0 10px 30px rgba(0,0,0,.6)",
      resize: "both",
      overflow: "hidden"
    });
    box.innerHTML = `
    <style>
      #mo-trainer-root .mo-btn{background:#2b2b2b;color:#eee;border:1px solid #444;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:12px}
      #mo-trainer-root .mo-btn:hover{background:#383838} #mo-trainer-root .mo-btn.active{background:#2f8f55;border-color:#43b573}
      #mo-trainer-root .mo-input{background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:8px;padding:6px;font-size:12px}
      #mo-trainer-root .mo-chip{background:#1b1b1b;padding:3px 8px;border-radius:10px;font-size:12px}
      #mo-trainer-root .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px}
      #mo-trainer-root label{font-size:12px;opacity:.9}
      #mo-trainer-overlay{position:fixed;inset:0;z-index:999990;pointer-events:none;display:none}
      #mo-trainer-overlay .ghost{position:absolute;bottom:0;border-radius:8px 8px 4px 4px;background:rgba(95,155,255,.42);border:1px solid rgba(170,210,255,.85);box-shadow:0 0 18px rgba(110,180,255,.8);overflow:visible}
      #mo-trainer-overlay .ghostHint{position:absolute;left:50%;top:-24px;transform:translateX(-50%);min-width:18px;padding:2px 6px;border-radius:8px;background:rgba(10,10,10,.88);border:1px solid rgba(255,255,255,.24);color:#fff;font-size:12px;font-weight:800;text-align:center;text-shadow:0 1px 3px #000;white-space:nowrap}
      #mo-trainer-overlay .ghost.done{background:rgba(80,235,140,.55);border-color:rgba(150,255,190,.95)}
      #mo-trainer-overlay .ghost.wrong{background:rgba(255,70,70,.45);border-color:rgba(255,150,150,.95)}
      #moTrainerKeyboard{height:36px;border-radius:8px;background:linear-gradient(90deg,rgba(255,255,255,.12),rgba(255,255,255,.04));position:relative;margin-top:8px;overflow:visible}
      #moTrainerKeyboard .keyDot{position:absolute;top:5px;width:6px;height:26px;border-radius:4px;background:#555;opacity:.75;transform:translateX(-50%)}
      #moTrainerKeyboard .keyDot.need{background:#5f9bff;box-shadow:0 0 10px #5f9bff;opacity:1}
      #moTrainerKeyboard .keyDot.hit{background:#55f098;box-shadow:0 0 10px #55f098;opacity:1}
      #moTrainerKeyboard .keyDot.bad{background:#ff4f4f;box-shadow:0 0 10px #ff4f4f;opacity:1}
      #moTrainerKeyboard .keyText{position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:800;color:#dbe8ff;text-shadow:0 1px 3px #000;white-space:nowrap;pointer-events:none}
    </style>
    <div id="mo-trainer-root">
      <div id="hdr" style="display:flex;align-items:center;gap:8px;cursor:move;user-select:none"><strong>Synthesia Trainer</strong><span id="status" class="mo-chip" style="margin-left:auto;background:#444">idle</span></div>
      <div id="body" style="max-height:70vh;overflow:auto;padding-right:4px">
        <div class="row"><select id="midiSelect" class="mo-input" style="flex:1;min-width:220px"></select><button id="refresh" class="mo-btn">Refresh</button><button id="load" class="mo-btn">Load</button></div>
        <div class="row"><button id="start" class="mo-btn">Start</button><button id="pause" class="mo-btn">Pause</button><button id="back" class="mo-btn">Back</button><button id="skip" class="mo-btn">Skip</button><button id="reset" class="mo-btn">Reset</button></div>
        <div class="row"><label>Mode</label><select id="mode" class="mo-input"><option value="chord">Chord gate</option><option value="note">Note by note</option><option value="arp">Arpeggio memory</option></select><label>Keyboard</label><select id="keyHints" class="mo-input"><option value="off">No key hints</option><option value="qwerty">QWERTY hints</option></select><label><input id="ghost" type="checkbox" checked> Ghost overlay</label><label><input id="listenMidi" type="checkbox"> WebMIDI input</label></div>
        <div class="row"><label>Chord window</label><input id="chordWin" type="range" min="20" max="650" value="90"><span id="chordWinVal" class="mo-chip">90 ms</span><label>Tolerance</label><input id="tol" type="range" min="0" max="12" value="0"><span id="tolVal" class="mo-chip">exact</span></div>
        <details id="calibration" style="margin-top:8px"><summary style="cursor:pointer;font-size:12px;opacity:.85">Overlay calibration</summary><div class="row"><label>X offset</label><input id="overlayX" type="range" min="-80" max="80" value="0"><span id="overlayXVal" class="mo-chip">0 px</span><label>Scale</label><input id="overlayScale" type="range" min="0.920" max="1.080" step="0.001" value="1"><span id="overlayScaleVal" class="mo-chip">1.000\xD7</span></div><div class="row"><label>White offset</label><input id="whiteX" type="range" min="-20" max="20" value="0"><span id="whiteXVal" class="mo-chip">0 px</span><label>Black offset</label><input id="blackX" type="range" min="-20" max="20" value="0"><span id="blackXVal" class="mo-chip">0 px</span></div></details>
        <div id="moTrainerKeyboard"></div>
        <div class="row"><span class="mo-chip">Step <span id="idx">0</span>/<span id="total">0</span></span><span class="mo-chip">Accuracy <span id="acc">100%</span></span><span class="mo-chip">Streak <span id="streak">0</span></span></div>
        <div id="current" style="margin-top:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,.05);font-size:13px;line-height:1.5"></div>
        <div id="hint" style="margin-top:8px;font-size:12px;opacity:.7">Load a MIDI from the Player library, then play the highlighted note or chord. Best used alone or with WebMIDI input enabled.</div>
      </div>
    </div>`;
    document.body.appendChild(box);
    const overlay = document.createElement("div");
    overlay.id = "mo-trainer-overlay";
    document.body.appendChild(overlay);
    const hdr = box.querySelector("#hdr");
    addMinimizer(box, hdr, "synthesia-trainer");
    makeDraggable(box, hdr);
    const $ = (s) => box.querySelector(s);
    const midiSelect = $("#midiSelect"), status = $("#status"), startBtn = $("#start"), pauseBtn = $("#pause"), ghost = $("#ghost"), listenMidi = $("#listenMidi"), keyHints = $("#keyHints"), modeSel = $("#mode"), chordWin = $("#chordWin"), chordWinVal = $("#chordWinVal"), tol = $("#tol"), tolVal = $("#tolVal"), overlayX = $("#overlayX"), overlayXVal = $("#overlayXVal"), overlayScale = $("#overlayScale"), overlayScaleVal = $("#overlayScaleVal"), whiteX = $("#whiteX"), whiteXVal = $("#whiteXVal"), blackX = $("#blackX"), blackXVal = $("#blackXVal"), current = $("#current"), idxEl = $("#idx"), totalEl = $("#total"), accEl = $("#acc"), streakEl = $("#streak"), keyboard = $("#moTrainerKeyboard");
    const prefs = Object.assign({ mode: "chord", chordWin: 90, tolerance: 0, ghost: true, listenMidi: false, keyHints: "qwerty", lastMidiId: "", overlayX: 0, overlayScale: 1, whiteX: 0, blackX: 0 }, loadPrefs());
    modeSel.value = prefs.mode;
    chordWin.value = prefs.chordWin;
    tol.value = prefs.tolerance;
    ghost.checked = !!prefs.ghost;
    listenMidi.checked = !!prefs.listenMidi;
    keyHints.value = prefs.keyHints || "qwerty";
    overlayX.value = String(prefs.overlayX || 0);
    overlayScale.value = String(prefs.overlayScale || 1);
    whiteX.value = String(prefs.whiteX || 0);
    blackX.value = String(prefs.blackX || 0);
    let library = [], notes = [], steps = [], stepIndex = 0, running = false, good = 0, bad = 0, streak = 0, midiAccess = null;
    let originalWorkerPost = null;
    const recentRendered = /* @__PURE__ */ new Map();
    function setStatus(t, ok = false) {
      status.textContent = t;
      status.style.background = ok ? "#264a2f" : "#444";
    }
    function saveUiPrefs() {
      savePrefs({ mode: modeSel.value, chordWin: Number(chordWin.value), tolerance: Number(tol.value), ghost: ghost.checked, listenMidi: listenMidi.checked, keyHints: keyHints.value, overlayX: Number(overlayX.value) || 0, overlayScale: Number(overlayScale.value) || 1, whiteX: Number(whiteX.value) || 0, blackX: Number(blackX.value) || 0, lastMidiId: midiSelect.value || prefs.lastMidiId || "" });
    }
    function noteOk(played, target) {
      const semis = Number(tol.value) || 0;
      return Math.abs(played - target) <= semis || semis === 12 && pc(played) === pc(target);
    }
    function currentStep() {
      return steps[stepIndex] || null;
    }
    function fmtNotes(ns) {
      return [...ns].sort((a, b) => a - b).map(noteLabel).join(" \xB7 ");
    }
    function fmtKeyHints(ns) {
      if (keyHints.value === "off") return "\u2014";
      return [...ns].sort((a, b) => a - b).map((n) => `${noteLabel(n)} = ${keyHintForNote(n, keyHints.value)}`).join(" \xB7 ");
    }
    function updateKeyboard() {
      keyboard.innerHTML = "";
      const s = currentStep();
      const req2 = s ? [...s.required] : [];
      const played = s ? [...s.played] : [];
      for (let n = 21; n <= 108; n++) {
        if (n % 2 === 0 && n < 108) continue;
        const d = document.createElement("div");
        d.className = "keyDot";
        if (req2.includes(n)) {
          d.classList.add(played.includes(n) ? "hit" : "need");
          if (keyHints.value !== "off") {
            const lab = document.createElement("span");
            lab.className = "keyText";
            lab.textContent = keyHintForNote(n, keyHints.value);
            d.appendChild(lab);
          }
        }
        d.style.left = `${(n - 21) / (108 - 21) * 100}%`;
        d.style.height = ([1, 3, 6, 8, 10].includes(pc(n)) ? 18 : 26) + "px";
        d.style.opacity = [1, 3, 6, 8, 10].includes(pc(n)) ? ".9" : ".55";
        keyboard.appendChild(d);
      }
    }
    const WHITE_PCS2 = /* @__PURE__ */ new Set([0, 2, 4, 5, 7, 9, 11]);
    const BLACK_PCS = /* @__PURE__ */ new Set([1, 3, 6, 8, 10]);
    let cachedPianoRect = null;
    let cachedPianoAt = 0;
    function isBlackKey2(n) {
      return BLACK_PCS.has(pc(n));
    }
    function whiteIndexBefore(note) {
      let count = 0;
      for (let n = 21; n < note; n++) if (WHITE_PCS2.has(pc(n))) count++;
      return count;
    }
    function whiteIndexOf(note) {
      let count = 0;
      for (let n = 21; n <= note; n++) {
        if (WHITE_PCS2.has(pc(n))) {
          if (n === note) return count;
          count++;
        }
      }
      return Math.max(0, whiteIndexBefore(note));
    }
    function unionRects(rects) {
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    function findChatLeft() {
      let best = null;
      for (const el of document.querySelectorAll("input, textarea, [contenteditable='true'], div, aside, section")) {
        const r = el.getBoundingClientRect();
        if (r.width < 170 || r.width > 430) continue;
        if (r.height < window.innerHeight * 0.45) continue;
        if (r.left < window.innerWidth * 0.55) continue;
        if (r.right < window.innerWidth - 40) continue;
        const txt = (el.getAttribute?.("placeholder") || el.textContent || "").toLowerCase();
        const looksChat = txt.includes("message") || txt.includes("joined the room") || txt.includes("server") || r.right > window.innerWidth - 12;
        if (!looksChat) continue;
        if (!best || r.left < best.left) best = r;
      }
      return best?.left || null;
    }
    function findPianoRect() {
      const t = performance.now();
      if (cachedPianoRect && t - cachedPianoAt < 250) return cachedPianoRect;
      const keySelectors = [
        ".piano-key",
        ".key",
        "[data-key]",
        "[data-note]",
        "[data-midi]",
        ".white-key",
        ".black-key",
        "[class*='piano'][class*='key']"
      ].join(",");
      const rects = [];
      for (const el of document.querySelectorAll(keySelectors)) {
        const r = el.getBoundingClientRect();
        if (!r || r.width < 2 || r.height < 18) continue;
        if (r.bottom < window.innerHeight * 0.55) continue;
        if (r.left < 40 || r.right > window.innerWidth + 20) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        rects.push(r);
      }
      if (rects.length >= 20) {
        cachedPianoRect = unionRects(rects);
        cachedPianoAt = t;
        return cachedPianoRect;
      }
      const chatLeft = findChatLeft();
      const left = 84;
      const right = Math.max(left + 600, (chatLeft || window.innerWidth - 16) - 4);
      const height = Math.min(128, Math.max(92, window.innerHeight * 0.125));
      const bottom = window.innerHeight - 16;
      cachedPianoRect = { left, right, top: bottom - height, bottom, width: right - left, height };
      cachedPianoAt = t;
      return cachedPianoRect;
    }
    function calibratedRect(rect) {
      const scale = Math.max(0.92, Math.min(1.08, Number(overlayScale.value) || 1));
      const x = Number(overlayX.value) || 0;
      const cx = rect.left + rect.width / 2;
      const width = rect.width * scale;
      return { ...rect, left: cx - width / 2 + x, right: cx + width / 2 + x, width };
    }
    function noteCenterX(note, rect) {
      const whiteW = rect.width / 52;
      if (!isBlackKey2(note)) {
        return rect.left + (whiteIndexOf(note) + 0.5) * whiteW + (Number(whiteX?.value) || 0);
      }
      const prevWhite = whiteIndexBefore(note);
      return rect.left + prevWhite * whiteW + (Number(blackX?.value) || 0);
    }
    function renderOverlay() {
      overlay.style.display = ghost.checked && running ? "block" : "none";
      overlay.innerHTML = "";
      const s = currentStep();
      if (!s) return;
      const pianoRect = calibratedRect(findPianoRect());
      const notes2 = [...s.required].sort((a, b) => a - b);
      const baseHeight = modeSel.value === "arp" ? 74 : 112;
      notes2.forEach((n, i) => {
        const g = document.createElement("div");
        g.className = "ghost";
        if (s.played.has(n)) g.classList.add("done");
        const black = isBlackKey2(n);
        const center = noteCenterX(n, pianoRect);
        const w = Math.max(black ? 8 : 12, pianoRect.width / 52 * (black ? 0.55 : 0.82));
        const h = Math.max(34, baseHeight - i * 8);
        g.style.position = "fixed";
        g.style.left = `${Math.round(center - w / 2)}px`;
        g.style.top = `${Math.round(pianoRect.top - h)}px`;
        g.style.width = `${Math.round(w)}px`;
        g.style.height = `${Math.round(h)}px`;
        g.style.background = s.played.has(n) ? "rgba(80,235,140,.55)" : colorForNote(n, s);
        if (keyHints.value !== "off") {
          const hint = document.createElement("div");
          hint.className = "ghostHint";
          hint.textContent = keyHintForNote(n, keyHints.value);
          g.appendChild(hint);
        }
        overlay.appendChild(g);
      });
    }
    function colorForNote(n, s) {
      if (s.required.size > 1) return "rgba(180,100,255,.42)";
      const hue = 260 - (n - 21) / (108 - 21) * 220;
      return `hsla(${hue},90%,60%,.46)`;
    }
    function updateUI2() {
      const s = currentStep();
      idxEl.textContent = steps.length ? String(stepIndex + 1) : "0";
      totalEl.textContent = String(steps.length);
      accEl.textContent = `${Math.round(good / Math.max(1, good + bad) * 100)}%`;
      streakEl.textContent = String(streak);
      startBtn.classList.toggle("active", running);
      current.innerHTML = s ? `
      <div><b>${s.name}</b></div>
      <div>Required: ${fmtNotes(s.required)}</div>
      <div style="font-size:13px;font-weight:700;color:#dbe8ff">Keyboard keys: ${fmtKeyHints(s.required)}</div>
      <div>Played: ${s.played.size ? fmtNotes(s.played) : "\u2014"}</div>
      <div>Velocity: ${s.velocity} \xB7 Time: ${s.start.toFixed(2)}s</div>
    ` : "No MIDI loaded.";
      updateKeyboard();
      renderOverlay();
      saveUiPrefs();
    }
    function rebuildSteps() {
      const win = Number(chordWin.value) || 90;
      const grouped = groupNotes(notes, win);
      if (modeSel.value === "note") {
        steps = notes.map((n) => ({ start: n.start, end: n.end, notes: [n], required: /* @__PURE__ */ new Set([n.note]), played: /* @__PURE__ */ new Set(), wrong: [], done: false, velocity: n.velocity, name: noteLabel(n.note) }));
      } else {
        steps = grouped.map((s) => ({ ...s, required: new Set(s.required), played: /* @__PURE__ */ new Set(), wrong: [], done: false }));
      }
      stepIndex = 0;
      good = 0;
      bad = 0;
      streak = 0;
      totalEl.textContent = String(steps.length);
      updateUI2();
    }
    async function refreshLibrary() {
      try {
        const previous = midiSelect.value || prefs.lastMidiId || "";
        library = await libraryList2();
        midiSelect.innerHTML = "";
        for (const item of library) {
          const opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.name;
          opt.title = item.name;
          midiSelect.appendChild(opt);
        }
        if (library.length) {
          const wanted = library.find((x) => x.id === previous) || library[0];
          midiSelect.value = wanted.id;
          prefs.lastMidiId = wanted.id;
        }
        setStatus(library.length ? `library ready \xB7 ${library.length}` : "empty library", !!library.length);
        saveUiPrefs();
      } catch (e) {
        console.error("[Synthesia Trainer] refresh library failed", e);
        setStatus("library error", false);
      }
    }
    async function loadSelected() {
      if (!midiSelect.value) {
        await refreshLibrary();
      }
      const id = midiSelect.value || library[0]?.id;
      if (!id) {
        setStatus("no MIDI in library", false);
        return;
      }
      midiSelect.value = id;
      const item = await libraryGet2(id);
      if (!item?.data) {
        setStatus("missing MIDI", false);
        return;
      }
      try {
        notes = midiToNotes(item.data);
        prefs.lastMidiId = id;
        saveUiPrefs();
        rebuildSteps();
        setStatus(`${notes.length} notes loaded`, true);
      } catch (e) {
        console.error(e);
        setStatus("parse error", false);
      }
    }
    function advance() {
      const s = currentStep();
      if (s) s.done = true;
      stepIndex = Math.min(steps.length, stepIndex + 1);
      if (stepIndex >= steps.length) {
        running = false;
        setStatus("finished", true);
      }
      updateUI2();
    }
    function playedNote(note, velocity = 0.7, source = "rendered") {
      if (!running || !steps.length) return;
      const key = `${note}:${source}`;
      const t = performance.now();
      if (recentRendered.has(key) && t - recentRendered.get(key) < 55) return;
      recentRendered.set(key, t);
      const s = currentStep();
      if (!s) return;
      let match = null;
      for (const target of s.required) {
        if (!s.played.has(target) && noteOk(note, target)) {
          match = target;
          break;
        }
      }
      if (match != null) {
        s.played.add(match);
        good++;
        streak++;
        setStatus("correct", true);
      } else {
        s.wrong.push({ note, velocity, t: Date.now() });
        bad++;
        streak = 0;
        setStatus(`wrong: ${noteLabel(note)}`, false);
      }
      const all = [...s.required].every((n) => s.played.has(n));
      updateUI2();
      if (all) setTimeout(advance, modeSel.value === "arp" ? 90 : 130);
    }
    function patchWorker() {
      if (originalWorkerPost) return;
      originalWorkerPost = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(data, transfer) {
        try {
          if (data?.type === "startEffect" && data.note != null) {
            const eff = Array.isArray(data.effects) ? data.effects[0] : null;
            const vel = Number(eff?.opts?.velocity ?? 80) / 127;
            playedNote(Number(data.note), vel, "worker");
          }
        } catch (e) {
        }
        return originalWorkerPost.call(this, data, transfer);
      };
    }
    async function setupMidiInput() {
      if (!listenMidi.checked || !navigator.requestMIDIAccess) return;
      try {
        midiAccess = await navigator.requestMIDIAccess();
        for (const input of midiAccess.inputs.values()) {
          input.onmidimessage = (e) => {
            const [st2, n, v] = e.data;
            const cmd = st2 & 240;
            if (cmd === 144 && v > 0) playedNote(n, v / 127, "midi");
          };
        }
        setStatus("MIDI input listening", true);
      } catch (e) {
        setStatus("MIDI input refused", false);
      }
    }
    $("#refresh").onclick = refreshLibrary;
    $("#load").onclick = loadSelected;
    startBtn.onclick = () => {
      if (!steps.length) return setStatus("load MIDI first", false);
      running = true;
      patchWorker();
      setupMidiInput();
      updateUI2();
      setStatus("listening", true);
    };
    pauseBtn.onclick = () => {
      running = false;
      updateUI2();
      setStatus("paused", false);
    };
    $("#back").onclick = () => {
      stepIndex = Math.max(0, stepIndex - 1);
      const s = currentStep();
      if (s) {
        s.played.clear();
        s.wrong = [];
      }
      updateUI2();
    };
    $("#skip").onclick = () => advance();
    $("#reset").onclick = () => {
      stepIndex = 0;
      good = 0;
      bad = 0;
      streak = 0;
      for (const s of steps) {
        s.played.clear();
        s.wrong = [];
        s.done = false;
      }
      updateUI2();
    };
    modeSel.onchange = () => rebuildSteps();
    chordWin.oninput = () => {
      chordWinVal.textContent = `${chordWin.value} ms`;
      rebuildSteps();
    };
    tol.oninput = () => {
      tolVal.textContent = Number(tol.value) === 0 ? "exact" : Number(tol.value) === 12 ? "same note name" : `\xB1${tol.value} semis`;
      updateUI2();
    };
    overlayX.oninput = () => {
      overlayXVal.textContent = `${overlayX.value} px`;
      cachedPianoRect = null;
      updateUI2();
    };
    overlayScale.oninput = () => {
      overlayScaleVal.textContent = `${Number(overlayScale.value).toFixed(3)}\xD7`;
      cachedPianoRect = null;
      updateUI2();
    };
    whiteX.oninput = () => {
      whiteXVal.textContent = `${whiteX.value} px`;
      cachedPianoRect = null;
      updateUI2();
    };
    blackX.oninput = () => {
      blackXVal.textContent = `${blackX.value} px`;
      cachedPianoRect = null;
      updateUI2();
    };
    ghost.onchange = () => updateUI2();
    keyHints.onchange = () => updateUI2();
    listenMidi.onchange = () => {
      saveUiPrefs();
      if (listenMidi.checked) setupMidiInput();
    };
    chordWinVal.textContent = `${chordWin.value} ms`;
    tolVal.textContent = Number(tol.value) === 0 ? "exact" : `\xB1${tol.value} semis`;
    overlayXVal.textContent = `${overlayX.value} px`;
    overlayScaleVal.textContent = `${Number(overlayScale.value).toFixed(3)}\xD7`;
    whiteXVal.textContent = `${whiteX.value} px`;
    blackXVal.textContent = `${blackX.value} px`;
    let dragging = false, dx = 0, dy = 0;
    hdr.addEventListener("mousedown", (e) => {
      dragging = true;
      const r = box.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      box.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx)) + "px";
      box.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy)) + "px";
      box.style.right = "auto";
      box.style.bottom = "auto";
    });
    window.addEventListener("mouseup", () => dragging = false);
    let alignRaf = 0;
    const realign = () => {
      if (alignRaf) return;
      alignRaf = requestAnimationFrame(() => {
        alignRaf = 0;
        cachedPianoRect = null;
        renderOverlay();
        updateKeyboard();
      });
    };
    window.addEventListener("resize", realign, { passive: true });
    window.addEventListener("orientationchange", realign, { passive: true });
    const alignTimer = setInterval(() => {
      if (ghost.checked && running) realign();
    }, 700);
    refreshLibrary();
    patchWorker();
    updateUI2();
    return { box, destroy() {
      if (originalWorkerPost) Worker.prototype.postMessage = originalWorkerPost;
      window.removeEventListener("resize", realign);
      window.removeEventListener("orientationchange", realign);
      clearInterval(alignTimer);
      if (alignRaf) cancelAnimationFrame(alignRaf);
      overlay.remove();
      box.remove();
    } };
  }

  // mnt/data/playlist_work/src/ui_dock.js
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

  // mnt/data/playlist_work/src/main.js
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
  var MIDI_OUT_PREF_KEY = "mo_live_last_midi_output_v2";
  function normalizeMidiLabel(v) {
    return String(v || "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 #+._-]/g, "").trim();
  }
  function getOutputSignature(o) {
    return {
      id: o?.id || "",
      name: o?.name || "",
      manufacturer: o?.manufacturer || "",
      label: midiName(o)
    };
  }
  function loadLastMidiOutput() {
    try {
      return JSON.parse(localStorage.getItem(MIDI_OUT_PREF_KEY) || "null");
    } catch {
      return null;
    }
  }
  function saveLastMidiOutput(o) {
    if (!o) return;
    try {
      localStorage.setItem(MIDI_OUT_PREF_KEY, JSON.stringify(getOutputSignature(o)));
    } catch {
    }
  }
  function scoreOutputMatch(o, pref) {
    if (!o || !pref) return 0;
    if (pref.id && o.id === pref.id) return 1e3;
    const name = normalizeMidiLabel(o.name);
    const manu = normalizeMidiLabel(o.manufacturer);
    const label = normalizeMidiLabel(midiName(o));
    const pName = normalizeMidiLabel(pref.name);
    const pManu = normalizeMidiLabel(pref.manufacturer);
    const pLabel = normalizeMidiLabel(pref.label);
    let score = 0;
    if (pLabel && label === pLabel) score += 500;
    if (pName && name === pName) score += 300;
    if (pManu && manu === pManu) score += 120;
    if (pName && label.includes(pName)) score += 90;
    if (pLabel && label.includes(pLabel)) score += 80;
    if (pName && pName.includes(name) && name.length > 2) score += 45;
    if (pLabel && pLabel.includes(label) && label.length > 2) score += 35;
    return score;
  }
  function pickPreferredOutput(arr) {
    if (!arr.length) return null;
    const pref = loadLastMidiOutput();
    if (!pref) return arr[0];
    let best = arr[0];
    let bestScore = scoreOutputMatch(best, pref);
    for (const o of arr.slice(1)) {
      const score = scoreOutputMatch(o, pref);
      if (score > bestScore) {
        best = o;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : arr[0];
  }
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
      setOutStatus("no output", false);
      return;
    }
    sel.disabled = false;
    arr.forEach((o) => {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = midiName(o);
      sel.appendChild(opt);
    });
    const pick = pickPreferredOutput(arr) || arr[0];
    sel.value = pick.id;
    setOutputById(pick.id);
    saveLastMidiOutput(pick);
    const pref = loadLastMidiOutput();
    const restored = pref && scoreOutputMatch(pick, pref) > 0;
    test.disabled = false;
    setOutStatus((restored ? "\u21BB " : "\u2192 ") + midiName(pick), true);
  }
  req.onclick = () => {
    requestMIDI(fillOutputs).then(() => {
      fillOutputs();
    }).catch(() => setOutStatus("WebMIDI unsupported", false));
  };
  rescan.onclick = () => {
    fillOutputs();
  };
  sel.onchange = () => {
    const out = setOutputById(sel.value);
    if (out) saveLastMidiOutput(out);
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
  setOutStatus("restoring...", true);
  requestMIDI(fillOutputs).then(() => fillOutputs()).catch(() => setOutStatus("click Request MIDI", false));
  var recorderPanel = null;
  var playerPanel = null;
  var reactivePanel = null;
  var trainerPanel = null;
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
    trainerPanel = mountSynthesiaTrainerUI();
  } catch (e) {
    console.warn("synthesia-trainer-ui failed", e);
  }
  try {
    mountToolsDock([
      { id: "midi-out", label: "MIDI Out", icon: "\u21E2", box: midiOutPanel?.box },
      { id: "player", label: "Player", icon: "\u25B6", box: playerPanel?.box },
      { id: "recorder", label: "Recorder", icon: "\u25CF", box: recorderPanel?.box },
      { id: "reactive-color", label: "Color", icon: "\u2726", box: reactivePanel?.box },
      { id: "trainer", label: "Trainer", icon: "\u25C6", box: trainerPanel?.box }
    ]);
  } catch (e) {
    console.warn("tools-dock failed", e);
  }
})();
