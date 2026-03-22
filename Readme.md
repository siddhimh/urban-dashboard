# NYC Urban Morphology Dashboard

An interactive data visualization dashboard for exploring building characteristics across New York City's five boroughs. Built with React and D3.js for the NYU Information Visualization course (Spring 2026).

## Overview

The dashboard visualizes **815,000+ NYC buildings** from the [PLUTO dataset](https://www.nyc.gov/site/planning/data-maps/open-data/dwn-pluto-mappluto.page), enabling exploration of urban development patterns through six coordinated views with interactive cross-filtering.

## Visualizations

**Summary Cards**  Key statistics — total buildings, avg floors, building area, lot area, year range, zoning types 
**Scatter Plot** Year Built vs. Number of Floors with brushable year-range selection 
**Dot Map**  Geographic distribution of buildings colored by floor count 
**Trend Line**  Median building height by decade per borough 
**Land Use Bar**  Average floors across 11 land use categories 
**Zoning Bar**  Top 10 zoning types broken down by borough 

All views are cross-filtered — selecting a borough, land use type, zoning code, or year range updates every other chart in real time.

## Tech Stack
- **React 18** — UI framework and state management
- **D3.js v7** — Data visualization and bindings
- **CSS3** — Custom responsive layout with grid


## Getting Started

### Prerequisites

- Node.js (v16+)
- npm

### Installation

```bash
git clone <repo-url>
cd urban-dashboard
npm install
```

### Running

```bash
npm start
```

Opens at [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
```

## Project Structure

```
src/
├── App.js                    # Main component — data loading, filtering logic
├── colors.js                 # Borough color palette & diverging scale
├── app.css                   # Global styles
├── components/
│   ├── layout/
│   │   ├── dashboard.js      # Dashboard grid layout
│   │   ├── topbar.js         # Header with title & building count
│   │   └── filtersbar.js     # Borough chips & active filter tags
│   └── charts/
│       ├── summarycards.js   # 6 summary statistic cards
│       ├── scatterplot.js    # Year Built vs Floors (brush selection)
│       ├── dotmap.js         # Geographic dot map
│       ├── trendline.js      # Height trends by decade
│       ├── landusebar.js     # Avg floors by land use
│       └── zoningbar.js      # Zoning distribution by borough
public/
├── pluto_sample.csv          # Sampled building records
├── full_stats.csv            # Pre-computed aggregate statistics
├── landuse_data.csv          # Land use breakdowns
├── trend_data.csv            # Historical trend data
└── zoning_data.csv           # Zoning distribution data
```

## Data

The dataset is derived from NYC's **Primary Land Use Tax Lot Output (PLUTO)**, which contains land use and geographic data for every tax lot in NYC.

**Key fields:** borough, year built, number of floors, building area, lot area, land use code, zoning district, address, latitude/longitude.

**Boroughs:** Manhattan (MN), Brooklyn (BK), Queens (QN), Bronx (BX), Staten Island (SI)

## Interactions

- **Borough filter chips** — click to toggle boroughs on/off
- **Scatter plot brush** — drag on x-axis to select a year range
- **Land use bars** — click a bar to filter by land use category
- **Zoning bars** — click a group to filter by zoning code
- **Filter tags** — click the x on any active filter to clear it
- **Hover tooltips** — all charts show details on hover
