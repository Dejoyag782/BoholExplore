import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import Map, {
  Source,
  Layer,
  Marker,
  NavigationControl,
  type MapRef,
  type ViewState,
  type LngLatBoundsLike,
} from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import ModelLayer from "./partials/ModelLayer";
import MapMarker from "./partials/MapMarker";
import RtsBattleLayer from "./partials/RtsBattleLayer";
import RtsHud from "./partials/RtsHud";
import TankPvpHud from "./partials/TankPvpHud";
import TankPvpLayer from "./partials/TankPvpLayer";
import MobileRoamControls, { type RoamInput } from "./partials/MobileRoamControls";
import GameModeMenu from "../GameModeMenu";
import { useTankParty } from "../../hooks/useTankParty";
import { getGtaGameStyle } from "../../utils/mapStyle";
import {
  createSkirmish,
  getMatchResult,
  issueAttackCommand,
  issueMoveCommand,
  offsetMeters,
  selectUnitIdsInScreenBox,
  stepRtsSimulation,
  type GameMode,
  type MatchResult,
  type UnitState,
} from "../../game/rts";
import { getRtsAudioFrame } from "../../game/rtsAudio";
import {
  TANK_SPAWN_RADIUS_METERS,
  type TankInput,
} from "../../game/tankPvp";

const BASE_MODEL_ELEVATION = 7;
const MANUAL_SPEED_FACTOR = 0.12;
const TURN_SPEED_RADIANS = 1.8;
const GRAVITY = 22;
const TERRAIN_LOOKAHEAD_METERS = 8;
const TERRAIN_WIDTH_SAMPLE_METERS = 5;
const RAMP_TAKEOFF_SLOPE = 0.08;
const DROP_TAKEOFF_SLOPE = -0.15;
const FOLLOW_DISTANCE_METERS = 30;
const FOLLOW_ZOOM = 18.5;
const MAX_FOLLOW_DRIFT_METERS = 180;
const TANK_FOLLOW_ZOOM = 18.4;
const TANK_CAMERA_PITCH = 58;

const createSpawnAreaFeature = (center: [number, number]) => {
  const ring = Array.from({ length: 65 }, (_, index) => {
    const angle = (index / 64) * Math.PI * 2;
    return offsetMeters(
      center,
      Math.cos(angle) * TANK_SPAWN_RADIUS_METERS,
      Math.sin(angle) * TANK_SPAWN_RADIUS_METERS
    );
  });
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [ring],
    },
  };
};

type EngineAudioGraph = {
  context: AudioContext;
  masterGain: GainNode;
  filter: BiquadFilterNode;
  engineOscillator: OscillatorNode;
  harmonicOscillator: OscillatorNode;
  rumbleOscillator: OscillatorNode;
  modulatorOscillator: OscillatorNode;
  modulationDepth: GainNode;
};

type RtsAudioGraph = {
  context: AudioContext;
  masterGain: GainNode;
  vehicleGain: GainNode;
  vehicleFilter: BiquadFilterNode;
  engineOscillator: OscillatorNode;
  harmonicOscillator: OscillatorNode;
  rumbleOscillator: OscillatorNode;
};

type RtsEffect =
  | "ready"
  | "select"
  | "move"
  | "attack"
  | "shot-player"
  | "shot-enemy"
  | "impact"
  | "destroy"
  | "victory"
  | "defeat";

