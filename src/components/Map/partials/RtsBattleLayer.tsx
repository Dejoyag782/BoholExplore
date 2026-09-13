import { useEffect } from "react";
import maplibregl from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { UnitState } from "../../../game/rts";

type RtsBattleLayerProps = {
  map?: maplibregl.Map | null;
  unitsRef: React.MutableRefObject<UnitState[]>;
  selectedIdsRef: React.MutableRefObject<Set<string>>;
  visible: boolean;
};

const zoomToScale = (zoom: number) => Math.max(10, Math.pow(2, 20 - zoom));

class RtsThreeLayer implements maplibregl.CustomLayerInterface {
  readonly id = "rts-battle-models";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private map!: maplibregl.Map;
  private renderer?: THREE.WebGLRenderer;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private template?: THREE.Object3D;
  private groups = new Map<string, THREE.Group>();
  private shadowReceiver?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private unitsRef: React.MutableRefObject<UnitState[]>;
  private selectedIdsRef: React.MutableRefObject<Set<string>>;

  constructor(
    unitsRef: React.MutableRefObject<UnitState[]>,
    selectedIdsRef: React.MutableRefObject<Set<string>>
  ) {
    this.unitsRef = unitsRef;
    this.selectedIdsRef = selectedIdsRef;
  }

  onAdd = (
    map: maplibregl.Map,
    gl: WebGLRenderingContext | WebGL2RenderingContext
  ) => {
    this.map = map;

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x475569, 1.5);
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2);
    sun.position.set(60, 100, 45);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 250;
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -35;
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.04;
    this.scene.add(hemisphere, ambient, sun);

    this.shadowReceiver = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.ShadowMaterial({ color: 0x030509, opacity: 0.38, depthWrite: false })
    );
    this.shadowReceiver.rotation.x = -Math.PI / 2;
    this.shadowReceiver.position.y = -0.05;
    this.shadowReceiver.receiveShadow = true;
    this.scene.add(this.shadowReceiver);

    new GLTFLoader().load("/models/orc_rammer.glb", (gltf) => {
      this.template = gltf.scene;
      this.map.triggerRepaint();
    });

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  };

  private createGroup(unit: UnitState) {
    if (!this.template) return;
    const group = new THREE.Group();
    const model = cloneSkeleton(this.template);
    const tint = new THREE.Color(unit.team === "player" ? 0x79c7ff : 0xff766c);

    model.rotation.y = -Math.PI / 2;
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => material.clone());
      } else {
        object.material = object.material.clone();
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) material.color.lerp(tint, 0.28);
      });
    });

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 2.25, 40),
      new THREE.MeshBasicMaterial({
        color: unit.team === "player" ? 0x22d3ee : 0xfb7185,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.name = "selection-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(model, ring);
    this.groups.set(unit.id, group);
    this.scene.add(group);
  }

  render = (
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    args: maplibregl.CustomRenderMethodInput
  ) => {
    if (!this.renderer || !this.template) return;

    for (const unit of this.unitsRef.current) {
      if (!this.groups.has(unit.id)) this.createGroup(unit);
    }
    this.groups.forEach((group) => {
      group.visible = false;
    });

    const projection = new THREE.Matrix4().fromArray(
      Array.from(args.defaultProjectionData.mainMatrix)
    );
    const scale = zoomToScale(this.map.getZoom());
    this.renderer.resetState();

    for (const unit of this.unitsRef.current) {
      if (!unit.alive) continue;
      const group = this.groups.get(unit.id);
      if (!group) continue;
      group.visible = true;
      group.rotation.y = unit.heading;
      const ring = group.getObjectByName("selection-ring");
      if (ring) ring.visible = unit.team === "enemy" || this.selectedIdsRef.current.has(unit.id);

      const elevation = (this.map.queryTerrainElevation(unit.position) ?? 0) + 7;
      const modelMatrix = this.map.transform.getMatrixForModel(unit.position, elevation);
      const transform = new THREE.Matrix4()
        .fromArray(modelMatrix)
        .scale(new THREE.Vector3(scale, scale, scale));
      this.camera.projectionMatrix = projection.clone().multiply(transform);
      this.renderer.render(this.scene, this.camera);
      group.visible = false;
    }
  };

  onRemove = () => {
    this.groups.forEach((group) => {
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    });
    this.shadowReceiver?.geometry.dispose();
    this.shadowReceiver?.material.dispose();
    this.renderer?.dispose();
    this.groups.clear();
  };
}

const RtsBattleLayer = ({ map, unitsRef, selectedIdsRef, visible }: RtsBattleLayerProps) => {
  useEffect(() => {
    if (!map || !visible) return;
    const layer = new RtsThreeLayer(unitsRef, selectedIdsRef);
    if (!map.getLayer(layer.id)) map.addLayer(layer);
    return () => {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    };
  }, [map, selectedIdsRef, unitsRef, visible]);

  useEffect(() => {
    if (visible) map?.triggerRepaint();
  }, [map, visible]);

  return null;
};

export default RtsBattleLayer;
