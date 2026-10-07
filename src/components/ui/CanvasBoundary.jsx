"use client";

import { Component, createRef } from "react";
import { hasWebGL } from "@/lib/hasWebGL";
import { markPart } from "@/lib/loadState";

// A calm deep forest to moss wash. It always sits behind the canvas (so there is never a blank
// frame while the scene loads) and is all that remains if WebGL fails.
function ForestFallback() {
  return (
    <div className="absolute inset-0 bg-gradient-to-b from-brand-forest via-brand-forest to-brand-moss/70" />
  );
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
    markPart("scene"); // nothing to wait for: the loader may go
  }

  componentDidMount() {
    const supported = hasWebGL();
    if (!supported) console.warn("WebGL is not available, showing the static fallback.");
    this.setState({ supported });
    if (!supported) markPart("scene"); // nothing to wait for: the loader may go

    // webglcontextlost does not bubble, but an ancestor can hear it in the capture phase.
    this.root.current?.addEventListener("webglcontextlost", this.handleContextLost, true);
  }

  componentWillUnmount() {
    this.root.current?.removeEventListener("webglcontextlost", this.handleContextLost, true);
  }

  handleContextLost = () => {
    markPart("scene");
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
