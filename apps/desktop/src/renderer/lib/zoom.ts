export const MIN_ZOOM_PERCENT = 60;
export const MAX_ZOOM_PERCENT = 175;
export const DEFAULT_ZOOM_PERCENT = 100;
export const ZOOM_STEP_PERCENT = 10;

export function clampZoomPercent(value: number): number {
  return Math.round(Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, value)));
}

export function parseZoomPercent(value: string): number | null {
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampZoomPercent(parsed);
}
