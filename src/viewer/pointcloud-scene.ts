import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PointCloudBuffer } from "@/domain/derivation";
import { stableLod } from "@/domain/pointcloud-protocol";
import { sampleCameraPath, medianTarget } from "@/compute/trajectory/path";
import type { CameraPath } from "@/domain/trajectory";
import { sampleColorMap } from "@/compute/render/color-map";
import type { SelectedPoint, ViewSpec } from "./types";

export interface ViewerCameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  projection: "perspective" | "orthographic";
  fov: number;
  orthoScale: number;
}
export interface PointCloudScene {
  setView(view: ViewSpec): void;
  setSelection(points: readonly SelectedPoint[]): void;
  setTrajectory(path: CameraPath | null, frame: number, fps: number): void;
  capturePng(): Promise<Blob>;
  cameraSnapshot(): ViewerCameraSnapshot;
  selectPixel(pixelIndex: number): SelectedPoint | null;
  dispose(): void;
}
export function selectedPointForPixel(
  data: PointCloudBuffer,
  pixelIndex: number,
): SelectedPoint | null {
  const [height, width] = data.manifest.sourceShape;
  if (!Number.isSafeInteger(pixelIndex) || pixelIndex < 0 || pixelIndex >= width * height)
    return null;
  let best = -1;
  let bestDistance = Infinity;
  let bestPixel = Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < data.manifest.pointCount; i += 1) {
    const pixel = data.sourcePixelIndex[i]!;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const distance = (x - (pixelIndex % width)) ** 2 + (y - Math.floor(pixelIndex / width)) ** 2;
    if (distance < bestDistance || (distance === bestDistance && pixel < bestPixel)) {
      best = i;
      bestDistance = distance;
      bestPixel = pixel;
    }
  }
  return best < 0
    ? null
    : {
        pixelIndex: bestPixel,
        position: [
          data.positions[best * 3]!,
          data.positions[best * 3 + 1]!,
          data.positions[best * 3 + 2]!,
        ],
        unit: data.manifest.unit,
      };
}
export function createPointCloudScene(
  canvas: HTMLCanvasElement,
  data: PointCloudBuffer,
  onSelect: (point: SelectedPoint) => void,
  initialView: ViewSpec,
): PointCloudScene {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const perspective = new THREE.PerspectiveCamera(45, 1, 0.001, 10000);
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 10000);
  let camera: THREE.Camera = perspective;
  const controls = new OrbitControls(perspective, canvas);
  controls.enableDamping = true;
  const target = medianTarget(data.positions);
  const diagonal = Math.hypot(
    ...data.manifest.bounds.max.map((v, i) => v - data.manifest.bounds.min[i]!),
  );
  const distance = Math.max(diagonal * 1.5, 0.1);
  const defaultPosition = new THREE.Vector3(
    target[0],
    -(target[1] - diagonal * 0.2),
    -(target[2] + distance),
  );
  perspective.position.copy(defaultPosition);
  controls.target.set(target[0], -target[1], -target[2]);
  orthographic.position.copy(defaultPosition);
  const lod = stableLod(data.manifest.pointCount);
  const positions = new Float32Array(lod.length * 3);
  const colors = new Uint8Array(lod.length * 3);
  lod.forEach((source, index) => {
    for (let c = 0; c < 3; c += 1) {
      positions[index * 3 + c] = data.positions[source * 3 + c]! * (c === 0 ? 1 : -1);
      colors[index * 3 + c] = data.colors[source * 3 + c]!;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colorAttribute = new THREE.BufferAttribute(colors, 3, true);
  geometry.setAttribute("color", colorAttribute);
  const material = new THREE.PointsMaterial({
    size: initialView.pointSize,
    sizeAttenuation: false,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  const selectionGeometry = new THREE.BufferGeometry();
  const selectionMaterial = new THREE.PointsMaterial({
    color: 0xffc94a,
    size: 8,
    sizeAttenuation: false,
  });
  const selection = new THREE.Points(selectionGeometry, selectionMaterial);
  scene.add(selection);
  const pathMaterial = new THREE.LineBasicMaterial({ color: 0x73dac5 });
  let pathLine: THREE.Line | null = null;
  let keyframeMarkers: THREE.Points | null = null;
  const frustum = new THREE.CameraHelper(perspective);
  frustum.visible = false;
  scene.add(frustum);
  let disposed = false;
  let animationFrame = 0;
  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    perspective.aspect = width / height;
    perspective.updateProjectionMatrix();
    const extent = Math.max(diagonal / 2, 0.1);
    orthographic.left = (-extent * width) / height;
    orthographic.right = (extent * width) / height;
    orthographic.top = extent;
    orthographic.bottom = -extent;
    orthographic.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: Math.max(diagonal * 0.015, 0.005) };
  const pointer = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster.intersectObject(points, false)[0];
    if (hit?.index !== undefined) {
      const pixel = data.sourcePixelIndex[lod[hit.index]!]!;
      const selected = selectedPointForPixel(data, pixel);
      if (selected) onSelect(selected);
    }
  };
  canvas.addEventListener("pointerup", pointer);
  const animate = (): void => {
    if (disposed) return;
    animationFrame = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
  return {
    setView(next) {
      material.size = next.pointSize;
      scene.background = new THREE.Color(next.background === "light" ? 0xf1f4f3 : 0x122532);
      camera = next.projection === "perspective" ? perspective : orthographic;
      const zMin = data.manifest.bounds.min[2];
      const span = Math.max(1e-9, data.manifest.bounds.max[2] - zMin);
      lod.forEach((source, index) => {
        const color: [number, number, number] =
          next.colorMode === "depth"
            ? sampleColorMap(next.colorMap, (data.positions[source * 3 + 2]! - zMin) / span)
            : next.colorMode === "mono"
              ? [125, 207, 192]
              : next.colorMode === "validity"
                ? [112, 196, 151]
                : [
                    data.colors[source * 3]!,
                    data.colors[source * 3 + 1]!,
                    data.colors[source * 3 + 2]!,
                  ];
        colorAttribute.setXYZ(index, color[0] / 255, color[1] / 255, color[2] / 255);
      });
      colorAttribute.needsUpdate = true;
    },
    setSelection(selected) {
      selectionGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          selected.flatMap((point) => [point.position[0], -point.position[1], -point.position[2]]),
          3,
        ),
      );
    },
    selectPixel(pixelIndex) {
      return selectedPointForPixel(data, pixelIndex);
    },
    setTrajectory(path, frame, fps) {
      controls.enabled = path === null;
      frustum.visible = path !== null;
      if (!path) {
        if (keyframeMarkers) {
          scene.remove(keyframeMarkers);
          keyframeMarkers.geometry.dispose();
          (keyframeMarkers.material as THREE.Material).dispose();
          keyframeMarkers = null;
        }
        if (pathLine) {
          scene.remove(pathLine);
          pathLine.geometry.dispose();
          pathLine = null;
        }
        return;
      }
      const count = Math.round(path.duration * fps);
      const pointsOnPath = Array.from({ length: Math.min(count, 360) }, (_, i) => {
        const pose = sampleCameraPath(path, Math.floor((i * count) / Math.min(count, 360)), fps);
        return new THREE.Vector3(pose.position[0], -pose.position[1], -pose.position[2]);
      });
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(pointsOnPath);
      if (pathLine) {
        pathLine.geometry.dispose();
        pathLine.geometry = lineGeometry;
      } else {
        pathLine = new THREE.Line(lineGeometry, pathMaterial);
        scene.add(pathLine);
      }
      if (path.keyframes.length) {
        const markerGeometry = new THREE.BufferGeometry().setFromPoints(
          path.keyframes.map(
            (keyframe) =>
              new THREE.Vector3(keyframe.position[0], -keyframe.position[1], -keyframe.position[2]),
          ),
        );
        if (keyframeMarkers) {
          keyframeMarkers.geometry.dispose();
          keyframeMarkers.geometry = markerGeometry;
        } else {
          keyframeMarkers = new THREE.Points(
            markerGeometry,
            new THREE.PointsMaterial({ color: 0xffc94a, size: 7, sizeAttenuation: false }),
          );
          scene.add(keyframeMarkers);
        }
      }
      const pose = sampleCameraPath(path, frame % count, fps);
      camera.position.set(pose.position[0], -pose.position[1], -pose.position[2]);
      camera.up.set(pose.up[0], -pose.up[1], -pose.up[2]);
      camera.lookAt(pose.target[0], -pose.target[1], -pose.target[2]);
      frustum.update();
      if (camera === perspective) {
        if (pose.projection === "perspective") {
          perspective.fov = pose.fov;
        }
        perspective.updateProjectionMatrix();
      } else {
        const extent = Math.max(pose.orthoScale, 0.001);
        orthographic.top = extent;
        orthographic.bottom = -extent;
        orthographic.updateProjectionMatrix();
      }
    },
    cameraSnapshot() {
      const position = camera.position;
      const target = controls.target;
      const perspectiveView = camera === perspective;
      return {
        position: [position.x, -position.y, -position.z] as [number, number, number],
        target: [target.x, -target.y, -target.z] as [number, number, number],
        up: [camera.up.x, -camera.up.y, -camera.up.z] as [number, number, number],
        projection: perspectiveView ? ("perspective" as const) : ("orthographic" as const),
        fov: perspectiveView ? perspective.fov : 45,
        orthoScale: Math.max(0.001, orthographic.top),
      };
    },
    async capturePng() {
      renderer.render(scene, camera);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG capture failed");
      return blob;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      canvas.removeEventListener("pointerup", pointer);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      selectionGeometry.dispose();
      selectionMaterial.dispose();
      pathLine?.geometry.dispose();
      pathMaterial.dispose();
      keyframeMarkers?.geometry.dispose();
      if (keyframeMarkers) (keyframeMarkers.material as THREE.Material).dispose();
      frustum.dispose();
      renderer.dispose();
    },
  };
}
