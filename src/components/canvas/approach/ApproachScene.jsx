"use client";

import PathAndGround from "./PathAndGround";
import UnderstoryFlora from "./UnderstoryFlora";
import Trunks from "./Trunks";
import Signposts from "./Signposts";
import StoryProps from "./StoryProps";
import TrunkSteps from "./TrunkSteps";
import AirAndLight, { LightRamp } from "./AirAndLight";
import TreehouseGlimpse from "./TreehouseGlimpse";

// ---------------------------------------------------------------------------
// The Approach, composed from the sibling world components (each a default export, no props).
//
// It is split in two because they mount differently (see src/components/canvas/SectionsHost.jsx):
//
//   World         the visible woodland. Mounted INSIDE <RevealGroup>: invisible at progress 0, dissolves
//                 in over the first 4.5 percent of scroll, so the approved hero frame never changes.
//   Controllers   non visual drivers (the light ramp: fog, sun, exposure). Mounted OUTSIDE the
//                 RevealGroup, because they must run from progress 0 (and are identical to the hero there).
//
// src/lib/sections/approach.js points the section's `Scene` at World and `Controllers` at Controllers.
// Order matters only for readability: ground first, then what stands on it, then air and light.
// ---------------------------------------------------------------------------

export function World() {
  return (
    <>
      <PathAndGround />
      <UnderstoryFlora />
      <Trunks />
      <Signposts />
      <StoryProps />
      <TrunkSteps />
      <AirAndLight />
      <TreehouseGlimpse />
    </>
  );
}

export function Controllers() {
  return <LightRamp />;
}

export default World;
