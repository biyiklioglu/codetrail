import type { Dispatch, SetStateAction } from "react";

import type {
  DiffViewMode,
  ExternalEditorId,
  ExternalToolConfig,
  MessagePageSize,
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ShikiThemeId,
  ThemeMode,
  ViewerWrapMode,
} from "../../shared/uiPreferences";

export type AppearanceState = {
  theme: ThemeMode;
  setTheme: Dispatch<SetStateAction<ThemeMode>>;
  darkShikiTheme: ShikiThemeId;
  setDarkShikiTheme: Dispatch<SetStateAction<ShikiThemeId>>;
  lightShikiTheme: ShikiThemeId;
  setLightShikiTheme: Dispatch<SetStateAction<ShikiThemeId>>;
  shikiTheme: ShikiThemeId;
  setShikiTheme: Dispatch<SetStateAction<ShikiThemeId>>;
  monoFontFamily: MonoFontFamily;
  setMonoFontFamily: Dispatch<SetStateAction<MonoFontFamily>>;
  regularFontFamily: RegularFontFamily;
  setRegularFontFamily: Dispatch<SetStateAction<RegularFontFamily>>;
  monoFontSize: MonoFontSize;
  setMonoFontSize: Dispatch<SetStateAction<MonoFontSize>>;
  regularFontSize: RegularFontSize;
  setRegularFontSize: Dispatch<SetStateAction<RegularFontSize>>;
  messagePageSize: MessagePageSize;
  setMessagePageSize: Dispatch<SetStateAction<MessagePageSize>>;
  useMonospaceForAllMessages: boolean;
  setUseMonospaceForAllMessages: Dispatch<SetStateAction<boolean>>;
  autoHideMessageActions: boolean;
  setAutoHideMessageActions: Dispatch<SetStateAction<boolean>>;
  autoHideViewerHeaderActions: boolean;
  setAutoHideViewerHeaderActions: Dispatch<SetStateAction<boolean>>;
  defaultViewerWrapMode: ViewerWrapMode;
  setDefaultViewerWrapMode: Dispatch<SetStateAction<ViewerWrapMode>>;
  defaultDiffViewMode: DiffViewMode;
  setDefaultDiffViewMode: Dispatch<SetStateAction<DiffViewMode>>;
  preferredExternalEditor: ExternalEditorId;
  setPreferredExternalEditor: Dispatch<SetStateAction<ExternalEditorId>>;
  preferredExternalDiffTool: ExternalEditorId;
  setPreferredExternalDiffTool: Dispatch<SetStateAction<ExternalEditorId>>;
  terminalAppCommand: string;
  setTerminalAppCommand: Dispatch<SetStateAction<string>>;
  externalTools: ExternalToolConfig[];
  setExternalTools: Dispatch<SetStateAction<ExternalToolConfig[]>>;
};

export function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return "-";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function scrollFocusedHistoryMessageIntoView(
  container: HTMLDivElement,
  messageElement: HTMLDivElement,
): void {
  const containerRect = container.getBoundingClientRect();
  const messageRect = messageElement.getBoundingClientRect();
  const containerHeight = container.clientHeight || containerRect.height;
  const messageHeight = messageRect.height;

  if (containerHeight > 0 && messageHeight > containerHeight) {
    const nextScrollTop = Math.max(0, container.scrollTop + (messageRect.top - containerRect.top));
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: nextScrollTop });
      return;
    }
    container.scrollTop = nextScrollTop;
    return;
  }

  messageElement.scrollIntoView({
    block: "center",
  });
}

export function focusHistoryList(container: HTMLDivElement | null): void {
  window.setTimeout(() => {
    container?.focus({ preventScroll: true });
  }, 0);
}

export function getMessageListFingerprint(messages: Array<{ id: string }>): string {
  const firstId = messages[0]?.id ?? "";
  const lastId = messages[messages.length - 1]?.id ?? "";
  return `${messages.length}:${firstId}:${lastId}`;
}
