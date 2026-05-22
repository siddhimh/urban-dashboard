// 3D city view container.
// Hosts the React Three Fiber scene foundation. Owns 3D-only UI state:
//   - hoveredId      : currently hovered building instance id
//   - selectedId     : last-clicked building instance id (for highlight)
//   - selectedRecord : the corresponding record (for the details panel)
//   - activePreset   : 'all' | borough code (drives the CameraRig)
//
// IMPORTANT: clicking a building is now PURELY LOCAL. It only updates
// the highlight + the details panel. App-level filters change only when
// the user explicitly clicks "Apply as Filters" in <SelectionPanel>,
// which fires `onApplyFilters(record)` to the parent (App.js).
//
// DOM siblings of <CityScene3D>:
//   - CameraPresets   (top-left)
//   - ActiveFilters3D (top-center, only when filters are active)
//   - Legend3D        (top-right)
//   - SelectionPanel  (bottom-left, only when something is selected)

import { useState, useEffect, useCallback } from 'react';
// Mapbox-backed 3D scene replaces the prior standalone R3F canvas.
// Same props contract, so every DOM overlay below keeps working.
import CityScene3D from '../three/city-scene-mapbox';
import Legend3D from '../three/legend-3d';
import CameraPresets from '../three/camera-presets';
import SelectionPanel from '../three/selection-panel';
import ActiveFilters3D from '../three/active-filters-3d';

function CityView3D({
  data = [],
  fullData = null,
  onApplyFilters,
  activeFilters = [],
  clearFilter,
  clearAll,
}) {
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [activePreset, setActivePreset] = useState('all');

  // Clear stale hover/selection whenever the underlying dataset changes
  // -- the old instance ids no longer point at the same buildings.
  useEffect(() => {
    setHoveredId(null);
    setSelectedId(null);
    setSelectedRecord(null);
  }, [data]);

  // BuildingLayer fires (record, instanceId). Purely local: we keep
  // the id for the highlight ring and the record for the panel. We
  // do NOT touch App-level filter state here.
  const handleSelect = useCallback((record, instanceId) => {
    setSelectedId(instanceId);
    setSelectedRecord(record);
  }, []);

  const handleClear = useCallback(() => {
    setSelectedId(null);
    setSelectedRecord(null);
  }, []);

  // Explicit user action -- bubble the selected record up so App.js can
  // fold it into shared 2D filter state. App will replace data, which
  // triggers the cleanup effect above and clears the selection.
  const handleApplyFilters = useCallback(
    (record) => {
      onApplyFilters?.(record);
    },
    [onApplyFilters]
  );

  // Force a fresh flyTo to the default NYC overview, even when we're
  // already on the 'all' preset. Toggling through the transient
  // 'reset' key produces a new prop value each click so the scene's
  // activePreset effect re-fires.
  const handleResetView = useCallback(() => {
    setActivePreset((prev) => (prev === 'reset' ? 'all' : 'reset'));
  }, []);

  return (
    <div
      className="city-view-3d"
      style={{
        position: 'relative',
        height: 'calc(100vh - 60px)',
        width: '100%',
        // Dark fallback colour so the frame doesn't flash white
        // before the Mapbox dark basemap paints in.
        background: '#0d1220',
      }}
    >
      <CityScene3D
        data={data}
        fullData={fullData}
        hoveredId={hoveredId}
        onHoverChange={setHoveredId}
        selectedId={selectedId}
        onSelect={handleSelect}
        activePreset={activePreset}
      />
      <CameraPresets
        activePreset={activePreset}
        setActivePreset={setActivePreset}
        onReset={handleResetView}
        position="top-left"
      />
      <ActiveFilters3D
        activeFilters={activeFilters}
        clearFilter={clearFilter}
        clearAll={clearAll}
        position="bottom-center"
      />
      <Legend3D position="top-right" />
      <SelectionPanel
        record={selectedRecord}
        onApplyFilters={handleApplyFilters}
        onClear={handleClear}
        position="bottom-left"
      />
    </div>
  );
}

export default CityView3D;