const ProviderMap = ({ coordinates }: { coordinates: string[] }) => {
  const [gameMode, setGameMode] = useState<GameMode | null>(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(true);
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const [mapIsReady, setMapIsReady] = useState(false);
  const [boholBounds, setBoholBounds] = useState<LngLatBoundsLike | null>(null);
  const [boholMask, setBoholMask] = useState<any>(null);
  const [boholOutlineGeoJSON, setBoholOutlineGeoJSON] = useState<any>(null);
  const [boholLakeFillGeoJSON, setBoholLakeFillGeoJSON] = useState<any>(null);
  const [rtsRouteGeoJSON, setRtsRouteGeoJSON] = useState<any>(null);
  const [checkpoints, setCheckpoints] = useState<Array<[number, number]>>([]);
  const [isRouteLoading, setIsRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [rtsSnapshot, setRtsSnapshot] = useState<UnitState[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [matchResult, setMatchResult] = useState<MatchResult>(null);
  const [selectionBox, setSelectionBox] = useState<{
    start: { x: number; y: number };
    end: { x: number; y: number };
  } | null>(null);
  const [providerPosition, setProviderPosition] = useState<{ lng: number; lat: number } | null>(null);
  const [pvpSpawnCenter, setPvpSpawnCenter] = useState<[number, number] | null>(null);
  const [pvpSpawnPreview, setPvpSpawnPreview] = useState<[number, number] | null>(null);
  const [isSelectingPvpSpawn, setIsSelectingPvpSpawn] = useState(false);
  const [, setIsMoving] = useState(false);
  const animationRef = useRef<number | null>(null);
  const providerCoordRef = useRef<[number, number] | null>(null);
  const providerHeadingRef = useRef<number | null>(null);
  const providerPitchRef = useRef<number | null>(null);
  const providerRollRef = useRef<number | null>(null);
  const modelAltitudeOverrideRef = useRef<number | null>(null);
  const manualAnimationRef = useRef<number | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const roamTouchInputRef = useRef<RoamInput>({ forward: 0, turn: 0 });
  const startRoamAnimationRef = useRef<(() => void) | null>(null);
  const airborneRef = useRef(false);
  const verticalVelocityRef = useRef(0);
  const airborneSpeedRef = useRef(0);
  const terrainSlopeRef = useRef(0);
  const engineAudioRef = useRef<EngineAudioGraph | null>(null);
  const tankShotSequenceRef = useRef<{ playerId: string; sequence: number } | null>(null);
  const rtsAudioRef = useRef<RtsAudioGraph | null>(null);
  const rtsUnitsRef = useRef<UnitState[]>([]);
  const selectedUnitIdsRef = useRef<Set<string>>(new Set());
  const rtsAnimationRef = useRef<number | null>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const middlePanRef = useRef<{ x: number; y: number } | null>(null);
  const roamSimulationActiveRef = useRef(false);
  const userInteractedRef = useRef(false);
  const routeCoordsRef = useRef<[number, number][]>([]);
  const zipAnimationRef = useRef<number | null>(null);
  const zipInProgressRef = useRef(false);
  const ZIP_DURATION_MS = 800;
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const lastCoordsKeyRef = useRef<string | null>(null);
  const [cameraMode, setCameraMode] = useState<"follow" | "orbit" | "free">("free");
  const [isRoamHudCollapsed, setIsRoamHudCollapsed] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );
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
  const HILLSHADE_SOURCE_ID = "terrain-hillshade";
  const LAND_FILL_COLOR = "#2f3b2f";

  const BOHOL_GEOJSON_URL =
    "https://services8.arcgis.com/FzMcsajYbTzWpRi9/ArcGIS/rest/services/Recovery_Areas/FeatureServer/3/query?where=Pro_Name%3D%27BOHOL%27&outFields=Pro_Name&outSR=4326&f=geojson";
  const BOHOL_EXTENT_URL =
    "https://services8.arcgis.com/FzMcsajYbTzWpRi9/ArcGIS/rest/services/Recovery_Areas/FeatureServer/3/query?where=Pro_Name%3D%27BOHOL%27&returnExtentOnly=true&outSR=4326&f=pjson";
  const mapTilerApiKey = import.meta.env.VITE_MAP_TILER_API_KEY;
  const TERRAIN_TILES_URL = `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${encodeURIComponent(mapTilerApiKey)}`;
  const mapStyle = useMemo(() => getGtaGameStyle(mapTilerApiKey), [mapTilerApiKey]);

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
  const pvpOrigin = useMemo<[number, number]>(
    () => pvpSpawnCenter ?? (activeProvider ? [activeProvider.lng, activeProvider.lat] : [123.9, 9.8]),
    [activeProvider, pvpSpawnCenter]
  );
  const pvpSpawnAreaGeoJSON = useMemo(
    () => createSpawnAreaFeature(pvpSpawnPreview ?? pvpSpawnCenter ?? pvpOrigin),
    [pvpOrigin, pvpSpawnCenter, pvpSpawnPreview]
  );
  const getPvpTerrainElevation = useCallback(
    (position: [number, number]) =>
      mapRef?.getMap()?.queryTerrainElevation(position) ?? null,
    [mapRef]
  );
  const tankParty = useTankParty(
    gameMode === "pvp",
    pvpOrigin,
    getPvpTerrainElevation
  );
  const setTankInput = tankParty.setInput;
  const tankPartyStatus = tankParty.status;

  const startEngineAudio = useCallback(() => {
    const existing = engineAudioRef.current;
    if (existing) {
      void existing.context.resume();
      return existing;
    }

    const context = new AudioContext();
    const masterGain = context.createGain();
    const filter = context.createBiquadFilter();
    const engineOscillator = context.createOscillator();
    const harmonicOscillator = context.createOscillator();
    const rumbleOscillator = context.createOscillator();
    const modulatorOscillator = context.createOscillator();
    const modulationDepth = context.createGain();
    const engineGain = context.createGain();
    const harmonicGain = context.createGain();
    const rumbleGain = context.createGain();

    engineOscillator.type = "sawtooth";
    harmonicOscillator.type = "square";
    rumbleOscillator.type = "triangle";
    modulatorOscillator.type = "sine";
    engineGain.gain.value = 0.55;
    harmonicGain.gain.value = 0.12;
    rumbleGain.gain.value = 0.33;
    masterGain.gain.value = 0;
    filter.type = "lowpass";
    filter.frequency.value = 500;
    filter.Q.value = 2.5;

    engineOscillator.connect(engineGain).connect(filter);
    harmonicOscillator.connect(harmonicGain).connect(filter);
    rumbleOscillator.connect(rumbleGain).connect(filter);
    modulatorOscillator.connect(modulationDepth);
    modulationDepth.connect(engineOscillator.frequency);
    modulationDepth.connect(harmonicOscillator.frequency);
    filter.connect(masterGain).connect(context.destination);

    engineOscillator.start();
    harmonicOscillator.start();
    rumbleOscillator.start();
    modulatorOscillator.start();

    const graph = {
      context,
      masterGain,
      filter,
      engineOscillator,
      harmonicOscillator,
      rumbleOscillator,
      modulatorOscillator,
      modulationDepth,
    };
    engineAudioRef.current = graph;
    return graph;
  }, []);

  const updateEngineAudio = useCallback(
    (speedRatio: number, active: boolean, airborne = false) => {
      const graph = engineAudioRef.current;
      if (!graph) return;

      const ratio = Math.max(0, Math.min(1, speedRatio));
      const isStalling = !active || ratio < 0.04;
      const now = graph.context.currentTime;
      const baseFrequency = isStalling
        ? 31
        : 42 + ratio * 105 + (airborne ? 18 : 0);
      graph.engineOscillator.frequency.setTargetAtTime(baseFrequency, now, 0.045);
      graph.harmonicOscillator.frequency.setTargetAtTime(
        baseFrequency * (isStalling ? 1.91 : 2.03),
        now,
        0.04
      );
      graph.rumbleOscillator.frequency.setTargetAtTime(
        baseFrequency * (isStalling ? 0.42 : 0.48),
        now,
        0.06
      );
      graph.modulatorOscillator.frequency.setTargetAtTime(
        isStalling ? 3.6 : 7 + ratio * 15,
        now,
        0.05
      );
      graph.modulationDepth.gain.setTargetAtTime(
        isStalling ? 7 : 3 + ratio * 9,
        now,
        0.05
      );
      graph.filter.frequency.setTargetAtTime(
        isStalling ? 220 : 380 + ratio * 1_500,
        now,
        0.06
      );
      graph.masterGain.gain.setTargetAtTime(
        isStalling ? 0.04 : airborne ? 0.075 : 0.09 + ratio * 0.055,
        now,
        isStalling ? 0.18 : 0.035
      );
    },
    []
  );

  const playTankShotAudio = useCallback(() => {
    const graph = startEngineAudio();
    const { context } = graph;
    const now = context.currentTime;
    const blast = context.createOscillator();
    const blastGain = context.createGain();
    const blastFilter = context.createBiquadFilter();
    blast.type = "sawtooth";
    blast.frequency.setValueAtTime(115, now);
    blast.frequency.exponentialRampToValueAtTime(32, now + 0.28);
    blastFilter.type = "lowpass";
    blastFilter.frequency.value = 520;
    blastGain.gain.setValueAtTime(0.22, now);
    blastGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    blast.connect(blastFilter).connect(blastGain).connect(context.destination);

    const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.24), context.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let index = 0; index < noise.length; index += 1) {
      noise[index] = (Math.random() * 2 - 1) * (1 - index / noise.length);
    }
    const crack = context.createBufferSource();
    const crackFilter = context.createBiquadFilter();
    const crackGain = context.createGain();
    crack.buffer = noiseBuffer;
    crackFilter.type = "bandpass";
    crackFilter.frequency.value = 900;
    crackFilter.Q.value = 0.7;
    crackGain.gain.setValueAtTime(0.28, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    crack.connect(crackFilter).connect(crackGain).connect(context.destination);
    blast.start(now);
    blast.stop(now + 0.34);
    crack.start(now);
  }, [startEngineAudio]);

  useEffect(() => {
    const localPlayer = tankParty.players.find((player) => player.id === tankParty.localPeerId);
    if (!localPlayer) {
      tankShotSequenceRef.current = null;
      return;
    }

    const previous = tankShotSequenceRef.current;
    tankShotSequenceRef.current = {
      playerId: localPlayer.id,
      sequence: localPlayer.shotSequence,
    };
    if (
      previous?.playerId === localPlayer.id &&
      localPlayer.shotSequence > previous.sequence
    ) {
      playTankShotAudio();
    }
  }, [playTankShotAudio, tankParty.localPeerId, tankParty.players]);

  const handleTankTouchInput = useCallback((input: TankInput) => {
    setTankInput(input);
    if (input.forward !== 0 || input.turn !== 0 || input.firing) {
      startEngineAudio();
    }
    updateEngineAudio(
      Math.max(Math.abs(input.forward), Math.abs(input.turn) * 0.45),
      input.forward !== 0 || input.turn !== 0
    );
  }, [setTankInput, startEngineAudio, updateEngineAudio]);

  const handleRoamTouchInput = useCallback((input: RoamInput) => {
    roamTouchInputRef.current = input;
    const isActive = input.forward !== 0 || input.turn !== 0;
    if (!isActive) return;

    startEngineAudio();
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (zipAnimationRef.current) {
      cancelAnimationFrame(zipAnimationRef.current);
      zipAnimationRef.current = null;
    }
    startRoamAnimationRef.current?.();
  }, [startEngineAudio]);

  const startRtsAudio = useCallback(() => {
    const existing = rtsAudioRef.current;
    if (existing) {
      void existing.context.resume();
      return existing;
    }

    const context = new AudioContext();
    const masterGain = context.createGain();
    const vehicleGain = context.createGain();
    const vehicleFilter = context.createBiquadFilter();
    const engineOscillator = context.createOscillator();
    const harmonicOscillator = context.createOscillator();
    const rumbleOscillator = context.createOscillator();
    const engineGain = context.createGain();
    const harmonicGain = context.createGain();
    const rumbleGain = context.createGain();

    masterGain.gain.value = 0.58;
    vehicleGain.gain.value = 0;
    vehicleFilter.type = "lowpass";
    vehicleFilter.frequency.value = 480;
    vehicleFilter.Q.value = 1.8;
    engineOscillator.type = "sawtooth";
    harmonicOscillator.type = "square";
    rumbleOscillator.type = "triangle";
    engineOscillator.frequency.value = 48;
    harmonicOscillator.frequency.value = 97;
    rumbleOscillator.frequency.value = 24;
    engineGain.gain.value = 0.34;
    harmonicGain.gain.value = 0.07;
    rumbleGain.gain.value = 0.32;

    engineOscillator.connect(engineGain).connect(vehicleFilter);
    harmonicOscillator.connect(harmonicGain).connect(vehicleFilter);
    rumbleOscillator.connect(rumbleGain).connect(vehicleFilter);
    vehicleFilter.connect(vehicleGain).connect(masterGain).connect(context.destination);
    engineOscillator.start();
    harmonicOscillator.start();
    rumbleOscillator.start();

    const graph = {
      context,
      masterGain,
      vehicleGain,
      vehicleFilter,
      engineOscillator,
      harmonicOscillator,
      rumbleOscillator,
    };
    rtsAudioRef.current = graph;
    return graph;
  }, []);

  const updateRtsVehicleAudio = useCallback((movingUnits: number, aliveUnits: number) => {
    const graph = rtsAudioRef.current;
    if (!graph) return;
    const now = graph.context.currentTime;
    const activity = aliveUnits > 0 ? Math.min(1, movingUnits / Math.min(4, aliveUnits)) : 0;
    const active = movingUnits > 0;
    const baseFrequency = 43 + activity * 28;
    graph.engineOscillator.frequency.setTargetAtTime(baseFrequency, now, 0.08);
    graph.harmonicOscillator.frequency.setTargetAtTime(baseFrequency * 2.02, now, 0.08);
    graph.rumbleOscillator.frequency.setTargetAtTime(baseFrequency * 0.49, now, 0.1);
    graph.vehicleFilter.frequency.setTargetAtTime(340 + activity * 620, now, 0.1);
    graph.vehicleGain.gain.setTargetAtTime(active ? 0.095 + activity * 0.045 : 0, now, active ? 0.08 : 0.2);
  }, []);

  const playRtsEffect = useCallback((effect: RtsEffect) => {
    const graph = startRtsAudio();
    const { context } = graph;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const settings: Record<RtsEffect, [OscillatorType, number, number, number, number]> = {
      ready: ["triangle", 210, 420, 0.1, 0.34],
      select: ["sine", 520, 700, 0.055, 0.09],
      move: ["triangle", 180, 270, 0.07, 0.15],
      attack: ["square", 250, 125, 0.09, 0.2],
      "shot-player": ["sawtooth", 135, 38, 0.13, 0.28],
      "shot-enemy": ["sawtooth", 105, 31, 0.12, 0.3],
      impact: ["square", 92, 48, 0.075, 0.16],
      destroy: ["sawtooth", 78, 24, 0.16, 0.48],
      victory: ["triangle", 330, 660, 0.11, 0.7],
      defeat: ["sawtooth", 190, 55, 0.1, 0.8],
    };
    const [wave, startFrequency, endFrequency, volume, duration] = settings[effect];
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);
    filter.type = "lowpass";
    filter.frequency.value = effect.includes("shot") || effect === "destroy" ? 650 : 1_600;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(filter).connect(gain).connect(graph.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);

    if (effect.includes("shot") || effect === "impact" || effect === "destroy") {
      const noiseDuration = effect === "destroy" ? 0.5 : 0.14;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * noiseDuration), context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = (Math.random() * 2 - 1) * (1 - index / samples.length);
      }
      const noise = context.createBufferSource();
      const noiseFilter = context.createBiquadFilter();
      const noiseGain = context.createGain();
      noise.buffer = buffer;
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.value = effect === "impact" ? 720 : 420;
      noiseFilter.Q.value = 0.7;
      noiseGain.gain.setValueAtTime(effect === "destroy" ? 0.2 : 0.1, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);
      noise.connect(noiseFilter).connect(noiseGain).connect(graph.masterGain);
      noise.start(now);
    }
  }, [startRtsAudio]);

  const commitUnitSelection = useCallback((ids: Iterable<string>) => {
    const next = new Set(ids);
    selectedUnitIdsRef.current = next;
    setSelectedUnitIds(next);
  }, []);

  const resetSkirmish = useCallback(() => {
    const origin = providerCoordRef.current ??
      (activeProvider ? [activeProvider.lng, activeProvider.lat] as [number, number] : null);
    if (!origin) return;
    const units = createSkirmish(origin);
    rtsUnitsRef.current = units;
    setRtsSnapshot(units);
    commitUnitSelection([]);
    setMatchResult(null);
    playRtsEffect("ready");
    mapRef?.getMap()?.triggerRepaint();
  }, [activeProvider, commitUnitSelection, mapRef, playRtsEffect]);

  const openModeMenu = useCallback(() => {
    setIsSelectingPvpSpawn(false);
    setPvpSpawnPreview(null);
    setIsModeMenuOpen(true);
    pressedKeysRef.current.clear();
    updateEngineAudio(0, false);
    updateRtsVehicleAudio(0, rtsUnitsRef.current.filter((unit) => unit.alive).length);
  }, [updateEngineAudio, updateRtsVehicleAudio]);

  const startGameMode = useCallback((mode: GameMode) => {
    setGameMode(mode);
    setIsModeMenuOpen(false);
    if (mode === "command" && rtsUnitsRef.current.length === 0) {
      const origin = providerCoordRef.current ??
        (activeProvider ? [activeProvider.lng, activeProvider.lat] as [number, number] : null);
      if (origin) {
        const units = createSkirmish(origin);
        rtsUnitsRef.current = units;
        setRtsSnapshot(units);
      }
    }
    if (mode === "command") playRtsEffect("ready");
    else updateRtsVehicleAudio(0, rtsUnitsRef.current.filter((unit) => unit.alive).length);
    const map = mapRef?.getMap();
    const center = providerCoordRef.current ??
      (activeProvider ? [activeProvider.lng, activeProvider.lat] as [number, number] : null);
    if (mode === "command" && map && center) {
      map.easeTo({ center, zoom: Math.max(15, map.getZoom()), pitch: 55, bearing: 0, duration: 600 });
    }
    if (mode === "pvp" && map) {
      map.easeTo({
        center: pvpOrigin,
        zoom: TANK_FOLLOW_ZOOM,
        pitch: TANK_CAMERA_PITCH,
        bearing: 0,
        duration: 600,
      });
    }
  }, [activeProvider, mapRef, playRtsEffect, pvpOrigin, updateRtsVehicleAudio]);


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
  const offsetCoordinate = (
    position: [number, number],
    heading: number,
    distanceMeters: number
  ): [number, number] => {
    const latitudeScale = 111_320;
    const longitudeScale = Math.max(
      1,
      latitudeScale * Math.cos((position[1] * Math.PI) / 180)
    );
    return [
      position[0] + (Math.cos(heading) * distanceMeters) / longitudeScale,
      position[1] + (Math.sin(heading) * distanceMeters) / latitudeScale,
    ];
  };
  const getRoamTerrainOrientation = (
    map: MapLibreMap,
    position: [number, number],
    heading: number
  ) => {
    const front = offsetCoordinate(position, heading, TERRAIN_LOOKAHEAD_METERS);
    const back = offsetCoordinate(position, heading, -TERRAIN_LOOKAHEAD_METERS);
    const right = offsetCoordinate(position, heading - Math.PI / 2, TERRAIN_WIDTH_SAMPLE_METERS);
    const left = offsetCoordinate(position, heading + Math.PI / 2, TERRAIN_WIDTH_SAMPLE_METERS);
    const frontElevation = map.queryTerrainElevation(front);
    const backElevation = map.queryTerrainElevation(back);
    const rightElevation = map.queryTerrainElevation(right);
    const leftElevation = map.queryTerrainElevation(left);
    const pitch = frontElevation == null || backElevation == null
      ? 0
      : clamp(
          Math.atan2(frontElevation - backElevation, TERRAIN_LOOKAHEAD_METERS * 2),
          -0.55,
          0.55
        );
    const roll = rightElevation == null || leftElevation == null
      ? 0
      : clamp(
          Math.atan2(rightElevation - leftElevation, TERRAIN_WIDTH_SAMPLE_METERS * 2),
          -0.55,
          0.55
        );
    return { pitch, roll };
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

        const targetHeading =
          frame.heading ?? ((90 - targetBearing) * Math.PI) / 180;
        const cinematicCenterTarget = offsetCoordinate(
          frame.coordinate,
          targetHeading,
          -FOLLOW_DISTANCE_METERS
        );
        const currentCenter = cameraCenterRef.current;
        const center =
          currentCenter &&
          haversineMeters(currentCenter, frame.coordinate) <= MAX_FOLLOW_DRIFT_METERS
            ? smoothCoord(currentCenter, cinematicCenterTarget, 0.12)
            : cinematicCenterTarget;
        cameraCenterRef.current = center;

        frame.map.jumpTo({
          center,
          zoom: FOLLOW_ZOOM,
          bearing: nextBearing,
          pitch: 78,
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
        130,
        0
      );
      const center = smoothCoord(cameraCenterRef.current, orbitCenterTarget, 0.1);
      cameraCenterRef.current = center;
      const orbitPitch = 72 + Math.sin(performance.now() * 0.0012) * 3;
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

      if (!roamSimulationActiveRef.current) {
        updateEngineAudio(0, false);
        animationRef.current = requestAnimationFrame(step);
        return;
      }

      const data = animationDataRef.current;
      const progressInc = (delta * speedRef.current) / data.totalDistance;
      data.progress = Math.min(1, data.progress + progressInc);
      updateEngineAudio(speedRef.current / 500, true);

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
        const orientation = getRoamTerrainOrientation(
          map,
          providerCoordRef.current,
          providerHeadingRef.current
        );
        const currentPitch = providerPitchRef.current ?? orientation.pitch;
        const currentRoll = providerRollRef.current ?? orientation.roll;
        providerPitchRef.current = smoothAngle(currentPitch, orientation.pitch, 0.2);
        providerPitchRef.current = clamp(providerPitchRef.current, -0.6, 0.6);
        providerRollRef.current = smoothAngle(currentRoll, orientation.roll, 0.2);
        providerRollRef.current = clamp(providerRollRef.current, -0.6, 0.6);
      }

      mapRef?.getMap()?.triggerRepaint();

      if (data.progress >= 1) {
        setProviderPosition({ lng: b[0], lat: b[1] });
        setIsMoving(false);
        updateEngineAudio(0, false);
        animationRef.current = null;
        return;
      }

      animationRef.current = requestAnimationFrame(step);
    };

    animationRef.current = requestAnimationFrame(step);
  };

  const handleMapClick = (evt: MapLayerMouseEvent) => {
    if (!activeProvider) return;
    userInteractedRef.current = true;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      setIsMoving(false);
      updateEngineAudio(0, false);
    }

    const { lng, lat } = evt.lngLat;
    if (typeof lng !== "number" || typeof lat !== "number") return;

    if (checkpoints.length === 0) setRtsRouteGeoJSON(null);
    setRouteError(null);
    setCheckpoints((current) => [...current, [lng, lat]]);
  };

  const beginPvpSpawnSelection = useCallback(() => {
    setPvpSpawnPreview(pvpSpawnCenter ?? pvpOrigin);
    setIsSelectingPvpSpawn(true);
  }, [pvpOrigin, pvpSpawnCenter]);

  const cancelPvpSpawnSelection = useCallback(() => {
    setIsSelectingPvpSpawn(false);
    setPvpSpawnPreview(null);
  }, []);

  const handlePvpSpawnClick = (event: MapLayerMouseEvent) => {
    if (!isSelectingPvpSpawn) return;
    const center: [number, number] = [event.lngLat.lng, event.lngLat.lat];
    setPvpSpawnCenter(center);
    setPvpSpawnPreview(null);
    setIsSelectingPvpSpawn(false);
  };

  const playCheckpointRoute = async () => {
    if (!activeProvider || checkpoints.length === 0 || isRouteLoading) return;

    startEngineAudio();
    updateEngineAudio(0, true);
    pressedKeysRef.current.clear();
    if (manualAnimationRef.current !== null) {
      cancelAnimationFrame(manualAnimationRef.current);
      manualAnimationRef.current = null;
    }
    airborneRef.current = false;
    verticalVelocityRef.current = 0;
    airborneSpeedRef.current = 0;
    terrainSlopeRef.current = 0;
    modelAltitudeOverrideRef.current = null;

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    const start = providerCoordRef.current ?? [activeProvider.lng, activeProvider.lat];
    setProviderPosition({ lng: start[0], lat: start[1] });
    setIsMoving(false);
    setIsRouteLoading(true);
    setRouteError(null);

    try {
      const waypoints = [start, ...checkpoints]
        .map(([lng, lat]) => `${lng},${lat}`)
        .join(";");
      const url = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Routing failed (${res.status})`);

      const data = await res.json();
      const geometry = data?.routes?.[0]?.geometry;
      if (!geometry?.coordinates?.length) throw new Error("No route found");

      routeCoordsRef.current = geometry.coordinates as [number, number][];
      startRouteZip(routeCoordsRef.current);
      animateAlongRoute(routeCoordsRef.current);
    } catch (error) {
      updateEngineAudio(0, false);
      setRouteError(error instanceof Error ? error.message : "Could not build route");
    } finally {
      setIsRouteLoading(false);
    }
  };

  const clearCheckpoints = () => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (zipAnimationRef.current) cancelAnimationFrame(zipAnimationRef.current);
    animationRef.current = null;
    zipAnimationRef.current = null;
    zipInProgressRef.current = false;
    routeCoordsRef.current = [];
    setIsMoving(false);
    setCheckpoints([]);
    setRtsRouteGeoJSON(null);
    setRouteError(null);
    updateEngineAudio(0, false);
  };

  const selectRtsUnit = (unitId: string, additive: boolean) => {
    const unit = rtsUnitsRef.current.find((candidate) => candidate.id === unitId);
    if (!unit?.alive || unit.team !== "player") return;
    const next = additive ? new Set(selectedUnitIdsRef.current) : new Set<string>();
    if (additive && next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    commitUnitSelection(next);
    playRtsEffect("select");
    mapRef?.getMap()?.triggerRepaint();
  };

  const commandEnemyTarget = (targetId: string) => {
    if (selectedUnitIdsRef.current.size === 0) return;
    const units = issueAttackCommand(
      rtsUnitsRef.current,
      selectedUnitIdsRef.current,
      targetId
    );
    rtsUnitsRef.current = units;
    setRtsSnapshot([...units]);
    playRtsEffect("attack");
  };

  const handleRtsContextMenu = (event: MapLayerMouseEvent) => {
    event.originalEvent.preventDefault();
    if (gameMode !== "command" || isModeMenuOpen || matchResult) return;
    const map = mapRef?.getMap();
    if (!map || selectedUnitIdsRef.current.size === 0) return;

    const enemy = rtsUnitsRef.current
      .filter((unit) => unit.alive && unit.team === "enemy")
      .map((unit) => ({ unit, point: map.project(unit.position) }))
      .find(({ point }) => Math.hypot(point.x - event.point.x, point.y - event.point.y) <= 32);

    const units = enemy
      ? issueAttackCommand(rtsUnitsRef.current, selectedUnitIdsRef.current, enemy.unit.id)
      : issueMoveCommand(
          rtsUnitsRef.current,
          selectedUnitIdsRef.current,
          [event.lngLat.lng, event.lngLat.lat]
        );
    rtsUnitsRef.current = units;
    setRtsSnapshot([...units]);
    playRtsEffect(enemy ? "attack" : "move");
    map.triggerRepaint();
  };

  const handleMapMouseDown = (event: MapLayerMouseEvent) => {
    if (gameMode !== "command" || isModeMenuOpen) {
      if (rotateRef.current) cancelAnimationFrame(rotateRef.current);
      return;
    }
    if (event.originalEvent.button === 1) {
      event.originalEvent.preventDefault();
      middlePanRef.current = { x: event.point.x, y: event.point.y };
      return;
    }
    if (event.originalEvent.button === 0) {
      const point = { x: event.point.x, y: event.point.y };
      selectionStartRef.current = point;
      setSelectionBox({ start: point, end: point });
    }
  };

  const handleMapMouseMove = (event: MapLayerMouseEvent) => {
    const map = mapRef?.getMap();
    if (!map) return;
    if (gameMode === "pvp" && isSelectingPvpSpawn) {
      setPvpSpawnPreview([event.lngLat.lng, event.lngLat.lat]);
      return;
    }
    if (gameMode !== "command" || isModeMenuOpen) return;
    if (middlePanRef.current) {
      const previous = middlePanRef.current;
      map.panBy([previous.x - event.point.x, previous.y - event.point.y], { animate: false });
      middlePanRef.current = { x: event.point.x, y: event.point.y };
      return;
    }
    if (selectionStartRef.current) {
      setSelectionBox({
        start: selectionStartRef.current,
        end: { x: event.point.x, y: event.point.y },
      });
    }
  };

  const handleMapMouseUp = (event: MapLayerMouseEvent) => {
    middlePanRef.current = null;
    const start = selectionStartRef.current;
    selectionStartRef.current = null;
    if (!start || gameMode !== "command" || isModeMenuOpen) return;

    const end = { x: event.point.x, y: event.point.y };
    setSelectionBox(null);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 5) {
      if (!event.originalEvent.shiftKey) commitUnitSelection([]);
      return;
    }
    const map = mapRef?.getMap();
    if (!map) return;
    const ids = selectUnitIdsInScreenBox(
      rtsUnitsRef.current,
      (position) => map.project(position),
      start,
      end
    );
    commitUnitSelection(
      event.originalEvent.shiftKey
        ? [...selectedUnitIdsRef.current, ...ids]
        : ids
    );
    if (ids.length > 0) playRtsEffect("select");
    map.triggerRepaint();
  };

  const rtsCommandGeoJSON = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: rtsSnapshot.flatMap((unit) => {
      if (!unit.alive || !selectedUnitIds.has(unit.id)) return [];
      let target: [number, number] | null = null;
      if (unit.command.type === "move") target = unit.command.target;
      if (unit.command.type === "attack") {
        const targetId = unit.command.targetId;
        target = rtsSnapshot.find((candidate) => candidate.id === targetId)?.position ?? null;
      }
      return target
        ? [{
            type: "Feature" as const,
            properties: { team: unit.team },
            geometry: { type: "LineString" as const, coordinates: [unit.position, target] },
          }]
        : [];
    }),
  }), [rtsSnapshot, selectedUnitIds]);

  const initialView: ViewState = {
    padding: { top: 80, bottom: 80, left: 80, right: 80 },
    longitude: from?.lng ?? 0,
    latitude: from?.lat ?? 0,
    zoom: 10,
    pitch: 70,
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
    roamSimulationActiveRef.current = gameMode === "roam" && !isModeMenuOpen;
    if (!roamSimulationActiveRef.current) updateEngineAudio(0, false);
    if (gameMode !== "command" || isModeMenuOpen) {
      updateRtsVehicleAudio(0, rtsUnitsRef.current.filter((unit) => unit.alive).length);
    }
  }, [gameMode, isModeMenuOpen, updateEngineAudio, updateRtsVehicleAudio]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.code === "Escape" && !isModeMenuOpen) openModeMenu();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [isModeMenuOpen, openModeMenu]);

  useEffect(() => {
    if (!providerCoord) return;
    providerCoordRef.current = [providerCoord.lng, providerCoord.lat];
  }, [providerCoord?.lng, providerCoord?.lat]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || gameMode !== "roam" || isModeMenuOpen) return;

    const initialPosition = providerCoordRef.current;
    if (initialPosition) {
      const initialOrientation = getRoamTerrainOrientation(
        map,
        initialPosition,
        providerHeadingRef.current ?? 0
      );
      providerPitchRef.current = initialOrientation.pitch;
      providerRollRef.current = initialOrientation.roll;
      map.triggerRepaint();
    }

    let previousTime = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;

      const keys = pressedKeysRef.current;
      const position = providerCoordRef.current;
      const touchInput = roamTouchInputRef.current;
      const forward = clamp(
        (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) + touchInput.forward,
        -1,
        1
      );
      const steering = clamp(
        (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0) + touchInput.turn,
        -1,
        1
      );
      const inputSpeed = forward * speedRef.current * MANUAL_SPEED_FACTOR;
      const travelSpeed = airborneRef.current ? airborneSpeedRef.current : inputSpeed;

      if (position) {
        let heading = providerHeadingRef.current ?? 0;
        if (steering !== 0) {
          heading = normalizeAngle(heading + steering * TURN_SPEED_RADIANS * deltaSeconds);
          providerHeadingRef.current = heading;
        }

        if (travelSpeed !== 0) {
          const nextPosition = offsetCoordinate(
            position,
            heading,
            travelSpeed * deltaSeconds
          );
          providerCoordRef.current = nextPosition;

          const terrainHere = map.queryTerrainElevation(nextPosition);
          const lookahead = offsetCoordinate(
            nextPosition,
            heading,
            forward * TERRAIN_LOOKAHEAD_METERS
          );
          const terrainAhead = map.queryTerrainElevation(lookahead);

          if (terrainHere != null && terrainAhead != null) {
            const slope = clamp(
              (terrainAhead - terrainHere) / TERRAIN_LOOKAHEAD_METERS,
              -2,
              2
            );
            const previousSlope = terrainSlopeRef.current;
            const leftRampCrest =
              previousSlope > RAMP_TAKEOFF_SLOPE && slope < previousSlope - 0.04;
            const reachedDrop =
              slope < DROP_TAKEOFF_SLOPE && previousSlope >= DROP_TAKEOFF_SLOPE;

            if (!airborneRef.current && forward > 0 && (leftRampCrest || reachedDrop)) {
              airborneRef.current = true;
              airborneSpeedRef.current = travelSpeed;
              modelAltitudeOverrideRef.current = terrainHere + BASE_MODEL_ELEVATION;
              verticalVelocityRef.current = clamp(
                Math.abs(travelSpeed) * Math.max(previousSlope, 0.1) * 0.75,
                3,
                18
              );
            }

            terrainSlopeRef.current = slope;
          }
        }

        if (!airborneRef.current && providerCoordRef.current) {
          const orientation = getRoamTerrainOrientation(
            map,
            providerCoordRef.current,
            heading
          );
          providerPitchRef.current = smoothAngle(
            providerPitchRef.current ?? orientation.pitch,
            orientation.pitch,
            0.18
          );
          providerRollRef.current = smoothAngle(
            providerRollRef.current ?? orientation.roll,
            orientation.roll,
            0.18
          );
        }
      }

      if (airborneRef.current && providerCoordRef.current) {
        const groundAltitude =
          (map.queryTerrainElevation(providerCoordRef.current) ?? 0) +
          BASE_MODEL_ELEVATION;
        const nextAltitude =
          (modelAltitudeOverrideRef.current ?? groundAltitude) +
          verticalVelocityRef.current * deltaSeconds;
        verticalVelocityRef.current -= GRAVITY * deltaSeconds;

        if (nextAltitude <= groundAltitude && verticalVelocityRef.current <= 0) {
          airborneRef.current = false;
          verticalVelocityRef.current = 0;
          airborneSpeedRef.current = 0;
          modelAltitudeOverrideRef.current = null;
          const orientation = getRoamTerrainOrientation(
            map,
            providerCoordRef.current,
            providerHeadingRef.current ?? 0
          );
          providerPitchRef.current = orientation.pitch;
          providerRollRef.current = orientation.roll;
        } else {
          modelAltitudeOverrideRef.current = nextAltitude;
          providerPitchRef.current = clamp(
            Math.atan2(verticalVelocityRef.current, Math.max(1, Math.abs(travelSpeed))),
            -0.6,
            0.6
          );
        }
      }

      updateEngineAudio(
        Math.abs(travelSpeed) / (500 * MANUAL_SPEED_FACTOR),
        forward !== 0 || steering !== 0 || airborneRef.current,
        airborneRef.current
      );

      map.triggerRepaint();

      if (forward !== 0 || steering !== 0 || airborneRef.current) {
        manualAnimationRef.current = requestAnimationFrame(tick);
      } else {
        manualAnimationRef.current = null;
        setIsMoving(false);
        updateEngineAudio(0, false);
      }
    };

    const startManualAnimation = () => {
      if (manualAnimationRef.current !== null) return;
      previousTime = performance.now();
      setIsMoving(true);
      manualAnimationRef.current = requestAnimationFrame(tick);
    };
    startRoamAnimationRef.current = startManualAnimation;

    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.tagName === "BUTTON");

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const isMovementKey = ["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code);
      if (!isMovementKey) return;

      event.preventDefault();
      startEngineAudio();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (zipAnimationRef.current) {
        cancelAnimationFrame(zipAnimationRef.current);
        zipAnimationRef.current = null;
      }

      if (isMovementKey) pressedKeysRef.current.add(event.code);
      startManualAnimation();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      pressedKeysRef.current.delete(event.code);
    };

    const onBlur = () => {
      pressedKeysRef.current.clear();
      roamTouchInputRef.current = { forward: 0, turn: 0 };
      startRoamAnimationRef.current = null;
      updateEngineAudio(0, false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      pressedKeysRef.current.clear();
      if (manualAnimationRef.current !== null) {
        cancelAnimationFrame(manualAnimationRef.current);
        manualAnimationRef.current = null;
      }
    };
  }, [gameMode, isModeMenuOpen, mapRef, startEngineAudio, updateEngineAudio]);

  useEffect(() => {
    return () => {
      const graph = engineAudioRef.current;
      if (graph) {
        [
          graph.engineOscillator,
          graph.harmonicOscillator,
          graph.rumbleOscillator,
          graph.modulatorOscillator,
        ].forEach((oscillator) => oscillator.stop());
        void graph.context.close();
        engineAudioRef.current = null;
      }
      const rtsGraph = rtsAudioRef.current;
      if (rtsGraph) {
        [
          rtsGraph.engineOscillator,
          rtsGraph.harmonicOscillator,
          rtsGraph.rumbleOscillator,
        ].forEach((oscillator) => oscillator.stop());
        void rtsGraph.context.close();
        rtsAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (
      !map ||
      gameMode !== "command" ||
      isModeMenuOpen ||
      matchResult ||
      rtsUnitsRef.current.length === 0
    ) return;

    let previousTime = performance.now();
    let lastPublished = 0;
    const tick = (now: number) => {
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      const previousUnits = rtsUnitsRef.current;
      const units = stepRtsSimulation(previousUnits, deltaSeconds);
      const audioFrame = getRtsAudioFrame(previousUnits, units);
      rtsUnitsRef.current = units;

      updateRtsVehicleAudio(audioFrame.movingUnits, audioFrame.aliveUnits);
      if (audioFrame.shots.player > 0) playRtsEffect("shot-player");
      if (audioFrame.shots.enemy > 0) playRtsEffect("shot-enemy");
      if (audioFrame.impacts > 0) playRtsEffect("impact");
      if (audioFrame.destructions > 0) playRtsEffect("destroy");

      const result = getMatchResult(units);
      if (result) {
        updateRtsVehicleAudio(0, audioFrame.aliveUnits);
        playRtsEffect(result);
        setRtsSnapshot([...units]);
        setMatchResult(result);
        rtsAnimationRef.current = null;
        map.triggerRepaint();
        return;
      }

      if (now - lastPublished >= 100) {
        setRtsSnapshot([...units]);
        lastPublished = now;
      }
      map.triggerRepaint();
      rtsAnimationRef.current = requestAnimationFrame(tick);
    };

    rtsAnimationRef.current = requestAnimationFrame(tick);
    return () => {
      updateRtsVehicleAudio(0, rtsUnitsRef.current.filter((unit) => unit.alive).length);
      if (rtsAnimationRef.current !== null) {
        cancelAnimationFrame(rtsAnimationRef.current);
        rtsAnimationRef.current = null;
      }
    };
  }, [gameMode, isModeMenuOpen, mapRef, matchResult, playRtsEffect, updateRtsVehicleAudio]);

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map || gameMode !== "command" || isModeMenuOpen) return;
    const keys = new Set<string>();
    let frame: number | null = null;
    let previous = performance.now();

    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const direction = (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0);
      if (direction !== 0) map.rotateTo(map.getBearing() + direction * 65 * delta, { duration: 0 });
      frame = keys.size ? requestAnimationFrame(tick) : null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyQ" && event.code !== "KeyE") return;
      event.preventDefault();
      keys.add(event.code);
      if (frame === null) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [gameMode, isModeMenuOpen, mapRef]);

  useEffect(() => {
    cameraCenterRef.current = providerCoordRef.current;
    cameraBearingRef.current = null;
    if (cameraMode !== "orbit" || gameMode !== "roam" || isModeMenuOpen) return;
    orbitBearingRef.current = mapRef?.getMap()?.getBearing() ?? orbitBearingRef.current;
  }, [cameraMode, gameMode, isModeMenuOpen, mapRef]);

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

    if (cameraMode === "orbit" && gameMode === "roam" && !isModeMenuOpen) {
      orbitAnimationRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (orbitAnimationRef.current) {
        cancelAnimationFrame(orbitAnimationRef.current);
        orbitAnimationRef.current = null;
      }
    };
  }, [cameraMode, gameMode, isModeMenuOpen, mapRef]);

  useEffect(() => {
    if (
      gameMode !== "pvp" ||
      isModeMenuOpen ||
      (tankPartyStatus !== "hosting" && tankPartyStatus !== "joined")
    ) {
      setTankInput({ forward: 0, turn: 0, firing: false });
      updateEngineAudio(0, false);
      return;
    }

    const keys = new Set<string>();
    const publishInput = () => {
      const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      setTankInput({
      forward,
      turn: (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0),
      firing: keys.has("Space"),
      });
      updateEngineAudio(Math.abs(forward), keys.size > 0);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(event.code)) return;
      event.preventDefault();
      startEngineAudio();
      keys.add(event.code);
      publishInput();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!keys.delete(event.code)) return;
      event.preventDefault();
      publishInput();
    };
    const onBlur = () => {
      keys.clear();
      publishInput();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      setTankInput({ forward: 0, turn: 0, firing: false });
      updateEngineAudio(0, false);
    };
  }, [gameMode, isModeMenuOpen, setTankInput, startEngineAudio, tankPartyStatus, updateEngineAudio]);

  const startRouteZip = (path: [number, number][]) => {
    if (zipAnimationRef.current) {
      cancelAnimationFrame(zipAnimationRef.current);
      zipAnimationRef.current = null;
    }

    if (path.length < 2) return;
    zipInProgressRef.current = true;
    let elapsed = 0;
    let previous = performance.now();

    const step = (now: number) => {
      const delta = now - previous;
      previous = now;
      if (!roamSimulationActiveRef.current) {
        zipAnimationRef.current = requestAnimationFrame(step);
        return;
      }
      elapsed += delta;
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
      const bounds = {
        minLng: Infinity,
        minLat: Infinity,
        maxLng: -Infinity,
        maxLat: -Infinity,
      };

      const extendBounds = (coordinates: unknown) => {
        if (!Array.isArray(coordinates)) return;
        if (
          coordinates.length >= 2 &&
          typeof coordinates[0] === "number" &&
          typeof coordinates[1] === "number"
        ) {
          bounds.minLng = Math.min(bounds.minLng, coordinates[0]);
          bounds.minLat = Math.min(bounds.minLat, coordinates[1]);
          bounds.maxLng = Math.max(bounds.maxLng, coordinates[0]);
          bounds.maxLat = Math.max(bounds.maxLat, coordinates[1]);
          return;
        }
        coordinates.forEach(extendBounds);
      };

      extendBounds(geometry?.coordinates);
      if (!Number.isFinite(bounds.minLng)) return null;

      // Keep inverse mask local. A world-sized ring crosses the antimeridian and
      // can expose Earcut bridge triangles when the fill is draped over terrain.
      const padding = 5;
      const outerRing = ensureWinding(
        [
          [bounds.minLng - padding, bounds.minLat - padding],
          [bounds.maxLng + padding, bounds.minLat - padding],
          [bounds.maxLng + padding, bounds.maxLat + padding],
          [bounds.minLng - padding, bounds.maxLat + padding],
          [bounds.minLng - padding, bounds.minLat - padding],
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
              coordinates: [outerRing, ...holes],
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
        {gameMode === "roam" && !isModeMenuOpen && (
        <aside className={`absolute left-3 top-3 z-10 select-none text-xs text-slate-100 sm:left-5 sm:top-5 ${isRoamHudCollapsed ? "w-auto" : "w-[min(19rem,calc(100vw-1.5rem))]"}`}>
          <div className="relative overflow-hidden border border-cyan-300/35 bg-slate-950/90 shadow-[0_0_0_1px_rgba(15,23,42,0.9),0_18px_50px_rgba(0,0,0,0.55),0_0_24px_rgba(34,211,238,0.08)] backdrop-blur-md [clip-path:polygon(0_0,calc(100%-14px)_0,100%_14px,100%_100%,14px_100%,0_calc(100%-14px))]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-300 to-transparent" />

            <header className="flex items-center justify-between border-b border-cyan-300/20 bg-cyan-300/5 px-4 py-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-cyan-300/70">
                  Bohol Trips
                </p>
                <h2 className="mt-0.5 text-sm font-black uppercase tracking-[0.16em] text-white">
                  Travel Control
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)] motion-reduce:animate-none" />
                  Online
                </div>
                <button
                  type="button"
                  aria-expanded={!isRoamHudCollapsed}
                  aria-label={isRoamHudCollapsed ? "Expand travel HUD" : "Collapse travel HUD"}
                  onClick={() => setIsRoamHudCollapsed((collapsed) => !collapsed)}
                  className="border border-cyan-300/45 px-2 py-1 font-mono text-[8px] uppercase text-cyan-200 hover:bg-cyan-300/10"
                >
                  {isRoamHudCollapsed ? "Show ▾" : "Hide ▴"}
                </button>
                <button
                  type="button"
                  onClick={openModeMenu}
                  className="border border-slate-600 px-2 py-1 font-mono text-[8px] uppercase text-slate-400 hover:border-cyan-300 hover:text-cyan-200"
                >
                  Modes
                </button>
              </div>
            </header>

            <div className={isRoamHudCollapsed ? "hidden" : "block"}>

            <section className="px-4 py-3">
              <div className="mb-2.5 flex items-end justify-between">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">Movement</p>
                  <p className="mt-0.5 font-bold uppercase tracking-wider text-slate-200">Travel speed</p>
                </div>
                <span className="border border-amber-300/30 bg-amber-300/10 px-2 py-1 font-mono text-[10px] font-bold uppercase text-amber-200">
                  {SPEED_PRESETS[speedIndex]?.label ?? "Fast"}
                </span>
              </div>
              <input
                aria-label="Travel speed"
                className="h-1.5 w-full cursor-pointer appearance-none rounded-none bg-slate-700 accent-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300"
                type="range"
                min={0}
                max={SPEED_PRESETS.length - 1}
                step={1}
                value={speedIndex}
                onChange={(e) => setSpeedIndex(Number(e.target.value))}
              />
              <div className="mt-3 grid grid-cols-3 gap-1">
                {SPEED_PRESETS.map((preset, idx) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSpeedIndex(idx)}
                    className={`border px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
                      idx === speedIndex
                        ? "border-amber-300 bg-amber-300 text-slate-950 shadow-[0_0_12px_rgba(252,211,77,0.25)]"
                        : "border-slate-700 bg-slate-900/70 text-slate-400 hover:border-amber-300/50 hover:text-amber-200"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="border-t border-slate-700/70 px-4 py-3">
              <div className="mb-2.5 flex items-center justify-between">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">Optics</p>
                  <p className="mt-0.5 font-bold uppercase tracking-wider text-slate-200">Camera mode</p>
                </div>
                <span className="font-mono text-[10px] uppercase text-cyan-300">[{cameraMode}]</span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(["follow", "orbit", "free"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCameraMode(mode)}
                    className={`border px-2 py-2 text-[9px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
                      mode === cameraMode
                        ? "border-cyan-300 bg-cyan-300/20 text-cyan-100 shadow-[inset_0_-2px_0_rgba(103,232,249,0.8)]"
                        : "border-slate-700 bg-slate-900/70 text-slate-500 hover:border-cyan-300/40 hover:text-cyan-200"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between border border-slate-700 bg-black/25 px-2.5 py-2">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300">Free roam</p>
                  <p className="mt-0.5 text-[9px] text-slate-500">Drive ramps for airtime</p>
                </div>
                <div className="flex items-center gap-1 font-mono text-[9px] font-black text-slate-200">
                  <kbd className="border border-slate-600 bg-slate-800 px-1.5 py-1">WASD</kbd>
                  <span className="border border-amber-300/30 bg-amber-300/10 px-1.5 py-1 text-amber-200">AUTO AIR</span>
                </div>
              </div>
            </section>

            <section className="border-t border-slate-700/70 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-500">Mission path</p>
                  <p className="mt-0.5 font-bold uppercase tracking-wider text-slate-200">Checkpoints</p>
                </div>
                <span className="font-mono text-2xl font-black leading-none text-cyan-300 tabular-nums">
                  {String(checkpoints.length).padStart(2, "0")}
                </span>
              </div>
              <p className="mt-2 border-l-2 border-cyan-300/40 pl-2 text-[10px] leading-relaxed text-slate-400">
                Select map positions in travel order, then deploy route.
              </p>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <button
                  type="button"
                  disabled={checkpoints.length === 0 || isRouteLoading}
                  onClick={playCheckpointRoute}
                  className="border border-emerald-300 bg-emerald-300 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950 shadow-[0_0_16px_rgba(110,231,183,0.2)] transition hover:bg-emerald-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none"
                >
                  {isRouteLoading ? "Calculating..." : "▶ Deploy"}
                </button>
                <button
                  type="button"
                  aria-label="Clear route"
                  title="Clear route"
                  disabled={checkpoints.length === 0 && !rtsRouteGeoJSON}
                  onClick={clearCheckpoints}
                  className="border border-red-300/40 bg-red-400/10 px-3 py-2.5 font-mono text-[10px] font-bold uppercase text-red-200 transition hover:border-red-300 hover:bg-red-400/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-transparent disabled:text-slate-700"
                >
                  Reset
                </button>
              </div>
              {routeError && (
                <p role="alert" className="mt-2 border border-red-400/30 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-200">
                  ERR: {routeError}
                </p>
              )}
            </section>

            <footer className="flex items-center justify-between border-t border-cyan-300/15 bg-black/30 px-4 py-2 font-mono text-[8px] uppercase tracking-[0.18em] text-slate-600">
              <span>Nav System 01</span>
              <span>{checkpoints.length ? "Route armed" : "Awaiting target"}</span>
            </footer>
            </div>
          </div>
        </aside>
        )}
        {gameMode === "roam" && !isModeMenuOpen && (
          <MobileRoamControls onInputChange={handleRoamTouchInput} />
        )}
        {gameMode === "command" && !isModeMenuOpen && (
          <RtsHud
            units={rtsSnapshot}
            selectedCount={selectedUnitIds.size}
            matchResult={matchResult}
            onChangeMode={openModeMenu}
            onRematch={resetSkirmish}
          />
        )}
        {gameMode === "pvp" && !isModeMenuOpen && (
          <TankPvpHud
            status={tankParty.status}
            partyCode={tankParty.partyCode}
            localPeerId={tankParty.localPeerId}
            players={tankParty.players}
            error={tankParty.error}
            isHost={tankParty.isHost}
            spawnAreaSelected={pvpSpawnCenter !== null}
            isSelectingSpawnArea={isSelectingPvpSpawn}
            onHost={(name) => {
              if (pvpSpawnCenter) void tankParty.createParty(name);
            }}
            onBeginSpawnSelection={beginPvpSpawnSelection}
            onCancelSpawnSelection={cancelPvpSpawnSelection}
            onJoin={(code, name) => void tankParty.joinParty(code, name)}
            onLeave={() => {
              tankParty.leaveParty();
              openModeMenu();
            }}
            onChangeMode={openModeMenu}
            onInputChange={handleTankTouchInput}
          />
        )}
        {selectionBox && gameMode === "command" && !isModeMenuOpen && (
          <div
            className="pointer-events-none absolute z-30 border border-cyan-200 bg-cyan-300/15 shadow-[0_0_12px_rgba(34,211,238,0.25)]"
            style={{
              left: Math.min(selectionBox.start.x, selectionBox.end.x),
              top: Math.min(selectionBox.start.y, selectionBox.end.y),
              width: Math.abs(selectionBox.end.x - selectionBox.start.x),
              height: Math.abs(selectionBox.end.y - selectionBox.start.y),
            }}
          />
        )}
        <Map
          ref={handleMapRef}
          onLoad={() => setMapIsReady(true)}
          onMouseDown={handleMapMouseDown}
          onMouseMove={handleMapMouseMove}
          onMouseUp={handleMapMouseUp}
          onContextMenu={handleRtsContextMenu}
          onDragStart={() => { userInteractedRef.current = true; }}
          onZoomStart={() => { userInteractedRef.current = true; }}
          onRotateStart={() => { userInteractedRef.current = true; }}
          onClick={isSelectingPvpSpawn
            ? handlePvpSpawnClick
            : gameMode === "roam" && !isModeMenuOpen
              ? handleMapClick
              : undefined}
          initialViewState={initialView}
          maxBounds={boholBounds ?? undefined}
          minZoom={13}
          maxZoom={20}
          maxPitch={85}
          dragPan={gameMode === "roam" || isSelectingPvpSpawn}
          renderWorldCopies={false}
          mapStyle={mapStyle as any}
          mapLib={import("maplibre-gl")}
          style={{
            width: "100%",
            height: "100%",
            cursor: isSelectingPvpSpawn ? "crosshair" : undefined,
          }}
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
              id={HILLSHADE_SOURCE_ID}
              type="raster-dem"
              url={TERRAIN_TILES_URL}
              tileSize={512}
              maxzoom={14}
            >
              <Layer
                id="terrain-hillshade"
                type="hillshade"
                paint={{
                  "hillshade-shadow-color": "#0b0e14",
                  "hillshade-highlight-color": "#f4f7f8",
                  "hillshade-accent-color": "#7d8791",
                  "hillshade-exaggeration": 0.6,
                }}
              />
            </Source>
          )}

          {mapIsReady && gameMode === "roam" && parsedCoords.map((coord, index) => {
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
                    altitudeOverrideRef={isProvider ? modelAltitudeOverrideRef : undefined}
                    headingRef={isProvider ? providerHeadingRef : undefined}
                    headingOffset={isProvider ? -Math.PI / 2 : 0}
                    pitchRef={isProvider ? providerPitchRef : undefined}
                    rollRef={isProvider ? providerRollRef : undefined}
                    onRenderFrame={isProvider ? handleProviderRenderFrame : undefined}
                    modelPath={index === 0 && parsedCoords.length === 2 ? "/models/cave.glb" : "/models/orc_rammer.glb"}
                />
              </Fragment>
            );
          })}

          {gameMode === "roam" && checkpoints.map(([lng, lat], index) => (
            <MapMarker
              key={`checkpoint-${index}-${lng}-${lat}`}
              lat={lat}
              lng={lng}
              label={`${index + 1}`}
              title={`Checkpoint ${index + 1}`}
              popupContent={`Checkpoint ${index + 1}`}
            />
          ))}

          {gameMode === "roam" && rtsRouteGeoJSON && (
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

          {mapIsReady && gameMode === "pvp" && !isModeMenuOpen &&
            (isSelectingPvpSpawn || pvpSpawnCenter) &&
            tankParty.status !== "hosting" && tankParty.status !== "joined" && (
              <Source id="tank-pvp-spawn-area" type="geojson" data={pvpSpawnAreaGeoJSON}>
                <Layer
                  id="tank-pvp-spawn-area-fill"
                  type="fill"
                  paint={{
                    "fill-color": "#fbbf24",
                    "fill-opacity": 0.2,
                  }}
                />
                <Layer
                  id="tank-pvp-spawn-area-outline"
                  type="line"
                  paint={{
                    "line-color": "#fde68a",
                    "line-width": 3,
                    "line-dasharray": [2, 1.5],
                  }}
                />
              </Source>
            )}

          {mapIsReady && gameMode === "pvp" && !isModeMenuOpen && isSelectingPvpSpawn && (
            <Marker
              longitude={(pvpSpawnPreview ?? pvpOrigin)[0]}
              latitude={(pvpSpawnPreview ?? pvpOrigin)[1]}
              anchor="center"
            >
              <div className="pointer-events-none grid h-8 w-8 place-items-center rounded-full border-2 border-amber-100 bg-amber-300/30 shadow-[0_0_20px_rgba(251,191,36,0.8)]">
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </div>
            </Marker>
          )}

          <RtsBattleLayer
            map={mapRef?.getMap()}
            unitsRef={rtsUnitsRef}
            selectedIdsRef={selectedUnitIdsRef}
            visible={mapIsReady && gameMode === "command" && !isModeMenuOpen}
          />

          <TankPvpLayer
            map={mapRef?.getMap()}
            playersRef={tankParty.playersRef}
            localPeerId={tankParty.localPeerId}
            visible={mapIsReady && gameMode === "pvp" && !isModeMenuOpen && tankParty.players.length > 0}
          />

          {gameMode === "command" && !isModeMenuOpen && rtsSnapshot
            .filter((unit) => unit.alive)
            .map((unit) => {
              const selected = selectedUnitIds.has(unit.id);
              return (
                <Marker
                  key={unit.id}
                  longitude={unit.position[0]}
                  latitude={unit.position[1]}
                  anchor="center"
                >
                  <div
                    role={unit.team === "player" ? "button" : undefined}
                    tabIndex={unit.team === "player" ? 0 : undefined}
                    aria-label={`${unit.team} unit ${unit.id}, ${unit.hp} health`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (unit.team === "player") selectRtsUnit(unit.id, event.shiftKey);
                    }}
                    onKeyDown={(event) => {
                      if (unit.team === "player" && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        selectRtsUnit(unit.id, event.shiftKey);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (unit.team === "enemy") commandEnemyTarget(unit.id);
                    }}
                    className={`relative h-12 w-12 cursor-crosshair rounded-full border-2 transition ${
                      unit.team === "player"
                        ? selected
                          ? "border-cyan-200 bg-cyan-300/20 shadow-[0_0_18px_rgba(34,211,238,0.8)]"
                          : "border-cyan-500/50 bg-cyan-400/5"
                        : "border-rose-400/70 bg-rose-500/10 shadow-[0_0_10px_rgba(251,113,133,0.25)]"
                    }`}
                  >
                    <div className="absolute -top-2 left-1/2 h-1.5 w-11 -translate-x-1/2 overflow-hidden border border-black/70 bg-black/80">
                      <div
                        className={unit.team === "player" ? "h-full bg-cyan-300" : "h-full bg-rose-400"}
                        style={{ width: `${(unit.hp / unit.maxHp) * 100}%` }}
                      />
                    </div>
                  </div>
                </Marker>
              );
            })}

          {gameMode === "command" && rtsCommandGeoJSON.features.length > 0 && (
            <Source id="rts-command-lines" type="geojson" data={rtsCommandGeoJSON}>
              <Layer
                id="rts-command-line-layer"
                type="line"
                paint={{
                  "line-color": "#67e8f9",
                  "line-width": 2,
                  "line-dasharray": [2, 2],
                  "line-opacity": 0.8,
                }}
              />
            </Source>
          )}
        </Map>
        {isModeMenuOpen && (
          <GameModeMenu currentMode={gameMode} onStart={startGameMode} />
        )}
      </div>
    </div>
  );
};

export default ProviderMap;
