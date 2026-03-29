import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { isWatchRefreshStrategy } from "../app/autoRefresh";
import type { RefreshStrategy } from "../app/autoRefresh";
import type { MainView, WatchLiveStatusResponse } from "../app/types";
import type { CodetrailClient } from "../lib/codetrailClient";
import { toErrorMessage } from "../lib/viewUtils";

const IS_TEST_ENV =
  typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
const LIVE_STATUS_ACTIVE_POLL_MS = IS_TEST_ENV ? 0 : 3_000;
const EMPTY_PROVIDER_COUNTS = {
  claude: 0,
  codex: 0,
  gemini: 0,
  cursor: 0,
  copilot: 0,
} as const;

export function useLiveWatchController({
  codetrail,
  mainView,
  refreshStrategy,
  liveWatchEnabled,
  claudeEnabled,
  claudeHooksPrompted,
  logError,
}: {
  codetrail: Pick<CodetrailClient, "invoke">;
  mainView: MainView;
  refreshStrategy: RefreshStrategy;
  liveWatchEnabled: boolean;
  claudeEnabled: boolean;
  claudeHooksPrompted: boolean;
  logError: (context: string, error: unknown) => void;
}) {
  const [liveStatus, setLiveStatus] = useState<WatchLiveStatusResponse | null>(null);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);
  const [claudeHookActionPending, setClaudeHookActionPending] = useState<
    "install" | "remove" | null
  >(null);
  const [showClaudeHooksPrompt, setShowClaudeHooksPrompt] = useState(false);
  const liveStatusRevisionRef = useRef<number | null>(null);

  const liveWatchActive = isWatchRefreshStrategy(refreshStrategy) && liveWatchEnabled;
  const settingsViewOpen = mainView === "settings";
  const settingsRefreshKey = `${mainView}:${refreshStrategy}:${liveWatchEnabled ? "1" : "0"}:${
    claudeEnabled ? "1" : "0"
  }`;
  const settingsRefreshTarget = settingsViewOpen && !liveWatchActive ? settingsRefreshKey : null;

  const loadLiveStatus = useCallback(async (): Promise<WatchLiveStatusResponse | null> => {
    try {
      const response = await codetrail.invoke("watcher:getLiveStatus", {});
      setLiveStatus((current) => {
        if (liveStatusRevisionRef.current === response.revision && current) {
          return current;
        }
        liveStatusRevisionRef.current = response.revision;
        return response;
      });
      setLiveStatusError(null);
      return response;
    } catch (error) {
      setLiveStatusError(toErrorMessage(error));
      return null;
    }
  }, [codetrail]);

  useEffect(() => {
    if (!liveWatchActive) {
      return;
    }

    let cancelled = false;
    const syncLiveStatus = async () => {
      const response = await loadLiveStatus();
      if (cancelled || response) {
        return;
      }
    };

    void syncLiveStatus();
    const pollMs = LIVE_STATUS_ACTIVE_POLL_MS;
    if (pollMs <= 0) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void syncLiveStatus();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [liveWatchActive, loadLiveStatus]);

  useEffect(() => {
    if (!settingsRefreshTarget) {
      return;
    }
    void loadLiveStatus();
  }, [loadLiveStatus, settingsRefreshTarget]);

  useEffect(() => {
    if (
      !liveWatchActive ||
      !claudeEnabled ||
      claudeHooksPrompted ||
      !liveStatus ||
      liveStatus.claudeHookState.installed
    ) {
      return;
    }
    setShowClaudeHooksPrompt(true);
  }, [claudeEnabled, claudeHooksPrompted, liveStatus, liveWatchActive]);

  const installClaudeHooks = useCallback(async () => {
    if (claudeHookActionPending) {
      return;
    }
    setClaudeHookActionPending("install");
    try {
      const response = await codetrail.invoke("claudeHooks:install", {});
      updateClaudeHookState(setLiveStatus, liveStatusRevisionRef, response.state);
      setLiveStatusError(null);
    } catch (error) {
      logError("Failed installing Claude hooks", error);
    } finally {
      setClaudeHookActionPending(null);
    }
  }, [claudeHookActionPending, codetrail, logError]);

  const removeClaudeHooks = useCallback(async () => {
    if (claudeHookActionPending) {
      return;
    }
    setClaudeHookActionPending("remove");
    try {
      const response = await codetrail.invoke("claudeHooks:remove", {});
      updateClaudeHookState(setLiveStatus, liveStatusRevisionRef, response.state);
      setLiveStatusError(null);
    } catch (error) {
      logError("Failed removing Claude hooks", error);
    } finally {
      setClaudeHookActionPending(null);
    }
  }, [claudeHookActionPending, codetrail, logError]);

  return {
    liveStatus,
    liveStatusError,
    liveWatchActive,
    claudeHookActionPending,
    showClaudeHooksPrompt,
    setShowClaudeHooksPrompt,
    installClaudeHooks,
    removeClaudeHooks,
  };
}

function updateClaudeHookState(
  setLiveStatus: Dispatch<SetStateAction<WatchLiveStatusResponse | null>>,
  liveStatusRevisionRef: MutableRefObject<number | null>,
  claudeHookState: WatchLiveStatusResponse["claudeHookState"],
): void {
  setLiveStatus((current) => {
    const nextRevision = (current?.revision ?? liveStatusRevisionRef.current ?? 0) + 1;
    const nextStatus = {
      enabled: current?.enabled ?? false,
      instrumentationEnabled: current?.instrumentationEnabled ?? false,
      updatedAt: new Date().toISOString(),
      providerCounts: current?.providerCounts ?? EMPTY_PROVIDER_COUNTS,
      sessions: current?.sessions ?? [],
      revision: nextRevision,
      claudeHookState,
    };
    liveStatusRevisionRef.current = nextRevision;
    return nextStatus;
  });
}
