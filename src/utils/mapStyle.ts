export type MapStyle = {
  version: number;
  name?: string;
  sources: Record<string, any>;
  layers: Array<Record<string, any>>;
  glyphs?: string;
  sprite?: string;
};

export const getGtaGameStyle = (): MapStyle => ({
  version: 8,
  name: "GTA Game Map Style",
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        "© OpenStreetMap contributors, © CARTO",
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        // GTA beige tone
        "background-color": "#e7dfcf",
      },
    },
    {
      id: "carto-base",
      type: "raster",
      source: "carto",
      paint: {
        // Reduce color for flat look
        "raster-saturation": -0.6,

        // Stronger contrast for bold roads
        "raster-contrast": 0.35,

        // Slightly darker overall
        "raster-brightness-min": 0.15,
        "raster-brightness-max": 0.9,

        // Slight warmth
        "raster-hue-rotate": -10,

        // Subtle sharpening effect
        // "raster-gamma": 0.9,

        // Optional: add opacity if layering custom elements
        "raster-opacity": 0.95,
      },
    },
  ],
});


export const SeaLayer = {
        id: 'sea',
        type: 'fill',
        source: 'carto', // make sure this source includes water polygons
        'source-layer': 'water', // confirm this matches your dataset
        paint: {
            'fill-color': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, '#71BEDF',    // light blue
            12, '#8AD8EC',   // medium blue
            18, '#72D4E8'    // deep blue
            ],
            'fill-opacity': 0.9
        }
    };

    export const GreeneryLayer = {
          id: 'greenery',
        type: 'fill',
        source: 'carto',
        'source-layer': 'landuse', // or 'landcover' depending on your tiles
        filter: [
            'in',
            ['get', 'class'], // or 'type' or 'landuse' depending on your schema
            'park',
            'forest',
            'grass',
            'recreation_ground'
        ],
        paint: {
            'fill-color': [
            'match',
            ['get', 'class'],
            'forest', '#D3F8E2',       // forest green
            'park', '#D3F8E2',         // lawn green
            'grass', '#D3F8E2',        // green-yellow
            'recreation_ground', '#D3F8E2',
            '#D3F8E2'                  // fallback light green
            ],
            'fill-opacity': 0.7
        }
    };



   export const ExtrusionLayer = {
        id: '3d-buildings',
        type: 'fill-extrusion',
        source: 'carto',
        'source-layer': 'building',
        minzoom: 14,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: {
            'fill-extrusion-color': [
            'interpolate',
            ['linear'],
            ['get', 'render_height'],
            0, '#e0e0e0',        // light gray
            100, '#d0d0d0',      // medium light gray
            300, '#b0b0b0'       // medium gray
            ],
            'fill-extrusion-height': [
            'interpolate',
            ['linear'],
            ['zoom'],
            14,
            0,
            15,
            ['get', 'render_height']
            ],
            'fill-extrusion-base': [
            'case',
            ['>=', ['get', 'zoom'], 14],
            ['get', 'render_min_height'],
            0
            ],
            'fill-extrusion-opacity': 0.6
        }
    };