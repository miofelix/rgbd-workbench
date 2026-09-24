import { describe, expect, it } from "vitest";

import vectors from "../../fixtures/m3/camera-path-vectors.json";

import {
  frameCount,
  sampleCameraPath,
  type CameraKeyframeV1,
  type CameraPathV1,
} from "../../web/src/trajectory/sampler";

const conformanceVectors = vectors as unknown as {
  cases: Array<{
    path: CameraPathV1;
    frame_count: number;
    first_position: number[];
    middle_position?: number[];
    last_position: number[];
    first_time: number;
    last_time: number;
  }>;
};

function orbitPath(overrides: Partial<CameraPathV1> = {}): CameraPathV1 {
  return {
    schema_version: 1,
    frame: "camera",
    unit: "m",
    trajectory_type: "orbit",
    target_source: "manual",
    target: [0, 0, 0],
    duration: 2,
    fps: 4,
    easing: "linear",
    loop_mode: "once",
    projection: "perspective",
    fov: 45,
    ortho_scale: 1,
    parameters: { radius: 2, turns: 1 },
    keyframes: [],
    sampler_version: "1",
    ...overrides,
  };
}

function keyframe(time: number, x: number, z: number): CameraKeyframeV1 {
  return {
    time,
    position: [x, 0, z],
    target: [0, 0, 0],
    up: [0, -1, 0],
    projection: "perspective",
    fov: 45,
    ortho_scale: 1,
    easing: "linear",
  };
}

describe("camera path sampler", () => {
  it("matches the shared Python/TypeScript conformance vectors", () => {
    for (const vector of conformanceVectors.cases) {
      const poses = sampleCameraPath(vector.path);
      expect(poses).toHaveLength(vector.frame_count);
      expect(poses[0].time).toBeCloseTo(vector.first_time);
      expect(poses.at(-1)?.time).toBeCloseTo(vector.last_time);
      vector.first_position.forEach((value, index) => {
        expect(poses[0].position[index]).toBeCloseTo(value);
      });
      vector.last_position.forEach((value, index) => {
        expect(poses.at(-1)?.position[index]).toBeCloseTo(value);
      });
      if (vector.middle_position) {
        vector.middle_position.forEach((value, index) => {
          expect(poses[1].position[index]).toBeCloseTo(value);
        });
      }
    }
  });

  it("matches deterministic once and loop frame rules", () => {
    expect(frameCount(2, 4)).toBe(8);
    const once = sampleCameraPath(orbitPath());
    const loop = sampleCameraPath(orbitPath({ loop_mode: "loop" }));

    expect(once).toHaveLength(8);
    expect(loop).toHaveLength(8);
    expect(once[0].time).toBe(0);
    expect(once.at(-1)?.time).toBe(2);
    expect(loop.at(-1)?.time).toBeLessThan(2);
    expect(once[0].position[0]).toBeCloseTo(2);
    expect(once.at(-1)?.position[2]).toBeCloseTo(0);
  });

  it("uses linear interpolation for a two-keyframe path", () => {
    const path = orbitPath({
      unit: "unitless",
      trajectory_type: "custom",
      duration: 2,
      fps: 2,
      keyframes: [keyframe(0, 0, 2), keyframe(2, 2, 2)],
    });
    const poses = sampleCameraPath(path);

    expect(poses).toHaveLength(4);
    expect(poses[1].position[0]).toBeCloseTo(2 / 3);
    expect(poses[1].up).toEqual([0, -1, 0]);
    expect(poses.at(-1)?.position).toEqual([2, 0, 2]);
  });

  it("keeps the sampler output repeatable for a multi-keyframe path", () => {
    const path = orbitPath({
      trajectory_type: "custom",
      duration: 3,
      fps: 3,
      keyframes: [
        keyframe(0, 0, 2),
        keyframe(1, 1, 2),
        keyframe(2, 1, 1),
        keyframe(3, 0, 1),
      ],
    });
    const first = sampleCameraPath(path);
    const second = sampleCameraPath(path);

    expect(first).toEqual(second);
    first.forEach((pose) => {
      expect(pose.position.every(Number.isFinite)).toBe(true);
      expect(pose.target.every(Number.isFinite)).toBe(true);
      expect(pose.up.every(Number.isFinite)).toBe(true);
    });
  });
});
