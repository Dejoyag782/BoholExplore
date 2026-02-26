import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import Map, {
  Source,
  Layer,
  NavigationControl,
  type MapRef,
  type ViewState,
  type LngLatBoundsLike,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import ModelLayer from "./partials/ModelLayer";
import MapMarker from "./partials/MapMarker";
import { ExtrusionLayer, getGtaGameStyle, GreeneryLayer, SeaLayer } from "../../utils/mapStyle";

const ProviderMap = ({ coordinates }: { coordinates: string[] }) => {
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const [mapIsReady, setMapIsReady] = useState(false);
  const [showDirections, setShowDirections] = useState(false);
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [boholBounds, setBoholBounds] = useState<LngLatBoundsLike | null>(null);
  const [boholMask, setBoholMask] = useState<any>(null);
  const [boholGeoJSON, setBoholGeoJSON] = useState<any>(null);
  const [boholOutlineGeoJSON, setBoholOutlineGeoJSON] = useState<any>(null);
  const [boholLakeFillGeoJSON, setBoholLakeFillGeoJSON] = useState<any>(null);
  const [rtsRouteGeoJSON, setRtsRouteGeoJSON] = useState<any>(null);
  const [providerPosition, setProviderPosition] = useState<{ lng: number; lat: number } | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const animationRef = useRef<number | null>(null);
  const providerCoordRef = useRef<[number, number] | null>(null);
  const providerHeadingRef = useRef<number | null>(null);
  const providerPitchRef = useRef<number | null>(null);
  const userInteractedRef = useRef(false);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const zipAnimationRef = useRef<number | null>(null);
  const zipInProgressRef = useRef(false);
  const ZIP_DURATION_MS = 800;
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const lastCoordsKeyRef = useRef<string | null>(null);
  const [cameraMode, setCameraMode] = useState<"follow" | "orbit" | "free">("free");
  const orbitBearingRef = useRef(0);
  const orbitAnimationRef = useRef<number | null>(null);
  const cameraCenterRef = useRef<[number, number] | null>(null);
  const cameraBearingRef = useRef<number | null>(null);
  const animationDataRef = useRef({
    progress: 0,
    totalDistance: 0,
    path: [] as [number, number][],
  });
  const lastFrameTimeRef = useRef<number | null>(null);
  const SPEED_PRESETS = [
    { label: "Slow", value: 100 },
    { label: "Normal", value: 250 },
    { label: "Fast", value: 500 },

  ];
  const [speedIndex, setSpeedIndex] = useState(1);
  const speedRef = useRef(SPEED_PRESETS[2].value);
  const TERRAIN_SOURCE_ID = "terrain";
  const HILLSHADE_SOURCE_ID = "terrain-hillshade";
  const TERRAIN_EXAGGERATION = 3;
  const LAND_FILL_COLOR = "#2f3b2f";

  const BOHOL_GEOJSON_URL =
    "https://services8.arcgis.com/FzMcsajYbTzWpRi9/ArcGIS/rest/services/Recovery_Areas/FeatureServer/3/query?where=Pro_Name%3D%27BOHOL%27&outFields=Pro_Name&outSR=4326&f=geojson";
  const BOHOL_EXTENT_URL =
    "https://services8.arcgis.com/FzMcsajYbTzWpRi9/ArcGIS/rest/services/Recovery_Areas/FeatureServer/3/query?where=Pro_Name%3D%27BOHOL%27&returnExtentOnly=true&outSR=4326&f=pjson";
  const TERRAIN_TILES_URL = `https://api.maptiler.com/tiles/terrain-rgb/tiles.json?key=${import.meta.env.VITE_MAP_TILER_API_KEY}`;
  const mapStyle = useMemo(() => getGtaGameStyle(), []);

  const parsedCoords = coordinates
    .map((coord) => {
      const [lng, lat, alt] = coord.split(",");
      return { lng: parseFloat(lng), lat: parseFloat(lat), alt: parseFloat(alt) };
    })
    .filter((c) => !isNaN(c.lng) && !isNaN(c.lat));

  const from = parsedCoords[0];
  const to = parsedCoords[1];
  const providerCoord = parsedCoords.length === 2 ? to : from;
  const activeProvider = providerPosition ?? providerCoord ?? null;

  const fetchRoute = async () => {
    if (!from || !to) return;

    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    setRouteGeoJSON({
      type: "Feature",
      geometry: data.routes[0].geometry,
      properties: {
        color: "#F7DC6F",
        weight: 4,
        opacity: 0.9,
      },
    });
  };

  const haversineMeters = (a: [number, number], b: [number, number]) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b[1] - a[1]);
    const dLng = toRad(b[0] - a[0]);
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  const angleBetween = (a: [number, number], b: [number, number]) =>
    Math.atan2(b[1] - a[1], b[0] - a[0]);

  const normalizeAngle = (angle: number) =>
    Math.atan2(Math.sin(angle), Math.cos(angle));

  const smoothAngle = (current: number, target: number, smoothing = 0.15) => {
    const delta = normalizeAngle(target - current);
    return current + delta * smoothing;
  };

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  const normalizeDegrees = (angle: number) => ((angle % 360) + 360) % 360;
  const smoothDegrees = (current: number, target: number, smoothing = 0.2) => {
    const delta = ((((target - current) % 360) + 540) % 360) - 180;
    return normalizeDegrees(current + delta * smoothing);
  };
  const smoothCoord = (
    current: [number, number] | null,
    target: [number, number],
    smoothing = 0.2
  ): [number, number] => {
    if (!current) return target;
    return [
      current[0] + (target[0] - current[0]) * smoothing,
      current[1] + (target[1] - current[1]) * smoothing,
    ];
  };
  const offsetCenterByBearing = (
    map: MapLibreMap,
    target: [number, number],
    bearingDeg: number,
    backPx: number,
    downPx = 0
  ): [number, number] => {
    const p = map.project(target);
    const r = (bearingDeg * Math.PI) / 180;
    const x = p.x + -Math.sin(r) * backPx;
    const y = p.y + Math.cos(r) * backPx + downPx;
    const ll = map.unproject([x, y]);
    return [ll.lng, ll.lat];
  };

  const handleProviderRenderFrame = useCallback(
    (frame: {
      map: MapLibreMap;
      coordinate: [number, number];
      heading: number | null;
      pitch: number | null;
      deltaMs: number;
    }) => {
      if (cameraMode === "free") return;

      if (cameraMode === "follow") {
        const targetBearing =
          frame.heading == null
            ? frame.map.getBearing()
            : normalizeDegrees(90 - (frame.heading * 180) / Math.PI);
        const nextBearing = smoothDegrees(
          cameraBearingRef.current ?? targetBearing,
          targetBearing,
          0.2
        );
        cameraBearingRef.current = nextBearing;

        const cinematicCenterTarget = offsetCenterByBearing(
          frame.map,
          frame.coordinate,
          nextBearing,
          120,
          18
        );
        const center = smoothCoord(cameraCenterRef.current, cinematicCenterTarget, 0.12);
        cameraCenterRef.current = center;

        frame.map.jumpTo({
          center,
          bearing: nextBearing,
          pitch: 68,
        });
        return;
      }

      orbitBearingRef.current =
        (orbitBearingRef.current + Math.max(0, frame.deltaMs) * 0.012) % 360;
      cameraBearingRef.current = orbitBearingRef.current;
      const orbitCenterTarget = offsetCenterByBearing(
        frame.map,
        frame.coordinate,
        orbitBearingRef.current,
        90,
        12
      );
      const center = smoothCoord(cameraCenterRef.current, orbitCenterTarget, 0.1);
      cameraCenterRef.current = center;
      const orbitPitch = 64 + Math.sin(performance.now() * 0.0012) * 2.5;
      frame.map.jumpTo({
        center,
        bearing: orbitBearingRef.current,
        pitch: orbitPitch,
      });
    },
    [cameraMode]
  );

  const buildRouteFeature = (geometry: any) => ({
    type: "Feature",
    geometry,
    properties: { color: "#60A5FA", weight: 4, opacity: 0.9 },
  });

  const animateAlongRoute = (coords: [number, number][]) => {
    if (!coords.length) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const total = coords
      .slice(1)
      .reduce((sum, c, i) => sum + haversineMeters(coords[i], c), 0);
    if (!total || total <= 0) return;

    animationDataRef.current = {
      progress: 0,
      totalDistance: total,
      path: coords,
    };
    lastFrameTimeRef.current = null;
    setIsMoving(true);

    const step = (now: number) => {
      const last = lastFrameTimeRef.current ?? now;
      const delta = (now - last) / 1000;
      lastFrameTimeRef.current = now;

      const data = animationDataRef.current;
      const progressInc = (delta * speedRef.current) / data.totalDistance;
      data.progress = Math.min(1, data.progress + progressInc);

      const path = data.path;
      const segmentCount = Math.max(1, path.length - 1);
      const rawIdx = data.progress * segmentCount;
      const idx = Math.min(segmentCount - 1, Math.floor(rawIdx));
      const t = rawIdx - idx;

      const a = path[idx];
      const b = path[idx + 1] || a;
      const lng = a[0] + (b[0] - a[0]) * t;
      const lat = a[1] + (b[1] - a[1]) * t;
      providerCoordRef.current = [lng, lat];

      const targetAngle = angleBetween(a, b);
      const currentAngle = providerHeadingRef.current ?? targetAngle;
      providerHeadingRef.current = smoothAngle(currentAngle, targetAngle, 0.2);

      const map = mapRef?.getMap();
      if (map?.queryTerrainElevation) {
        const elevA = map.queryTerrainElevation(a) ?? 0;
        const elevB = map.queryTerrainElevation(b) ?? elevA;
        const horiz = haversineMeters(a, b) || 1;
        const pitch = -Math.atan2(elevB - elevA, horiz);
        const currentPitch = providerPitchRef.current ?? pitch;
        providerPitchRef.current = smoothAngle(currentPitch, pitch, 0.2);
        providerPitchRef.current = clamp(providerPitchRef.current, -0.6, 0.6);
      }

      mapRef?.getMap()?.triggerRepaint();

      if (data.progress >= 1) {
        setProviderPosition({ lng: b[0], lat: b[1] });
        setIsMoving(false);
        animationRef.current = null;
        return;
      }

      animationRef.current = requestAnimationFrame(step);
    };

    animationRef.current = requestAnimationFrame(step);
  };

  const handleMapClick = async (evt: any) => {
    if (!activeProvider) return;
    userInteractedRef.current = true;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      setIsMoving(false);
    }

    const { lng, lat } = evt?.lngLat ?? {};
    if (typeof lng !== "number" || typeof lat !== "number") return;

    const start = providerCoordRef.current ?? [activeProvider.lng, activeProvider.lat];
    setProviderPosition({ lng: start[0], lat: start[1] });

    const url = `https://router.project-osrm.org/route/v1/driving/${start[0]},${start[1]};${lng},${lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    const geometry = data?.routes?.[0]?.geometry;
    if (!geometry?.coordinates?.length) return;

    routeCoordsRef.current = geometry.coordinates as [number, number][];
    startRouteZip(routeCoordsRef.current);
    animateAlongRoute(geometry.coordinates as [number, number][]);
  };

  useEffect(() => {
    if (showDirections) {
      fetchRoute();
    } else {
      setRouteGeoJSON(null);
    }
  }, [showDirections]);

  const initialView: ViewState = {
    padding: { top: 80, bottom: 80, left: 80, right: 80 },
    longitude: from?.lng ?? 0,
    latitude: from?.lat ?? 0,
    zoom: 10,
    pitch: 60,
    bearing: 0,
  };

  const fitMapToBounds = (map: MapRef) => {
    if (!parsedCoords.length) {
      if (boholBounds) {
        map.fitBounds(boholBounds, {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          duration: 0,
        });
      }
      return;
    }

    if (parsedCoords.length === 1) {
      map.flyTo({
        center: [parsedCoords[0].lng, parsedCoords[0].lat],
        zoom: 15,
        duration: 0,
      });
      return;
    }

    const bounds = [
      [Math.min(...parsedCoords.map((c) => c.lng)), Math.min(...parsedCoords.map((c) => c.lat)), Math.min(...parsedCoords.map((c) => c.alt))],
      [Math.max(...parsedCoords.map((c) => c.lng)), Math.max(...parsedCoords.map((c) => c.lat)), Math.max(...parsedCoords.map((c) => c.alt))],
    ];

    const lngSpan = Math.abs(bounds[1][0] - bounds[0][0]);
    const latSpan = Math.abs(bounds[1][1] - bounds[0][1]);
    const hasArea = lngSpan > 0.00001 || latSpan > 0.00001;

    if (!hasArea) {
      map.flyTo({
        center: [bounds[0][0], bounds[0][1]],
        zoom: 15,
        duration: 0,
      });
      return;
    }

    try {
      map.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 80, bottom: 80, left: 80, right: 80 },
        duration: 0,
        maxZoom: 20,
      });
    } catch {
      map.flyTo({
        center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2],
        zoom: 12,
        duration: 0,
      });
    }
  };

  const rotateRef = useRef<number | null>(null);

  const rotate = () => {
    const map = mapRef?.getMap();
    if (!map) return;

    const bearing = (map.getBearing() + 0.1) % 360;
    map.rotateTo(bearing, { duration: 0 });
    rotateRef.current = requestAnimationFrame(rotate);
  };

  const handleLegendClick = (lat: number, lng: number) => {
    const map = mapRef?.getMap();
    if (!map) return;

    if (rotateRef?.current) cancelAnimationFrame(rotateRef.current);

    // Fly to the selected location
    map.flyTo({
      center: [lng, lat],
      zoom: 18,
      pitch: 60,
      bearing: 0,
      speed: 1.2,
      curve: 1.4,
      easing: (t) => t,
      essential: true,
    });

    // Restart rotation once flying finishes
    map.once("moveend", () => {
      rotateRef.current = requestAnimationFrame(rotate);
    });

  };

  const handleMapRef = useCallback((ref: MapRef | null) => {
    if (!ref) return;
    setMapRef((prev) => (prev === ref ? prev : ref));
  }, []);

  useEffect(() => {
    if (!mapRef) return;
    const coordsKey = parsedCoords.map((c) => `${c.lng},${c.lat}`).join("|");
    const coordsChanged = coordsKey !== lastCoordsKeyRef.current;
    if (!userInteractedRef.current && (coordsChanged || !lastCoordsKeyRef.current)) {
      fitMapToBounds(mapRef);
      lastCoordsKeyRef.current = coordsKey;
    }
  }, [mapRef, parsedCoords, boholBounds]);

  useEffect(() => {
    speedRef.current = SPEED_PRESETS[speedIndex]?.value ?? SPEED_PRESETS[2].value;
  }, [speedIndex]);

  useEffect(() => {
    if (!providerCoord) return;
    providerCoordRef.current = [providerCoord.lng, providerCoord.lat];
  }, [providerCoord?.lng, providerCoord?.lat]);

  useEffect(() => {
    cameraCenterRef.current = providerCoordRef.current;
    cameraBearingRef.current = null;
    if (cameraMode !== "orbit") return;
    orbitBearingRef.current = mapRef?.getMap()?.getBearing() ?? orbitBearingRef.current;
  }, [cameraMode, mapRef]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (zipAnimationRef.current) cancelAnimationFrame(zipAnimationRef.current);
      if (orbitAnimationRef.current) cancelAnimationFrame(orbitAnimationRef.current);
    };
  }, []);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    if (orbitAnimationRef.current) {
      cancelAnimationFrame(orbitAnimationRef.current);
      orbitAnimationRef.current = null;
    }

    const tick = () => {
      map.triggerRepaint();
      orbitAnimationRef.current = requestAnimationFrame(tick);
    };

    if (cameraMode === "orbit") {
      orbitAnimationRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (orbitAnimationRef.current) {
        cancelAnimationFrame(orbitAnimationRef.current);
        orbitAnimationRef.current = null;
      }
    };
  }, [cameraMode, mapRef]);

  const startRouteZip = (path: [number, number][]) => {
    if (zipAnimationRef.current) {
      cancelAnimationFrame(zipAnimationRef.current);
      zipAnimationRef.current = null;
    }

    if (path.length < 2) return;
    zipInProgressRef.current = true;
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / ZIP_DURATION_MS);
      const eased = easeOutCubic(t);
      const pointCount = Math.max(2, Math.floor(eased * (path.length - 1)) + 1);
      const partial = path.slice(0, pointCount);
      setRtsRouteGeoJSON(buildRouteFeature({ type: "LineString", coordinates: partial }));

      if (t >= 1) {
        zipInProgressRef.current = false;
        setRtsRouteGeoJSON(buildRouteFeature({ type: "LineString", coordinates: path }));
        zipAnimationRef.current = null;
        return;
      }

      zipAnimationRef.current = requestAnimationFrame(step);
    };

    zipAnimationRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    let cancelled = false;

    const ringArea = (ring: number[][]) => {
      let sum = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        sum += (x1 * y2 - x2 * y1);
      }
      return sum / 2;
    };

    const ensureWinding = (ring: number[][], clockwise: boolean) => {
      if (ring.length < 4) return ring;
      const area = ringArea(ring);
      const isClockwise = area < 0;
      if (isClockwise === clockwise) return ring;
      return [...ring].reverse();
    };

    const buildOutlineFromBohol = (feature: any) => {
      if (!feature?.geometry) return null;

      if (feature.geometry.type === "Polygon") {
        return {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: feature.properties ?? {},
              geometry: {
                type: "Polygon",
                coordinates: feature.geometry.coordinates?.[0]
                  ? [feature.geometry.coordinates[0]]
                  : [],
              },
            },
          ],
        };
      }

      if (feature.geometry.type === "MultiPolygon") {
        const polys = feature.geometry.coordinates
          .map((poly: number[][][]) => (poly?.[0] ? [poly[0]] : null))
          .filter(Boolean);

        return {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: feature.properties ?? {},
              geometry: {
                type: "MultiPolygon",
                coordinates: polys as number[][][][],
              },
            },
          ],
        };
      }

      return null;
    };

    const buildLakeFillFromBohol = (geometry: any) => {
      const features: any[] = [];

      if (geometry?.type === "Polygon") {
        const innerRings = geometry.coordinates?.slice(1) ?? [];
        innerRings.forEach((ring: number[][]) => {
          const fixedRing = ensureWinding(ring, false);
          features.push({
            type: "Feature",
            properties: { name: "lake-fill" },
            geometry: { type: "Polygon", coordinates: [fixedRing] },
          });
        });
      } else if (geometry?.type === "MultiPolygon") {
        geometry.coordinates?.forEach((poly: number[][][]) => {
          const innerRings = poly?.slice(1) ?? [];
          innerRings.forEach((ring: number[][]) => {
            const fixedRing = ensureWinding(ring, false);
            features.push({
              type: "Feature",
              properties: { name: "lake-fill" },
              geometry: { type: "Polygon", coordinates: [fixedRing] },
            });
          });
        });
      }

      if (!features.length) return null;
      return { type: "FeatureCollection", features };
    };

    const buildMaskFromBohol = (geometry: any) => {
      // World polygon (lon/lat). Keep simple to avoid antimeridian issues.
      const worldRing = ensureWinding(
        [
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85],
        ],
        false
      );

      const holes: number[][][] = [];

      if (geometry?.type === "Polygon") {
        // Only use the outer ring as a hole; ignore inner rings (lakes).
        if (geometry.coordinates?.[0]) holes.push(ensureWinding(geometry.coordinates[0], true));
      } else if (geometry?.type === "MultiPolygon") {
        // Only use each polygon's outer ring as a hole.
        geometry.coordinates.forEach((poly: number[][][]) => {
          if (poly?.[0]) holes.push(ensureWinding(poly[0], true));
        });
      }

      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "bohol-mask" },
            geometry: {
              type: "Polygon",
              coordinates: [worldRing, ...holes],
            },
          },
        ],
      };
    };

    const fetchBoholData = async () => {
      try {
        const [extentRes, geoRes] = await Promise.all([
          fetch(BOHOL_EXTENT_URL),
          fetch(BOHOL_GEOJSON_URL),
        ]);

        const extentData = await extentRes.json();
        const geoData = await geoRes.json();
        if (cancelled) return;

        const extent = extentData?.extent;
        if (extent) {
          const bounds: LngLatBoundsLike = [
            [extent.xmin, extent.ymin],
            [extent.xmax, extent.ymax],
          ];
          setBoholBounds(bounds);
        }

        const feature = geoData?.features?.[0];
        if (feature?.geometry) {
          setBoholGeoJSON(geoData);
          setBoholOutlineGeoJSON(buildOutlineFromBohol(feature));
          setBoholLakeFillGeoJSON(buildLakeFillFromBohol(feature.geometry));
          setBoholMask(buildMaskFromBohol(feature.geometry));
        }
      } catch {
        // If bounds fail to load, fall back to normal behavior.
      }
    };

    fetchBoholData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !boholBounds) return;
    map.setMaxBounds(boholBounds);
  }, [mapRef, boholBounds]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || !mapIsReady) return;

    const applyTerrain = () => {
      if (!map.getSource(TERRAIN_SOURCE_ID)) return;
      map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
    };

    applyTerrain();
    map.on("sourcedata", applyTerrain);

    return () => {
      map.off("sourcedata", applyTerrain);
      map.setTerrain(null);
    };
  }, [mapRef, mapIsReady]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const onStyleImageMissing = (event: { id: string }) => {
      const id = event?.id ?? "";
      if (!id || map.hasImage(id)) return;

      map.addImage(id, {
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 0]),
      });
    };

    map.on("styleimagemissing", onStyleImageMissing);
    return () => {
      map.off("styleimagemissing", onStyleImageMissing);
    };
  }, [mapRef]);


  return (
    <div>

      <div className="w-full h-[100vh] overflow-hidden relative">
        <div className="absolute left-3 top-3 z-10 rounded-xl bg-black/70 text-white px-3 py-2 text-xs backdrop-blur space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Speed</span>
              <span className="opacity-80">
                {SPEED_PRESETS[speedIndex]?.label ?? "Fast"}
              </span>
            </div>
            <input
              className="mt-2 w-44 accent-white"
              type="range"
              min={0}
              max={SPEED_PRESETS.length - 1}
              step={1}
              value={speedIndex}
              onChange={(e) => setSpeedIndex(Number(e.target.value))}
            />
            <div className="mt-2 flex items-center gap-2">
              {SPEED_PRESETS.map((preset, idx) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSpeedIndex(idx)}
                  className={`rounded-full px-2 py-1 text-[10px] ${
                    idx === speedIndex ? "bg-white text-black" : "bg-white/10 text-white"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">Camera</span>
              <span className="opacity-80 capitalize">{cameraMode}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {(["follow", "orbit", "free"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setCameraMode(mode)}
                  className={`rounded-full px-2 py-1 text-[10px] capitalize ${
                    mode === cameraMode ? "bg-white text-black" : "bg-white/10 text-white"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Map
          ref={handleMapRef}
          onLoad={() => setMapIsReady(true)}
          onMouseDown={() => {
            if (rotateRef.current) cancelAnimationFrame(rotateRef.current);
          }}
          onDragStart={() => { userInteractedRef.current = true; }}
          onZoomStart={() => { userInteractedRef.current = true; }}
          onRotateStart={() => { userInteractedRef.current = true; }}
          onClick={handleMapClick}
          initialViewState={initialView}
          maxBounds={boholBounds ?? undefined}
          minZoom={9}
          maxZoom={20}
          renderWorldCopies={false}
          mapStyle={mapStyle as any}
          mapLib={import("maplibre-gl")}
          style={{ width: "100%", height: "100%" }}
        >
          <NavigationControl position="bottom-right" />
          {/* <FullscreenControl position="top-right" /> */}
          {/* <GeolocateControl position="top-left" /> */}

          {mapIsReady && boholMask && (
            <Source id="bohol-mask" type="geojson" data={boholMask}>
              <Layer
                id="outside-bohol-mask"
                type="fill"
                paint={{
                  "fill-color": "#0b0e14",
                  "fill-opacity": 1,
                }}
              />
            </Source>
          )}



          {mapIsReady && boholLakeFillGeoJSON && (
            <Source id="bohol-lake-fill" type="geojson" data={boholLakeFillGeoJSON}>
              <Layer
                id="bohol-lake-fill-layer"
                type="fill"
                paint={{
                  "fill-color": LAND_FILL_COLOR,
                  "fill-opacity": 1,
                }}
              />
            </Source>
          )}

          {mapIsReady && boholOutlineGeoJSON && (
            <Source id="bohol-geo" type="geojson" data={boholOutlineGeoJSON}>
              <Layer
                id="bohol-outline"
                type="line"
                paint={{
                  "line-color": "#ffffff",
                  "line-width": 2,
                }}
              />
            </Source>
          )}

          {mapIsReady && (
            <Source
              id={TERRAIN_SOURCE_ID}
              type="raster-dem"
              url={TERRAIN_TILES_URL}
              tileSize={256}
              maxzoom={20}
            >
            </Source>
          )}

          {mapIsReady && (
            <Source
              id={HILLSHADE_SOURCE_ID}
              type="raster-dem"
              url={TERRAIN_TILES_URL}
              tileSize={256}
              maxzoom={20}
            >
              <Layer
                id="terrain-hillshade"
                type="hillshade"
                paint={{
                  "hillshade-shadow-color": "#0b0e14",
                  "hillshade-exaggeration": 0.6,
                }}
              />
            </Source>
          )}

          {mapIsReady && parsedCoords.map((coord, index) => {
            const isProvider =
              (parsedCoords.length === 2 && index === 1) || (parsedCoords.length === 1 && index === 0);
            const displayCoord = coord;
            return (
              <Fragment key={`marker-${index}`}>
                {!isProvider && (
                  <MapMarker 
                    lat={displayCoord.lat || 0} 
                    lng={displayCoord.lng || 0} 
                    alt={coord.alt || 0}
                    imgUrl={'/images/blank.png'} 
                    title="Destination" 
                    style={{
                      height: 45,
                      width: 42,
                      imageRendering: "pixelated",
                      // backgroundImage: "url('/admin/assets/media/svg/map-icons/destination-pin-icon.svg')",
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      cursor: "pointer",
                      // transform: `translate(-50%, -50%) rotate(${centerMap?.heading}deg)`,
                    }}
                    popupContent={`<span className="text-xs">${index === 0 && parsedCoords.length === 2 ? "Client" : "Provider Branch"}</span>:<br/><b className="ms-1">${index === 0 && parsedCoords.length === 2 ? "Client Address" : "Branch Address"}</b>`}
                  />
                )}
              
                <ModelLayer
                    map={mapRef?.getMap()}
                    key={`model-${index}`}
                    layerId={`model-${index}`}
                    coordinates={[displayCoord.lng, displayCoord.lat]}
                    coordinatesRef={isProvider ? providerCoordRef : undefined}
                    headingRef={isProvider ? providerHeadingRef : undefined}
                    headingOffset={isProvider ? -Math.PI / 2 : 0}
                    pitchRef={isProvider ? providerPitchRef : undefined}
                    onRenderFrame={isProvider ? handleProviderRenderFrame : undefined}
                    modelPath={index === 0 && parsedCoords.length === 2 ? "/models/cave.glb" : "/models/orc_rammer.glb"}
                />
              </Fragment>
            );
          })}

          {routeGeoJSON && (
            <Source id="route" type="geojson" data={routeGeoJSON}>
              <Layer
                id="route-line"
                type="line"
                paint={{
                  "line-color": "#1D4ED8",
                  "line-width": 4,
                  "line-opacity": 0.9,
                }}
              />
            </Source>
          )}

          {rtsRouteGeoJSON && (
            <Source id="rts-route" type="geojson" data={rtsRouteGeoJSON}>
              <Layer
                id="rts-route-line"
                type="line"
                paint={{
                  "line-color": "#60A5FA",
                  "line-width": 3,
                  "line-opacity": 0.8,
                }}
              />
            </Source>
          )}
        </Map>
      </div>
    </div>
  );
};

export default ProviderMap;
