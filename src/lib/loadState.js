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

export function markSiteReady() {
  if (state.ready) return;
  state.ready = true;
  state.readyListeners.forEach((listener) => listener());
  state.readyListeners.clear();
}

// Calls `listener` once the loader has finished (straight away if it already has). Returns a cancel function.
export function onSiteReady(listener) {
  if (state.ready) {
    listener();
    return () => {};
  }
  state.readyListeners.add(listener);
  return () => state.readyListeners.delete(listener);
}
