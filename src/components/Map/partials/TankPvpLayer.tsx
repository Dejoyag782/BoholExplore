import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import * as THREE from "three";
import type { TankPlayer } from "../../../game/tankPvp";

type TankPvpLayerProps = {
  map?: maplibregl.Map | null;
  playersRef: React.MutableRefObject<TankPlayer[]>;
  visible: boolean;
};

type ActiveShot = {
  mesh: THREE.Mesh;
  from: [number, number];
  to: [number, number];
  startedAt: number;
};

const zoomToScale = (zoom: number) => Math.max(8, Math.pow(2, 20 - zoom));

class TankThreeLayer implements maplibregl.CustomLayerInterface {
  readonly id = "tank-pvp-models";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;
  private map!: maplibregl.Map;
  private renderer?: THREE.WebGLRenderer;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private groups = new Map<string, THREE.Group>();
  private shots = new Map<string, ActiveShot>();
  private lastShotSequence = new Map<string, number>();
  private playersRef: React.MutableRefObject<TankPlayer[]>;

  constructor(playersRef: React.MutableRefObject<TankPlayer[]>) {
    this.playersRef = playersRef;
  }

  onAdd = (map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) => {
    this.map = map;
    this.scene.add(
      new THREE.HemisphereLight(0xffffff, 0x334155, 2),
      new THREE.AmbientLight(0xffffff, 1.2)
    );
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  };

  private createTank(player: TankPlayer) {
    const group = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.65, metalness: 0.35 });
    const tracks = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.15, 5.2), armor);
    body.position.y = 1;
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.5, 0.8, 8), armor.clone());
    turret.position.y = 1.9;
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 4.4), armor.clone());
    barrel.position.set(0, 2, -2.5);
    const leftTrack = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.8, 5.6), tracks);
    const rightTrack = leftTrack.clone();
    leftTrack.position.set(-2, 0.72, 0);
    rightTrack.position.set(2, 0.72, 0);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.8, 3.15, 40),
      new THREE.MeshBasicMaterial({ color: player.color, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(body, turret, barrel, leftTrack, rightTrack, ring);
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
    this.groups.set(player.id, group);
    this.scene.add(group);
  }

  private syncShots(players: TankPlayer[], now: number) {
    for (const player of players) {
      const seenSequence = this.lastShotSequence.get(player.id) ?? 0;
      if (!player.lastShot || player.shotSequence <= seenSequence) continue;
      this.lastShotSequence.set(player.id, player.shotSequence);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff1a8 })
      );
      mesh.scale.set(1, 1, 2.8);
      this.scene.add(mesh);
      this.shots.set(`${player.id}-${player.shotSequence}`, {
        mesh,
        from: player.lastShot.from,
        to: player.lastShot.to,
        startedAt: now,
      });
    }
  }

  render = (_gl: WebGLRenderingContext | WebGL2RenderingContext, args: maplibregl.CustomRenderMethodInput) => {
    if (!this.renderer) return;
    const renderer = this.renderer;
    const players = this.playersRef.current;
    const now = performance.now();
    for (const player of players) if (!this.groups.has(player.id)) this.createTank(player);
    this.syncShots(players, now);
    this.groups.forEach((group) => { group.visible = false; });
    this.shots.forEach((shot) => { shot.mesh.visible = false; });
    const projection = new THREE.Matrix4().fromArray(Array.from(args.defaultProjectionData.mainMatrix));
    const scale = zoomToScale(this.map.getZoom());
    this.renderer.resetState();
    for (const player of players) {
      if (player.hp <= 0) continue;
      const group = this.groups.get(player.id);
      if (!group) continue;
      group.visible = true;
      group.rotation.y = player.heading + Math.PI / 2;
      const elevation = (this.map.queryTerrainElevation(player.position) ?? 0) + 5;
      const modelMatrix = this.map.transform.getMatrixForModel(player.position, elevation);
      this.camera.projectionMatrix = projection
        .clone()
        .multiply(new THREE.Matrix4().fromArray(modelMatrix).scale(new THREE.Vector3(scale, scale, scale)));
      renderer.render(this.scene, this.camera);
      group.visible = false;
    }

    this.shots.forEach((shot, id) => {
      const progress = (now - shot.startedAt) / 360;
      if (progress >= 1) {
        this.scene.remove(shot.mesh);
        shot.mesh.geometry.dispose();
        const materials = Array.isArray(shot.mesh.material) ? shot.mesh.material : [shot.mesh.material];
        materials.forEach((material) => material.dispose());
        this.shots.delete(id);
        return;
      }
      const arc = Math.sin(progress * Math.PI) * 8;
      const coordinate: [number, number] = [
        shot.from[0] + (shot.to[0] - shot.from[0]) * progress,
        shot.from[1] + (shot.to[1] - shot.from[1]) * progress,
      ];
      shot.mesh.visible = true;
      shot.mesh.rotation.x += 0.25;
      const elevation = (this.map.queryTerrainElevation(coordinate) ?? 0) + 8 + arc;
      const modelMatrix = this.map.transform.getMatrixForModel(coordinate, elevation);
      this.camera.projectionMatrix = projection
        .clone()
        .multiply(new THREE.Matrix4().fromArray(modelMatrix).scale(new THREE.Vector3(scale, scale, scale)));
      renderer.render(this.scene, this.camera);
      shot.mesh.visible = false;
    });
    this.map.triggerRepaint();
  };

  onRemove = () => {
    this.groups.forEach((group) => group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }));
    this.renderer?.dispose();
    this.shots.forEach((shot) => {
      shot.mesh.geometry.dispose();
      const materials = Array.isArray(shot.mesh.material) ? shot.mesh.material : [shot.mesh.material];
      materials.forEach((material) => material.dispose());
    });
    this.shots.clear();
    this.lastShotSequence.clear();
    this.groups.clear();
  };
}

const TankPvpLayer = ({ map, playersRef, visible }: TankPvpLayerProps) => {
  useEffect(() => {
    if (!map || !visible) return;
    const layer = new TankThreeLayer(playersRef);
    if (!map.getLayer(layer.id)) map.addLayer(layer);
    return () => {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    };
  }, [map, playersRef, visible]);
  return null;
};

export default TankPvpLayer;
