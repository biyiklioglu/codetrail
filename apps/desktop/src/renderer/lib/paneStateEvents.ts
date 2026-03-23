import type { ExternalEditorId, ExternalToolConfig } from "../../shared/uiPreferences";

export const PANE_STATE_UPDATED_EVENT = "codetrail:pane-state-updated";

export type PaneStateUpdatedDetail = {
  preferredExternalEditor: ExternalEditorId;
  preferredExternalDiffTool: ExternalEditorId;
  terminalAppCommand: string;
  externalTools: ExternalToolConfig[];
};
