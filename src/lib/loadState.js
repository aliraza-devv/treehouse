// What the page is waiting for before the loader lets go, and a way for the rest of the site to hear when it has.
//
// Three things must be true: the web fonts are in, the scroll runway has mounted (it loads lazily, and until it
// exists the page below the stage is the wrong height), and the 3D scene has drawn its first frames (or cannot, on a
// device without WebGL). Each reports with markPart(). The loader (Preloader.jsx) shows that progress and, when it has
// finished its exit, calls markSiteReady(); the hero's intro waits for that (onSiteReady), so it plays on screen
// instead of behind the loader.
//
// The state lives on globalThis so a hot reload in development does not reset it and strand the loader.
const state = (globalThis.__treehouseLoad ??= {
  parts: { fonts: false, runway: false, scene: false },
  ready: false,
  delayMs: 0,
  partListeners: new Set(),
  readyListeners: new Set(),
});

export const loadParts = () => state.parts;

export function markPart(name) {
  if (state.parts[name]) return;
  state.parts[name] = true;
  state.partListeners.forEach((listener) => listener(state.parts));
}

export function onPart(listener) {
  state.partListeners.add(listener);
  return () => state.partListeners.delete(listener);
}

// delayMs: how long from now the hero should wait before it starts. The loader signals at the START of its exit (so nothing waits
// on a timer that a busy page could hold up) and says how much of the exit to let go by.
export function markSiteReady(delayMs = 0) {
  if (state.ready) return;
  state.ready = true;
  state.delayMs = delayMs;
  state.readyListeners.forEach((listener) => listener(delayMs));
  state.readyListeners.clear();
}

// Calls `listener(delayMs)` once the loader has begun to leave (straight away if it already has). Returns a cancel function.
export function onSiteReady(listener) {
  if (state.ready) {
    listener(0);
    return () => {};
  }
  state.readyListeners.add(listener);
  return () => state.readyListeners.delete(listener);
}
