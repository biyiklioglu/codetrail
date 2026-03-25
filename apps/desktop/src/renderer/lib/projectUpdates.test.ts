import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../app/types";
import {
  collectProjectMessageDeltas,
  mergeStableOrder,
  reorderItemsByStableOrder,
  resolveStableRefreshSource,
} from "./projectUpdates";

describe("projectUpdates", () => {
  it("collects positive project message deltas", () => {
    const previousProjects: ProjectSummary[] = [
      createProject({ id: "project_1", messageCount: 10 }),
      createProject({ id: "project_2", messageCount: 5 }),
    ];
    const nextProjects: ProjectSummary[] = [
      createProject({ id: "project_1", messageCount: 13 }),
      createProject({ id: "project_2", messageCount: 5 }),
      createProject({ id: "project_3", messageCount: 2 }),
    ];

    expect(collectProjectMessageDeltas(previousProjects, nextProjects)).toEqual({
      project_1: 3,
    });
  });

  it("preserves the existing order and appends new ids", () => {
    expect(
      mergeStableOrder(
        ["project_3", "project_1", "project_2"],
        ["project_2", "project_1", "project_4"],
      ),
    ).toEqual(["project_1", "project_2", "project_4"]);
  });

  it("reorders items according to the retained stable ids", () => {
    const naturallySortedProjects: ProjectSummary[] = [
      createProject({ id: "project_2" }),
      createProject({ id: "project_1" }),
      createProject({ id: "project_4" }),
    ];

    expect(
      reorderItemsByStableOrder(naturallySortedProjects, ["project_1", "project_2", "project_4"]),
    ).toEqual([naturallySortedProjects[1], naturallySortedProjects[0], naturallySortedProjects[2]]);
  });

  it("returns the natural order when there is no stable order yet", () => {
    const naturallySortedProjects: ProjectSummary[] = [
      createProject({ id: "project_2" }),
      createProject({ id: "project_1" }),
    ];

    expect(reorderItemsByStableOrder(naturallySortedProjects, [])).toEqual(naturallySortedProjects);
  });

  it("drops stale ids that no longer exist in the natural order", () => {
    const naturallySortedProjects: ProjectSummary[] = [
      createProject({ id: "project_2" }),
      createProject({ id: "project_1" }),
    ];

    expect(
      reorderItemsByStableOrder(naturallySortedProjects, ["project_9", "project_1", "project_2"]),
    ).toEqual([naturallySortedProjects[1], naturallySortedProjects[0]]);
  });

  it("appends new items that are not yet present in the stable order", () => {
    const naturallySortedProjects: ProjectSummary[] = [
      createProject({ id: "project_2" }),
      createProject({ id: "project_1" }),
      createProject({ id: "project_4" }),
    ];

    expect(reorderItemsByStableOrder(naturallySortedProjects, ["project_1", "project_2"])).toEqual([
      naturallySortedProjects[1],
      naturallySortedProjects[0],
      naturallySortedProjects[2],
    ]);
  });

  it("forces a one-time resort for the first auto refresh after startup watch restore", () => {
    expect(resolveStableRefreshSource("auto", true)).toEqual({
      updateSource: "resort",
      clearStartupWatchResort: true,
    });
  });

  it("keeps later auto refreshes stable after the startup watch resort is consumed", () => {
    expect(resolveStableRefreshSource("auto", false)).toEqual({
      updateSource: "auto",
      clearStartupWatchResort: false,
    });
  });

  it("clears the pending startup watch resort when a manual refresh already resorted", () => {
    expect(resolveStableRefreshSource("manual", true)).toEqual({
      updateSource: "resort",
      clearStartupWatchResort: true,
    });
  });

  it("keeps manual refreshes on resort without clearing anything when no startup watch resort is pending", () => {
    expect(resolveStableRefreshSource("manual", false)).toEqual({
      updateSource: "resort",
      clearStartupWatchResort: false,
    });
  });
});

function createProject(
  overrides: Partial<ProjectSummary> & Pick<ProjectSummary, "id">,
): ProjectSummary {
  const { id, ...rest } = overrides;
  return {
    id,
    provider: "claude",
    name: id,
    path: `/tmp/${id}`,
    providerProjectKey: null,
    repositoryUrl: null,
    resolutionState: null,
    resolutionSource: null,
    sessionCount: 1,
    messageCount: 0,
    bookmarkCount: 0,
    lastActivity: null,
    ...rest,
  };
}
