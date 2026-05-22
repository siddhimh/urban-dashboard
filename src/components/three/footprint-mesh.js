
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import mapboxgl from 'mapbox-gl';
import { getBoroughColor } from '../../utils/building-color';


const HEIGHT_PER_FLOOR_M = 22.0;
const MIN_HEIGHT_M = 18;
const MAX_FLOORS = 120;
const FT_TO_M = 0.3048;


export const HEIGHT_EXAGGERATION = 4.2;

const COLOR_DESATURATION = 0.10;

const COLOR_LIGHTNESS_OFFSET = 0;

const BOTTOM_SHADE = 0.48;
const TOP_SHADE = 1.12;
// Roof vertices get their own slightly-brightened multiplier so
// the top face catches the key light and doesn't bleed into the
// roof of whatever's behind it.
const ROOF_SHADE = 1.18;
// How much epsilon (in merc Z units, relative to building height) we
// allow when deciding "is this vertex on the roof plane?". Extrude
// geometry stamps vertices exactly at z=0 and z=depth, but floating-
// point slop means a ratio check is safer than equality.
const ROOF_Z_EPSILON = 0.995;

// Minimum-footprint handling.
//
// Many NYC buildings (garages, sheds, narrow rowhouses) digitize to
// 4-8 m wide polygons. At zoom 14 that's a sub-pixel smear. We
// enlarge any polygon smaller than MIN_FOOTPRINT_M on either axis by
// scaling it about its centroid. We cap the scale factor so a truly
// tiny polygon doesn't balloon to absurd proportions.
const MIN_FOOTPRINT_M = 24;
const MAX_INFLATE_SCALE = 3.2;

// Ramer-Douglas-Peucker tolerance.
//
// Expressed in meters (converted to Mercator units per-build via
// `mScale`). ~1.2 m matches the smallest architectural feature still
// worth preserving at typical dashboard zoom; anything finer gets
// collapsed into a straight edge. Typical vertex reduction: 40-60%
// on a dense footprint. LOD callers multiply this through the
// `simplification` build option to get a coarser mesh for zoomed-out
// viewing (e.g. simplification=4 ≈ 5m tolerance → another big triangle
// reduction at the cost of rough corners that zoom-out hides anyway).
const RDP_TOLERANCE_M = 1.2;

// Flat cool-grey used for context buildings (records rendered
// while a filter is active but not in the filtered set). Picked
// to sit a shade or two brighter than the dark basemap so the
// context reads as actual geometry, while staying dim enough for
// the full-color filtered mesh to dominate the composition.
const CONTEXT_COLOR = 0x2d3240;

// Near-black tone baked into the ground-shadow mesh. On the dark
// basemap a pure-black shadow disappears; we lift it just enough
// that the contact edge still registers as a subtle darkening
// around each tower's base.
const SHADOW_COLOR = 0x000207;

// Shoelace signed area of a ring of Vector2. Used to guard
// simplification from collapsing a ring into < 3 usable points.
function ringSignedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return a * 0.5;
}

// Perpendicular distance from `p` to the segment a-b. Standard
// projection-onto-line formula; returns 0 when a === b.
function perpDistanceSq(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  // t = param along a->b where the perpendicular from p lands
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx - p.x;
  const py = a.y + t * dy - p.y;
  return px * px + py * py;
}

