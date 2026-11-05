// Shared, mutable motion state (no React re-renders). Written by GSAP / pointer handlers,
// read every frame by the phone (3D or CSS fallback).
export const story = {
  /** 0 → 1 across the cinematic hero + story track. */
  progress: 0,
  /** Pointer position in the hero, −1 … 1. */
  pointerX: 0,
  pointerY: 0,
  /** 0 → 1 entrance of the phone. */
  intro: 0,
}
