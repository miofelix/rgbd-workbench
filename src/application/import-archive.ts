import type { Workbench } from "./workbench";
import { importSourceArchive } from "@/persistence/archive";
import type { Scene } from "@/domain/scene";
export function restoreArchive(workbench: Workbench, file: File): Promise<Scene> {
  return importSourceArchive(file, workbench.libraryAccess);
}
