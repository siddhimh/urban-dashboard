// Hover tooltip for the 3D city scene.
//
// Wraps drei's <Html> so we can pin a small DOM card to a 3D
// position (the top of the hovered building). The tooltip is purely
// presentational; hover wiring lives in the building layers, and the
// position anchor is provided by the scene from the layer callbacks.

import { Html } from "@react-three/drei";
import { BOROUGH_NAMES } from "../../colors";

const formatNumber = (n) =>
  Number.isFinite(+n) ? Math.round(+n).toLocaleString() : "N/A";

function BuildingTooltip({ record, position, transform = false }) {
  if (!record || !position) return null;

  const boroughLabel =
    BOROUGH_NAMES[record.borough] ?? record.borough ?? "N/A";
  const floors = formatNumber(record.numfloors);
  const year =
    Number.isFinite(+record.yearbuilt) && +record.yearbuilt > 0
      ? record.yearbuilt
      : "N/A";

  // `transform` mode renders the HTML into a 3D plane the XR compositor
  // can actually see; the default DOM overlay is invisible inside an
  // immersive session, so it's only used on desktop.
  const xrProps = transform
    ? { transform: true, distanceFactor: 0.6, sprite: true }
    : { center: true };

  return (
    <Html
      position={position}
      style={{ pointerEvents: "none" }}
      zIndexRange={[100, 0]}
      wrapperClass="spatial-tooltip-wrapper"
      {...xrProps}
    >
      <div className="spatial-tooltip">
        <strong className="spatial-tooltip-title">
          {record.address || "Unknown address"}
        </strong>
        <div className="spatial-tooltip-row">
          <span>Borough</span>
          <span>{boroughLabel}</span>
        </div>
        <div className="spatial-tooltip-row">
          <span>Floors</span>
          <span>{floors}</span>
        </div>
        <div className="spatial-tooltip-row">
          <span>Year</span>
          <span>{year}</span>
        </div>
      </div>
    </Html>
  );
}

export default BuildingTooltip;
