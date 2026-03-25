import type { ClaudeHookStateResponse, WatchLiveStatusResponse } from "../../app/types";
import { compactPath } from "../../lib/viewUtils";
import {
  InlineSwitchRow,
  SectionCard,
  SectionHeader,
  SettingsSwitch,
} from "./SettingsSectionPrimitives";

export function LiveWatchSection({
  liveStatusError,
  claudeHookState,
  claudeHookActionPending,
  onInstallClaudeHooks,
  onRemoveClaudeHooks,
  liveWatchEnabled,
  liveWatchRowHasBackground,
  onLiveWatchEnabledChange,
  onLiveWatchRowHasBackgroundChange,
}: {
  liveStatus: WatchLiveStatusResponse | null;
  liveStatusError: string | null;
  claudeHookState: ClaudeHookStateResponse | null;
  claudeHookActionPending: "install" | "remove" | null;
  onInstallClaudeHooks: () => void;
  onRemoveClaudeHooks: () => void;
  liveWatchEnabled: boolean;
  liveWatchRowHasBackground: boolean;
  onLiveWatchEnabledChange: (enabled: boolean) => void;
  onLiveWatchRowHasBackgroundChange: (enabled: boolean) => void;
}) {
  const managedEventTotal = claudeHookState
    ? claudeHookState.managedEventNames.length + claudeHookState.missingEventNames.length
    : 0;

  return (
    <SectionCard>
      <SectionHeader
        tone="diagnostics"
        icon="LW"
        title="Live Watch"
        subtitle="Track active Codex and Claude sessions while watch mode is running. Disabling this stops the extra transcript tailing and hook-log processing."
      />
      <div className="settings-callout-row settings-callout-row-hooks">
        <div className="settings-callout-copy">
          <strong>
            {liveWatchEnabled ? "Live session tracking enabled" : "Live session tracking disabled"}
          </strong>
          <p>
            Show live Codex and Claude activity in the message header when the selected context is
            actively updating.
          </p>
          <p>
            Live tracking only runs while Auto-refresh is using a watch strategy. Manual and scan
            refresh modes do not produce live session updates.
          </p>
          {liveStatusError ? <p>{liveStatusError}</p> : null}
        </div>
        <SettingsSwitch
          checked={liveWatchEnabled}
          onChange={onLiveWatchEnabledChange}
          ariaLabel="Enable live watch"
        />
      </div>
      <InlineSwitchRow label="Use subtle background behind the live message row">
        <SettingsSwitch
          checked={liveWatchRowHasBackground}
          onChange={onLiveWatchRowHasBackgroundChange}
          ariaLabel="Use live row background"
        />
      </InlineSwitchRow>
      <div className="settings-callout-row settings-callout-row-hooks">
        <div className="settings-callout-copy">
          <strong>
            {claudeHookState?.installed
              ? "Claude hooks installed"
              : claudeHookState?.managed
                ? "Claude hooks partially installed"
                : "Claude hooks not installed"}
          </strong>
          <p>
            {claudeHookState
              ? `${claudeHookState.managedEventNames.length} of ${managedEventTotal} managed hook events configured.`
              : "Hook status is not available yet."}
          </p>
          <p>
            Passive transcript watching works without hooks, but Claude waiting, approval, and idle
            states are only precise with hooks installed.
          </p>
          {claudeHookState?.lastError ? <p>{claudeHookState.lastError}</p> : null}
        </div>
        <div className="settings-hook-actions">
          <button
            type="button"
            className="settings-primary-button"
            onClick={onInstallClaudeHooks}
            disabled={claudeHookActionPending !== null}
          >
            {claudeHookActionPending === "install" ? "Installing..." : "Install / Update"}
          </button>
          <button
            type="button"
            className="settings-rule-button"
            onClick={onRemoveClaudeHooks}
            disabled={claudeHookActionPending !== null || !claudeHookState?.managed}
          >
            {claudeHookActionPending === "remove" ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
      {claudeHookState ? (
        <div className="settings-hook-meta">
          <div className="settings-hook-meta-row">
            <span className="settings-runtime-label">Settings file</span>
            <code className="settings-path-value">{compactPath(claudeHookState.settingsPath)}</code>
          </div>
          <div className="settings-hook-meta-row">
            <span className="settings-runtime-label">Hook log</span>
            <code className="settings-path-value">{compactPath(claudeHookState.logPath)}</code>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
