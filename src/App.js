import { useEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import SpatialTwinView from "./components/layout/spatial-twin-view";
import "./App.css";

const FOCUS_BOROUGH = "MN";

function normalizeBorough(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function App() {
  const base = process.env.PUBLIC_URL;
  const [sampleData, setSampleData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    d3.csv(`${base}/pluto_3d_sample.csv`)
      .then((sample) => {
        const cleaned = sample
          .map((d) => {
            const latitude = Number(d.latitude);
            const longitude = Number(d.longitude);
            return {
              ...d,
              yearbuilt: +d.yearbuilt || 0,
              numfloors: +d.numfloors || 0,
              bldgarea: +d.bldgarea || 0,
              lotarea: +d.lotarea || 0,
              unitstotal: +d.unitstotal || 0,
              latitude,
              longitude,
            };
          })
          // Drop records that are missing real coordinates instead of
          // pinning them to (0, 0). A single (0, 0) point in PLUTO
          // expands the borough's bbox to include the equator + prime
          // meridian, which collapses the entire model into a single
          // pixel on a planet-sized platform.
          .filter(
            (d) =>
              Number.isFinite(d.latitude) &&
              Number.isFinite(d.longitude) &&
              Math.abs(d.latitude) > 1e-3 &&
              Math.abs(d.longitude) > 1e-3
          );

        setSampleData(cleaned);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load spatial twin data:", err);
        setLoading(false);
      });
  }, [base]);

  const boroughData = useMemo(() => {
    return sampleData.filter(
      (d) => normalizeBorough(d.borough) === normalizeBorough(FOCUS_BOROUGH)
    );
  }, [sampleData]);

  if (loading) {
    return <div className="app-loading">Loading Levitating City Twin...</div>;
  }

  return (
    <SpatialTwinView data={boroughData} focusBorough={FOCUS_BOROUGH} />
  );
}

export default App;
