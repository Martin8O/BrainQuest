// Pure pan/zoom math for the skill-tree canvas (C2 + M3 touch redesign). Framework-neutral: the /map
// client owns the pointer events and React state, but the coordinate math — clamping the zoom and keeping
// a focal point pinned under the finger/cursor while scaling — lives here so it is unit-testable without a
// DOM. All coordinates are in the SVG's viewBox units (the same space MapNode x/y live in), NOT screen
// pixels; the client converts screen → viewBox via getScreenCTM before calling in.

/** The canvas view: a translate (viewBox units) + a uniform scale applied to the node layer. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.4;
// Deep enough that, combined with constant-size labels (which don't grow with zoom), dense topic clusters
// genuinely spread apart instead of just scaling up together.
export const MAX_SCALE = 7;

export function clampScale(s: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.max(min, Math.min(max, s));
}

/**
 * Zoom by `factor` around a focal point, keeping whatever content sits under the focus pinned there.
 * `fx,fy` are in viewBox units (post-viewBox mapping, pre node-layer transform). Used by wheel zoom
 * (focus = cursor), pinch (focus = the two-finger midpoint), double-tap, and the toolbar (focus = the
 * canvas centre). `factor` < 1 zooms out, > 1 zooms in; the result scale is clamped to [min, max].
 */
export function focalZoom(view: View, fx: number, fy: number, factor: number, min = MIN_SCALE, max = MAX_SCALE): View {
  const scale = clampScale(view.scale * factor, min, max);
  // The content point currently under the focus (invert the node-layer transform: screen = translate + c*scale).
  const cx = (fx - view.x) / view.scale;
  const cy = (fy - view.y) / view.scale;
  // Re-place the translate so that same content point stays under (fx,fy) at the new scale.
  return { scale, x: fx - cx * scale, y: fy - cy * scale };
}

/**
 * One pinch frame: zoom around the current two-finger midpoint by `factor`, AND pan by how far that
 * midpoint itself travelled since the previous frame — so two fingers can drag the map while pinching it.
 * All coordinates in viewBox units. At factor 1 with a still midpoint this is the identity.
 */
export function pinchStep(
  view: View,
  midX: number,
  midY: number,
  prevMidX: number,
  prevMidY: number,
  factor: number,
  min = MIN_SCALE,
  max = MAX_SCALE,
): View {
  const zoomed = focalZoom(view, midX, midY, factor, min, max);
  return { scale: zoomed.scale, x: zoomed.x + (midX - prevMidX), y: zoomed.y + (midY - prevMidY) };
}
