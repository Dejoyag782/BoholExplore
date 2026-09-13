import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  TANK_MAX_HP,
  TANK_MAX_AIR_HEIGHT_METERS,
  TANK_SPEED_METERS,
  type TankPlayer,
} from "../../../game/tankPvp";
import { distanceMeters, offsetMeters } from "../../../game/rts";
import { getTankModelLoadUrl } from "../../../game/tankModelCache";

type TankPvpLayerProps = {
  map?: maplibregl.Map | null;
  playersRef: React.MutableRefObject<TankPlayer[]>;
  localPeerId: string | null;
  visible: boolean;
};

type ActiveShot = {
  mesh: THREE.Mesh;
  from: [number, number];
  to: [number, number];
  fromElevation: number;
  toElevation: number;
  arcHeight: number;
  durationMs: number;
  startedAt: number;
};

type TankHealthMarker = {
  marker: maplibregl.Marker;
  element: HTMLDivElement;
  bar: HTMLDivElement;
  fill: HTMLDivElement;
  position: [number, number];
};

type DisplayTank = {
  position: [number, number];
  heading: number;
};

type TankFlightState = {
  airborne: boolean;
  heightAboveGround: number;
  verticalVelocity: number;
  speed: number;
};

const zoomToScale = (zoom: number) => Math.max(8, Math.pow(2, 20 - zoom));
const TANK_MODEL_SCALE = 0.62;
const TANK_LENGTH_SAMPLE_METERS = 10;
const TANK_WIDTH_SAMPLE_METERS = 6;
const MAX_TERRAIN_TILT = THREE.MathUtils.degToRad(32);
const TERRAIN_TILT_SMOOTHING = 0.14;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);
const ROLL_AXIS = new THREE.Vector3(0, 0, 1);
const PROJECTILE_BARREL_ANGLE = THREE.MathUtils.degToRad(18);
const PROJECTILE_MIN_ANGLE = THREE.MathUtils.degToRad(4);
const PROJECTILE_MAX_ANGLE = THREE.MathUtils.degToRad(50);
const PROJECTILE_MIN_ARC_METERS = 6;
const PROJECTILE_SPEED_METERS_PER_SECOND = 260;
const PROJECTILE_RADIUS = 0.16;
const PROJECTILE_MUZZLE_ELEVATION_METERS = 12;
const PROJECTILE_TARGET_ELEVATION_METERS = 8;
const TANK_CAMERA_ZOOM = 18.4;
const TANK_CAMERA_PITCH = 58;
const TANK_CAMERA_LOOK_AHEAD_METERS = 18;
const TANK_INTERPOLATION_SPEED = 15;
const TANK_ALTITUDE_INTERPOLATION_SPEED = 8;
const TANK_MODEL_BASE_ELEVATION = 5;
const disposeModelResources = (root: THREE.Object3D) => {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
};

class TankThreeLayer implements maplibregl.CustomLayerInterface {
  readonly id = "tank-pvp-models";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map!: maplibregl.Map;
  private renderer?: THREE.WebGLRenderer;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private shadowReceiver?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private groups = new Map<string, THREE.Group>();
  private healthMarkers = new Map<string, TankHealthMarker>();
  private displayTanks = new Map<string, DisplayTank>();
  private flightStates = new Map<string, TankFlightState>();
  private tankTemplate: THREE.Group | null = null;
  private shots = new Map<string, ActiveShot>();
  private lastShotSequence = new Map<string, number>();
  private playersRef: React.MutableRefObject<TankPlayer[]>;
  private localPeerId: string | null;
  private disposed = false;
  private lastRenderTime: number | null = null;
  private cameraCenter: [number, number] | null = null;
  private cameraBearing: number | null = null;

  constructor(playersRef: React.MutableRefObject<TankPlayer[]>, localPeerId: string | null) {
    this.playersRef = playersRef;
    this.localPeerId = localPeerId;
  }

