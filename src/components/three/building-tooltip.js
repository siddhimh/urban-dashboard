// Hover tooltip for the 3D city scene.
//
// Wraps drei's <Html> so we can pin a normal DOM tooltip to a world
// position (the top of the hovered building). Reuses the existing
// `.d3-tooltip` / `.tt-row` / `.tt-label` / `.tt-value` classes from
// App.css so the 3D tooltip is visually identical to the 2D DotMap one.
//
// Pure presentational: receives a record + world position. No data
// fetching, no event wiring (that lives in BuildingLayer).

import { Html } from '@react-three/drei';
import { BOROUGH_NAMES } from '../../colors';

const formatNumber = (n) => {
  if (!Number.isFinite(+n)) return 'N/A';
  return Math.round(+n).toLocaleString();
};

function BuildingTooltip({ record, position }) {
  if (!record || !position) return null;

  const boroughLabel = BOROUGH_NAMES[record.borough] ?? record.borough ?? 'N/A';

  return (
    <Html
      // World-space anchor at the top of the building. drei's <Html>
      // projects this to screen space every frame.
      position={position}
      // Center horizontally, sit just above the anchor.
      center
      // Don't intercept the next pointer move -- otherwise the tooltip
      // can steal hover from the building beneath it and flicker.
      style={{ pointerEvents: 'none' }}
      // No distanceFactor -> fixed screen size at any zoom.
      zIndexRange={[100, 0]}
      wrapperClass="three-tooltip-wrapper"
    >
      <div
        className="d3-tooltip"
        style={{
          opacity: 1,
          position: 'relative',
          transform: 'translateY(-110%)',
          whiteSpace: 'nowrap',
        }}
      >
        <strong>{record.address || 'Unknown address'}</strong>
        <div className="tt-row">
          <span className="tt-label">Borough</span>
          <span className="tt-value">{boroughLabel}</span>
        </div>
        <div className="tt-row">
          <span className="tt-label">Floors</span>
          <span className="tt-value">{formatNumber(record.numfloors)}</span>
        </div>
        <div className="tt-row">
          <span className="tt-label">Year</span>
          <span className="tt-value">
            {Number.isFinite(+record.yearbuilt) && +record.yearbuilt > 0
              ? record.yearbuilt
              : 'N/A'}
          </span>
        </div>
        <div className="tt-row">
          <span className="tt-label">Area</span>
          <span className="tt-value">
            {Number.isFinite(+record.bldgarea)
              ? `${formatNumber(record.bldgarea)} sqft`
              : 'N/A'}
          </span>
        </div>
      </div>
    </Html>
  );
}

export default BuildingTooltip;