// Iterative Ramer-Douglas-Peucker on an open polyline (first/last
// points pinned). Accepts Vector2[]; returns a new Vector2[] with
// redundant intermediate vertices dropped. Iterative (stack-based)
// implementation so a pathological 10k-vertex ring doesn't blow the
// JS recursion limit.
function simplifyPolyline(points, toleranceSq) {
  const n = points.length;
  if (n <= 2) return points.slice();

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;

  const stack = [[0, n - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxD = 0;
    let maxIdx = -1;
    const a = points[first];
    const b = points[last];
    for (let i = first + 1; i < last; i++) {
      const d = perpDistanceSq(points[i], a, b);
      if (d > maxD) {
        maxD = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxD > toleranceSq) {
      keep[maxIdx] = 1;
      stack.push([first, maxIdx]);
      stack.push([maxIdx, last]);
    }
  }

  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

// Simplify a closed ring. GeoJSON rings repeat their first coord at
// the end; we strip that, run RDP on the open polyline, then drop
// the original closure point before handing back to THREE.Shape
// (which closes the shape implicitly).
function simplifyRing(ring, toleranceSq) {
  if (ring.length < 4) return ring.slice();
  // Drop duplicated closure point if present so the endpoints of the
  // polyline RDP sees aren't identical.
  const last = ring[ring.length - 1];
  const first = ring[0];
  let open = ring;
  if (Math.abs(last.x - first.x) < 1e-12 && Math.abs(last.y - first.y) < 1e-12) {
    open = ring.slice(0, -1);
  }
  if (open.length < 4) return open;
  const simplified = simplifyPolyline(open, toleranceSq);
  // RDP must leave us with a ring that still forms a polygon.
  if (simplified.length < 3) return open;
  return simplified;
}

// Compute the bounds of a ring in Vector2 space.
function ringBounds(pts) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

// Scale a ring of Vector2 about its bbox center. Used by the
// min-size guard to inflate under-visible footprints without changing
// their shape. Mutates in place for performance.
function inflateRingInPlace(pts, scale, cx, cy) {
  for (const p of pts) {
    p.x = cx + (p.x - cx) * scale;
    p.y = cy + (p.y - cy) * scale;
  }
}

// Height in meters. Prefer the authoritative footprint heightroof
// (feet) when present; fall back to the floors estimate. MIN_HEIGHT_M
// keeps 1-story buildings visible; HEIGHT_EXAGGERATION gives the
// overview skyline some presence without distorting relative heights.
function computeHeightMeters(record, footprint) {
  const hrFt = footprint?.heightRoof;
  let base;
  if (Number.isFinite(hrFt) && hrFt > 0) {
    base = hrFt * FT_TO_M;
  } else {
    const raw = +record.numfloors;
    const floors = Math.min(
      Math.max(Number.isFinite(raw) ? raw : 1, 1),
      MAX_FLOORS
    );
    base = floors * HEIGHT_PER_FLOOR_M;
  }
  return Math.max(base, MIN_HEIGHT_M) * HEIGHT_EXAGGERATION;
}

// Convert a GeoJSON ring ([[lng, lat], ...]) to THREE.Vector2 points
// in Mercator units, RELATIVE to `anchor`. Keeping the shape local
// (not in absolute Mercator) avoids floating-point precision loss
// that would show up as wobbling geometry at NYC's scale.
function ringToLocalPoints(ring, anchor) {
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const lng = ring[i][0];
    const lat = ring[i][1];
    const m = mapboxgl.MercatorCoordinate.fromLngLat([lng, lat], 0);
    pts.push(new THREE.Vector2(m.x - anchor.x, m.y - anchor.y));
  }
  return pts;
}

// Build a THREE.Shape (with holes) for one record's footprint,
// applying simplification + minimum-size inflation. Returns
// { shape, anchor, outerAbs } or null if the polygon is unusable
// (too few points, self-intersecting, etc).
//
// `outerAbs` is the simplified outer ring in ABSOLUTE mercator
// coordinates, suitable for drawing a selection outline directly.
function buildShapeForFootprint(
  record,
  footprint,
  { mScale, simplification = 1, minFootprintM = MIN_FOOTPRINT_M }
) {
  const geom = footprint?.geometry;
  if (!geom) return null;

  let polygonCoords;
  if (geom.type === 'Polygon') {
    polygonCoords = geom.coordinates;
  } else if (geom.type === 'MultiPolygon') {
    // One record == one building. Pick the largest polygon (by vertex
    // count as a cheap proxy for area) so we don't lose the main mass
    // on a feature that happens to carry a tiny outbuilding.
    polygonCoords = geom.coordinates.reduce((best, poly) => {
      if (!best) return poly;
      const bn = best[0]?.length ?? 0;
      const pn = poly[0]?.length ?? 0;
      return pn > bn ? poly : best;
    }, null);
  } else {
    return null;
  }

  if (!polygonCoords || polygonCoords.length === 0) return null;

  const outer = polygonCoords[0];
  if (!outer || outer.length < 3) return null;

  const anchor = mapboxgl.MercatorCoordinate.fromLngLat(
    [+record.longitude, +record.latitude],
    0
  );

  // RDP tolerance is specified in meters; convert to the squared
  // mercator distance our perpDistanceSq comparison expects. The
  // `simplification` multiplier lets LOD callers ask for a coarser
  // polygon — everything downstream (triangle count, edge pass) gets
  // proportionally lighter.
  const tolMerc = RDP_TOLERANCE_M * Math.max(0.25, simplification) * mScale;
  const tolMercSq = tolMerc * tolMerc;

  let outerPts = ringToLocalPoints(outer, anchor);
  outerPts = simplifyRing(outerPts, tolMercSq);
  if (outerPts.length < 3) return null;

  // Minimum-footprint inflation (uniform scale about centroid). At
  // coarse simplification levels we also bump the min floor so tiny
  // shapes still register as distinct buildings at zoom-out.
  const effMinFootprintM =
    minFootprintM * Math.max(1, Math.sqrt(simplification));
  const minMerc = effMinFootprintM * mScale;
  const bounds = ringBounds(outerPts);
  const smaller = Math.min(bounds.w, bounds.h);
  if (smaller > 0 && smaller < minMerc) {
    const scale = Math.min(minMerc / smaller, MAX_INFLATE_SCALE);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    inflateRingInPlace(outerPts, scale, cx, cy);
  }

  // If the ring collapsed to zero area after simplification, bail.
  if (Math.abs(ringSignedArea(outerPts)) < 1e-18) return null;

  const shape = new THREE.Shape(outerPts);

  for (let h = 1; h < polygonCoords.length; h++) {
    let holePts = ringToLocalPoints(polygonCoords[h], anchor);
    holePts = simplifyRing(holePts, tolMercSq);
    if (holePts.length >= 3) {
      shape.holes.push(new THREE.Path(holePts));
    }
  }

  // Convert the outer ring to absolute mercator for the caller's
  // selection-outline use. Local-anchored `outerPts` drive the
  // THREE.Shape (extruded in local space, then translated); `outerAbs`
  // is the same ring already translated to its absolute position.
  const outerAbs = outerPts.map(
    (p) => new THREE.Vector2(p.x + anchor.x, p.y + anchor.y)
  );

  return { shape, anchor, outerAbs };
}

// Main entry point. Returns null if nothing usable could be built.
//
// Options:
//   mScale         : meters -> Mercator units factor (required)
//   simplification : multiplier on RDP tolerance (default 1.0). Higher
//                    values produce lower-poly meshes for LOD swaps.
//   contextMode    : when true, emit flat muted-grey buildings with no
//                    vertical gradient. Used for the "rest of the
//                    city" pass when a filter is active.
//   heightScale    : scalar on computed building height (default 1).
//                    Context/low-LOD callers can push this below 1 to
//                    keep background buildings visually subordinate.
export function buildFootprintGeometry(
  records,
  footprints,
  {
    mScale,
    simplification = 1,
    contextMode = false,
    heightScale = 1,
  } = {}
) {
  if (!records || !footprints || footprints.size === 0) return null;
  if (!Number.isFinite(mScale) || mScale <= 0) return null;

  const geometries = [];
  const ranges = new Map();
  const color = new THREE.Color();
  let vertexOffset = 0;

  // Precompute the context tint once; in context mode every vertex of
  // every building uses the same flat tone.
  const contextColor = new THREE.Color(CONTEXT_COLOR);

  for (const [recIdx, footprint] of footprints.entries()) {
    const record = records[recIdx];
    if (!record) continue;

    const shapeInfo = buildShapeForFootprint(record, footprint, {
      mScale,
      simplification,
    });
    if (!shapeInfo) continue;
    const { shape, anchor, outerAbs } = shapeInfo;

    const heightM = computeHeightMeters(record, footprint);
    const depthMerc = heightM * Math.max(0.05, heightScale) * mScale;

    let g;
    try {
      g = new THREE.ExtrudeGeometry(shape, {
        depth: depthMerc,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1,
      });
    } catch {
      // Extrude can throw on self-intersecting rings. Skip that
      // record silently; with the box fallback retired, an unrenderable
      // footprint simply means the building doesn't appear.
      continue;
    }

    // Translate from the anchor-local shape into absolute Mercator
    // coordinates so the final merged mesh can sit at origin and
    // still place each building in the correct spot.
    g.translate(anchor.x, anchor.y, 0);

    const posCount = g.attributes.position.count;
    if (!posCount) {
      g.dispose();
      continue;
    }

    // Pick the base tone. In context mode every building gets the
    // same flat muted grey so the non-filtered city recedes; in the
    // default foreground path we desaturate the borough palette so
    // the color still reads as data-vis rather than a toy city.
    if (contextMode) {
      color.copy(contextColor);
    } else {
      color.set(getBoroughColor(record.borough));
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      color.setHSL(
        hsl.h,
        Math.max(0, hsl.s * (1 - COLOR_DESATURATION)),
        Math.max(0, Math.min(1, hsl.l + COLOR_LIGHTNESS_OFFSET))
      );
    }
    const baseR = color.r;
    const baseG = color.g;
    const baseB = color.b;

    // Bake a vertical tonal gradient into per-vertex colors. We read
    // each vertex's extrude-local Z (0 at ground, `depthMerc` at
    // roof), normalize to 0..1, and lerp between BOTTOM_SHADE and
    // TOP_SHADE — with a slight roof bump so the top face reads
    // clearly. This gives every building free pseudo-AO and a
    // top/side tonal split at zero shader cost.
    //
    // Context mode skips the gradient: flat grey buildings hold the
    // eye less and act as neutral scaffolding behind the filtered
    // mesh.
    const colors = new Float32Array(posCount * 3);
    const posArr = g.attributes.position.array;
    const roofZThreshold = depthMerc * ROOF_Z_EPSILON;
    for (let i = 0; i < posCount; i++) {
      let shade;
      if (contextMode) {
        shade = 1;
      } else {
        const z = posArr[i * 3 + 2];
        const t = depthMerc > 0 ? Math.max(0, Math.min(1, z / depthMerc)) : 1;
        shade = BOTTOM_SHADE + (TOP_SHADE - BOTTOM_SHADE) * t;
        if (z >= roofZThreshold) shade = ROOF_SHADE;
      }

      colors[i * 3] = Math.min(1, baseR * shade);
      colors[i * 3 + 1] = Math.min(1, baseG * shade);
      colors[i * 3 + 2] = Math.min(1, baseB * shade);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Compute the absolute-mercator bbox of the outer ring so the
    // selection layer can center its ground pool and edge outline
    // against the actual polygon (not the PLUTO lat/lng anchor,
    // which may sit well off-center for L-shaped buildings).
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of outerAbs) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    geometries.push(g);
    // Keep a snapshot of this building's baked vertex colors so the
    // hover-out path can restore the vertical shade gradient exactly.
    // A single scalar baseColor can't reproduce the bottom-to-top
    // ramp, so we store the per-vertex slice directly.
    const baseColors = new Float32Array(colors);
    ranges.set(recIdx, {
      start: vertexOffset,
      count: posCount,
      baseColor: [baseR, baseG, baseB], // retained for quick single-tone uses
      baseColors,
      heightMerc: depthMerc,
      // Outer ring in absolute mercator (post-simplification,
      // post-inflation). The selection layer re-extrudes this to
      // build an outline that hugs the real polygon.
      outerRing: outerAbs,
      center: [(minX + maxX) / 2, (minY + maxY) / 2],
      extents: [maxX - minX, maxY - minY],
    });

    vertexOffset += posCount;
  }

  if (geometries.length === 0) return null;

  let merged;
  try {
    merged = mergeGeometries(geometries, false);
  } catch {
    merged = null;
  }

  // Release the per-building sub-geometries regardless of merge success.
  for (const g of geometries) g.dispose();

  if (!merged) return null;

  merged.computeBoundingSphere();
  merged.computeBoundingBox();

  return { geometry: merged, ranges };
}

// In-place color update for one building's vertex range. Caller is
// responsible for setting `geometry.attributes.color.needsUpdate =
// true` -- we don't toggle it here so several updates per frame can
// be batched into a single upload.
export function writeBuildingColor(geometry, range, colorRGB) {
  if (!geometry || !range) return;
  const attr = geometry.attributes.color;
  if (!attr) return;
  const arr = attr.array;
  const r = colorRGB[0];
  const g = colorRGB[1];
  const b = colorRGB[2];
  const end = range.start + range.count;
  for (let i = range.start; i < end; i++) {
    arr[i * 3] = r;
    arr[i * 3 + 1] = g;
    arr[i * 3 + 2] = b;
  }
}

// Restore a building's baked vertex colors (with the full bottom-to-
// top shade gradient, not a single solid tone). Falls back to the
// single baseColor tuple for legacy ranges that don't carry a
// per-vertex snapshot.
export function resetBuildingColor(geometry, range) {
  if (!geometry || !range) return;
  const attr = geometry.attributes.color;
  if (!attr) return;
  const dst = attr.array;
  if (range.baseColors && range.baseColors.length === range.count * 3) {
    const src = range.baseColors;
    const base = range.start * 3;
    for (let i = 0; i < src.length; i++) {
      dst[base + i] = src[i];
    }
    return;
  }
  if (range.baseColor) {
    writeBuildingColor(geometry, range, range.baseColor);
  }
}

// Build a flat ground-shadow mesh from the outer rings already cached
// on `ranges`. One merged ShapeGeometry, positioned just above the
// basemap in Z, rendered as a single dark translucent pass.
//
// The shadow ring is inflated slightly outward from each building's
// centroid so the shadow "leaks" beyond the footprint edge, giving
// the eye the soft-contact depth cue a real cast shadow would
// provide without the cost of a shadow map on 20k meshes.
//
// Options:
//   mScale   : meters -> merc factor (required)
//   inflateM : how many meters to grow the footprint outward (default 3)
//   zOffset  : merc height above the basemap to park the shadow at.
//              Too small and it z-fights the map; too large and the
//              shadow floats away from the building's base. Small
//              positive defaults work well for typical NYC heights.
export function buildGroundShadowFromRanges(
  ranges,
  { mScale, inflateM = 3, zOffset = 0 } = {}
) {
  if (!ranges || ranges.size === 0) return null;
  if (!Number.isFinite(mScale) || mScale <= 0) return null;

  const inflateMerc = inflateM * mScale;
  const geometries = [];

  for (const range of ranges.values()) {
    const outer = range.outerRing;
    if (!outer || outer.length < 3) continue;

    const [cx, cy] = range.center;
    const [extW, extH] = range.extents;
    const half = Math.max(extW, extH) * 0.5;
    if (!(half > 0)) continue;

    // Scale each vertex outward from the footprint bbox center by a
    // uniform factor that adds `inflateMerc` to the larger bbox axis.
    const scale = (half + inflateMerc) / half;

    const local = new Array(outer.length);
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i];
      local[i] = new THREE.Vector2(
        cx + (p.x - cx) * scale,
        cy + (p.y - cy) * scale
      );
    }

    let g;
    try {
      const shape = new THREE.Shape(local);
      g = new THREE.ShapeGeometry(shape, 1);
    } catch {
      continue;
    }
    // ShapeGeometry emits x,y with z=0. Translate into our z-offset
    // so the shadow sits a hair above the basemap to avoid z-fighting.
    if (zOffset !== 0) g.translate(0, 0, zOffset);
    geometries.push(g);
  }

  if (geometries.length === 0) return null;

  let merged;
  try {
    merged = mergeGeometries(geometries, false);
  } catch {
    merged = null;
  }
  for (const g of geometries) g.dispose();
  if (!merged) return null;

  merged.computeBoundingSphere();
  return { geometry: merged, color: SHADOW_COLOR };
}
