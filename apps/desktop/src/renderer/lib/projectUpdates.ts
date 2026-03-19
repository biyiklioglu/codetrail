import type { ProjectSummary } from "../app/types";

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

export function mergeStableProjectOrder(previousIds: string[], nextIds: string[]): string[] {
  const nextIdSet = new Set(nextIds);
  const retainedIds = previousIds.filter((id) => nextIdSet.has(id));
  const retainedIdSet = new Set(retainedIds);
  const appendedIds = nextIds.filter((id) => !retainedIdSet.has(id));
  return [...retainedIds, ...appendedIds];
}
