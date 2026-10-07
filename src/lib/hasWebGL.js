// Cheap feature test on a throwaway canvas, so a device without WebGL never downloads or mounts the scene (and never logs
// the renderer's errors). The probe context is released straight away, and the answer is kept, so asking twice costs nothing.
let answer;

export function hasWebGL() {
  if (answer !== undefined) return answer;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return (answer = false);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return (answer = true);
  } catch {
    return (answer = false);
  }
}
