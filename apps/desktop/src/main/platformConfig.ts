import type { BrowserWindowConstructorOptions, OpenDialogOptions } from "electron";

import {
  type DesktopPlatform,
  isMacPlatform,
  normalizeDesktopPlatform,
} from "../shared/desktopPlatform";

export type MainPlatformConfig = {
  platform: DesktopPlatform;
  windowChromeOptions: Pick<
    BrowserWindowConstructorOptions,
    "titleBarStyle" | "trafficLightPosition"
  >;
  shouldSetDockIcon: boolean;
  shouldQuitWhenAllWindowsClosed: boolean;
  externalToolCommandDialog: Pick<OpenDialogOptions, "properties">;
  externalToolCommandValidation: {
    allowAppBundle: boolean;
    invalidSelectionMessage: string;
  };
  preferredWatcherBackends: Array<{
    backend: "default" | "kqueue";
    subscribeOptions?: { backend: "kqueue" };
    failureMessage?: string;
  }>;
};

export function createMainPlatformConfig(platform: DesktopPlatform): MainPlatformConfig {
  if (isMacPlatform(platform)) {
    return {
      platform,
      windowChromeOptions: {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 14, y: 16 },
      },
      shouldSetDockIcon: true,
      shouldQuitWhenAllWindowsClosed: false,
      externalToolCommandDialog: {
        properties: ["openFile", "openDirectory"],
      },
      externalToolCommandValidation: {
        allowAppBundle: true,
        invalidSelectionMessage: "Choose an executable file or a macOS .app bundle.",
      },
      preferredWatcherBackends: [
        {
          backend: "kqueue",
          subscribeOptions: { backend: "kqueue" },
          failureMessage:
            "[codetrail] Failed to start kqueue watcher on macOS, falling back to default backend",
        },
        { backend: "default" },
      ],
    };
  }

  return {
    platform,
    windowChromeOptions: {},
    shouldSetDockIcon: false,
    shouldQuitWhenAllWindowsClosed: true,
    externalToolCommandDialog: {
      properties: ["openFile"],
    },
    externalToolCommandValidation: {
      allowAppBundle: false,
      invalidSelectionMessage: "Choose an executable file.",
    },
    preferredWatcherBackends: [{ backend: "default" }],
  };
}

export function getCurrentMainPlatformConfig(): MainPlatformConfig {
  return createMainPlatformConfig(normalizeDesktopPlatform(process.platform));
}

export function shouldUseBundledIndexingWorker(input: {
  platform: DesktopPlatform;
  electronVersion: string | null | undefined;
}): boolean {
  const { platform, electronVersion } = input;
  if (!electronVersion) {
    return true;
  }

  const majorVersion = Number.parseInt(electronVersion.split(".")[0] ?? "", 10);
  if (!Number.isFinite(majorVersion)) {
    return true;
  }

  return !(isMacPlatform(platform) && majorVersion >= 35);
}
