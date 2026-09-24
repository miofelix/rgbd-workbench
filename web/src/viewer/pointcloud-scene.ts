import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { SelectedPoint, ViewSpec } from "../api/types";
import type { ParsedPointCloud } from "../features/pointcloud/pointcloud-protocol";
import { stableLod } from "../features/pointcloud/pointcloud-protocol";

export interface PointCloudSceneOptions {
  background?: "dark" | "light";
  pointSize?: number;
  maxPreviewPoints?: number;
}

export interface PointCloudSceneHandle {
  setPoints: (data: ParsedPointCloud) => void;
  setSelectedPoints: (points: readonly SelectedPoint[]) => void;
  setViewSpec: (view: ViewSpec) => void;
  resetView: () => void;
  pick: (clientX: number, clientY: number) => SelectedPoint | null;
  selectPixel: (pixelIndex: number) => SelectedPoint | null;
  capturePng: () => string;
  dispose: () => void;
}

export function setNormalizedColorBytes(
  attribute: THREE.BufferAttribute,
  index: number,
  color: [number, number, number],
): void {
  attribute.setXYZ(index, color[0] / 255, color[1] / 255, color[2] / 255);
}

export function selectedPointForPixel(
  data: ParsedPointCloud,
  pixelIndex: number,
): SelectedPoint | null {
  const [height, width] = data.manifest.source_shape;
  if (
    !Number.isSafeInteger(pixelIndex) ||
    pixelIndex < 0 ||
    pixelIndex >= width * height
  ) {
    return null;
  }
  const targetX = pixelIndex % width;
  const targetY = Math.floor(pixelIndex / width);
  let bestSource = -1;
  let bestPixel = Number.MAX_SAFE_INTEGER;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let source = 0; source < data.pixelIndex.length; source += 1) {
    const representative = data.pixelIndex[source];
    if (representative >= width * height) continue;
    const x = representative % width;
    const y = Math.floor(representative / width);
    const distance = (x - targetX) ** 2 + (y - targetY) ** 2;
    if (
      distance < bestDistance ||
      (distance === bestDistance && representative < bestPixel)
    ) {
      bestSource = source;
      bestPixel = representative;
      bestDistance = distance;
    }
  }
  if (bestSource < 0) return null;
  return {
    pixelIndex: bestPixel,
    position: [
      data.positions[bestSource * 3],
      data.positions[bestSource * 3 + 1],
      data.positions[bestSource * 3 + 2],
    ],
    unit: data.manifest.unit,
  };
}

