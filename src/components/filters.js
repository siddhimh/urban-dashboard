import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

function Filters({ data }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!data.length) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); // Clear previous render

    // D3 drawing code goes here
    
  }, [data]); // Redraws when data changes

  return <svg ref={svgRef} width={500} height={350}></svg>;
}

export default Filters;