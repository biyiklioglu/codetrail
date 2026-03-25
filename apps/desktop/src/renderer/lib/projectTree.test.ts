import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "../app/types";
import { buildProjectFolderGroups } from "./projectTree";

function createProjectSummary(
  overrides: Partial<ProjectSummary> & Pick<ProjectSummary, "id" | "provider" | "name" | "path">,
): ProjectSummary {
  const { id, provider, name, path, ...rest } = overrides;
  return {
    id,
    provider,
    name,
    path,
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

const projects: ProjectSummary[] = [
  createProjectSummary({
    id: "project_1",
    provider: "claude",
    name: "Alpha",
    path: "/Users/test/src/alpha",
    sessionCount: 2,
    messageCount: 12,
    lastActivity: "2026-03-01T12:00:00.000Z",
  }),
  createProjectSummary({
    id: "project_2",
    provider: "codex",
    name: "Beta",
    path: "/Users/test/src/beta",
    sessionCount: 9,
    messageCount: 36,
    lastActivity: "2026-03-01T13:00:00.000Z",
  }),
  createProjectSummary({
    id: "project_3",
    provider: "gemini",
    name: "Gamma",
    path: "/tmp/gamma",
    sessionCount: 3,
    messageCount: 14,
    lastActivity: "2026-03-01T10:00:00.000Z",
  }),
  createProjectSummary({
    id: "project_4",
    provider: "claude",
    name: "Loose",
    path: "",
    sessionCount: 1,
    messageCount: 2,
    lastActivity: null,
  }),
];

describe("buildProjectFolderGroups", () => {
  it("groups projects by project folder and uses home-relative labels when possible", () => {
    const groups = buildProjectFolderGroups(projects, "last_active", "desc");

    expect(groups.map((group) => group.label)).toEqual([
      "~/src/beta",
      "~/src/alpha",
      "/tmp/gamma",
      "Other Locations",
    ]);
    expect(groups[0]?.projects.map((project) => project.id)).toEqual(["project_2"]);
  });

  it("sorts folder groups by label using the selected direction in name mode", () => {
    const ascending = buildProjectFolderGroups(projects, "name", "asc");
    const descending = buildProjectFolderGroups(projects, "name", "desc");

    expect(ascending.map((group) => group.label)).toEqual([
      "/tmp/gamma",
      "~/src/alpha",
      "~/src/beta",
      "Other Locations",
    ]);
    expect(descending.map((group) => group.label)).toEqual([
      "~/src/beta",
      "~/src/alpha",
      "/tmp/gamma",
      "Other Locations",
    ]);
  });

  it("aggregates multiple projects that share the same project folder", () => {
    const groups = buildProjectFolderGroups(
      [
        ...projects,
        createProjectSummary({
          id: "project_5",
          provider: "cursor",
          name: "Alpha Two",
          path: "/Users/test/src/alpha",
          sessionCount: 4,
          messageCount: 18,
          lastActivity: "2026-03-01T14:00:00.000Z",
        }),
      ],
      "last_active",
      "desc",
    );

    const alphaGroup = groups.find((group) => group.label === "~/src/alpha");
    expect(alphaGroup).toMatchObject({
      projectCount: 2,
      sessionCount: 6,
      lastActivity: "2026-03-01T14:00:00.000Z",
    });
    expect(alphaGroup?.projects.map((project) => project.id)).toEqual(["project_1", "project_5"]);
  });
});
