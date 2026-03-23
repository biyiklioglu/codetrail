import { useMemo, useState } from "react";

import type {
  ExternalEditorId,
  ExternalToolConfig,
  KnownExternalAppId,
} from "../../../shared/uiPreferences";
import {
  EXTERNAL_APP_OPTIONS,
  createCustomExternalTool,
  createKnownToolId,
  getEnabledExternalTools,
  supportsKnownToolRole,
} from "../../../shared/uiPreferences";
import { browseExternalToolCommand } from "../../lib/pathActions";
import { compactPath, toErrorMessage } from "../../lib/viewUtils";
import {
  createToolMonogram,
  moveToolById,
  parseSingleLineArgs,
  pickPreferredToolId,
  serializeSingleLineArgs,
} from "./externalToolsUtils";

type AvailableToolInfo = {
  id: ExternalEditorId;
  kind: "known" | "custom";
  label: string;
  appId: KnownExternalAppId | null;
  detected: boolean;
  command: string | null;
  args: string[];
  capabilities: {
    openFile: boolean;
    openAtLineColumn: boolean;
    openContent: boolean;
    openDiff: boolean;
  };
};

type Props = {
  preferredExternalEditor: ExternalEditorId;
  preferredExternalDiffTool: ExternalEditorId;
  terminalAppCommand: string;
  externalTools: ExternalToolConfig[];
  availableEditors: AvailableToolInfo[];
  availableDiffTools: AvailableToolInfo[];
  onPreferredExternalEditorChange: (editor: ExternalEditorId) => void;
  onPreferredExternalDiffToolChange: (editor: ExternalEditorId) => void;
  onTerminalAppCommandChange: (value: string) => void;
  onExternalToolsChange: (tools: ExternalToolConfig[]) => void;
  onRescanExternalTools?: () => Promise<void> | void;
  onActionError?: (context: string, error: unknown) => void;
};

function updateTool(
  tools: ExternalToolConfig[],
  toolId: string,
  updater: (tool: ExternalToolConfig) => ExternalToolConfig,
): ExternalToolConfig[] {
  return tools.map((tool) => (tool.id === toolId ? updater(tool) : tool));
}

function canMovePresetTool(
  presetIndex: number,
  direction: "up" | "down",
  presetTools: Array<{ toolId: string }>,
): boolean {
  return direction === "up" ? presetIndex > 0 : presetIndex < presetTools.length - 1;
}

function canMoveCustomTool(
  customIndex: number,
  direction: "up" | "down",
  customTools: ExternalToolConfig[],
): boolean {
  return direction === "up" ? customIndex > 0 : customIndex < customTools.length - 1;
}

