import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { DIVERGING_INTERPOLATOR } from '../colors';

function Histogram({ data, hoveredBorough }) {
  const svgRef = useRef();
  const tooltipRef = useRef();

  useEffect(() => {
    if (!data.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 10, right: 20, bottom: 50, left: 55 };
    const width = 520 - margin.left - margin.right;
    const height = 300 - margin.top - margin.bottom;

    svg.attr("width", width + margin.left + margin.right)
       .attr("height", height + margin.top + margin.bottom);

    const g = svg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Filter valid years
    const validData = data.filter(d => d.yearbuilt > 1700 && d.yearbuilt <= 2030);

    const x = d3.scaleLinear()
      .domain([1800, 2030])
      .range([0, width]);

    // Create bins
    const bins = d3.bin()
      .value(d => d.yearbuilt)
      .domain(x.domain())
      .thresholds(d3.range(1800, 2030, 10))(validData);

    const y = d3.scaleLinear()
      .domain([0, d3.max(bins, d => d.length)])
      .nice()
      .range([height, 0]);

    // Grid
    g.append("g").attr("class", "grid")
      .call(d3.axisLeft(y).tickSize(-width).tickFormat(""));

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(8))
      .selectAll("text").style("font-size", "10px");

    g.append("g")
      .call(d3.axisLeft(y).ticks(6))
      .selectAll("text").style("font-size", "10px");

    g.append("text").attr("class", "axis-label")
      .attr("x", width / 2).attr("y", height + 40)
      .attr("text-anchor", "middle").style("font-size", "11px")
      .text("Year Built (decade)");

    g.append("text").attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2).attr("y", -40)
      .attr("text-anchor", "middle").style("font-size", "11px")
      .text("Number of Buildings");

    // Tooltip
    if (!tooltipRef.current) {
      tooltipRef.current = d3.select("body").append("div")
        .attr("class", "d3-tooltip").node();
    }
    const tooltip = d3.select(tooltipRef.current).style("opacity", 0);

    // Gradient color based on count
    const colorScale = d3.scaleSequential()
      .domain([0, d3.max(bins, d => d.length)])
      .interpolator(DIVERGING_INTERPOLATOR);

    // Bars
    g.selectAll("rect")
      .data(bins)
      .enter()
      .append("rect")
      .attr("x", d => x(d.x0) + 1)
      .attr("y", height)
      .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
      .attr("height", 0)
      .attr("fill", d => colorScale(d.length))
      .attr("rx", 2)
      .attr("opacity", 0.9)
      .on("mouseover", function (event, d) {
        d3.select(this).transition().duration(100).attr("opacity", 1).attr("stroke", "#4a7ee8").attr("stroke-width", 1.5);
        tooltip.style("opacity", 1)
          .html(`
            <strong>${d.x0}s</strong><br/>
            <div class="tt-row"><span class="tt-label">Buildings</span><span class="tt-value">${d3.format(",")(d.length)}</span></div>
            <div class="tt-row"><span class="tt-label">Avg Floors</span><span class="tt-value">${d.length ? d3.mean(d, v => v.numfloors).toFixed(1) : 0}</span></div>
          `)
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 14) + "px");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", (event.pageX + 14) + "px").style("top", (event.pageY - 14) + "px");
      })
      .on("mouseout", function () {
        d3.select(this).transition().duration(100).attr("opacity", 0.9).attr("stroke", "none");
        tooltip.style("opacity", 0);
      })
      .transition()
      .duration(600)
      .delay((d, i) => i * 25)
      .ease(d3.easeCubicOut)
      .attr("y", d => y(d.length))
      .attr("height", d => height - y(d.length));

    return () => { tooltip.style("opacity", 0); };
  }, [data, hoveredBorough]);

  return <svg ref={svgRef}></svg>;
}

export default Histogram;
