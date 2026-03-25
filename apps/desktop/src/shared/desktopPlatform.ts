export const DESKTOP_PLATFORM_VALUES = ["darwin", "win32", "linux"] as const;

export type DesktopPlatform = (typeof DESKTOP_PLATFORM_VALUES)[number];
export const DEFAULT_DESKTOP_PLATFORM: DesktopPlatform = "darwin";

export function normalizeDesktopPlatform(value: string | null | undefined): DesktopPlatform {
  return value === "darwin" || value === "win32" ? value : "linux";
}

export function isMacPlatform(platform: DesktopPlatform): boolean {
  return platform === "darwin";
}

export function isWindowsPlatform(platform: DesktopPlatform): boolean {
  return platform === "win32";
}
