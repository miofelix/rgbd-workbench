import type { Scene } from "@/domain/scene";
export function sourceFile(scene: Scene, role: "rgb" | "depth", blob: Blob): File {
  const descriptor = scene.sources[role];
  return new File([blob], descriptor.name, { type: descriptor.mediaType ?? blob.type });
}
