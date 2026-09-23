import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { SelectedPoint } from "../api/types";
import type { ParsedPointCloud } from "../features/pointcloud/pointcloud-protocol";
import { stableLod } from "../features/pointcloud/pointcloud-protocol";

export interface PointCloudSceneOptions {
  background?: "dark" | "light";
  pointSize?: number;
  maxPreviewPoints?: number;
}

export interface PointCloudSceneHandle {
  setPoints: (data: ParsedPointCloud) => void;
  resetView: () => void;
  pick: (clientX: number, clientY: number) => SelectedPoint | null;
  capturePng: () => string;
  dispose: () => void;
}

export function createPointCloudScene(
  canvas: HTMLCanvasElement,
  options: PointCloudSceneOptions = {},
): PointCloudSceneHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(
    options.background === "light" ? 0xf3f6f5 : 0x122532,
  );
  const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10_000);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.02 };
  const pointer = new THREE.Vector2();
  let points: THREE.Points | null = null;
  let parsed: ParsedPointCloud | null = null;
  let disposed = false;

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth || canvas.width || 640);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 420);
    if (canvas.width !== width || canvas.height !== height)
      renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const disposePoints = (): void => {
    if (points === null) return;
    scene.remove(points);
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
    points = null;
  };

  const resetView = (): void => {
    if (points === null) return;
    points.geometry.computeBoundingBox();
    const bounds = points.geometry.boundingBox;
    if (bounds === null) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 0.1);
    controls.target.copy(center);
    camera.position.set(center.x, center.y, center.z + size * 1.5);
    camera.near = Math.max(size / 10_000, 0.0001);
    camera.far = Math.max(size * 100, 10);
    camera.updateProjectionMatrix();
    controls.update();
  };

  const setPoints = (data: ParsedPointCloud): void => {
    disposePoints();
    parsed = data;
    const lod = stableLod(
      data.manifest.point_count,
      options.maxPreviewPoints ?? 250_000,
    );
    const positions = new Float32Array(lod.length * 3);
    const colors = new Uint8Array(lod.length * 3);
    const sourceIndices = new Uint32Array(lod.length);
    for (let index = 0; index < lod.length; index += 1) {
      const source = lod[index];
      positions[index * 3] = data.positions[source * 3];
      positions[index * 3 + 1] = -data.positions[source * 3 + 1];
      positions[index * 3 + 2] = -data.positions[source * 3 + 2];
      colors.set(data.colors.subarray(source * 3, source * 3 + 3), index * 3);
      sourceIndices[index] = source;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3, true));
    geometry.setAttribute(
      "sourceIndex",
      new THREE.BufferAttribute(sourceIndices, 1),
    );
    const material = new THREE.PointsMaterial({
      size: options.pointSize ?? 0.012,
      sizeAttenuation: true,
      vertexColors: true,
    });
    points = new THREE.Points(geometry, material);
    scene.add(points);
    resetView();
  };

  const pick = (clientX: number, clientY: number): SelectedPoint | null => {
    if (points === null || parsed === null) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(points, false)[0];
    if (hit?.index === undefined) return null;
    const source = (
      points.geometry.getAttribute("sourceIndex") as THREE.BufferAttribute
    ).getX(hit.index);
    return {
      pixelIndex: parsed.pixelIndex[source],
      position: [
        parsed.positions[source * 3],
        parsed.positions[source * 3 + 1],
        parsed.positions[source * 3 + 2],
      ],
      unit: parsed.manifest.unit,
    };
  };

  renderer.setAnimationLoop(() => {
    if (disposed) return;
    resize();
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setPoints,
    resetView,
    pick,
    capturePng: () => canvas.toDataURL("image/png"),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      disposePoints();
      controls.dispose();
      renderer.dispose();
    },
  };
}
