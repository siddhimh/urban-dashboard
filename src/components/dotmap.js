import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { BOROUGH_NAMES, DIVERGING_INTERPOLATOR } from '../colors';

function DotMap({ data }) {
  const svgRef = useRef();
  const tooltipRef = useRef();

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 580;
    const height = 370;

    svg.attr("viewBox", `0 0 ${width} ${height}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g");

    // Filter valid lat/lng
    const validData = data.filter(d =>
      d.latitude && d.longitude &&
      +d.latitude > 40.4 && +d.latitude < 40.95 &&
      +d.longitude > -74.3 && +d.longitude < -73.65
    );

    // Scales: project lat/lng to pixels
    const xScale = d3.scaleLinear()
      .domain(d3.extent(validData, d => +d.longitude))
      .range([25, width - 25]);

    const yScale = d3.scaleLinear()
      .domain(d3.extent(validData, d => +d.latitude))
      .range([height - 40, 20]); // flip Y, leave room for legend

    // Color by number of floors — diverging scale
    const floorMax = d3.quantile(validData.map(d => d.numfloors).sort(d3.ascending), 0.95) || 10;
    const colorScale = d3.scaleSequential()
      .domain([1, floorMax])
      .interpolator(DIVERGING_INTERPOLATOR);

    // Tooltip
    if (!tooltipRef.current) {
      tooltipRef.current = d3.select("body").append("div")
        .attr("class", "d3-tooltip").node();
    }
    const tooltip = d3.select(tooltipRef.current).style("opacity", 0);

    // Background
    g.append("rect")
      .attr("width", width).attr("height", height)
      .attr("fill", "#f8f9fc").attr("rx", 8);

    // Size scale — taller buildings get slightly bigger dots
    const sizeScale = d3.scaleSqrt()
      .domain([1, floorMax])
      .range([1.8, 5]);

    // Dots colored by floor count
    const dots = g.selectAll("circle")
      .data(validData.sort((a, b) => a.numfloors - b.numfloors)) // draw tall on top
      .enter()
      .append("circle")
      .attr("cx", d => xScale(+d.longitude))
      .attr("cy", d => yScale(+d.latitude))
      .attr("r", 0)
      .attr("fill", d => colorScale(Math.min(d.numfloors, floorMax)))
      .attr("opacity", 0.65)
      .attr("stroke", "none");

    // Entrance animation
    dots.transition()
      .duration(600)
      .delay((d, i) => Math.min(i * 0.1, 200))
      .attr("r", d => sizeScale(Math.min(d.numfloors, floorMax)));

    dots
      .on("mouseover", function (event, d) {
        d3.select(this)
          .transition().duration(100)
          .attr("r", sizeScale(Math.min(d.numfloors, floorMax)) + 3)
          .attr("opacity", 1)
          .attr("stroke", "#1a1a2e")
          .attr("stroke-width", 1.5);

        tooltip.style("opacity", 1)
          .html(`
            <strong>${d.address || "N/A"}</strong><br/>
            <div class="tt-row"><span class="tt-label">Borough</span><span class="tt-value">${BOROUGH_NAMES[d.borough]}</span></div>
            <div class="tt-row"><span class="tt-label">Floors</span><span class="tt-value">${d.numfloors}</span></div>
            <div class="tt-row"><span class="tt-label">Year</span><span class="tt-value">${d.yearbuilt}</span></div>
            <div class="tt-row"><span class="tt-label">Area</span><span class="tt-value">${d3.format(",")(d.bldgarea)} sqft</span></div>
          `)
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 14) + "px");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 14) + "px").style("top", (event.pageY - 14) + "px");
      })
      .on("mouseout", function (event, d) {
        d3.select(this)
          .transition().duration(100)
          .attr("r", sizeScale(Math.min(d.numfloors, floorMax)))
          .attr("opacity", 0.65)
          .attr("stroke", "none");
        tooltip.style("opacity", 0);
      });

    // Color legend
    const legendW = 180;
    const legendH = 10;
    const legendX = width - legendW - 20;
    const legendY = height - 25;

    const defs = svg.append("defs");
    const linearGrad = defs.append("linearGradient").attr("id", "floor-gradient");
    linearGrad.append("stop").attr("offset", "0%").attr("stop-color", "#3969ac");
    linearGrad.append("stop").attr("offset", "33%").attr("stop-color", "#8a8a8a");
    linearGrad.append("stop").attr("offset", "66%").attr("stop-color", "#e58429");
    linearGrad.append("stop").attr("offset", "100%").attr("stop-color", "#c4314b");

    g.append("rect")
      .attr("x", legendX).attr("y", legendY)
      .attr("width", legendW).attr("height", legendH)
      .attr("rx", 4)
      .attr("fill", "url(#floor-gradient)");

    g.append("text")
      .attr("x", legendX).attr("y", legendY - 5)
      .style("font-size", "9px").style("fill", "#9a9cb0")
      .text("1 floor");

    g.append("text")
      .attr("x", legendX + legendW).attr("y", legendY - 5)
      .attr("text-anchor", "end")
      .style("font-size", "9px").style("fill", "#9a9cb0")
      .text(`${Math.round(floorMax)}+ floors`);

    // Borough labels
    const boroughCentroids = d3.rollups(
      validData,
      v => [d3.mean(v, d => +d.longitude), d3.mean(v, d => +d.latitude)],
      d => d.borough
    );

    boroughCentroids.forEach(([borough, [lng, lat]]) => {
      g.append("text")
        .attr("x", xScale(lng))
        .attr("y", yScale(lat))
        .attr("text-anchor", "middle")
        .style("font-size", "9px")
        .style("font-weight", "600")
        .style("fill", "#1a1a2e")
        .style("opacity", 0.35)
        .style("pointer-events", "none")
        .text(BOROUGH_NAMES[borough]);
    });

    return () => { tooltip.style("opacity", 0); };
  }, [data]);

  return <svg ref={svgRef}></svg>;
}

export default DotMap;
