import { describe, it, expect } from "vitest";
import { clampScale, focalZoom, pinchStep, MIN_SCALE, MAX_SCALE, type View } from "./viewport";

// The screen position of a content point `c` under the node-layer transform is `view.x + c * view.scale`
// (and `view.y + c * view.scale` on the y-axis). These tests assert the invariant the touch UI depends on:
// focal zoom keeps the content point under the focus fixed on screen, so a pinch/wheel grows the map
// *around your fingers*, not off-centre.
const screenX = (v: View, c: number) => v.x + c * v.scale;
const screenY = (v: View, c: number) => v.y + c * v.scale;

describe("clampScale", () => {
  it("keeps a scale inside the default bounds", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
  });

  it("honours custom bounds", () => {
    expect(clampScale(5, 1, 3)).toBe(3);
    expect(clampScale(0.5, 1, 3)).toBe(1);
  });
});

describe("focalZoom", () => {
  it("is the identity at factor 1", () => {
    const v: View = { x: 12, y: -34, scale: 2 };
    expect(focalZoom(v, 100, 200, 1)).toEqual(v);
  });

  it("keeps the focus point pinned while scaling", () => {
    const v: View = { x: 0, y: 0, scale: 1 };
    const fx = 100;
    const fy = 250;
    // content point currently under the focus
    const cx = (fx - v.x) / v.scale;
    const cy = (fy - v.y) / v.scale;
    const out = focalZoom(v, fx, fy, 2);
    expect(out.scale).toBe(2);
    // the same content point still projects to the focus on screen (both axes)
    expect(screenX(out, cx)).toBeCloseTo(fx, 9);
    expect(screenY(out, cy)).toBeCloseTo(fy, 9);
  });

  it("pins the focus when zooming out too", () => {
    const v: View = { x: -40, y: 80, scale: 3 };
    const fx = 512;
    const cx = (fx - v.x) / v.scale;
    const out = focalZoom(v, fx, 999, 0.5);
    expect(out.scale).toBe(1.5);
    expect(screenX(out, cx)).toBeCloseTo(fx, 9);
  });

  it("clamps at MAX_SCALE yet still keeps the focus pinned", () => {
    const v: View = { x: 5, y: 5, scale: 5 };
    const fx = 300;
    const cx = (fx - v.x) / v.scale;
    const out = focalZoom(v, fx, fx, 100); // 5 * 100 → clamped to MAX_SCALE
    expect(out.scale).toBe(MAX_SCALE);
    expect(screenX(out, cx)).toBeCloseTo(fx, 9);
  });
});

describe("pinchStep", () => {
  it("pans by the midpoint travel at factor 1 (two fingers dragging, not spreading)", () => {
    const v: View = { x: 10, y: 20, scale: 2 };
    const out = pinchStep(v, 150, 90, 100, 100, 1); // midpoint moved +50, -10
    expect(out.scale).toBe(2);
    expect(out.x).toBeCloseTo(10 + 50, 9);
    expect(out.y).toBeCloseTo(20 - 10, 9);
  });

  it("zooms around a still midpoint like focalZoom", () => {
    const v: View = { x: 0, y: 0, scale: 1 };
    const still = focalZoom(v, 200, 200, 1.5);
    const out = pinchStep(v, 200, 200, 200, 200, 1.5);
    expect(out).toEqual(still);
  });

  it("keeps the midpoint pinned while both spreading and drifting", () => {
    const v: View = { x: 3, y: 7, scale: 1.5 };
    const mid = { x: 260, y: 140 };
    const cx = (mid.x - v.x) / v.scale;
    // spread (factor 1.4) with no midpoint drift → the content under the midpoint stays put
    const out = pinchStep(v, mid.x, mid.y, mid.x, mid.y, 1.4);
    expect(screenX(out, cx)).toBeCloseTo(mid.x, 9);
  });
});
