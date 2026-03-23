export const SHIKI_THEME_OPTIONS = [
  { value: "andromeeda", label: "Andromeeda", group: "dark" },
  { value: "aurora-x", label: "Aurora X", group: "dark" },
  { value: "ayu-dark", label: "Ayu Dark", group: "dark" },
  { value: "ayu-light", label: "Ayu Light", group: "light" },
  { value: "ayu-mirage", label: "Ayu Mirage", group: "dark" },
  { value: "catppuccin-frappe", label: "Catppuccin Frappé", group: "dark" },
  { value: "catppuccin-latte", label: "Catppuccin Latte", group: "light" },
  { value: "catppuccin-macchiato", label: "Catppuccin Macchiato", group: "dark" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha", group: "dark" },
  { value: "dark-plus", label: "Dark Plus", group: "dark" },
  { value: "dracula", label: "Dracula Theme", group: "dark" },
  { value: "dracula-soft", label: "Dracula Theme Soft", group: "dark" },
  { value: "everforest-dark", label: "Everforest Dark", group: "dark" },
  { value: "everforest-light", label: "Everforest Light", group: "light" },
  { value: "github-dark", label: "GitHub Dark", group: "dark" },
  { value: "github-dark-default", label: "GitHub Dark Default", group: "dark" },
  { value: "github-dark-dimmed", label: "GitHub Dark Dimmed", group: "dark" },
  { value: "github-dark-high-contrast", label: "GitHub Dark High Contrast", group: "dark" },
  { value: "github-light", label: "GitHub Light", group: "light" },
  { value: "github-light-default", label: "GitHub Light Default", group: "light" },
  {
    value: "github-light-high-contrast",
    label: "GitHub Light High Contrast",
    group: "light",
  },
  { value: "gruvbox-dark-hard", label: "Gruvbox Dark Hard", group: "dark" },
  { value: "gruvbox-dark-medium", label: "Gruvbox Dark Medium", group: "dark" },
  { value: "gruvbox-dark-soft", label: "Gruvbox Dark Soft", group: "dark" },
  { value: "gruvbox-light-hard", label: "Gruvbox Light Hard", group: "light" },
  { value: "gruvbox-light-medium", label: "Gruvbox Light Medium", group: "light" },
  { value: "gruvbox-light-soft", label: "Gruvbox Light Soft", group: "light" },
  { value: "horizon", label: "Horizon", group: "dark" },
  { value: "horizon-bright", label: "Horizon Bright", group: "dark" },
  { value: "houston", label: "Houston", group: "dark" },
  { value: "kanagawa-dragon", label: "Kanagawa Dragon", group: "dark" },
  { value: "kanagawa-lotus", label: "Kanagawa Lotus", group: "light" },
  { value: "kanagawa-wave", label: "Kanagawa Wave", group: "dark" },
  { value: "laserwave", label: "LaserWave", group: "dark" },
  { value: "light-plus", label: "Light Plus", group: "light" },
  { value: "material-theme", label: "Material Theme", group: "dark" },
  { value: "material-theme-darker", label: "Material Theme Darker", group: "dark" },
  { value: "material-theme-lighter", label: "Material Theme Lighter", group: "light" },
  { value: "material-theme-ocean", label: "Material Theme Ocean", group: "dark" },
  { value: "material-theme-palenight", label: "Material Theme Palenight", group: "dark" },
  { value: "min-dark", label: "Min Dark", group: "dark" },
  { value: "min-light", label: "Min Light", group: "light" },
  { value: "monokai", label: "Monokai", group: "dark" },
  { value: "night-owl", label: "Night Owl", group: "dark" },
  { value: "night-owl-light", label: "Night Owl Light", group: "light" },
  { value: "nord", label: "Nord", group: "dark" },
  { value: "one-dark-pro", label: "One Dark Pro", group: "dark" },
  { value: "one-light", label: "One Light", group: "light" },
  { value: "plastic", label: "Plastic", group: "dark" },
  { value: "poimandres", label: "Poimandres", group: "dark" },
  { value: "red", label: "Red", group: "dark" },
  { value: "rose-pine", label: "Rosé Pine", group: "dark" },
  { value: "rose-pine-dawn", label: "Rosé Pine Dawn", group: "light" },
  { value: "rose-pine-moon", label: "Rosé Pine Moon", group: "dark" },
  { value: "slack-dark", label: "Slack Dark", group: "dark" },
  { value: "slack-ochin", label: "Slack Ochin", group: "light" },
  { value: "snazzy-light", label: "Snazzy Light", group: "light" },
  { value: "solarized-dark", label: "Solarized Dark", group: "dark" },
  { value: "solarized-light", label: "Solarized Light", group: "light" },
  { value: "synthwave-84", label: "Synthwave '84", group: "dark" },
  { value: "tokyo-night", label: "Tokyo Night", group: "dark" },
  { value: "vesper", label: "Vesper", group: "dark" },
  { value: "vitesse-black", label: "Vitesse Black", group: "dark" },
  { value: "vitesse-dark", label: "Vitesse Dark", group: "dark" },
  { value: "vitesse-light", label: "Vitesse Light", group: "light" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  group: "dark" | "light";
}>;

export type ShikiThemeId = (typeof SHIKI_THEME_OPTIONS)[number]["value"];

export const UI_SHIKI_THEME_VALUES: ShikiThemeId[] = SHIKI_THEME_OPTIONS.map(
  (option) => option.value,
);

export const SHIKI_THEME_GROUPS = [
  {
    value: "dark",
    label: "Dark Themes",
    options: SHIKI_THEME_OPTIONS.filter((option) => option.group === "dark"),
  },
  {
    value: "light",
    label: "Light Themes",
    options: SHIKI_THEME_OPTIONS.filter((option) => option.group === "light"),
  },
] as const;

export const DEFAULT_DARK_SHIKI_THEME: ShikiThemeId = "github-dark-default";
export const DEFAULT_LIGHT_SHIKI_THEME: ShikiThemeId = "github-light-default";

const SHIKI_THEME_VALUE_SET = new Set<string>(UI_SHIKI_THEME_VALUES);

export function isShikiThemeId(value: string): value is ShikiThemeId {
  return SHIKI_THEME_VALUE_SET.has(value);
}

export function getShikiThemeFamily(theme: ShikiThemeId): "dark" | "light" {
  return SHIKI_THEME_OPTIONS.find((option) => option.value === theme)?.group ?? "dark";
}

export function getDefaultShikiThemeForFamily(family: "dark" | "light"): ShikiThemeId {
  return family === "light" ? DEFAULT_LIGHT_SHIKI_THEME : DEFAULT_DARK_SHIKI_THEME;
}

export function resolveShikiThemeForFamily(
  family: "dark" | "light",
  override: string | null | undefined,
): ShikiThemeId {
  if (override && isShikiThemeId(override) && getShikiThemeFamily(override) === family) {
    return override;
  }
  return getDefaultShikiThemeForFamily(family);
}

export function getShikiThemeLabel(theme: ShikiThemeId): string {
  return SHIKI_THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}
