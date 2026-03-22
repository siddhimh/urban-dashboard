//Loads the NYC building data and displays a dashboard with the data
import { useState, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { BOROUGH_NAMES } from './colors';
import './App.css';
import DashboardLayout from "./components/layout/dashboard";


//Land use codes are mapped to human-readable labels
const LAND_USE_LABELS = {
  "1": "One & Two Family", "2": "Multi-Family Walk-Up", "3": "Multi-Family Elevator",
  "4": "Mixed Res/Commercial", "5": "Commercial & Office", "6": "Industrial & Mfg",
  "7": "Transport & Utility", "8": "Public Facilities", "9": "Open Space",
  "10": "Parking", "11": "Vacant Land"
};


function App() {

  //raw dataset
  const [sampleData, setSampleData] = useState([]);

  //pre-computed summary statistics
  const [fullStats, setFullStats] = useState(null);

  //interactive cross-filtering across chart
  const [selectedBoroughs, setSelectedBoroughs] = useState(new Set());
  const [selectedLandUse, setSelectedLandUse] = useState(null);
  const [selectedZoning, setSelectedZoning] = useState(null);
  const [brushRange, setBrushRange] = useState(null);

  //adding and removing borough from set and toggling
  const toggleBorough = (b) => {
    setSelectedBoroughs(prev => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  };

  //loading the csv data 
  useEffect(() => {
    Promise.all([
      d3.csv("/pluto_sample.csv"),
      d3.csv("/full_stats.csv")
    ]).then(([sample, stats]) => {

      //convert numeric fields from strings to numbers
      sample = sample.map(d => ({
        ...d,
        yearbuilt: +d.yearbuilt,
        numfloors: +d.numfloors,
        bldgarea: +d.bldgarea,
        lotarea: +d.lotarea,
        unitstotal: +d.unitstotal
      }));
      setSampleData(sample);

      //parse summary statistics
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


  //applying the different filters
  const filteredData = useMemo(() => {
    let data = sampleData;
    if (selectedBoroughs.size > 0) data = data.filter(d => selectedBoroughs.has(d.borough));
    if (selectedLandUse) data = data.filter(d => String(Math.round(+d.landuse)) === selectedLandUse);
    if (selectedZoning) data = data.filter(d => d.zonedist1 === selectedZoning);
    if (brushRange) data = data.filter(d => d.yearbuilt >= brushRange[0] && d.yearbuilt <= brushRange[1]);
    return data;
  }, [sampleData, selectedBoroughs, selectedLandUse, selectedZoning, brushRange]);

  //data for LandUseBar: filtered by everything EXCEPT land use
  const dataForLandUse = useMemo(() => {
    let data = sampleData;
    if (selectedBoroughs.size > 0) data = data.filter(d => selectedBoroughs.has(d.borough));
    if (selectedZoning) data = data.filter(d => d.zonedist1 === selectedZoning);
    if (brushRange) data = data.filter(d => d.yearbuilt >= brushRange[0] && d.yearbuilt <= brushRange[1]);
    return data;
  }, [sampleData, selectedBoroughs, selectedZoning, brushRange]);

  //data for ZoningBar: filtered by everything EXCEPT zoning
  const dataForZoning = useMemo(() => {
    let data = sampleData;
    if (selectedBoroughs.size > 0) data = data.filter(d => selectedBoroughs.has(d.borough));
    if (selectedLandUse) data = data.filter(d => String(Math.round(+d.landuse)) === selectedLandUse);
    if (brushRange) data = data.filter(d => d.yearbuilt >= brushRange[0] && d.yearbuilt <= brushRange[1]);
    return data;
  }, [sampleData, selectedBoroughs, selectedLandUse, brushRange]);


  //computes the land use statistics for floors and building area
  const landUseComputed = useMemo(() => {
    if (!dataForLandUse.length) return [];
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


  //computes median building height trends per decade per borough
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


  //shows the list of active filtero
  const activeFilters = [];
  if (selectedBoroughs.size > 0) activeFilters.push({
    key: 'borough',
    label: [...selectedBoroughs].map(b => BOROUGH_NAMES[b] || b).join(', ')
  });
  if (selectedLandUse) activeFilters.push({ 
    key: 'landuse', 
    label: LAND_USE_LABELS[selectedLandUse] || `Land Use ${selectedLandUse}` 
  });
  if (selectedZoning) activeFilters.push({ 
    key: 'zoning', 
    label: `Zone ${selectedZoning}` 
  });
  if (brushRange) activeFilters.push({ 
    key: 'brush', 
    label: `Years ${brushRange[0]}\u2013${brushRange[1]}` 
  });
  

  //resetting individual filters
  const clearFilter = (key) => {
    if (key === 'borough') setSelectedBoroughs(new Set());
    if (key === 'landuse') setSelectedLandUse(null);
    if (key === 'zoning') setSelectedZoning(null);
    if (key === 'brush') setBrushRange(null);
  };

  //resetting all filters
  const clearAll = () => {
    setSelectedBoroughs(new Set());
    setSelectedLandUse(null);
    setSelectedZoning(null);
    setBrushRange(null);
  };

  //loading screen till data is loaded on screen
  if (!sampleData.length) {
    return (
      <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f4f5f9' }}>
        <div style={{ color: '#9a9cb0', fontSize: 16 }}>Loading data...</div>
      </div>
    );
  }

  //creates a layout for the dashboard
  return (
    <DashboardLayout
      fullStats={fullStats}
      sampleData={sampleData}
      selectedBoroughs={selectedBoroughs}
      toggleBorough={toggleBorough}
      activeFilters={activeFilters}
      clearFilter={clearFilter}
      clearAll={clearAll}
      filteredData={filteredData}
      brushRange={brushRange}
      setBrushRange={setBrushRange}
      trendComputed={trendComputed}
      landUseComputed={landUseComputed}
      selectedLandUse={selectedLandUse}
      setSelectedLandUse={setSelectedLandUse}
      dataForZoning={dataForZoning}
      selectedZoning={selectedZoning}
      setSelectedZoning={setSelectedZoning}
    />
  );
}

export default App;
