import { useCallback, useEffect, useState } from "react";

import type { IpcRequest } from "@codetrail/core/browser";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import { MONO_FONT_STACKS, REGULAR_FONT_STACKS } from "../app/constants";
import type { PaneStateSnapshot, SettingsInfoResponse } from "../app/types";
import { useCodetrailClient } from "../lib/codetrailClient";
import { applyTheme } from "../lib/theme";
import { toErrorMessage } from "../lib/viewUtils";
import {
  DEFAULT_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  clampZoomPercent,
} from "../lib/zoom";

export function useAppearanceController({
  initialPaneState,
  logError,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  logError: (context: string, error: unknown) => void;
}) {
  const codetrail = useCodetrailClient();
  const [theme, setTheme] = useState<ThemeMode>(initialPaneState?.theme ?? "light");
  const [monoFontFamily, setMonoFontFamily] = useState<MonoFontFamily>(
    initialPaneState?.monoFontFamily ?? "droid_sans_mono",
  );
  const [regularFontFamily, setRegularFontFamily] = useState<RegularFontFamily>(
    initialPaneState?.regularFontFamily ?? "inter",
  );
  const [monoFontSize, setMonoFontSize] = useState<MonoFontSize>(
    initialPaneState?.monoFontSize ?? "13px",
  );
  const [regularFontSize, setRegularFontSize] = useState<RegularFontSize>(
    initialPaneState?.regularFontSize ?? "14px",
  );
  const [useMonospaceForAllMessages, setUseMonospaceForAllMessages] = useState(
    initialPaneState?.useMonospaceForAllMessages ?? false,
  );
  const [zoomPercent, setZoomPercent] = useState(100);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfoResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void codetrail
      .invoke("ui:getZoom", {})
      .then((response) => {
        if (!cancelled) {
          setZoomPercent(clampZoomPercent(response.percent));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading zoom state", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [codetrail, logError]);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem("codetrail-theme", theme);
    } catch {
      // Ignore storage errors when persisting the last selected theme.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-mono", MONO_FONT_STACKS[monoFontFamily]);
  }, [monoFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-sans",
      REGULAR_FONT_STACKS[regularFontFamily],
    );
  }, [regularFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty("--message-mono-font-size", monoFontSize);
  }, [monoFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty("--message-font-size", regularFontSize);
  }, [regularFontSize]);

  useEffect(() => {
    document.documentElement.dataset.useMonospaceMessages = useMonospaceForAllMessages
      ? "true"
      : "false";
  }, [useMonospaceForAllMessages]);

  const applyZoomAction = useCallback(
    async (action: "in" | "out" | "reset") => {
      try {
        const response = await codetrail.invoke("ui:setZoom", { action });
        setZoomPercent(clampZoomPercent(response.percent));
      } catch (error) {
        logError(`Failed applying zoom action '${action}'`, error);
      }
    },
    [codetrail, logError],
  );

  const setZoomPercentValue = useCallback(
    async (percent: number) => {
      const clampedPercent = clampZoomPercent(percent);
      try {
        const response = await codetrail.invoke("ui:setZoom", { percent: clampedPercent });
        setZoomPercent(clampZoomPercent(response.percent));
      } catch (error) {
        logError(`Failed setting zoom to ${clampedPercent}%`, error);
      }
    },
    [codetrail, logError],
  );

  const loadSettingsInfo = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await codetrail.invoke("app:getSettingsInfo", {});
      setSettingsInfo(response);
    } catch (error) {
      setSettingsError(toErrorMessage(error));
    } finally {
      setSettingsLoading(false);
    }
  }, [codetrail]);

  return {
    theme,
    setTheme,
    monoFontFamily,
    setMonoFontFamily,
    regularFontFamily,
    setRegularFontFamily,
    monoFontSize,
    setMonoFontSize,
    regularFontSize,
    setRegularFontSize,
    useMonospaceForAllMessages,
    setUseMonospaceForAllMessages,
    zoomPercent,
    canZoomIn: zoomPercent < MAX_ZOOM_PERCENT,
    canZoomOut: zoomPercent > MIN_ZOOM_PERCENT,
    applyZoomAction,
    setZoomPercent: setZoomPercentValue,
    defaultZoomPercent: DEFAULT_ZOOM_PERCENT,
    settingsInfo,
    settingsLoading,
    settingsError,
    loadSettingsInfo,
  };
}
