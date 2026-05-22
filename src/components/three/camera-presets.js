// Camera preset button row for the 3D city scene.
//
// Plain DOM component, rendered as a SIBLING of <Canvas>. Clicking a
// button changes `activePreset`, which is consumed by CameraRig to
// smoothly fly the camera to that borough's framing (or back to "All").
//
// No business logic here -- it just calls setActivePreset(key).

import {
  BOROUGH_ORDER,
  BOROUGH_NAMES,
  BOROUGH_PALETTE,
} from '../../utils/building-color';

function CameraPresets({
  activePreset = 'all',
  setActivePreset,
  onReset,
  position = 'top-left',
}) {
  const anchorStyle = {
    position: 'absolute',
    zIndex: 5,
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'blur(6px)',
    border: '1px solid #ebedf2',
    borderRadius: 10,
    padding: '8px 10px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  };
  if (position === 'top-left') Object.assign(anchorStyle, { top: 16, left: 16 });
  else if (position === 'top-right') Object.assign(anchorStyle, { top: 16, right: 16 });
  else if (position === 'bottom-left') Object.assign(anchorStyle, { bottom: 16, left: 16 });
  else Object.assign(anchorStyle, { bottom: 16, right: 16 });

  const baseBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    border: '1px solid #ebedf2',
    borderRadius: 16,
    background: '#fff',
    color: '#6b6d82',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 120ms ease',
  };

  const renderButton = (key, label, color) => {
    const isActive = activePreset === key;
    const style = {
      ...baseBtn,
      borderColor: isActive ? (color ?? '#1a1a2e') : '#ebedf2',
      color: isActive ? (color ?? '#1a1a2e') : '#6b6d82',
      background: isActive
        ? color
          ? `${color}18`
          : '#f4f5f9'
        : '#fff',
      fontWeight: isActive ? 700 : 500,
    };
    return (
      <button
        key={key}
        type="button"
        style={style}
        onClick={() => setActivePreset?.(key)}
      >
        {color && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: color,
              display: 'inline-block',
            }}
          />
        )}
        {label}
      </button>
    );
  };

  return (
    <div style={anchorStyle}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#9a9cb0',
          marginBottom: 6,
        }}
      >
        View
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {renderButton('all', 'NYC Overview', null)}
        {BOROUGH_ORDER.map((b) =>
          renderButton(b, BOROUGH_NAMES[b], BOROUGH_PALETTE[b])
        )}
        <button
          key="reset"
          type="button"
          title="Re-frame the NYC overview"
          style={{
            ...baseBtn,
            color: '#4b4d66',
            borderColor: '#d8dae7',
            background: '#fafbfe',
          }}
          onClick={() => {
            // Default handler: toggle the preset through a transient
            // 'reset' key so the scene effect fires even when we're
            // already on 'all'. 'reset' maps to the same default
            // framing on the scene side (see city-scene-mapbox).
            if (onReset) {
              onReset();
              return;
            }
            setActivePreset?.((prev) => (prev === 'reset' ? 'all' : 'reset'));
          }}
        >
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              display: 'inline-block',
              borderRadius: 2,
              border: '2px solid currentColor',
              borderRight: 'none',
              borderBottom: 'none',
              transform: 'rotate(-45deg)',
              marginRight: 2,
            }}
          />
          Reset
        </button>
      </div>
    </div>
  );
}

export default CameraPresets;
