"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Mesh, Scene, WebGLRenderTarget } from "three";
import { TIMELINE } from "@/lib/sections";
import { createPose, getCameraPath } from "@/lib/sections/cameraPath";

// COMPILE EVERY SHADER AT ONCE. The hero has about 65 shader programs (the scene's materials, the shadow maps, and the post stack:
// ambient occlusion, depth of field, bloom, grading, anti-aliasing). Left alone, three.js creates each one as the first frame needs it
// and then WAITS for it to finish compiling before it creates the next, so they compile one after another while the page is frozen:
// measured at about 5 of the 8.7 seconds the hero took to load on an ordinary laptop GPU. The graphics driver can compile many at
// once, on other cores, if it is handed them all together (the KHR_parallel_shader_compile extension, which three exposes as
// compileAsync). That is all this does: it hands over every program up front, waits for the driver without blocking the page (so
// the loader keeps drawing), and only then lets the render loop start (Scene.jsx holds the loop until onDone). The picture is
// identical; it just no longer waits in a queue.
//
// The same moment is used to do the other things that would otherwise happen for the first time in the middle of a scroll, each of which
// was a stall of 300 to 600 ms when the visitor first scrolled: every texture the materials use is uploaded to the GPU (it normally
// happens when an object is first drawn, and much of the forest is not in the first frame's view), and the scene is drawn once, into a
// tiny hidden target, from a handful of points along the camera's path, so every buffer is uploaded and every object has been drawn
// before the first real frame. It is all done in small steps with the page free in between, and is given up after three seconds.
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
  const size = useThree((state) => state.size);

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

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    // Uploads and first draws, ahead of the scroll (see the header)
    const warm = async () => {
      const deadline = performance.now() + 3000;
      const textures = new Set();
      scene.traverse((object) => {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          for (const key of Object.keys(material)) {
            const value = material[key];
            if (value && value.isTexture && !value.isRenderTargetTexture) textures.add(value);
          }
          if (material.uniforms) {
            for (const key of Object.keys(material.uniforms)) {
              const value = material.uniforms[key] && material.uniforms[key].value;
              if (value && value.isTexture && !value.isRenderTargetTexture) textures.add(value);
            }
          }
        }
      });
      let uploaded = 0;
      for (const texture of textures) {
        gl.initTexture(texture);
        if (++uploaded % 3 === 0) {
          await tick();
          if (cancelled || performance.now() > deadline) return;
        }
      }

      const path = getCameraPath(TIMELINE, size.width / Math.max(1, size.height));
      const pose = createPose();
      const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
      const probe = new WebGLRenderTarget(96, 54);
      const previous = gl.getRenderTarget();
      try {
        for (const progress of [0.04, 0.16, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
          if (cancelled || performance.now() > deadline) break;
          path.evaluate(progress, pose);
          camera.position.copy(pose.position);
          camera.lookAt(pose.target);
          camera.fov = pose.fov;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld();
          gl.setRenderTarget(probe);
          gl.render(scene, camera);
          gl.setRenderTarget(previous);
          await tick();
        }
      } finally {
        gl.setRenderTarget(previous);
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.fov = saved.fov;
        camera.updateProjectionMatrix();
        probe.dispose();
      }
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
      try {
        await warm();
      } catch (error) {
        if (process.env.NODE_ENV === "development") console.warn("[precompile] warm-up failed", error);
      }
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
