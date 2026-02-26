import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type ModelChaseViewProps = {
  coordinatesRef: React.MutableRefObject<[number, number] | null>;
  headingRef?: React.MutableRefObject<number | null>;
  pitchRef?: React.MutableRefObject<number | null>;
  modelPath: string;
  headingOffset?: number;
  pitchOffset?: number;
};

const metersPerDegreeLat = 110540;
const metersPerDegreeLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

const ModelChaseView = ({
  coordinatesRef,
  headingRef,
  pitchRef,
  modelPath,
  headingOffset = 0,
  pitchOffset = 0,
}: ModelChaseViewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const originRef = useRef<[number, number] | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !modelPath) return;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio || 1);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121518);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(0, 8, 16);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(40, 60, 80);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-30, 20, -40);
    scene.add(ambientLight, keyLight, fillLight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.9, metalness: 0.1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    scene.add(ground);

    let model: THREE.Object3D | null = null;
    const loader = new GLTFLoader();
    loader.load(modelPath, (gltf) => {
      model = gltf.scene;
      model.scale.set(1, 1, 1);
      model.rotation.set(0, Math.PI / -2, 0);
      scene.add(model);
    });

    const resize = () => {
      if (!canvasRef.current) return;
      const { clientWidth, clientHeight } = canvasRef.current;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };

    const update = () => {
      resize();

      const coord = coordinatesRef.current;
      if (coord && model) {
        if (!originRef.current) originRef.current = coord;
        const [lng0, lat0] = originRef.current;
        const dx = (coord[0] - lng0) * metersPerDegreeLng(lat0);
        const dz = (coord[1] - lat0) * metersPerDegreeLat;

        model.position.set(dx, 0, -dz);
        const yaw = (headingRef?.current ?? 0) + headingOffset;
        const pitch = (pitchRef?.current ?? 0) + pitchOffset;
        model.rotation.set(pitch, yaw, 0);

        const followDistance = 18;
        const followHeight = 10;
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const cameraPos = new THREE.Vector3()
          .copy(model.position)
          .add(new THREE.Vector3(0, followHeight, 0))
          .add(forward.multiplyScalar(-followDistance));

        camera.position.lerp(cameraPos, 0.15);
        camera.lookAt(model.position);
      }

      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(update);
    };

    frameRef.current = requestAnimationFrame(update);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      renderer.dispose();
    };
  }, [coordinatesRef, headingRef, pitchRef, modelPath, headingOffset, pitchOffset]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-xl"
    />
  );
};

export default ModelChaseView;
