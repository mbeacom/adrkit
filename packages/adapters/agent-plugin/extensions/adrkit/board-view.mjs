// @ts-check
/**
 * Pan and zoom for the decision board's graph, as pure functions over an SVG
 * `viewBox` in graph units: `{ x, y, w, h }`. The page applies a view by
 * setting the `viewBox` attribute, so zooming and panning set no inline style
 * and rebuild nothing.
 *
 * These functions are shipped twice from one source: imported here by the
 * tests, and embedded into the page script with `Function.prototype.toString`
 * (see board-page.mjs). So each one is self-contained ES2017: no imports, no
 * module-level constants, no closures over anything outside its own body.
 * A test runs the embedded copies to prove they are the same functions.
 *
 * A view always has the aspect ratio of the viewport it is drawn in, so the
 * SVG's `preserveAspectRatio` never letterboxes it, and `scale` (pixels per
 * graph unit) is `viewportWidth / view.w`.
 */

/**
 * Clamp a scale to the board's zoom range: 0.2 to 3, except that `floor` may
 * lower the minimum, so a graph that only fits below 0.2 can still be shown
 * whole and zoomed back out to that fit.
 *
 * @param {number} scale
 * @param {number} [floor] a lower minimum, used only when it is below 0.2
 * @returns {number}
 */
export function clampScale(scale, floor) {
  var MIN = typeof floor === 'number' && floor > 0 && floor < 0.2 ? floor : 0.2;
  var MAX = 3;
  if (!(scale > 0) || !isFinite(scale)) return 1;
  return Math.min(MAX, Math.max(MIN, scale));
}

/**
 * Keep at least half the viewport over the graph, so a pan or zoom cannot
 * lose the drawing off one edge.
 *
 * @param {{ x: number, y: number, w: number, h: number }} view
 * @param {number} graphW
 * @param {number} graphH
 */
export function clampView(view, graphW, graphH) {
  var minX = -view.w / 2;
  var maxX = Math.max(minX, graphW - view.w / 2);
  var minY = -view.h / 2;
  var maxY = Math.max(minY, graphH - view.h / 2);
  return {
    x: Math.min(maxX, Math.max(minX, view.x)),
    y: Math.min(maxY, Math.max(minY, view.y)),
    w: view.w,
    h: view.h,
  };
}

/**
 * The whole graph, centred, at the largest scale that fits (never above 1, so
 * a small graph is not blown up), even when that is below the zoom minimum.
 *
 * @param {number} graphW
 * @param {number} graphH
 * @param {number} viewW viewport width in pixels
 * @param {number} viewH viewport height in pixels
 */
export function fitView(graphW, graphH, viewW, viewH) {
  var gw = graphW > 0 ? graphW : 1;
  var gh = graphH > 0 ? graphH : 1;
  var vw = viewW > 0 ? viewW : gw;
  var vh = viewH > 0 ? viewH : gh;
  // Fit means the whole graph, so it may go below the interactive minimum.
  var fit = Math.min(1, vw / gw, vh / gh);
  var scale = clampScale(fit, fit);
  var w = vw / scale;
  var h = vh / scale;
  return { x: (gw - w) / 2, y: (gh - h) / 2, w: w, h: h };
}

/**
 * Where the board opens: the whole graph when it fits at a readable scale
 * (0.6 or more: 12 px labels stay above 7 px); otherwise the top of it, fitted
 * to the width at no less than
 * that scale, so labels stay legible and the rest is a pan or a zoom away.
 *
 * @param {number} graphW
 * @param {number} graphH
 * @param {number} viewW
 * @param {number} viewH
 */
export function initialView(graphW, graphH, viewW, viewH) {
  var fitted = fitView(graphW, graphH, viewW, viewH);
  var vw = viewW > 0 ? viewW : graphW > 0 ? graphW : 1;
  if (vw / fitted.w >= 0.6) return fitted;
  var vh = viewH > 0 ? viewH : graphH > 0 ? graphH : 1;
  var gw = graphW > 0 ? graphW : 1;
  var scale = clampScale(Math.max(0.6, Math.min(1, vw / gw)));
  var w = vw / scale;
  var h = vh / scale;
  var gh = graphH > 0 ? graphH : 1;
  return { x: gw > w ? 0 : (gw - w) / 2, y: gh > h ? 0 : (gh - h) / 2, w: w, h: h };
}

/**
 * Zoom by `factor` (above 1 zooms in) about an anchor given as a fraction of
 * the viewport (0..1 on each axis; 0.5, 0.5 is the centre), so the graph point
 * under the pointer stays under it. The result is clamped to the zoom range.
 *
 * @param {{ x: number, y: number, w: number, h: number }} view
 * @param {number} factor
 * @param {number} fx
 * @param {number} fy
 * @param {number} viewW viewport width in pixels
 * @param {number} [floor] the fitted scale, when it is below the zoom minimum
 */
export function zoomView(view, factor, fx, fy, viewW, floor) {
  var vw = viewW > 0 ? viewW : view.w;
  var scale = vw / view.w;
  var next = clampScale(scale * (factor > 0 && isFinite(factor) ? factor : 1), floor);
  var ratio = scale / next;
  var w = view.w * ratio;
  var h = view.h * ratio;
  var ax = fx >= 0 && fx <= 1 ? fx : 0.5;
  var ay = fy >= 0 && fy <= 1 ? fy : 0.5;
  return { x: view.x + (view.w - w) * ax, y: view.y + (view.h - h) * ay, w: w, h: h };
}

/**
 * Pan by a distance in viewport pixels: dragging right moves the drawing
 * right, so the view's origin moves left.
 *
 * @param {{ x: number, y: number, w: number, h: number }} view
 * @param {number} dx
 * @param {number} dy
 * @param {number} viewW viewport width in pixels
 */
export function panView(view, dx, dy, viewW) {
  var vw = viewW > 0 ? viewW : view.w;
  var unit = view.w / vw;
  return { x: view.x - (isFinite(dx) ? dx : 0) * unit, y: view.y - (isFinite(dy) ? dy : 0) * unit, w: view.w, h: view.h };
}

/**
 * Re-shape a view for a viewport whose aspect changed (a resize), keeping its
 * scale and top-left corner.
 *
 * @param {{ x: number, y: number, w: number, h: number }} view
 * @param {number} viewW
 * @param {number} viewH
 * @param {number} previousW the viewport width the view was made for
 */
export function resizeView(view, viewW, viewH, previousW) {
  var scale = (previousW > 0 ? previousW : view.w) / view.w;
  return { x: view.x, y: view.y, w: (viewW > 0 ? viewW : view.w * scale) / scale, h: (viewH > 0 ? viewH : view.h * scale) / scale };
}

/** @param {{ x: number, y: number, w: number, h: number }} view */
export function viewBoxOf(view) {
  var r = /** @param {number} n */ function (n) { return Math.round(n * 100) / 100; };
  return r(view.x) + ' ' + r(view.y) + ' ' + r(view.w) + ' ' + r(view.h);
}

/** Every helper, in the order the page script embeds them. */
export const VIEW_HELPERS = [clampScale, clampView, fitView, initialView, zoomView, panView, resizeView, viewBoxOf];

/** The helpers' source, for the page script. */
export const VIEW_HELPERS_SRC = VIEW_HELPERS.map((fn) => fn.toString()).join('\n');