export function createPointCloudScene(
  canvas: HTMLCanvasElement,
  options: PointCloudSceneOptions = {},
): PointCloudSceneHandle {
  const scene = new THREE.Scene();
  const perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.001, 10_000);
  const orthographicCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0.001,
    10_000,
  );
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera =
    perspectiveCamera;
  let viewSpec: ViewSpec = {
    projection: "perspective",
    colorMode: "rgb",
    pointSize: options.pointSize ?? 2,
    background: options.background ?? "dark",
  };
  let orthographicExtent = 1;
  scene.background = new THREE.Color(
    viewSpec.background === "light" ? 0xf3f6f5 : 0x122532,
  );
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
  let selectionPoints: THREE.Points | null = null;
  let parsed: ParsedPointCloud | null = null;
  let selectedPoints: readonly SelectedPoint[] = [];
  let disposed = false;

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth || canvas.width || 640);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 420);
    if (canvas.width !== width || canvas.height !== height)
      renderer.setSize(width, height, false);
    const aspect = width / height;
    perspectiveCamera.aspect = aspect;
    perspectiveCamera.updateProjectionMatrix();
    orthographicCamera.left = -orthographicExtent * aspect;
    orthographicCamera.right = orthographicExtent * aspect;
    orthographicCamera.top = orthographicExtent;
    orthographicCamera.bottom = -orthographicExtent;
    orthographicCamera.updateProjectionMatrix();
  };

  const disposeSelectionPoints = (): void => {
    if (selectionPoints === null) return;
    scene.remove(selectionPoints);
    selectionPoints.geometry.dispose();
    (selectionPoints.material as THREE.Material).dispose();
    selectionPoints = null;
  };

  const updateSelectionPoints = (): void => {
    disposeSelectionPoints();
    if (parsed === null || selectedPoints.length === 0) return;
    const positions: number[] = [];
    const colors: number[] = [];
    const selectionColors = [
      [1, 0.72, 0.12],
      [0.18, 0.85, 1],
    ];
    selectedPoints.slice(0, 2).forEach((selected, selectionIndex) => {
      const source = parsed?.pixelIndex.indexOf(selected.pixelIndex) ?? -1;
      if (source < 0 || parsed === null) return;
      positions.push(
        parsed.positions[source * 3],
        -parsed.positions[source * 3 + 1],
        -parsed.positions[source * 3 + 2],
      );
      colors.push(...selectionColors[selectionIndex]);
    });
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(colors), 3),
    );
    const material = new THREE.PointsMaterial({
      size: 10,
      sizeAttenuation: false,
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
    });
    selectionPoints = new THREE.Points(geometry, material);
    selectionPoints.renderOrder = 10;
    scene.add(selectionPoints);
  };

  const disposePoints = (): void => {
    disposeSelectionPoints();
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
    orthographicExtent = size * 0.65;
    controls.target.copy(center);
    for (const viewCamera of [perspectiveCamera, orthographicCamera]) {
      viewCamera.position.set(center.x, center.y, center.z + size * 1.5);
      viewCamera.near = Math.max(size / 10_000, 0.0001);
      viewCamera.far = Math.max(size * 100, 10);
      viewCamera.updateProjectionMatrix();
    }
    resize();
    controls.update();
  };

  const depthColor = (value: number): [number, number, number] => {
    const stops: Array<[number, number, number]> = [
      [49, 54, 149],
      [18, 126, 184],
      [70, 173, 109],
      [253, 174, 50],
      [165, 0, 38],
    ];
    const scaled = Math.min(1, Math.max(0, value)) * (stops.length - 1);
    const lower = Math.min(stops.length - 2, Math.floor(scaled));
    const mix = scaled - lower;
    return stops[lower].map((channel, index) =>
      Math.round(channel + (stops[lower + 1][index] - channel) * mix),
    ) as [number, number, number];
  };

  const updatePointStyle = (): void => {
    scene.background = new THREE.Color(
      viewSpec.background === "light" ? 0xf3f6f5 : 0x122532,
    );
    if (points === null || parsed === null) return;
    const material = points.material as THREE.PointsMaterial;
    material.size = viewSpec.pointSize * 0.006;
    material.needsUpdate = true;
    const colors = points.geometry.getAttribute(
      "color",
    ) as THREE.BufferAttribute;
    const sourceIndices = points.geometry.getAttribute(
      "sourceIndex",
    ) as THREE.BufferAttribute;
    const depthMin = parsed.manifest.bounds.min[2];
    const depthSpan = Math.max(
      parsed.manifest.bounds.max[2] - depthMin,
      Number.EPSILON,
    );
    for (let index = 0; index < sourceIndices.count; index += 1) {
      const source = sourceIndices.getX(index);
      let color: [number, number, number];
      if (viewSpec.colorMode === "rgb") {
        color = [
          parsed.colors[source * 3],
          parsed.colors[source * 3 + 1],
          parsed.colors[source * 3 + 2],
        ];
      } else if (viewSpec.colorMode === "depth") {
        color = depthColor(
          (parsed.positions[source * 3 + 2] - depthMin) / depthSpan,
        );
      } else if (viewSpec.colorMode === "validity") {
        color = [70, 190, 164];
      } else {
        color = [205, 214, 216];
      }
      setNormalizedColorBytes(colors, index, color);
    }
    colors.needsUpdate = true;
  };

  const setViewSpec = (next: ViewSpec): void => {
    const projectionChanged = next.projection !== viewSpec.projection;
    viewSpec = next;
    camera =
      next.projection === "orthographic"
        ? orthographicCamera
        : perspectiveCamera;
    controls.object = camera;
    updatePointStyle();
    if (projectionChanged && points !== null) resetView();
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
    updatePointStyle();
    updateSelectionPoints();
    resetView();
  };

  const setSelectedPoints = (next: readonly SelectedPoint[]): void => {
    selectedPoints = [...next];
    updateSelectionPoints();
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
    setSelectedPoints,
    setViewSpec,
    resetView,
    pick,
    selectPixel: (pixelIndex) =>
      parsed === null ? null : selectedPointForPixel(parsed, pixelIndex),
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
