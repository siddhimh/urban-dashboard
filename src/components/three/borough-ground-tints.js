// Per-borough ground tint.
//
// Fills each borough's convex hull (shared with `borough-boundaries.js`)
// with a low-opacity colored polygon, sitting just above the ground
// plane. Reinforces the borough -> color mapping without dominating
// the scene.
//
// Geometry: fan triangulation of the convex hull
//   triangles = [ (v0, v1, v2), (v0, v2, v3), ..., (v0, v(n-2), v(n-1)) ]
// Convex polygons triangulate trivially this way (no ear-clipping
// needed). 5 boroughs * ~10-15 vertices each is negligible.

import { useMemo } from 'react';
import * as THREE from 'three';
import { computeBoroughHulls } from '../../utils/borough-hulls';

const DEFAULT_WORLD_SIZE = 300;
// Sit above the ground plane (y=0) but BELOW the boundary outlines
// (y=0.08) so the outline reads as the border of the tint.
const DEFAULT_Y = 0.04;

function BoroughGroundTints({
  data,
  worldSize = DEFAULT_WORLD_SIZE,
  y = DEFAULT_Y,
  opacity = 0.22,
}) {
  const fills = useMemo(() => {
    const hulls = computeBoroughHulls(data, { worldSize });
    return hulls.map(({ borough, color, hullWorld }) => {
      const n = hullWorld.length;
      const positions = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        positions[i * 3 + 0] = hullWorld[i].x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = hullWorld[i].z;
      }
      // Fan triangulation: (n - 2) triangles, indexed off vertex 0.
      const indices = new Uint16Array((n - 2) * 3);
      for (let i = 1; i < n - 1; i++) {
        indices[(i - 1) * 3 + 0] = 0;
        indices[(i - 1) * 3 + 1] = i;
        indices[(i - 1) * 3 + 2] = i + 1;
      }
      return { borough, color, positions, indices };
    });
  }, [data, worldSize, y]);

  if (fills.length === 0) return null;

  return (
    <>
      {fills.map(({ borough, color, positions, indices }) => (
        // Keying on borough + vertex count forces fresh buffers when
        // the hull changes shape (e.g. after a filter).
        <mesh
          key={`${borough}:${positions.length}`}
          // Pass-through for raycasts: ground tints shouldn't capture
          // building hover/click events.
          raycast={() => null}
          // Render before opaque buildings (we're transparent + below
          // them), keeps the sort sane.
          renderOrder={-1}
        >
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={positions.length / 3}
              array={positions}
              itemSize={3}
            />
            <bufferAttribute
              attach="index"
              count={indices.length}
              array={indices}
              itemSize={1}
            />
          </bufferGeometry>
          <meshBasicMaterial
            color={color}
            transparent
            opacity={opacity}
            // DoubleSide spares us reasoning about hull winding order
            // after the lng/lat -> (x, -z) projection.
            side={THREE.DoubleSide}
            // Don't write to depth -- the tint must never occlude
            // anything; it's pure surface coloring.
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

export default BoroughGroundTints;
