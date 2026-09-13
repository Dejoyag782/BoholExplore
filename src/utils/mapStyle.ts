import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

const BASEMAP_SOURCE_ID = "openmaptiles";
const TERRAIN_SOURCE_ID = "terrain";
const TERRAIN_EXAGGERATION = 2;

type ZoomWidthExpression = [
  "interpolate",
  ["exponential", number],
  ["zoom"],
  number,
  number,
  number,
  number,
];

const roadWidth = (minor: number, major: number): ZoomWidthExpression => [
  "interpolate",
  ["exponential", 1.5],
  ["zoom"],
  5,
  minor,
  18,
  major,
];

export const SeaLayer = {
  id: "water",
  type: "fill",
  source: BASEMAP_SOURCE_ID,
  "source-layer": "water",
  paint: {
    "fill-color": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      "#5f9dad",
      12,
      "#76afba",
      18,
      "#5ea2b2",
    ],
  },
} satisfies LayerSpecification;

export const GreeneryLayer = {
  id: "greenery",
  type: "fill",
  source: BASEMAP_SOURCE_ID,
  "source-layer": "landcover",
  filter: ["in", ["get", "class"], ["literal", ["wood", "grass", "farmland"]]],
  paint: {
    "fill-color": [
      "match",
      ["get", "class"],
      "wood",
      "#7d9364",
      "farmland",
      "#a9ae7d",
      "#98ad7d",
    ],
    "fill-opacity": 0.75,
  },
} satisfies LayerSpecification;

export const ExtrusionLayer = {
  id: "3d-buildings",
  type: "fill-extrusion",
  source: BASEMAP_SOURCE_ID,
  "source-layer": "building",
  minzoom: 14,
  paint: {
    "fill-extrusion-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "render_height"], 0],
      0,
      "#bdb4a2",
      100,
      "#aa9e8b",
      300,
      "#918572",
    ],
    "fill-extrusion-height": [
      "interpolate",
      ["linear"],
      ["zoom"],
      14,
      0,
      15,
      ["coalesce", ["get", "render_height"], 6],
    ],
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
    "fill-extrusion-opacity": 0.72,
  },
} satisfies LayerSpecification;

const layers: LayerSpecification[] = [
  {
    id: "background",
    type: "background",
    paint: { "background-color": "#c5beab" },
  },
  {
    id: "landcover",
    type: "fill",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "landcover",
    paint: {
      "fill-color": [
        "match",
        ["get", "class"],
        "ice",
        "#cdd5d3",
        "sand",
        "#c2b386",
        "#aca88d",
      ],
      "fill-opacity": 0.6,
    },
  },
  GreeneryLayer,
  {
    id: "landuse",
    type: "fill",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "landuse",
    paint: {
      "fill-color": [
        "match",
        ["get", "class"],
        "residential",
        "#bbb4a2",
        "commercial",
        "#b8a393",
        "industrial",
        "#aaa19d",
        "cemetery",
        "#8fa379",
        "hospital",
        "#ba9991",
        "school",
        "#baac85",
        "#b2ac98",
      ],
      "fill-opacity": 0.55,
    },
  },
  {
    id: "parks",
    type: "fill",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "park",
    paint: {
      "fill-color": "#8da36f",
      "fill-opacity": 0.78,
      "fill-outline-color": "#71865a",
    },
  },
  SeaLayer,
  {
    id: "waterways",
    type: "line",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "waterway",
    paint: {
      "line-color": "#5ea2b2",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 3],
    },
  },
  {
    id: "boundaries",
    type: "line",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "boundary",
    filter: ["<=", ["get", "admin_level"], 4],
    paint: {
      "line-color": "#766f61",
      "line-dasharray": [3, 2],
      "line-opacity": 0.55,
      "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 10, 1.5],
    },
  },
  {
    id: "minor-road-casing",
    type: "line",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["minor", "service", "path", "track"]]],
    paint: {
      "line-color": "#746e60",
      "line-width": roadWidth(0.3, 7),
    },
  },
  {
    id: "minor-roads",
    type: "line",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["minor", "service", "path", "track"]]],
    paint: {
      "line-color": "#d1c8b5",
      "line-width": roadWidth(0.1, 4.5),
    },
  },
  {
    id: "major-road-casing",
    type: "line",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk", "motorway"]]],
    paint: {
      "line-color": "#565146",
      "line-width": roadWidth(0.7, 14),
    },
  },
  {
    id: "major-roads",
    type: "line",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "trunk", "motorway"]]],
    paint: {
      "line-color": [
        "match",
        ["get", "class"],
        "motorway",
        "#bd824d",
        "trunk",
        "#bd9259",
        "#c5aa72",
      ],
      "line-width": roadWidth(0.4, 10),
    },
  },
  {
    id: "building-footprints",
    type: "fill",
    source: BASEMAP_SOURCE_ID,
    "source-layer": "building",
    minzoom: 12,
    maxzoom: 15,
    paint: {
      "fill-color": "#a69b89",
      "fill-outline-color": "#8c816f",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0, 14, 0.75],
    },
  },
  ExtrusionLayer,
];

/** A fully custom MapLibre style; only the raw OpenMapTiles data is remote. */
export const getGtaGameStyle = (mapTilerApiKey?: string): StyleSpecification => {
  const sources: StyleSpecification["sources"] = {
    [BASEMAP_SOURCE_ID]: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
      attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
    },
  };

  if (mapTilerApiKey) {
    sources[TERRAIN_SOURCE_ID] = {
      type: "raster-dem",
      url: `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(mapTilerApiKey)}`,
      tileSize: 512,
      maxzoom: 14,
    };
  }

  return {
    version: 8,
    name: "Bohol Trips Custom Game Map",
    sources,
    layers,
    ...(mapTilerApiKey
      ? {
          terrain: {
            source: TERRAIN_SOURCE_ID,
            exaggeration: TERRAIN_EXAGGERATION,
          },
        }
      : {}),
  };
};
