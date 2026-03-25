export function compactMetadata(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const compact = Object.fromEntries(
      Object.entries(value).filter(([, entry]) => {
        if (entry === null || entry === undefined) {
          return false;
        }
        if (typeof entry === "string") {
          return entry.length > 0;
        }
        if (Array.isArray(entry)) {
          return entry.length > 0;
        }
        return true;
      }),
    );

    return Object.keys(compact).length > 0 ? compact : null;
  } catch {
    return null;
  }
}

export function stringifyCompactMetadata(
  value: Record<string, unknown> | null | undefined,
): string | null {
  const compact = compactMetadata(value);
  if (!compact) {
    return null;
  }

  try {
    return JSON.stringify(compact);
  } catch {
    return null;
  }
}
