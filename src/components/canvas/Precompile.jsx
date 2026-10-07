"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Mesh, Scene, WebGLRenderTarget } from "three";

// COMPILE EVERY SHADER AT ONCE. The hero has about 65 shader programs (the scene's materials, the shadow maps, and the post stack:
// ambient occlusion, depth of field, bloom, grading, anti-aliasing). Left alone, three.js creates each one as the first frame needs it
// and then WAITS for it to finish compiling before it creates the next, so they compile one after another while the page is frozen:
// measured at about 5 of the 8.7 seconds the hero took to load on an ordinary laptop GPU. The graphics driver can compile many at
// once, on other cores, if it is handed them all together (the KHR_parallel_shader_compile extension, which three exposes as
// compileAsync). That is all this does: it hands over every program up front, waits for the driver without blocking the page (so
// the loader keeps drawing), and only then lets the render loop start (Scene.jsx holds the loop until onDone). The picture is
// identical; it just no longer waits in a queue.
//
// One detail matters: three bakes the render target's colour space into the program, and the post stack renders into targets, not
// the screen. So everything is compiled with a (tiny) render target bound, which makes the programs the very ones the real frames
// will ask for. If they did not match, the work would be wasted and the first frame would compile them all again.
const TIMEOUT_MS = 6000;

// Every ShaderMaterial the composer's passes and effects hold (the effects keep their own inner passes, and n8ao keeps its own
// full-screen quads). Walks only plain objects, arrays and passes, to a small depth, and never into the scene, cameras, textures,
// render targets or the renderer.
function shaderMaterials(composer) {
  const found = new Set();
  const seen = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 4) return;
    seen.add(value);
    if (value.isShaderMaterial) {
      found.add(value);
      return;
    }
    if (
      value.isObject3D || value.isTexture || value.isWebGLRenderTarget || value.isBufferGeometry || value.isWebGLRenderer ||
      value.isMaterial || value instanceof Map || value instanceof Set || value instanceof Node || (typeof WebGL2RenderingContext !== "undefined" && value instanceof WebGL2RenderingContext)
    ) {
      return;
    }
    if (Array.isArray(value)) {
      if (value.length <= 64) value.forEach((item) => visit(item, depth + 1));
      return;
    }
    for (const key of Object.keys(value)) {
      if (key === "scene" || key === "camera" || key === "renderer" || key === "parent" || key === "domElement") continue;
      visit(value[key], depth + 1);
    }
  };
  composer.passes.forEach((pass) => {
    if (pass.fullscreenMaterial) found.add(pass.fullscreenMaterial);
    visit(pass, 0);
  });
  return [...found];
}

export default function Precompile({ composer, onDone }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    let cancelled = false;
    const target = new WebGLRenderTarget(1, 1);
    const holder = new Scene();
    const triangle = new BufferGeometry();
    triangle.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));

    // Submit a scene for compiling with the little render target bound (the submit part is synchronous; only the waiting is not)
    const submit = (root) => {
      const previous = gl.getRenderTarget();
      try {
        gl.setRenderTarget(target);
        return gl.compileAsync(root, camera);
      } finally {
        gl.setRenderTarget(previous);
      }
    };

    // The composer builds its passes a moment after this mounts, so give it a few ticks to appear
    const composerReady = async () => {
      const until = performance.now() + 1200;
      while (!cancelled && performance.now() < until) {
        if (composer?.current?.passes?.length > 1) return true;
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return false;
    };

    const run = async () => {
      const jobs = [];
      try {
        jobs.push(submit(scene)); // the scene's own materials, straight away
      } catch (error) {
        if (process.env.NODE_ENV === "development") console.warn("[precompile] scene submit failed", error);
      }
      const post = (async () => {
        if (!(await composerReady())) return;
        const materials = shaderMaterials(composer.current);
        materials.forEach((material) => holder.add(new Mesh(triangle, material)));
        if (materials.length) await submit(holder);
      })().catch((error) => {
        if (process.env.NODE_ENV === "development") console.warn("[precompile] post submit failed", error);
      });
      jobs.push(post);
      // Never hold the page for longer than the timeout, whatever the driver does
      await Promise.race([Promise.all(jobs).catch(() => {}), new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))]);
      if (!cancelled) onDone();
    };
    run();

    return () => {
      cancelled = true;
      target.dispose();
      triangle.dispose();
    };
    // once, when the scene has mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
