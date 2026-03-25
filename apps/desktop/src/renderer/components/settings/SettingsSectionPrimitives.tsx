import type { ReactNode } from "react";

import type { Provider } from "@codetrail/core/browser";

export function SectionCard({
  children,
  padded = true,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  return <section className={`settings-section${padded ? "" : " no-padding"}`}>{children}</section>;
}

export function SectionHeader({
  icon,
  title,
  subtitle,
  tone,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tone:
    | "theme"
    | "fonts"
    | "provider"
    | "expansion"
    | "warning"
    | "rules"
    | "storage"
    | "discovery"
    | "diagnostics"
    | "breakdown";
}) {
  return (
    <div className="settings-section-header">
      <div className={`settings-section-icon settings-section-icon-${tone}`} aria-hidden>
        {icon}
      </div>
      <div className="settings-section-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function InlineSwitchRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-inline-switch-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  tone,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  tone?: Provider;
}) {
  return (
    <label className={`settings-switch${tone ? ` settings-switch-${tone}` : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="settings-switch-track" aria-hidden>
        <span className="settings-switch-thumb" />
      </span>
    </label>
  );
}
