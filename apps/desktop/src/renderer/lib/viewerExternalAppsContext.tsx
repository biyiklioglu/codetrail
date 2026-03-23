import { createContext, useContext } from "react";

import type { IpcResponse } from "@codetrail/core/browser";

import type { ExternalEditorId, ExternalToolConfig } from "../../shared/uiPreferences";

export type ViewerEditorInfo = IpcResponse<"editor:listAvailable">["editors"][number];

export type ViewerToolPreferences = {
  preferredExternalEditor: ExternalEditorId | null;
  preferredExternalDiffTool: ExternalEditorId | null;
  terminalAppCommand: string;
  orderedToolIds: string[];
  externalTools: ExternalToolConfig[];
};

export type ViewerExternalAppsSnapshot = {
  editors: ViewerEditorInfo[];
  diffTools: ViewerEditorInfo[];
  preferences: ViewerToolPreferences;
};

const ViewerExternalAppsContext = createContext<ViewerExternalAppsSnapshot | null>(null);

export function ViewerExternalAppsProvider({
  value,
  children,
}: {
  value: ViewerExternalAppsSnapshot;
  children: React.ReactNode;
}) {
  return (
    <ViewerExternalAppsContext.Provider value={value}>
      {children}
    </ViewerExternalAppsContext.Provider>
  );
}

export function useViewerExternalAppsContext(): ViewerExternalAppsSnapshot | null {
  return useContext(ViewerExternalAppsContext);
}
