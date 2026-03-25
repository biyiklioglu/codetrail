import type { ProjectSummary } from "../app/types";

export type StableListUpdateSource = "auto" | "resort";

export function collectProjectMessageDeltas(
  previousProjects: ProjectSummary[],
  nextProjects: ProjectSummary[],
): Record<string, number> {
  const previousCounts = new Map(
    previousProjects.map((project) => [project.id, project.messageCount] as const),
  );
  const deltas: Record<string, number> = {};

  for (const project of nextProjects) {
    const previousCount = previousCounts.get(project.id);
    if (previousCount === undefined) {
      continue;
    }
    const delta = project.messageCount - previousCount;
    if (delta > 0) {
      deltas[project.id] = delta;
    }
  }

  return deltas;
}

export function mergeStableOrder(previousIds: string[], nextIds: string[]): string[] {
  const nextIdSet = new Set(nextIds);
  const retainedIds = previousIds.filter((id) => nextIdSet.has(id));
  const retainedIdSet = new Set(retainedIds);
  const appendedIds = nextIds.filter((id) => !retainedIdSet.has(id));
  return [...retainedIds, ...appendedIds];
}

export function reorderItemsByStableOrder<T extends { id: string }>(
  naturallySortedItems: T[],
  orderIds: string[],
): T[] {
  if (orderIds.length === 0) {
    return naturallySortedItems;
  }

  const itemsById = new Map(naturallySortedItems.map((item) => [item.id, item] as const));
  const orderedItems = orderIds
    .map((itemId) => itemsById.get(itemId) ?? null)
    .filter((item): item is T => item !== null);
  const orderedIdSet = new Set(orderedItems.map((item) => item.id));
  const appendedItems = naturallySortedItems.filter((item) => !orderedIdSet.has(item.id));
  return [...orderedItems, ...appendedItems];
}

export function resolveStableRefreshSource(
  refreshSource: "manual" | "auto",
  startupWatchResortPending: boolean,
): {
  updateSource: StableListUpdateSource;
  clearStartupWatchResort: boolean;
} {
  if (refreshSource === "manual") {
    return {
      updateSource: "resort",
      clearStartupWatchResort: startupWatchResortPending,
    };
  }

  if (startupWatchResortPending) {
    return {
      updateSource: "resort",
      clearStartupWatchResort: true,
    };
  }

  return {
    updateSource: "auto",
    clearStartupWatchResort: false,
  };
}
