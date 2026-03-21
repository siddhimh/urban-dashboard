import { useState, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import ScatterPlot from './components/scatterplot';
import SummaryCards from './components/summarycards';
import TrendLine from './components/trendline';
import LandUseBar from './components/landusebar';
import ZoningBar from './components/zoningbar';
import DotMap from './components/dotmap';
import { BOROUGH_NAMES, BOROUGH_PALETTE, BOROUGH_ORDER } from './colors';
import './app.css';

const LAND_USE_LABELS = {
  "1": "One & Two Family", "2": "Multi-Family Walk-Up", "3": "Multi-Family Elevator",
  "4": "Mixed Res/Commercial", "5": "Commercial & Office", "6": "Industrial & Mfg",
  "7": "Transport & Utility", "8": "Public Facilities", "9": "Open Space",
  "10": "Parking", "11": "Vacant Land"
};

function App() {
  const [sampleData, setSampleData] = useState([]);
  const [fullStats, setFullStats] = useState(null);

  // Cross-filter state — selectedBoroughs is a Set (empty = all)
  const [selectedBoroughs, setSelectedBoroughs] = useState(new Set());
  const [selectedLandUse, setSelectedLandUse] = useState(null);
  const [selectedZoning, setSelectedZoning] = useState(null);
  const [brushRange, setBrushRange] = useState(null);

  const toggleBorough = (b) => {
    setSelectedBoroughs(prev => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  };

  useEffect(() => {
    Promise.all([
      d3.csv("/pluto_sample.csv"),
      d3.csv("/full_stats.csv")
    ]).then(([sample, stats]) => {
      sample = sample.map(d => ({
        ...d,
        yearbuilt: +d.yearbuilt,
        numfloors: +d.numfloors,
        bldgarea: +d.bldgarea,
        lotarea: +d.lotarea,
        unitstotal: +d.unitstotal
      }));
      setSampleData(sample);

      // full_stats.csv has a single row — parse to numbers
      const s = stats[0];
      setFullStats({
        total_buildings: +s.total_buildings,
        total_boroughs: +s.total_boroughs,
        avg_floors: +s.avg_floors,
        max_floors: +s.max_floors,
        median_floors: +s.median_floors,
        avg_bldgarea: +s.avg_bldgarea,
        max_bldgarea: +s.max_bldgarea,
        avg_lotarea: +s.avg_lotarea,
        max_lotarea: +s.max_lotarea,
        avg_unitstotal: +s.avg_unitstotal,
        max_unitstotal: +s.max_unitstotal,
        oldest_year: +s.oldest_year,
        newest_year: +s.newest_year,
        total_landuse_types: +s.total_landuse_types,
        total_zoning_types: +s.total_zoning_types
      });
    });
  }, []);

  // Fully filtered data (all filters applied) — used by ScatterPlot, DotMap, SummaryCards
  const filteredData = useMemo(() => {
    let data = sampleData;
    if (selectedBoroughs.size > 0) data = data.filter(d => selectedBoroughs.has(d.borough));
    if (selectedLandUse) data = data.filter(d => String(Math.round(+d.landuse)) === selectedLandUse);
    if (selectedZoning) data = data.filter(d => d.zonedist1 === selectedZoning);
    if (brushRange) data = data.filter(d => d.yearbuilt >= brushRange[0] && d.yearbuilt <= brushRange[1]);
    return data;
  }, [sampleData, selectedBoroughs, selectedLandUse, selectedZoning, brushRange]);

  // Data for LandUseBar: filtered by everything EXCEPT land use (so all bars stay visible)
  const dataForLandUse = useMemo(() => {
    let data = sampleData;
    if (selectedBoroughs.size > 0) data = data.filter(d => selectedBoroughs.has(d.borough));
    if (selectedZoning) data = data.filter(d => d.zonedist1 === selectedZoning);
    if (brushRange) data = data.filter(d => d.yearbuilt >= brushRange[0] && d.yearbuilt <= brushRange[1]);
    return data;
  }, [sampleData, selectedBoroughs, selectedZoning, brushRange]);

  // Data for ZoningBar: filtered by everything EXCEPT zoning (so all zones stay visible)
  const dataForZoning = useMemo(() => {
    let data = sampleData;
    if (selectedBoroughs.size > 0) data = data.filter(d => selectedBoroughs.has(d.borough));
    if (selectedLandUse) data = data.filter(d => String(Math.round(+d.landuse)) === selectedLandUse);
    if (brushRange) data = data.filter(d => d.yearbuilt >= brushRange[0] && d.yearbuilt <= brushRange[1]);
    return data;
  }, [sampleData, selectedBoroughs, selectedLandUse, brushRange]);

  // Aggregated land use data — recomputed live from cross-filtered data
  const landUseComputed = useMemo(() => {
    if (!dataForLandUse.length) return [];
    // Only include valid land use codes (1–11)
    const valid = dataForLandUse.filter(d => +d.landuse >= 1 && +d.landuse <= 11);
    const grouped = d3.rollup(valid,
      v => ({
        count: v.length,
        avg_floors: d3.mean(v, d => d.numfloors),
        avg_bldgarea: d3.mean(v, d => d.bldgarea)
      }),
      d => String(Math.round(+d.landuse))
    );
    return Array.from(grouped, ([landuse, stats]) => ({
      landuse,
      count: stats.count,
      avg_floors: stats.avg_floors || 0,
      avg_bldgarea: stats.avg_bldgarea || 0
    }));
  }, [dataForLandUse]);

  // Aggregated trend data — recomputed live from cross-filtered data
  const trendComputed = useMemo(() => {
    if (!filteredData.length) return [];
    const decadeData = filteredData
      .filter(d => d.yearbuilt >= 1800 && d.yearbuilt <= 2030)
      .map(d => ({
        decade: Math.floor(d.yearbuilt / 10) * 10,
        borough: d.borough,
        numfloors: d.numfloors
      }));

    const grouped = d3.rollup(decadeData,
      v => d3.median(v, d => d.numfloors),
      d => d.decade,
      d => d.borough
    );

    const result = [];
    grouped.forEach((boroughMap, decade) => {
      boroughMap.forEach((medianFloors, borough) => {
        result.push({ decade, borough, median_floors: medianFloors });
      });
    });
    return result;
  }, [filteredData]);

  const activeFilters = [];
  if (selectedBoroughs.size > 0) activeFilters.push({
    key: 'borough',
    label: [...selectedBoroughs].map(b => BOROUGH_NAMES[b] || b).join(', ')
  });
  if (selectedLandUse) activeFilters.push({ key: 'landuse', label: LAND_USE_LABELS[selectedLandUse] || `Land Use ${selectedLandUse}` });
  if (selectedZoning) activeFilters.push({ key: 'zoning', label: `Zone ${selectedZoning}` });
  if (brushRange) activeFilters.push({ key: 'brush', label: `Years ${brushRange[0]}\u2013${brushRange[1]}` });

  const clearFilter = (key) => {
    if (key === 'borough') setSelectedBoroughs(new Set());
    if (key === 'landuse') setSelectedLandUse(null);
    if (key === 'zoning') setSelectedZoning(null);
    if (key === 'brush') setBrushRange(null);
  };

  const clearAll = () => {
    setSelectedBoroughs(new Set());
    setSelectedLandUse(null);
    setSelectedZoning(null);
    setBrushRange(null);
  };

  if (!sampleData.length) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f4f5f9' }}>
        <div style={{ color: '#9a9cb0', fontSize: 16 }}>Loading data...</div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Top Bar */}
      <div className="top-bar">
        <div className="top-bar-left">
          <div className="top-bar-logo">UM</div>
          <div className="top-bar-title">
            <h1>Urban Morphology Dashboard</h1>
            <span>NYC Building Analytics &mdash; {d3.format(",")(fullStats ? fullStats.total_buildings : sampleData.length)} buildings across 5 boroughs</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="filter-group">
          <label>Borough</label>
          <div className="borough-chips">
            {BOROUGH_ORDER.map(b => (
              <button
                key={b}
                className={`borough-chip ${selectedBoroughs.has(b) ? 'active' : ''}`}
                style={{
                  '--chip-color': BOROUGH_PALETTE[b],
                  borderColor: selectedBoroughs.has(b) ? BOROUGH_PALETTE[b] : undefined,
                  background: selectedBoroughs.has(b) ? BOROUGH_PALETTE[b] + '18' : undefined,
                  color: selectedBoroughs.has(b) ? BOROUGH_PALETTE[b] : undefined
                }}
                onClick={() => toggleBorough(b)}
              >
                <span className="chip-dot" style={{ background: BOROUGH_PALETTE[b] }}></span>
                {BOROUGH_NAMES[b]}
              </button>
            ))}
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="active-filters">
            {activeFilters.map(f => (
              <span key={f.key} className="filter-tag" onClick={() => clearFilter(f.key)}>
                {f.label} <span className="clear-x">&times;</span>
              </span>
            ))}
            {activeFilters.length > 1 && (
              <button className="clear-all-btn" onClick={clearAll}>Clear All</button>
            )}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="main-content">
        <SummaryCards data={filteredData} total={sampleData.length} fullStats={fullStats} />

        {/* Row 1: Scatterplot + Geographic Distribution */}
        <div className="dashboard-row row-equal">
          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Year Built vs Number of Floors</h3>
                <div className="chart-subtitle">Brush to select a year range. Size = building area, color = borough.</div>
              </div>
            </div>
            <ScatterPlot data={filteredData} onBrush={setBrushRange} brushRange={brushRange} />
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Geographic Distribution</h3>
                <div className="chart-subtitle">Each dot is a building. Color = number of floors.</div>
              </div>
            </div>
            <DotMap data={filteredData} />
          </div>
        </div>

        {/* Row 2: Trend Line + Land Use + Zoning */}
        <div className="dashboard-row row-three">
          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Building Height Trends</h3>
                <div className="chart-subtitle">Median floors per decade. Click legend to toggle.</div>
              </div>
            </div>
            <TrendLine data={trendComputed} selectedBoroughs={selectedBoroughs} />
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Avg Floors by Land Use</h3>
                <div className="chart-subtitle">Horizontal bars sorted by avg floors. Click to filter.</div>
              </div>
            </div>
            <LandUseBar data={landUseComputed} selected={selectedLandUse} onSelect={setSelectedLandUse} />
          </div>

          <div className="chart-card">
            <div className="chart-card-header">
              <div>
                <h3>Zoning by Borough</h3>
                <div className="chart-subtitle">Top 10 zones by borough. R = Residential · C = Commercial · M = Industrial</div>
              </div>
            </div>
            <ZoningBar sampleData={dataForZoning} selected={selectedZoning} onSelect={setSelectedZoning} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
