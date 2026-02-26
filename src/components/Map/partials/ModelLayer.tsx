import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ModelLayerProps = {
  map?: maplibregl.Map | null;
  coordinates?: [number, number];
  modelPath?: string;
  layerId?: string;
  coordinatesRef?: React.MutableRefObject<[number, number] | null>;
  elevationOffset?: number;
  headingRef?: React.MutableRefObject<number | null>;
  headingOffset?: number;
  pitchRef?: React.MutableRefObject<number | null>;
  pitchOffset?: number;
  onRenderFrame?: (frame: {
    map: maplibregl.Map;
    coordinate: [number, number];
    heading: number | null;
    pitch: number | null;
    deltaMs: number;
  }) => void;
};

function zoomToScale(zoom: number) {
  return Math.max(10, Math.pow(2, 20 - zoom));
}

const ModelLayer = ({
  map = null,
  coordinates = [123.685, 10.35],
  modelPath = "",
  layerId,
  coordinatesRef,
  elevationOffset = 7,
  headingRef,
  headingOffset = 0,
  pitchRef,
  pitchOffset = 0,
  onRenderFrame,
}: ModelLayerProps) => {
  const modelScaleRef = useRef(10);
  const coordRef = useRef<[number, number]>(coordinates);

  useEffect(() => {
    coordRef.current = coordinates;
    if (map) map.triggerRepaint();
  }, [coordinates, map]);

  useEffect(() => {
    if (!map || !modelPath) return;

    const resolvedLayerId = layerId || `3d-model-${modelPath}`;

    const handleZoom = () => {
      modelScaleRef.current = zoomToScale(map.getZoom());
      map.triggerRepaint();
    };

    class ThreeModelLayer implements maplibregl.CustomLayerInterface {
      id = resolvedLayerId;
      type: "custom" = "custom";
      renderingMode: "3d" = "3d";

      private map!: maplibregl.Map;
      private scene = new THREE.Scene();
      private camera = new THREE.Camera();
      private renderer?: THREE.WebGLRenderer;
      private model?: THREE.Object3D;
      private modelLoaded = false;
      private lastRenderTime: number | null = null;

      onAdd = (
        mapInstance: maplibregl.Map,
        gl: WebGLRenderingContext | WebGL2RenderingContext
      ) => {
        this.map = mapInstance;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(100, 100, 200).normalize();
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight.position.set(-100, -50, 100).normalize();
        this.scene.add(ambientLight, directionalLight, fillLight);

        const loader = new GLTFLoader();
        loader.load(modelPath, (gltf) => {
          this.model = gltf.scene;
          this.model.rotation.set(0, Math.PI / -2, 0);
          this.model.scale.set(1, 1, 1);
          this.scene.add(this.model);
          this.modelLoaded = true;

          if (this.map.getLayer("building")) {
            this.map.moveLayer(resolvedLayerId, "building");
          }
          this.map.triggerRepaint();
        });

        this.renderer = new THREE.WebGLRenderer({
          canvas: mapInstance.getCanvas(),
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
      };

      render = (
        _gl: WebGLRenderingContext | WebGL2RenderingContext,
        args: maplibregl.CustomRenderMethodInput
      ) => {
        if (!this.renderer || !this.model || !this.modelLoaded) return;

        const renderCoord = coordinatesRef?.current ?? coordRef.current;
        const terrainElevation =
          this.map.queryTerrainElevation?.(renderCoord) ?? 0;
        const modelAltitude = terrainElevation + elevationOffset;
        const modelMatrix = this.map.transform.getMatrixForModel(
          renderCoord,
          modelAltitude
        );
        const projectionMatrix = new THREE.Matrix4().fromArray(
          Array.from(args.defaultProjectionData.mainMatrix)
        );
        const transformMatrix = new THREE.Matrix4()
          .fromArray(modelMatrix)
          .scale(
            new THREE.Vector3(
              modelScaleRef.current,
              modelScaleRef.current,
              modelScaleRef.current
            )
          );

        const heading = headingRef?.current ?? null;
        const pitch = pitchRef?.current ?? null;
        if (heading != null || pitch != null) {
          const yaw = (heading ?? 0) + headingOffset;
          const tilt = (pitch ?? 0) + pitchOffset;
          this.model.rotation.set(tilt, yaw, 0);
        }

        if (onRenderFrame) {
          const now = performance.now();
          const deltaMs = this.lastRenderTime == null ? 16 : now - this.lastRenderTime;
          this.lastRenderTime = now;
          onRenderFrame({
            map: this.map,
            coordinate: renderCoord,
            heading,
            pitch,
            deltaMs,
          });
        }

        this.camera.projectionMatrix = projectionMatrix.multiply(transformMatrix);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
      };

      onRemove = () => {
        this.renderer?.dispose();
      };
    }

    handleZoom();
    map.on("zoom", handleZoom);

    if (!map.getLayer(resolvedLayerId)) {
      map.addLayer(new ThreeModelLayer());
    }

    return () => {
      map.off("zoom", handleZoom);
      if (map.getLayer(resolvedLayerId)) {
        map.removeLayer(resolvedLayerId);
      }
    };
  }, [map, modelPath, layerId, onRenderFrame]);

  return null;
};

export default ModelLayer;
