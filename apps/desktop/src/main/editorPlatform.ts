import type { DesktopPlatform } from "../shared/desktopPlatform";

export type EditorPlatformConfig = {
  pathLocatorCommand: "which" | "where";
  spawnWithShell: boolean;
};

export function createEditorPlatformConfig(platform: DesktopPlatform): EditorPlatformConfig {
  return {
    pathLocatorCommand: platform === "win32" ? "where" : "which",
    spawnWithShell: platform === "win32",
  };
}
