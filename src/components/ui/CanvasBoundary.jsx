"use client";

import { Component, createRef } from "react";

// A calm deep forest to moss wash. It always sits behind the canvas (so there is never a blank
// frame while the scene loads) and is all that remains if WebGL fails.
function ForestFallback() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-brand-forest via-brand-forest to-brand-moss/70" />
  );
}

// Cheap feature test on a throwaway canvas, so a device without WebGL never downloads or mounts
// the scene (and never logs the renderer's errors). The probe context is released straight away.
function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

// React only supports error boundaries as class components, so this is the single exception to
// the functional-components rule. If the WebGL canvas throws (no WebGL) or loses its context,
// the canvas is dropped and the fallback stays, so the HTML overlay never disappears.
export default class CanvasBoundary extends Component {
  // supported is null until the client has probed WebGL, so the scene never mounts on the server
  state = { failed: false, supported: null };
  root = createRef();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn("WebGL scene unavailable, showing the static fallback.", error);
  }

  componentDidMount() {
    const supported = hasWebGL();
    if (!supported) console.warn("WebGL is not available, showing the static fallback.");
    this.setState({ supported });

    // webglcontextlost does not bubble, but an ancestor can hear it in the capture phase.
    this.root.current?.addEventListener("webglcontextlost", this.handleContextLost, true);
  }

  componentWillUnmount() {
    this.root.current?.removeEventListener("webglcontextlost", this.handleContextLost, true);
  }

  handleContextLost = () => {
    this.setState({ failed: true });
  };

  render() {
    return (
      <div ref={this.root} className="absolute inset-0">
        <ForestFallback />
        {this.state.supported && !this.state.failed ? this.props.children : null}
      </div>
    );
  }
}
