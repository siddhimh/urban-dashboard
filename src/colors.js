import * as d3 from 'd3';

/*
 * Diverging 5-color palette for NYC boroughs
 * Warm ← neutral → Cool
 *   Manhattan (MN)     — deep rose      #c4314b
 *   Bronx (BX)         — warm amber     #e58429
 *   Staten Island (SI) — muted sage     #8a8a8a 
 *   Queens (QN)        — teal           #2fa4a0
 *   Brooklyn (BK)      — steel blue     #3969ac
 */

export const BOROUGH_PALETTE = {
  MN: "#c4314b",
  BX: "#8b5cf6" ,
 SI: "#a8b545",  
  QN: "#2fa4a0",
  BK:  "#e58429"
};

export const BOROUGH_ORDER = ["MN", "BX", "SI", "QN", "BK"];

export const BOROUGH_NAMES = {
  MN: "Manhattan",
  BX: "Bronx",
  SI: "Staten Island",
  QN: "Queens",
  BK: "Brooklyn"
};

export const BOROUGH_COLOR = d3.scaleOrdinal()
  .domain(BOROUGH_ORDER)
  .range(BOROUGH_ORDER.map(b => BOROUGH_PALETTE[b]));

/*
 * Diverging sequential ramp for continuous data (e.g. dot map floor count)
 * Goes from cool blue → neutral → warm rose
 */
export const DIVERGING_INTERPOLATOR = d3.interpolateRgbBasis([
 "#8b5cf6"  , "#a8b545", "#e58429", "#c4314b"
]);