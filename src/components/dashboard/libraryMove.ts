import { invoke } from "@tauri-apps/api/core";
import { fileStore } from "../../stores/fileStore";
import { moveFavorite } from "../../stores/favoritesStore";

export type LibrarySection = "scripts" | "enabled" | "disabled";
export interface LibraryMove {
  from: LibrarySection;
  to: LibrarySection;
  relative: string;
  oldPath: string;
  destination?: string;
}
export async function moveLibraryScript(move: LibraryMove) {
  const newPath = await invoke<string>("move_library_script", {
    from: move.from, to: move.to, relative: move.relative,
    destination: move.destination ?? move.relative,
  });
  moveFavorite(move.oldPath, newPath);
  await fileStore.loadFilesFromDisk();
  return newPath;
}
