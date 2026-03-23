import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupStaleEditorTempArtifacts,
  getEditorTempRoot,
  materializeContentTarget,
  resetActiveEditorTempArtifactsForTests,
} from "./editorTempArtifacts";

describe("editorTempArtifacts", () => {
  beforeEach(() => {
    resetActiveEditorTempArtifactsForTests();
  });

  it("writes content artifacts under the dedicated Codetrail temp root", async () => {
    const mkdirMock = vi.fn(async () => undefined);
    const mkdtempMock = vi.fn(async (prefix: string) => `${prefix}abc123`);
    const writeFileMock = vi.fn(async () => undefined);

    const result = await materializeContentTarget(
      {
        kind: "content",
        title: "Notes",
        language: "typescript",
        content: "const a = 1;\n",
      },
      {
        mkdir: mkdirMock as never,
        mkdtemp: mkdtempMock as never,
        writeFile: writeFileMock as never,
      } as never,
    );

    expect(mkdirMock).toHaveBeenCalledWith(getEditorTempRoot(), { recursive: true });
    expect(mkdtempMock).toHaveBeenCalledWith(`${getEditorTempRoot()}/content-`);
    expect(result.filePath).toBe(`${getEditorTempRoot()}/content-abc123/Notes.ts`);
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it("removes stale artifact directories but keeps active ones", async () => {
    const now = 1_000_000;
    const freshDir = "content-fresh";
    const staleDir = "diff-stale";
    const activeDir = await materializeContentTarget(
      {
        kind: "content",
        title: "Active",
        content: "hello\n",
      },
      {
        mkdir: vi.fn(async () => undefined) as never,
        mkdtemp: vi.fn(async (prefix: string) => `${prefix}active`) as never,
        writeFile: vi.fn(async () => undefined) as never,
      } as never,
    );

    const readdirMock = vi.fn(async () => [
      {
        name: freshDir,
        isDirectory: () => true,
      },
      {
        name: staleDir,
        isDirectory: () => true,
      },
      {
        name: "content-active",
        isDirectory: () => true,
      },
    ]);
    const statMock = vi.fn(async (pathValue: string) => ({
      mtimeMs: pathValue.endsWith(staleDir) ? now - 1000 * 60 * 60 * 24 : now,
    }));
    const rmMock = vi.fn(async () => undefined);

    await cleanupStaleEditorTempArtifacts(
      {
        readdir: readdirMock as never,
        stat: statMock as never,
        rm: rmMock as never,
      },
      now,
    );

    expect(rmMock).toHaveBeenCalledWith(`${getEditorTempRoot()}/${staleDir}`, {
      recursive: true,
      force: true,
    });
    expect(rmMock).not.toHaveBeenCalledWith(
      activeDir.filePath.replace(/\/[^/]+$/, ""),
      expect.anything(),
    );
  });
});
