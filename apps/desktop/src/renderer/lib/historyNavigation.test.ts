// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  getAdjacentItemId,
  getAdjacentVisibleProjectTarget,
  getEdgeItemId,
  getFirstVisibleMessageId,
} from "./historyNavigation";

describe("historyNavigation", () => {
  it("falls back to the first item when there is no current selection", () => {
    expect(getAdjacentItemId([{ id: "first" }, { id: "second" }], "", "next")).toBe("first");
  });

  it("returns the adjacent item in the requested direction", () => {
    expect(
      getAdjacentItemId([{ id: "first" }, { id: "second" }, { id: "third" }], "second", "next"),
    ).toBe("third");
    expect(
      getAdjacentItemId([{ id: "first" }, { id: "second" }, { id: "third" }], "second", "previous"),
    ).toBe("first");
  });

  it("returns null when moving past the ends", () => {
    expect(getAdjacentItemId([{ id: "first" }], "first", "previous")).toBeNull();
    expect(getAdjacentItemId([{ id: "first" }], "first", "next")).toBeNull();
  });

  it("returns the requested edge item", () => {
    expect(getEdgeItemId([{ id: "first" }, { id: "second" }], "next")).toBe("first");
    expect(getEdgeItemId([{ id: "first" }, { id: "second" }], "previous")).toBe("second");
  });

  it("prefers the first visible message element", () => {
    const container = document.createElement("div");
    const first = document.createElement("article");
    first.dataset.historyMessageId = "m1";
    const second = document.createElement("article");
    second.dataset.historyMessageId = "m2";
    const third = document.createElement("article");
    third.dataset.historyMessageId = "m3";
    container.append(first, second, third);

    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ top: 100, bottom: 200 }),
      configurable: true,
    });
    Object.defineProperty(first, "getBoundingClientRect", {
      value: () => ({ top: 20, bottom: 80 }),
      configurable: true,
    });
    Object.defineProperty(second, "getBoundingClientRect", {
      value: () => ({ top: 110, bottom: 150 }),
      configurable: true,
    });
    Object.defineProperty(third, "getBoundingClientRect", {
      value: () => ({ top: 210, bottom: 260 }),
      configurable: true,
    });

    expect(getFirstVisibleMessageId(container)).toBe("m2");
  });

  it("falls back to the first message when layout information is unavailable", () => {
    const container = document.createElement("div");
    const first = document.createElement("article");
    first.dataset.historyMessageId = "m1";
    const second = document.createElement("article");
    second.dataset.historyMessageId = "m2";
    container.append(first, second);

    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ top: 0, bottom: 0 }),
      configurable: true,
    });

    expect(getFirstVisibleMessageId(container)).toBe("m1");
  });

  it("treats a collapsed folder row as the next selectable visible target", () => {
    const container = document.createElement("div");
    const current = document.createElement("button");
    current.dataset.projectNavKind = "project";
    current.dataset.projectNavId = "project_1";
    const folder = document.createElement("button");
    folder.dataset.projectNavKind = "folder";
    folder.dataset.folderId = "folder_a";
    folder.dataset.folderFirstProjectId = "project_2";
    folder.dataset.folderLastProjectId = "project_3";
    folder.setAttribute("aria-expanded", "false");
    container.append(current, folder);

    const target = getAdjacentVisibleProjectTarget(
      container,
      { kind: "project", id: "project_1" },
      "next",
    );
    expect(target?.kind).toBe("folder");
    expect(target?.id).toBe("folder_a");
  });

  it("selects a collapsed folder row when moving upward into it", () => {
    const container = document.createElement("div");
    const folder = document.createElement("button");
    folder.dataset.projectNavKind = "folder";
    folder.dataset.folderId = "folder_b";
    folder.dataset.folderFirstProjectId = "project_2";
    folder.dataset.folderLastProjectId = "project_3";
    folder.setAttribute("aria-expanded", "false");
    const current = document.createElement("button");
    current.dataset.projectNavKind = "project";
    current.dataset.projectNavId = "project_4";
    container.append(folder, current);

    const target = getAdjacentVisibleProjectTarget(
      container,
      { kind: "project", id: "project_4" },
      "previous",
    );
    expect(target?.kind).toBe("folder");
    expect(target?.id).toBe("folder_b");
  });
});