export function ExternalToolsSection({
  preferredExternalEditor,
  preferredExternalDiffTool,
  terminalAppCommand,
  externalTools,
  availableEditors,
  availableDiffTools,
  onPreferredExternalEditorChange,
  onPreferredExternalDiffToolChange,
  onTerminalAppCommandChange,
  onExternalToolsChange,
  onRescanExternalTools,
  onActionError,
}: Props) {
  const editorInfoById = useMemo(
    () => new Map(availableEditors.map((tool) => [tool.id, tool])),
    [availableEditors],
  );
  const diffInfoById = useMemo(
    () => new Map(availableDiffTools.map((tool) => [tool.id, tool])),
    [availableDiffTools],
  );
  const [expandedCustomToolIds, setExpandedCustomToolIds] = useState<Set<string>>(() => new Set());
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftCommand, setDraftCommand] = useState("");
  const [draftEditorArgs, setDraftEditorArgs] = useState("{file}");
  const [draftDiffArgs, setDraftDiffArgs] = useState("{left} {right}");

  const enabledEditorChoices = getEnabledExternalTools("editor", externalTools);
  const enabledDiffChoices = getEnabledExternalTools("diff", externalTools);
  const customExternalTools = externalTools.filter((tool) => tool.kind === "custom");

  const presetTools = externalTools
    .filter(
      (tool): tool is ExternalToolConfig & { kind: "known"; appId: KnownExternalAppId } =>
        tool.kind === "known" && tool.appId !== null,
    )
    .map((tool) => {
      const option = EXTERNAL_APP_OPTIONS.find((candidate) => candidate.value === tool.appId);
      const toolId = createKnownToolId(tool.appId);
      const info = diffInfoById.get(toolId) ?? editorInfoById.get(toolId) ?? null;
      return {
        value: tool.appId,
        label: option?.label ?? tool.label,
        toolId,
        info,
        editorOn: tool.enabledForEditor,
        diffOn: tool.enabledForDiff,
        diffSupported: supportsKnownToolRole(tool.appId, "diff"),
      };
    });

  const commitTools = (nextTools: ExternalToolConfig[]) => {
    onExternalToolsChange(nextTools);
    onPreferredExternalEditorChange(
      pickPreferredToolId(preferredExternalEditor, getEnabledExternalTools("editor", nextTools)),
    );
    onPreferredExternalDiffToolChange(
      pickPreferredToolId(preferredExternalDiffTool, getEnabledExternalTools("diff", nextTools)),
    );
  };

  const browseForCommand = async (
    onSelect: (path: string) => void,
    context: string,
  ): Promise<void> => {
    try {
      const result = await browseExternalToolCommand();
      if (result.canceled) {
        return;
      }
      if (result.error) {
        onActionError?.(context, result.error);
        return;
      }
      if (result.path) {
        onSelect(result.path);
      }
    } catch (error) {
      onActionError?.(context, toErrorMessage(error));
    }
  };

  return (
    <div className="settings-tools-unified">
      <div className="settings-tools-defaults">
        <div className="settings-field">
          <span className="settings-field-label">Preferred editor</span>
          <div className="settings-select-wrap">
            <select
              className="settings-select"
              aria-label="Preferred editor"
              value={preferredExternalEditor}
              disabled={enabledEditorChoices.length === 0}
              onChange={(event) =>
                onPreferredExternalEditorChange(
                  pickPreferredToolId(event.target.value, enabledEditorChoices),
                )
              }
            >
              {enabledEditorChoices.length === 0 ? (
                <option value="">No editor tools enabled</option>
              ) : (
                enabledEditorChoices.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.label}
                  </option>
                ))
              )}
            </select>
            <span className="settings-select-chevron" aria-hidden>
              <svg viewBox="0 0 12 12">
                <title>Open menu</title>
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </span>
          </div>
        </div>

        <div className="settings-field">
          <span className="settings-field-label">Preferred diff tool</span>
          <div className="settings-select-wrap">
            <select
              className="settings-select"
              aria-label="Preferred diff tool"
              value={preferredExternalDiffTool}
              disabled={enabledDiffChoices.length === 0}
              onChange={(event) =>
                onPreferredExternalDiffToolChange(
                  pickPreferredToolId(event.target.value, enabledDiffChoices),
                )
              }
            >
              {enabledDiffChoices.length === 0 ? (
                <option value="">No diff tools enabled</option>
              ) : (
                enabledDiffChoices.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.label}
                  </option>
                ))
              )}
            </select>
            <span className="settings-select-chevron" aria-hidden>
              <svg viewBox="0 0 12 12">
                <title>Open menu</title>
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </span>
          </div>
        </div>

        <div className="settings-tool-detail-field full">
          <label className="settings-tool-detail-label" htmlFor="terminal-app-command">
            Terminal app (macOS)
          </label>
          <div className="settings-tool-command-row">
            <input
              id="terminal-app-command"
              className="settings-tool-detail-input"
              type="text"
              value={terminalAppCommand}
              placeholder="Terminal or /Applications/iTerm.app"
              onChange={(event) => onTerminalAppCommandChange(event.target.value)}
            />
            <button
              type="button"
              className="settings-tool-secondary-button compact"
              onClick={() =>
                void browseForCommand(
                  (path) => onTerminalAppCommandChange(path),
                  "Choose terminal app",
                )
              }
            >
              Browse
            </button>
          </div>
          <span className="settings-tool-detail-hint">
            Used when launching terminal-based tools like Neovim on macOS. Leave empty to use
            Terminal.
          </span>
        </div>
      </div>

      <div className="settings-tools-legend" aria-hidden>
        <span className="settings-tools-legend-item">
          <span className="settings-tool-chip editor on">Editor</span>
          Enabled as editor
        </span>
        <span className="settings-tools-legend-item">
          <span className="settings-tool-chip diff on">Diff</span>
          Enabled as diff tool
        </span>
        <span className="settings-tools-legend-item">
          <span className="settings-tool-chip off">Off</span>
          Click to enable
        </span>
        <span className="settings-tools-legend-item">
          <span className="settings-tool-legend-dot detected" />
          Detected
        </span>
        <span className="settings-tools-legend-item">
          <span className="settings-tool-legend-dot missing" />
          Not found
        </span>
      </div>

      <div className="settings-tools-divider">
        <span>Preset Tools</span>
      </div>
      <ul className="settings-tools-list" aria-label="Preset tools">
        {presetTools.map((tool, presetIndex) => (
          <li
            key={tool.value}
            className={`settings-tool-row${!tool.editorOn && !tool.diffOn ? " disabled" : ""}`}
          >
            <div className="settings-tool-main">
              <div className="settings-tool-icon" aria-hidden>
                <span>{createToolMonogram(tool.label)}</span>
                <span
                  className={`settings-tool-status-dot${tool.info?.detected ? " detected" : " missing"}`}
                />
              </div>
              <div className="settings-tool-body">
                <div className="settings-tool-name">
                  {tool.label}
                  <span className="settings-tool-source-badge">Preset</span>
                </div>
                <div className="settings-tool-path" title={tool.info?.command ?? undefined}>
                  {tool.info?.command ? compactPath(tool.info.command) : "Managed preset launcher"}
                </div>
              </div>
              <div className="settings-tool-roles">
                <button
                  type="button"
                  className="settings-tool-order-button"
                  aria-label={`Move ${tool.label} up`}
                  title={`Move ${tool.label} up`}
                  disabled={!canMovePresetTool(presetIndex, "up", presetTools)}
                  onClick={() => commitTools(moveToolById(externalTools, tool.toolId, "up"))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="settings-tool-order-button"
                  aria-label={`Move ${tool.label} down`}
                  title={`Move ${tool.label} down`}
                  disabled={!canMovePresetTool(presetIndex, "down", presetTools)}
                  onClick={() => commitTools(moveToolById(externalTools, tool.toolId, "down"))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={`settings-tool-chip editor${tool.editorOn ? " on" : " off"}`}
                  onClick={() =>
                    commitTools(
                      updateTool(externalTools, tool.toolId, (current) => ({
                        ...current,
                        enabledForEditor: !current.enabledForEditor,
                      })),
                    )
                  }
                  aria-pressed={tool.editorOn}
                >
                  Editor
                </button>
                <button
                  type="button"
                  className={`settings-tool-chip diff${
                    tool.diffSupported ? (tool.diffOn ? " on" : " off") : " unavailable"
                  }`}
                  onClick={() =>
                    tool.diffSupported
                      ? commitTools(
                          updateTool(externalTools, tool.toolId, (current) => ({
                            ...current,
                            enabledForDiff: !current.enabledForDiff,
                          })),
                        )
                      : undefined
                  }
                  aria-pressed={tool.diffOn}
                  disabled={!tool.diffSupported}
                >
                  Diff
                </button>
              </div>
              <span className="settings-tool-delete-placeholder" aria-hidden />
            </div>
          </li>
        ))}
      </ul>

      <div className="settings-tools-divider">
        <span>Custom Tools</span>
      </div>
      <ul className="settings-tools-list" aria-label="Custom tools">
        {customExternalTools.length === 0 ? (
          <li className="settings-tool-empty">
            No custom tools yet. Add one below, then enable Editor and Diff roles as needed.
          </li>
        ) : (
          customExternalTools.map((tool, customIndex) => {
            const editorInfo = editorInfoById.get(tool.id);
            const diffInfo = diffInfoById.get(tool.id);
            const detected =
              editorInfo?.detected || diffInfo?.detected || tool.command.trim().length > 0;
            const expanded = expandedCustomToolIds.has(tool.id);
            const disabled = !tool.enabledForEditor && !tool.enabledForDiff;
            return (
              <li
                key={tool.id}
                className={`settings-tool-row custom${disabled ? " disabled" : ""}${expanded ? " expanded" : ""}`}
              >
                <div className="settings-tool-main">
                  <button
                    type="button"
                    className="settings-tool-disclosure"
                    aria-label={expanded ? `Collapse ${tool.label}` : `Expand ${tool.label}`}
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedCustomToolIds((current) => {
                        const next = new Set(current);
                        if (next.has(tool.id)) {
                          next.delete(tool.id);
                        } else {
                          next.add(tool.id);
                        }
                        return next;
                      })
                    }
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                  <div className="settings-tool-icon custom" aria-hidden>
                    <span>{createToolMonogram(tool.label)}</span>
                    <span
                      className={`settings-tool-status-dot${detected ? " detected" : " missing"}`}
                    />
                  </div>
                  <div className="settings-tool-body">
                    <div className="settings-tool-name">
                      {tool.label}
                      <span className="settings-tool-source-badge custom">Custom</span>
                    </div>
                    <div className="settings-tool-path" title={tool.command || undefined}>
                      {tool.command.trim().length > 0
                        ? compactPath(tool.command)
                        : "Command not configured"}
                    </div>
                  </div>
                  <div className="settings-tool-roles">
                    <button
                      type="button"
                      className="settings-tool-order-button"
                      aria-label={`Move ${tool.label} up`}
                      title={`Move ${tool.label} up`}
                      disabled={!canMoveCustomTool(customIndex, "up", customExternalTools)}
                      onClick={() => commitTools(moveToolById(externalTools, tool.id, "up"))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="settings-tool-order-button"
                      aria-label={`Move ${tool.label} down`}
                      title={`Move ${tool.label} down`}
                      disabled={!canMoveCustomTool(customIndex, "down", customExternalTools)}
                      onClick={() => commitTools(moveToolById(externalTools, tool.id, "down"))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={`settings-tool-chip editor${tool.enabledForEditor ? " on" : " off"}`}
                      onClick={() =>
                        commitTools(
                          updateTool(externalTools, tool.id, (current) => ({
                            ...current,
                            enabledForEditor: !current.enabledForEditor,
                          })),
                        )
                      }
                      aria-pressed={tool.enabledForEditor}
                    >
                      Editor
                    </button>
                    <button
                      type="button"
                      className={`settings-tool-chip diff${tool.enabledForDiff ? " on" : " off"}`}
                      onClick={() =>
                        commitTools(
                          updateTool(externalTools, tool.id, (current) => ({
                            ...current,
                            enabledForDiff: !current.enabledForDiff,
                          })),
                        )
                      }
                      aria-pressed={tool.enabledForDiff}
                    >
                      Diff
                    </button>
                  </div>
                  <button
                    type="button"
                    className="settings-tool-delete"
                    aria-label={`Remove ${tool.label}`}
                    onClick={() => {
                      setExpandedCustomToolIds((current) => {
                        const next = new Set(current);
                        next.delete(tool.id);
                        return next;
                      });
                      commitTools(externalTools.filter((candidate) => candidate.id !== tool.id));
                    }}
                  >
                    ×
                  </button>
                </div>
                {expanded ? (
                  <div className="settings-tool-detail">
                    <div className="settings-tool-detail-field">
                      <span className="settings-tool-detail-label">Name</span>
                      <input
                        className="settings-tool-detail-input"
                        aria-label={`${tool.label} name`}
                        value={tool.label}
                        onChange={(event) =>
                          commitTools(
                            updateTool(externalTools, tool.id, (current) => ({
                              ...current,
                              label: event.target.value,
                            })),
                          )
                        }
                      />
                    </div>
                    <div className="settings-tool-detail-field">
                      <span className="settings-tool-detail-label">Command</span>
                      <div className="settings-tool-command-row">
                        <input
                          className="settings-tool-detail-input"
                          aria-label={`${tool.label} command`}
                          value={tool.command}
                          onChange={(event) =>
                            commitTools(
                              updateTool(externalTools, tool.id, (current) => ({
                                ...current,
                                command: event.target.value,
                              })),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="settings-tool-secondary-button compact"
                          onClick={() =>
                            void browseForCommand(
                              (path) =>
                                commitTools(
                                  updateTool(externalTools, tool.id, (current) => ({
                                    ...current,
                                    command: path,
                                  })),
                                ),
                              `Failed choosing command for '${tool.label}'`,
                            )
                          }
                        >
                          Browse
                        </button>
                      </div>
                    </div>
                    <div className="settings-tool-detail-field">
                      <span className="settings-tool-detail-label">Editor Arguments</span>
                      <input
                        className="settings-tool-detail-input"
                        aria-label={`${tool.label} editor arguments`}
                        value={serializeSingleLineArgs(tool.editorArgs)}
                        onChange={(event) =>
                          commitTools(
                            updateTool(externalTools, tool.id, (current) => ({
                              ...current,
                              editorArgs: parseSingleLineArgs(event.target.value),
                            })),
                          )
                        }
                      />
                    </div>
                    <div className="settings-tool-detail-field">
                      <span className="settings-tool-detail-label">Diff Arguments</span>
                      <input
                        className="settings-tool-detail-input"
                        aria-label={`${tool.label} diff arguments`}
                        value={serializeSingleLineArgs(tool.diffArgs)}
                        onChange={(event) =>
                          commitTools(
                            updateTool(externalTools, tool.id, (current) => ({
                              ...current,
                              diffArgs: parseSingleLineArgs(event.target.value),
                            })),
                          )
                        }
                      />
                    </div>
                    <div className="settings-tool-detail-field full">
                      <span className="settings-tool-detail-hint">
                        Placeholders: {"{file}"} {"{line}"} {"{column}"} {"{left}"} {"{right}"}{" "}
                        {"{title}"}
                      </span>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {addFormOpen ? (
        <div className="settings-tool-add-form">
          <div className="settings-tool-add-grid">
            <div className="settings-tool-detail-field">
              <label className="settings-tool-detail-label" htmlFor="new-custom-tool-name">
                Name
              </label>
              <input
                id="new-custom-tool-name"
                className="settings-tool-detail-input"
                aria-label="New custom tool name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </div>
            <div className="settings-tool-detail-field">
              <label className="settings-tool-detail-label" htmlFor="new-custom-tool-command">
                Command
              </label>
              <div className="settings-tool-command-row">
                <input
                  id="new-custom-tool-command"
                  className="settings-tool-detail-input"
                  aria-label="New custom tool command"
                  value={draftCommand}
                  onChange={(event) => setDraftCommand(event.target.value)}
                />
                <button
                  type="button"
                  className="settings-tool-secondary-button compact"
                  onClick={() =>
                    void browseForCommand(
                      setDraftCommand,
                      "Failed choosing command for custom tool",
                    )
                  }
                >
                  Browse
                </button>
              </div>
            </div>
            <div className="settings-tool-detail-field">
              <label className="settings-tool-detail-label" htmlFor="new-custom-tool-editor-args">
                Editor Arguments
              </label>
              <input
                id="new-custom-tool-editor-args"
                className="settings-tool-detail-input"
                aria-label="New custom tool editor arguments"
                value={draftEditorArgs}
                onChange={(event) => setDraftEditorArgs(event.target.value)}
              />
            </div>
            <div className="settings-tool-detail-field">
              <label className="settings-tool-detail-label" htmlFor="new-custom-tool-diff-args">
                Diff Arguments
              </label>
              <input
                id="new-custom-tool-diff-args"
                className="settings-tool-detail-input"
                aria-label="New custom tool diff arguments"
                value={draftDiffArgs}
                onChange={(event) => setDraftDiffArgs(event.target.value)}
              />
            </div>
          </div>
          <div className="settings-tool-add-actions">
            <button
              type="button"
              className="settings-tool-secondary-button"
              onClick={() => {
                setAddFormOpen(false);
                setDraftName("");
                setDraftCommand("");
                setDraftEditorArgs("{file}");
                setDraftDiffArgs("{left} {right}");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="settings-tool-primary-button"
              onClick={() => {
                const nextTool = {
                  ...createCustomExternalTool(customExternalTools.length + 1),
                  label: draftName.trim() || `Custom Tool ${customExternalTools.length + 1}`,
                  command: draftCommand.trim(),
                  editorArgs: parseSingleLineArgs(draftEditorArgs),
                  diffArgs: parseSingleLineArgs(draftDiffArgs),
                };
                commitTools([...externalTools, nextTool]);
                setExpandedCustomToolIds((current) => new Set([...current, nextTool.id]));
                setAddFormOpen(false);
                setDraftName("");
                setDraftCommand("");
                setDraftEditorArgs("{file}");
                setDraftDiffArgs("{left} {right}");
              }}
            >
              Add Tool
            </button>
          </div>
        </div>
      ) : null}

      <div className={`settings-tool-footer${addFormOpen ? " form-open" : ""}`}>
        {!addFormOpen ? (
          <button
            type="button"
            className="settings-tool-add-button"
            aria-label="Add Custom Tool"
            onClick={() => setAddFormOpen(true)}
          >
            + Add Custom Tool
          </button>
        ) : (
          <span className="settings-tool-footer-spacer" aria-hidden />
        )}
        <div className="settings-tool-footer-meta">
          <span>
            {presetTools.filter((tool) => tool.info?.detected).length} presets detected ·{" "}
            {customExternalTools.length} custom tools
          </span>
          <button
            type="button"
            className="settings-tool-secondary-button"
            onClick={() => void onRescanExternalTools?.()}
          >
            Rescan System
          </button>
        </div>
      </div>
    </div>
  );
}
