(function inject() {
  if (window.__MO_LIVE_INJECTED__) return;
  Object.defineProperty(window, "__MO_LIVE_INJECTED__", { value: true });
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("mo-live.bundle.js");
  s.type = "text/javascript";
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();
