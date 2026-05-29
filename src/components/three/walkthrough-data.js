// Guided walkthrough stops for Manhattan.
//
// Each stop describes a curated cluster center + radius (in lng/lat),
// a recommended layer mode, and a short blurb for the on-screen card.
// The walkthrough controller selects buildings near the lng/lat
// center to seed the cluster brush at the right place.
//
// All coordinates are real Manhattan landmarks. Radius is in world
// units that match the platform projector (WORLD_SIZE = 12); pick
// values empirically that give a "block-ish" selection.

export const MANHATTAN_STOPS = [
  {
    id: "midtown-tall",
    title: "Tallest cluster — Midtown",
    blurb:
      "Midtown's super-tall residential and commercial towers. Height mode makes the cluster jump out of the model.",
    centerLngLat: [-73.978, 40.758],
    radius: 0.75,
    layer: "height",
    allowEnterScale: true,
  },
  {
    id: "financial-density",
    title: "Dense corridor — Financial District",
    blurb:
      "Lower Manhattan's tightest building grain. Density mode shows the contrast with the rest of the borough.",
    centerLngLat: [-74.012, 40.706],
    radius: 0.8,
    layer: "density",
    allowEnterScale: true,
  },
  {
    id: "village-lowrise",
    title: "Low-rise pocket — West Village",
    blurb:
      "Walk-up brownstones next to a tall corridor. Try Enter Scale to feel the contrast in enclosure at street level.",
    centerLngLat: [-74.005, 40.735],
    radius: 0.5,
    layer: "height",
    allowEnterScale: true,
  },
  {
    id: "uptown-scenario",
    title: "Scenario zone — Upper East Side",
    blurb:
      "Pick a low-rise lot, bump up its proposed floors, and step inside to see the skyline impact in human scale.",
    centerLngLat: [-73.96, 40.776],
    radius: 0.65,
    layer: "neutral",
    allowEnterScale: true,
  },
  {
    id: "harlem-age",
    title: "Older fabric — Harlem",
    blurb:
      "Pre-war housing stock. Neutral mode is the cleanest read here; the cluster summary highlights median year built.",
    centerLngLat: [-73.945, 40.81],
    radius: 0.85,
    layer: "neutral",
    allowEnterScale: true,
  },
];
