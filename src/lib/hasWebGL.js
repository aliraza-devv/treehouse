// Cheap feature test on a throwaway canvas, so a device without WebGL never downloads or mounts the scene (and never logs
// the renderer's errors). The probe context is released straight away, and the answer is kept, so asking twice costs nothing.
// The same probe reads the name of the graphics chip (gpuName), which the scene uses to choose where to start its quality.
let answer;
let name = "";

export function hasWebGL() {
  if (answer !== undefined) return answer;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return (answer = false);
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "") : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return (answer = true);
  } catch {
    return (answer = false);
  }
}

// The graphics chip's name ("" when the browser does not say), after hasWebGL() has run.
export function gpuName() {
  hasWebGL();
  return name;
}
