// Per-borough convex hulls in world (x, z) space.
//
// Shared by `borough-boundaries.js` (outline lines) and
// `borough-ground-tints.js` (filled ground polygons) so both stay in
// lockstep and the hull math only runs once worth of code.
//
// The hulls are computed from each borough's filtered building points,
// projected through the same shared NYC projector the BuildingLayer
// uses -- so the outlines / tints line up with rendered geometry.

import { createNYCProjector } from './projection';
import { BOROUGH_PALETTE } from './building-color';

const NYC_BOUNDS = {
  minLat: 40.4,
  maxLat: 40.95,
  minLng: -74.3,
  maxLng: -73.65,
};

const DEFAULT_WORLD_SIZE = 300;
const DEFAULT_MIN_POINTS = 12;

export function isValidNYCRecord(d) {
  const lat = +d.latitude;
  const lng = +d.longitude;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= NYC_BOUNDS.minLat &&
    lat <= NYC_BOUNDS.maxLat &&
    lng >= NYC_BOUNDS.minLng &&
    lng <= NYC_BOUNDS.maxLng
  );
}

// Andrew's monotone chain. Pure, O(n log n).
// Input/output: arrays of [x, y]. Returns vertices CCW in the input
// coordinate plane, no duplicate closing point.
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (O, A, B) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

  const lower = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Compute per-borough convex hulls in world space.
// Returns: [{ borough, color, hullWorld: [{ x, z }, ...] }]
export function computeBoroughHulls(data, options = {}) {
  const worldSize = options.worldSize ?? DEFAULT_WORLD_SIZE;
  const minPoints = options.minPoints ?? DEFAULT_MIN_POINTS;

  if (!data || data.length === 0) return [];
  const valid = data.filter(isValidNYCRecord);
  if (valid.length === 0) return [];

  const project = createNYCProjector({ worldSize });

  const groups = new Map();
  for (const d of valid) {
    const b = d.borough;
    if (!b) continue;
    const arr = groups.get(b);
    if (arr) arr.push([+d.longitude, +d.latitude]);
    else groups.set(b, [[+d.longitude, +d.latitude]]);
  }

  const out = [];
  for (const [borough, pts] of groups) {
    if (pts.length < minPoints) continue;
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const hullWorld = hull.map(([lng, lat]) => project(lng, lat));
    out.push({
      borough,
      color: BOROUGH_PALETTE[borough] ?? '#1a1a2e',
      hullWorld,
    });
  }
  return out;
}
