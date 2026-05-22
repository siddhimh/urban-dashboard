// Subtle borough boundary outlines on the ground plane.
//
// Hull math is shared with `borough-ground-tints.js` via
// `src/utils/borough-hulls.js`, so both layers see exactly the same
// per-borough polygon. We just turn each hull into a thin LineLoop.
//
// Notes:
//   - Lives inside <Canvas>. No DOM, no interaction.
//   - Lifted slightly above y=0 to avoid z-fighting with the ground
//     plane (and the ground tint mesh which sits just below us).
//   - WebGL ignores linewidth > 1 on most platforms; we lean on color +
//     opacity for the "subtle" feel rather than thick strokes.

import { useMemo } from 'react';
import { computeBoroughHulls } from '../../utils/borough-hulls';

const DEFAULT_WORLD_SIZE = 300;
// Just enough lift to clear the ground plane and the ground-tint mesh.
const DEFAULT_Y = 0.08;

function BoroughBoundaries({
  data,
  worldSize = DEFAULT_WORLD_SIZE,
  y = DEFAULT_Y,
  opacity = 0.6,
}) {
  const lines = useMemo(() => {
    const hulls = computeBoroughHulls(data, { worldSize });
    return hulls.map(({ borough, color, hullWorld }) => {
      const positions = new Float32Array(hullWorld.length * 3);
      for (let i = 0; i < hullWorld.length; i++) {
        positions[i * 3 + 0] = hullWorld[i].x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = hullWorld[i].z;
      }
      return { borough, color, positions };
    });
  }, [data, worldSize, y]);

  if (lines.length === 0) return null;

  return (
    <>
      {lines.map(({ borough, positions, color }) => (
        // lineLoop = THREE.LineLoop -- auto-closes the polygon.
        // Keying on borough + vertex count forces a fresh BufferGeometry
        // when the hull shape changes (e.g. after a filter).
        <lineLoop key={`${borough}:${positions.length}`}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={positions.length / 3}
              array={positions}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={color}
            transparent
            opacity={opacity}
            // Don't write to depth -- prevents the line from occluding
            // tiny details on the ground plane and keeps it visually
            // recessive against the buildings above.
            depthWrite={false}
          />
        </lineLoop>
      ))}
    </>
  );
}

export default BoroughBoundaries;