  onAdd = (map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) => {
    this.map = map;
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x53606d, 1.6);
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    const directionalLight = new THREE.DirectionalLight(0xfff4dd, 2.2);
    directionalLight.position.set(60, 100, 45);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.set(1024, 1024);
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 250;
    directionalLight.shadow.camera.left = -35;
    directionalLight.shadow.camera.right = 35;
    directionalLight.shadow.camera.top = 35;
    directionalLight.shadow.camera.bottom = -35;
    directionalLight.shadow.bias = -0.001;
    directionalLight.shadow.normalBias = 0.04;
    const fillLight = new THREE.DirectionalLight(0xddeeff, 1.2);
    fillLight.position.set(-100, -50, 100).normalize();
    this.scene.add(hemisphereLight, ambientLight, directionalLight, fillLight);

    const shadowReceiver = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.ShadowMaterial({
        color: 0x05070a,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    shadowReceiver.rotation.x = -Math.PI / 2;
    shadowReceiver.position.y = -0.05;
    shadowReceiver.receiveShadow = true;
    this.shadowReceiver = shadowReceiver;
    this.scene.add(shadowReceiver);

    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    void this.loadTankTemplate();
  };

  private async loadTankTemplate() {
    let revokeModelUrl: () => void = () => undefined;
    try {
      const cachedModel = await getTankModelLoadUrl();
      revokeModelUrl = cachedModel.revoke;
      const gltf = await new GLTFLoader().loadAsync(cachedModel.url);
      if (this.disposed) {
        disposeModelResources(gltf.scene);
        return;
      }

      const template = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(template);
      const size = bounds.getSize(new THREE.Vector3());
      const longestHorizontalSide = Math.max(size.x, size.z, 0.001);
      template.scale.multiplyScalar(5.6 / longestHorizontalSide);
      const scaledBounds = new THREE.Box3().setFromObject(template);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      template.position.set(-center.x, -scaledBounds.min.y, -center.z);
      // tank-v1's longest axis is X; rotate its nose onto the layer's local -Z axis.
      template.rotation.y = -Math.PI / 2;
      template.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.tankTemplate = template;
      this.map.triggerRepaint();
    } catch (cause) {
      console.error("Could not load the Tank PvP model", cause);
    } finally {
      revokeModelUrl();
    }
  }

  private createTank(player: TankPlayer) {
    if (!this.tankTemplate) return;
    const group = new THREE.Group();
    group.scale.setScalar(TANK_MODEL_SCALE);
    const tankModel = this.tankTemplate.clone(true);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.8, 3.15, 40),
      new THREE.MeshBasicMaterial({ color: player.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    ring.userData.instanceOwned = true;
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 3;
    group.add(tankModel, ring);
    this.groups.set(player.id, group);
    this.scene.add(group);

    const healthElement = document.createElement("div");
    healthElement.setAttribute("aria-hidden", "true");
    healthElement.style.cssText = "width:72px;height:9px;pointer-events:none;overflow:visible;";
    const healthBar = document.createElement("div");
    healthBar.style.cssText = "width:72px;height:9px;padding:2px;background:rgba(2,6,23,.86);border:1px solid rgba(255,255,255,.68);box-shadow:0 2px 8px rgba(0,0,0,.7);box-sizing:border-box;will-change:transform;";
    const healthFill = document.createElement("div");
    healthFill.style.cssText = "height:100%;width:100%;background:#4ade80;transform-origin:left center;transition:width 100ms linear,background-color 100ms linear;";
    healthBar.append(healthFill);
    healthElement.append(healthBar);
    const marker = new maplibregl.Marker({
      element: healthElement,
      anchor: "bottom",
      offset: [0, -34],
      pitchAlignment: "viewport",
      rotationAlignment: "viewport",
    }).setLngLat(player.position).addTo(this.map);
    this.healthMarkers.set(player.id, {
      marker,
      element: healthElement,
      bar: healthBar,
      fill: healthFill,
      position: player.position,
    });
  }

  private removeTank(playerId: string) {
    const group = this.groups.get(playerId);
    if (group) {
      this.scene.remove(group);
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.userData.instanceOwned) {
          object.geometry.dispose();
        }
        if (object.userData.instanceOwned || object.userData.instanceMaterialOwned) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      this.groups.delete(playerId);
    }
    this.healthMarkers.get(playerId)?.marker.remove();
    this.healthMarkers.delete(playerId);
    this.displayTanks.delete(playerId);
    this.flightStates.delete(playerId);
  }

  private interpolateTank(player: TankPlayer, deltaSeconds: number): DisplayTank {
    const current = this.displayTanks.get(player.id);
    if (!current || distanceMeters(current.position, player.position) > 35) {
      this.flightStates.delete(player.id);
      const initial = { position: player.position, heading: player.heading };
      this.displayTanks.set(player.id, initial);
      return initial;
    }

    const smoothing = 1 - Math.exp(-TANK_INTERPOLATION_SPEED * deltaSeconds);
    const headingDelta = Math.atan2(
      Math.sin(player.heading - current.heading),
      Math.cos(player.heading - current.heading)
    );
    const next: DisplayTank = {
      position: [
        current.position[0] + (player.position[0] - current.position[0]) * smoothing,
        current.position[1] + (player.position[1] - current.position[1]) * smoothing,
      ],
      heading: current.heading + headingDelta * smoothing,
    };
    this.displayTanks.set(player.id, next);
    return next;
  }

  private followLocalTank(tank: DisplayTank, deltaSeconds: number) {
    const targetCenter = offsetMeters(
      tank.position,
      Math.cos(tank.heading) * TANK_CAMERA_LOOK_AHEAD_METERS,
      Math.sin(tank.heading) * TANK_CAMERA_LOOK_AHEAD_METERS
    );
    const smoothing = 1 - Math.exp(-9 * deltaSeconds);
    const center: [number, number] = this.cameraCenter
      ? [
          this.cameraCenter[0] + (targetCenter[0] - this.cameraCenter[0]) * smoothing,
          this.cameraCenter[1] + (targetCenter[1] - this.cameraCenter[1]) * smoothing,
        ]
      : targetCenter;
    const targetBearing = ((90 - (tank.heading * 180) / Math.PI) % 360 + 360) % 360;
    const bearingDelta = this.cameraBearing == null
      ? 0
      : ((((targetBearing - this.cameraBearing) % 360) + 540) % 360) - 180;
    const bearing = this.cameraBearing == null
      ? targetBearing
      : ((this.cameraBearing + bearingDelta * smoothing) % 360 + 360) % 360;
    this.cameraCenter = center;
    this.cameraBearing = bearing;
    this.map.setCenterClampedToGround(true);
    this.map.jumpTo({
      center,
      zoom: TANK_CAMERA_ZOOM,
      pitch: TANK_CAMERA_PITCH,
      bearing,
    });
  }

  private updateHealthMarker(player: TankPlayer, altitudeAboveGround = 0) {
    const health = this.healthMarkers.get(player.id);
    if (!health) return;
    if (health.position[0] !== player.position[0] || health.position[1] !== player.position[1]) {
      health.position = player.position;
      health.marker.setLngLat(player.position);
    }
    const metersPerPixel =
      (156543.03392 * Math.cos(THREE.MathUtils.degToRad(player.position[1]))) /
      Math.pow(2, this.map.getZoom());
    health.bar.style.transform = `translateY(-${altitudeAboveGround / metersPerPixel}px)`;
    const healthRatio = THREE.MathUtils.clamp(player.hp / TANK_MAX_HP, 0, 1);
    health.element.style.display = healthRatio > 0 ? "block" : "none";
    health.fill.style.width = `${healthRatio * 100}%`;
    health.fill.style.backgroundColor = healthRatio > 0.6
      ? "#4ade80"
      : healthRatio > 0.3
        ? "#facc15"
        : "#fb7185";
  }

  private syncShots(players: TankPlayer[], now: number) {
    for (const player of players) {
      const seenSequence = this.lastShotSequence.get(player.id) ?? 0;
      if (!player.lastShot || player.shotSequence <= seenSequence) continue;
      this.lastShotSequence.set(player.id, player.shotSequence);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(PROJECTILE_RADIUS, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff1a8 })
      );
      mesh.visible = false;
      this.scene.add(mesh);
      const distance = distanceMeters(player.lastShot.from, player.lastShot.to);
      const group = this.groups.get(player.id);
      const terrainPitch = typeof group?.userData.terrainPitch === "number"
        ? group.userData.terrainPitch
        : 0;
      const launchAngle = THREE.MathUtils.clamp(
        PROJECTILE_BARREL_ANGLE + terrainPitch,
        PROJECTILE_MIN_ANGLE,
        PROJECTILE_MAX_ANGLE
      );
      const launchTerrainElevation = this.map.queryTerrainElevation(player.lastShot.from) ?? 0;
      const flight = this.flightStates.get(player.id);
      const airborneOffset = flight?.airborne
        ? flight.heightAboveGround
        : 0;
      this.shots.set(`${player.id}-${player.shotSequence}`, {
        mesh,
        from: player.lastShot.from,
        to: player.lastShot.to,
        fromElevation:
          launchTerrainElevation + PROJECTILE_MUZZLE_ELEVATION_METERS + airborneOffset,
        toElevation:
          (this.map.queryTerrainElevation(player.lastShot.to) ?? 0) +
          PROJECTILE_TARGET_ELEVATION_METERS,
        arcHeight: Math.max(
          PROJECTILE_MIN_ARC_METERS,
          (distance * Math.tan(launchAngle)) / 4
        ),
        durationMs: Math.max(420, (distance / PROJECTILE_SPEED_METERS_PER_SECOND) * 1_000),
        startedAt: now,
      });
    }
  }

  private updateTankFlight(player: TankPlayer, deltaSeconds: number) {
    const terrainElevation = this.map.queryTerrainElevation(player.position) ?? 0;
    const existing = this.flightStates.get(player.id);
    const authoritativeGround = player.groundAltitude ?? terrainElevation;
    const targetHeight = player.airborne && player.altitude != null
      ? THREE.MathUtils.clamp(
          player.altitude - authoritativeGround,
          0,
          TANK_MAX_AIR_HEIGHT_METERS
        )
      : 0;
    const smoothing = 1 - Math.exp(-TANK_ALTITUDE_INTERPOLATION_SPEED * deltaSeconds);
    const heightAboveGround = !existing || player.hp <= 0
      ? targetHeight
      : THREE.MathUtils.lerp(existing.heightAboveGround, targetHeight, smoothing);
    const next: TankFlightState = {
      airborne: player.airborne || heightAboveGround > 0.1,
      heightAboveGround,
      verticalVelocity: player.verticalVelocity,
      speed: Math.abs(player.airborne ? player.airborneSpeed : TANK_SPEED_METERS),
    };
    this.flightStates.set(player.id, next);
    return next;
  }

  private applyTerrainOrientation(
    group: THREE.Group,
    player: TankPlayer,
    flight: TankFlightState
  ) {
    const forwardEast = Math.cos(player.heading);
    const forwardNorth = Math.sin(player.heading);
    const rightEast = forwardNorth;
    const rightNorth = -forwardEast;
    const front = offsetMeters(
      player.position,
      forwardEast * TANK_LENGTH_SAMPLE_METERS,
      forwardNorth * TANK_LENGTH_SAMPLE_METERS
    );
    const back = offsetMeters(
      player.position,
      -forwardEast * TANK_LENGTH_SAMPLE_METERS,
      -forwardNorth * TANK_LENGTH_SAMPLE_METERS
    );
    const right = offsetMeters(
      player.position,
      rightEast * TANK_WIDTH_SAMPLE_METERS,
      rightNorth * TANK_WIDTH_SAMPLE_METERS
    );
    const left = offsetMeters(
      player.position,
      -rightEast * TANK_WIDTH_SAMPLE_METERS,
      -rightNorth * TANK_WIDTH_SAMPLE_METERS
    );
    const frontElevation = this.map.queryTerrainElevation(front);
    const backElevation = this.map.queryTerrainElevation(back);
    const rightElevation = this.map.queryTerrainElevation(right);
    const leftElevation = this.map.queryTerrainElevation(left);

    const terrainPitch = frontElevation == null || backElevation == null
      ? 0
      : THREE.MathUtils.clamp(
          Math.atan2(frontElevation - backElevation, TANK_LENGTH_SAMPLE_METERS * 2),
          -MAX_TERRAIN_TILT,
          MAX_TERRAIN_TILT
        );
    const terrainRoll = rightElevation == null || leftElevation == null
      ? 0
      : THREE.MathUtils.clamp(
          Math.atan2(rightElevation - leftElevation, TANK_WIDTH_SAMPLE_METERS * 2),
          -MAX_TERRAIN_TILT,
          MAX_TERRAIN_TILT
        );
    const targetPitch = flight.airborne
      ? THREE.MathUtils.clamp(
          Math.atan2(flight.verticalVelocity, Math.max(1, flight.speed)),
          -0.6,
          0.6
        )
      : terrainPitch;
    const targetRoll = flight.airborne ? 0 : terrainRoll;
    const previousPitch = typeof group.userData.terrainPitch === "number"
      ? group.userData.terrainPitch
      : targetPitch;
    const previousRoll = typeof group.userData.terrainRoll === "number"
      ? group.userData.terrainRoll
      : targetRoll;
    const pitch = THREE.MathUtils.lerp(previousPitch, targetPitch, TERRAIN_TILT_SMOOTHING);
    const roll = THREE.MathUtils.lerp(previousRoll, targetRoll, TERRAIN_TILT_SMOOTHING);
    group.userData.terrainPitch = pitch;
    group.userData.terrainRoll = roll;

    const yaw = player.heading - Math.PI / 2;
    group.quaternion
      .setFromAxisAngle(UP_AXIS, yaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(PITCH_AXIS, pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(ROLL_AXIS, roll));
  }

  render = (_gl: WebGLRenderingContext | WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) => {
    if (!this.renderer) return;
    const renderer = this.renderer;
    const players = this.playersRef.current;
    const now = performance.now();
    const deltaSeconds = Math.min(
      this.lastRenderTime == null ? 1 / 60 : (now - this.lastRenderTime) / 1_000,
      0.05
    );
    this.lastRenderTime = now;
    for (const player of players) if (!this.groups.has(player.id)) this.createTank(player);
    const playerIds = new Set(players.map((player) => player.id));
    for (const playerId of this.groups.keys()) {
      if (!playerIds.has(playerId)) this.removeTank(playerId);
    }
    this.groups.forEach((group) => { group.visible = false; });
    this.shots.forEach((shot) => { shot.mesh.visible = false; });
    const projection = new THREE.Matrix4().fromArray(Array.from(args.defaultProjectionData.mainMatrix));
    const scale = zoomToScale(this.map.getZoom());
    let localDisplayTank: DisplayTank | null = null;
    this.renderer.resetState();
    for (const player of players) {
      const displayTank = this.interpolateTank(player, deltaSeconds);
      const displayPlayer = {
        ...player,
        position: displayTank.position,
        heading: displayTank.heading,
      };
      const flight = this.updateTankFlight(displayPlayer, deltaSeconds);
      const groundAltitude =
        (this.map.queryTerrainElevation(displayPlayer.position) ?? 0) +
        TANK_MODEL_BASE_ELEVATION;
      const altitudeAboveGround = flight.heightAboveGround;
      this.updateHealthMarker(displayPlayer, altitudeAboveGround);
      if (player.hp <= 0) continue;
      const group = this.groups.get(player.id);
      if (!group) continue;
      group.visible = true;
      // The normalized GLB tank points down the layer's local -Z axis.
      this.applyTerrainOrientation(group, displayPlayer, flight);
      group.position.y = altitudeAboveGround;
      const modelMatrix = this.map.transform.getMatrixForModel(displayPlayer.position, groundAltitude);
      this.camera.projectionMatrix = projection
        .clone()
        .multiply(new THREE.Matrix4().fromArray(modelMatrix).scale(new THREE.Vector3(scale, scale, scale)));
      renderer.render(this.scene, this.camera);
      group.visible = false;
      if (player.id === this.localPeerId) localDisplayTank = displayTank;
    }

    this.syncShots(players, now);

    this.shots.forEach((shot, id) => {
      const progress = (now - shot.startedAt) / shot.durationMs;
      if (progress >= 1) {
        this.scene.remove(shot.mesh);
        shot.mesh.geometry.dispose();
        const materials = Array.isArray(shot.mesh.material) ? shot.mesh.material : [shot.mesh.material];
        materials.forEach((material) => material.dispose());
        this.shots.delete(id);
        return;
      }
      const arc = 4 * shot.arcHeight * progress * (1 - progress);
      const coordinate: [number, number] = [
        shot.from[0] + (shot.to[0] - shot.from[0]) * progress,
        shot.from[1] + (shot.to[1] - shot.from[1]) * progress,
      ];
      shot.mesh.visible = true;
      shot.mesh.rotation.x += 0.25;
      const elevation = THREE.MathUtils.lerp(
        shot.fromElevation,
        shot.toElevation,
        progress
      ) + arc;
      const modelMatrix = this.map.transform.getMatrixForModel(coordinate, elevation);
      this.camera.projectionMatrix = projection
        .clone()
        .multiply(new THREE.Matrix4().fromArray(modelMatrix).scale(new THREE.Vector3(scale, scale, scale)));
      renderer.render(this.scene, this.camera);
      shot.mesh.visible = false;
    });
    if (localDisplayTank) this.followLocalTank(localDisplayTank, deltaSeconds);
    this.map.triggerRepaint();
  };

  onRemove = () => {
    this.disposed = true;
    for (const playerId of [...this.groups.keys()]) this.removeTank(playerId);
    if (this.tankTemplate) disposeModelResources(this.tankTemplate);
    this.tankTemplate = null;
    if (this.shadowReceiver) {
      this.shadowReceiver.geometry.dispose();
      this.shadowReceiver.material.dispose();
      this.scene.remove(this.shadowReceiver);
      this.shadowReceiver = undefined;
    }
    this.renderer?.dispose();
    this.shots.forEach((shot) => {
      shot.mesh.geometry.dispose();
      const materials = Array.isArray(shot.mesh.material) ? shot.mesh.material : [shot.mesh.material];
      materials.forEach((material) => material.dispose());
    });
    this.shots.clear();
    this.lastShotSequence.clear();
    this.healthMarkers.clear();
    this.displayTanks.clear();
    this.groups.clear();
  };
}

const TankPvpLayer = ({ map, playersRef, localPeerId, visible }: TankPvpLayerProps) => {
  useEffect(() => {
    if (!map || !visible) return;
    const layer = new TankThreeLayer(playersRef, localPeerId);
    if (!map.getLayer(layer.id)) map.addLayer(layer);
    return () => {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    };
  }, [map, playersRef, localPeerId, visible]);
  return null;
};

export default TankPvpLayer;
