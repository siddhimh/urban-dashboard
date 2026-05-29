// XR / spatial measurement tools.
//
// Mounted inside the WebGL scene so the visualizations work in both
// desktop and AR/VR. Each tool is driven by `activeTool` state lifted
// to SpatialTwinView; the tool itself reads hover / select anchors
// from the building layers (no XR-specific code -- the existing
// raycast pipeline works on controller / hand rays via @react-three/xr).
//
// First tool that's actually wired:
//   - Height Probe: click a building, get floors / estimated meters /
//                   percentile rank vs. the dataset.
//
// Scaffolded for later (feature-flagged off in the UI):
//   - Distance Ruler  -- pick two buildings, draw a line, label the gap.
//   - Radius Brush    -- already done via cluster brush; in human-scale
//                        this would be a 200 m disk of "buildings near me".
//   - Sightline Ray   -- a forward ray that reports which building
//                        intercepts the view direction.

import { useMemo } from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";
import { percentileRank } from "../../utils/layer-stats";

export const TOOL_DEFS = [
  { id: "none", label: "None", available: true },
  { id: "heightProbe", label: "Height Probe", available: true },
  { id: "ruler", label: "Distance Ruler", available: false },
  { id: "radius", label: "Radius Brush", available: false },
  { id: "sightline", label: "Sightline", available: false },
];

// Convert scene-meter height into an approximate real-world height
// label. In tabletop mode the building extrusion is in world units
// (0.06 per floor) so we infer floors from `numfloors`; in human
// scale the extrusion already IS in meters. The caller passes a
// `mode` so we render the right unit.
function formatHeightLabel(record, anchor, mode) {
  const floors = +record?.numfloors;
  const validFloors = Number.isFinite(floors) && floors > 0 ? floors : null;

  // ~3 m / floor is the standard back-of-envelope estimate for NYC.
  const meters = validFloors ? Math.round(validFloors * 3) : null;
  const label = validFloors
    ? `${validFloors} floors · ~${meters} m`
    : "Height unknown";
  return { label, floors: validFloors, meters };
}

/**
 * Height Probe -- draws a vertical guide from base to roof of the
 * selected building plus a floating label with floors / meters /
 * percentile rank.
 *
 * Expects the selected anchor to carry { pos, base, height? } -- both
 * the tabletop layers and the human-scale layer already produce this
 * shape via their `anchor` constructors.
 */
export function HeightProbeOverlay({
  active,
  anchor,
  stats,
  mode = "tabletop",
}) {
  const lineData = useMemo(() => {
    if (!active || !anchor) return null;
    const [x, top, z] = anchor.pos;
    const base = anchor.base ?? [x, 0, z];
    const topY = mode === "human" ? anchor.height ?? top : top;
    const baseY = base[1] ?? 0;
    return {
      base: [base[0], baseY, base[2]],
      top: [x, topY, z],
      labelPos: [x, topY + (mode === "human" ? 4 : 0.45), z],
    };
  }, [active, anchor, mode]);

  if (!active || !anchor || !lineData) return null;

  const heightInfo = formatHeightLabel(anchor.record, anchor, mode);
  const floorsValue = +anchor.record?.numfloors;
  const rank =
    Number.isFinite(floorsValue) && floorsValue > 0
      ? percentileRank(stats?.floors?.sorted, floorsValue)
      : null;

  const rankLine = rank != null ? `Taller than ${Math.round(rank * 100)}% of the dataset` : "";

  return (
    <group raycast={() => null}>
      <Line
        points={[lineData.base, lineData.top]}
        color="#39d5ff"
        lineWidth={mode === "human" ? 3 : 2}
        transparent
        opacity={0.85}
      />
      <mesh position={lineData.top}>
        <sphereGeometry args={[mode === "human" ? 0.4 : 0.04, 16, 16]} />
        <meshBasicMaterial color="#39d5ff" />
      </mesh>
      <mesh position={lineData.base}>
        <sphereGeometry args={[mode === "human" ? 0.3 : 0.03, 16, 16]} />
        <meshBasicMaterial color="#39d5ff" transparent opacity={0.7} />
      </mesh>
      <Text
        position={lineData.labelPos}
        fontSize={mode === "human" ? 0.9 : 0.18}
        color="#e8f7ff"
        anchorX="center"
        anchorY="middle"
        outlineColor="#03070d"
        outlineWidth={mode === "human" ? 0.05 : 0.01}
        maxWidth={mode === "human" ? 30 : 4}
      >
        {`${heightInfo.label}${rankLine ? "\n" + rankLine : ""}`}
      </Text>
    </group>
  );
}

/**
 * Floating toolbar (DOM overlay) rendered in spatial-twin-view.js.
 * Picks tools from TOOL_DEFS; disabled tools are visible but inert
 * so the user can see what's coming.
 */
export function ToolPicker({ activeTool, onChange, disabled }) {
  return (
    <div className="spatial-tool-picker">
      <div className="spatial-tool-picker-label">Tools</div>
      <div className="spatial-tool-picker-row">
        {TOOL_DEFS.map((tool) => {
          const isActive = activeTool === tool.id;
          const isDisabled = disabled || !tool.available;
          return (
            <button
              key={tool.id}
              type="button"
              className={
                isActive
                  ? "spatial-tool-btn active"
                  : "spatial-tool-btn"
              }
              disabled={isDisabled}
              onClick={() => onChange?.(tool.id)}
              title={tool.available ? tool.label : `${tool.label} (coming soon)`}
            >
              {tool.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
