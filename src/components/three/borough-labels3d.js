// Borough centroid labels for the 3D city scene.
//
// Computes the geographic centroid (mean lng/lat) of each borough from
// the same filtered dataset the BuildingLayer consumes, projects it
// with the same projector, and pins a drei <Html> label there.
//
// Lives inside <Canvas>. Pure presentation -- no interactions, no
// hover, no click.

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import { createNYCProjector } from '../../utils/projection';
import {
  BOROUGH_NAMES,
  BOROUGH_PALETTE,
} from '../../utils/building-color';

// Same NYC bounding box BuildingLayer uses, so the projector and the
// labels can never disagree about which records count.
const NYC_BOUNDS = {
  minLat: 40.4,
  maxLat: 40.95,
  minLng: -74.3,
  maxLng: -73.65,
};

const DEFAULT_WORLD_SIZE = 300;
const DEFAULT_Y = 6; // small lift so the label feels anchored above the ground

function isValidRecord(d) {
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

function BoroughLabels3D({
  data,
  worldSize = DEFAULT_WORLD_SIZE,
  y = DEFAULT_Y,
}) {
  const labels = useMemo(() => {
    if (!data || data.length === 0) return [];

    const valid = data.filter(isValidRecord);
    if (valid.length === 0) return [];

    // Same projector configuration as BuildingLayer (stable NYC extent).
    const project = createNYCProjector({ worldSize });

    // Single pass: accumulate per-borough lng/lat sums + counts.
    const sums = new Map();
    for (const d of valid) {
      const b = d.borough;
      if (!b) continue;
      const acc = sums.get(b) ?? { lng: 0, lat: 0, n: 0 };
      acc.lng += +d.longitude;
      acc.lat += +d.latitude;
      acc.n += 1;
      sums.set(b, acc);
    }

    const out = [];
    for (const [borough, { lng, lat, n }] of sums) {
      if (n === 0) continue;
      const centerLng = lng / n;
      const centerLat = lat / n;
      const { x, z } = project(centerLng, centerLat);
      out.push({
        borough,
        position: [x, y, z],
        color: BOROUGH_PALETTE[borough] ?? '#1a1a2e',
        name: BOROUGH_NAMES[borough] ?? borough,
      });
    }
    return out;
  }, [data, worldSize, y]);

  if (labels.length === 0) return null;

  return (
    <>
      {labels.map((label) => (
        <Html
          key={label.borough}
          position={label.position}
          center
          // Don't intercept hover so buildings underneath stay
          // tooltippable through the label area.
          style={{ pointerEvents: 'none' }}
          // No distanceFactor -> fixed screen size at any zoom.
          // Sit above buildings (zIndex 50) but below tooltips (100).
          zIndexRange={[50, 0]}
        >
          <div
            className="borough-label-3d"
            style={{
              fontFamily: "'Inter', 'Segoe UI', sans-serif",
              fontWeight: 700,
              fontSize: '13px',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: label.color,
              textShadow:
                '0 1px 2px rgba(255,255,255,0.9), 0 0 6px rgba(255,255,255,0.6)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {label.name}
          </div>
        </Html>
      ))}
    </>
  );
}

export default BoroughLabels3D;
