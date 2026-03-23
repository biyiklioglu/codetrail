import { describe, expect, it, vi } from "vitest";

import {
  createCustomExternalTool,
  createKnownExternalTool,
  createKnownToolId,
} from "../shared/uiPreferences";
import type { PaneState } from "./appStateStore";
import { listAvailableEditors, openInEditor } from "./editorRegistry";

const basePaneState: PaneState = {
  projectPaneWidth: 240,
  sessionPaneWidth: 320,
  preferredExternalEditor: createKnownToolId("vscode"),
  preferredExternalDiffTool: createKnownToolId("vscode"),
  externalTools: [createKnownExternalTool("vscode")],
};

describe("editorRegistry", () => {
  it("detects path-installed editors and reports capabilities", async () => {
    const response = await listAvailableEditors(basePaneState, {
      execFile: vi.fn(async (_command, args: string[]) => {
        const target = args[0];
        if (target === "code") {
          return { stdout: "/usr/bin/code\n", stderr: "" };
        }
        throw new Error("missing");
      }) as never,
      access: vi.fn(async () => undefined) as never,
    });

    const vscode = response.editors.find((editor) => editor.id === createKnownToolId("vscode"));
    expect(vscode).toEqual({
      id: createKnownToolId("vscode"),
      kind: "known",
      label: "VS Code",
      appId: "vscode",
      detected: true,
      command: "/usr/bin/code",
      args: [],
      capabilities: {
        openFile: true,
        openAtLineColumn: true,
        openContent: true,
        openDiff: true,
      },
    });
  });

  it("detects Text Edit as a known macOS view-only preset", async () => {
    const accessMock = vi.fn(async (target: string) => {
      if (target === "/System/Applications/TextEdit.app") {
        return;
      }
      throw new Error("missing");
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const response = await listAvailableEditors(
        {
          ...basePaneState,
          externalTools: [createKnownExternalTool("text_edit")],
          preferredExternalEditor: createKnownToolId("text_edit"),
          preferredExternalDiffTool: "",
        },
        {
          execFile: vi.fn(async () => {
            throw new Error("missing");
          }) as never,
          access: accessMock as never,
        },
      );

      expect(response.editors[0]).toEqual({
        id: createKnownToolId("text_edit"),
        kind: "known",
        label: "Text Edit",
        appId: "text_edit",
        detected: true,
        command: "/System/Applications/TextEdit.app",
        args: [],
        capabilities: {
          openFile: true,
          openAtLineColumn: false,
          openContent: true,
          openDiff: false,
        },
      });
      expect(response.diffTools.some((tool) => tool.id === createKnownToolId("text_edit"))).toBe(
        false,
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process, "platform", originalDescriptor);
      }
    }
  });

  it("opens files in Text Edit through open -a", async () => {
    const spawned = vi.fn(() => ({ unref: vi.fn() })) as never;
    const accessMock = vi.fn(async (target: string) => {
      if (target === "/System/Applications/TextEdit.app") {
        return;
      }
      throw new Error("missing");
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const result = await openInEditor(
        {
          kind: "file",
          filePath: "/workspace/notes.txt",
        },
        {
          ...basePaneState,
          externalTools: [createKnownExternalTool("text_edit")],
          preferredExternalEditor: createKnownToolId("text_edit"),
          preferredExternalDiffTool: "",
        },
        {
          execFile: vi.fn(async () => {
            throw new Error("missing");
          }) as never,
          access: accessMock as never,
          spawn: spawned,
        },
      );

      expect(result).toEqual({ ok: true, error: null });
      expect(spawned).toHaveBeenCalledWith(
        "/usr/bin/open",
        ["-a", "/System/Applications/TextEdit.app", "/workspace/notes.txt"],
        expect.objectContaining({ detached: true }),
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process, "platform", originalDescriptor);
      }
    }
  });

  it("opens files in VS Code using --goto when line metadata exists", async () => {
    const spawned = vi.fn(() => ({ unref: vi.fn() })) as never;
    const result = await openInEditor(
      {
        kind: "file",
        filePath: "/workspace/app.ts",
        line: 12,
        column: 4,
      },
      basePaneState,
      {
        execFile: vi.fn(async (_command, args: string[]) => {
          const target = args[0];
          if (target === "code") {
            return { stdout: "/usr/bin/code\n", stderr: "" };
          }
          throw new Error("missing");
        }) as never,
        access: vi.fn(async () => undefined) as never,
        spawn: spawned,
      },
    );

    expect(result).toEqual({ ok: true, error: null });
    expect(spawned).toHaveBeenCalledWith(
      "/usr/bin/code",
      ["--goto", "/workspace/app.ts:12:4"],
      expect.objectContaining({ detached: true }),
    );
  });

  it("materializes diff snapshots for supported compare editors", async () => {
    const spawned = vi.fn(() => ({ unref: vi.fn() })) as never;
    const result = await openInEditor(
      {
        kind: "diff",
        title: "app.ts",
        filePath: "/workspace/app.ts",
        leftContent: "const a = 1;\n",
        rightContent: "const a = 2;\n",
      },
      basePaneState,
      {
        execFile: vi.fn(async (_command, args: string[]) => {
          const target = args[0];
          if (target === "code") {
            return { stdout: "/usr/bin/code\n", stderr: "" };
          }
          throw new Error("missing");
        }) as never,
        access: vi.fn(async () => undefined) as never,
        spawn: spawned,
        mkdtemp: vi.fn(async () => "/tmp/codetrail-diff-123") as never,
        writeFile: vi.fn(async () => undefined) as never,
      },
    );

    expect(result).toEqual({ ok: true, error: null });
    expect(spawned).toHaveBeenCalledWith(
      "/usr/bin/code",
      ["--diff", "/tmp/codetrail-diff-123/app.before.ts", "/tmp/codetrail-diff-123/app.after.ts"],
      expect.any(Object),
    );
  });

  it("uses custom command placeholders when configured", async () => {
    const spawned = vi.fn(() => ({ unref: vi.fn() })) as never;
    const result = await openInEditor(
      {
        kind: "file",
        editorId: "editor:custom",
        filePath: "/workspace/app.ts",
        line: 3,
        column: 9,
      },
      {
        ...basePaneState,
        preferredExternalEditor: "editor:custom",
        externalTools: [
          {
            ...createCustomExternalTool("editor", 1),
            id: "editor:custom",
            label: "Custom Editor",
            command: "my-editor",
            editorArgs: ["{file}", "{line}", "{column}"],
            diffArgs: ["{left}", "{right}"],
            enabledForEditor: true,
            enabledForDiff: false,
          },
        ],
      },
      {
        execFile: vi.fn(async (_command, args: string[]) => {
          if (args[0] === "my-editor") {
            return { stdout: "/usr/local/bin/my-editor\n", stderr: "" };
          }
          throw new Error("skip");
        }) as never,
        access: vi.fn(async () => undefined) as never,
        spawn: spawned,
      },
    );

    expect(result).toEqual({ ok: true, error: null });
    expect(spawned).toHaveBeenCalledWith(
      "/usr/local/bin/my-editor",
      ["/workspace/app.ts", "3", "9"],
      expect.any(Object),
    );
  });

  it("does not launch custom file editors when filePath is missing", async () => {
    const spawned = vi.fn(() => ({ unref: vi.fn() })) as never;

    const result = await openInEditor(
      {
        kind: "file",
        editorId: "editor:custom",
      } as never,
      {
        ...basePaneState,
        preferredExternalEditor: "editor:custom",
        externalTools: [
          {
            ...createCustomExternalTool("editor", 1),
            id: "editor:custom",
            label: "Custom Editor",
            command: "my-editor",
            editorArgs: ["{file}"],
            diffArgs: ["{left}", "{right}"],
            enabledForEditor: true,
            enabledForDiff: false,
          },
        ],
      },
      {
        execFile: vi.fn(async (_command, args: string[]) => {
          if (args[0] === "my-editor") {
            return { stdout: "/usr/local/bin/my-editor\n", stderr: "" };
          }
          throw new Error("skip");
        }) as never,
        access: vi.fn(async () => undefined) as never,
        spawn: spawned,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: "Unable to build a launch command for Custom Editor.",
    });
    expect(spawned).not.toHaveBeenCalled();
  });

  it("launches custom macOS app bundles through open -a for file opens", async () => {
    const spawnMock = vi.fn((_command: string, _args: string[], _options: unknown) => ({
      unref: vi.fn(),
    }));
    const spawned = spawnMock as never;
    const accessMock = vi.fn(async () => undefined);
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const result = await openInEditor(
        {
          kind: "content",
          title: "Notes",
          content: "hello",
          editorId: "editor:custom:bundle",
        },
        {
          ...basePaneState,
          preferredExternalEditor: "editor:custom:bundle",
          externalTools: [
            {
              ...createCustomExternalTool("editor", 1),
              id: "editor:custom:bundle",
              label: "TextEdit",
              command: "/System/Applications/TextEdit.app",
              editorArgs: ["{file}"],
              diffArgs: ["{left}", "{right}"],
              enabledForEditor: true,
              enabledForDiff: false,
            },
          ],
        },
        {
          execFile: vi.fn(async () => {
            throw new Error("skip");
          }) as never,
          access: accessMock as never,
          spawn: spawned,
          mkdtemp: vi.fn(async () => "/tmp/codetrail-content-123") as never,
          writeFile: vi.fn(async () => undefined) as never,
        },
      );

      expect(result).toEqual({ ok: true, error: null });
      expect(spawnMock).toHaveBeenCalledWith(
        "/usr/bin/open",
        ["-a", "/System/Applications/TextEdit.app", "/tmp/codetrail-content-123/Notes.txt"],
        expect.any(Object),
      );
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process, "platform", originalDescriptor);
      }
    }
  });

  it("launches Neovim through Terminal on macOS", async () => {
    const spawnMock = vi.fn((_command: string, _args: string[], _options: unknown) => ({
      unref: vi.fn(),
    }));
    const spawned = spawnMock as never;
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const result = await openInEditor(
        {
          kind: "file",
          editorId: createKnownToolId("neovim"),
          filePath: "/workspace/app.ts",
          line: 7,
          column: 2,
        },
        {
          ...basePaneState,
          preferredExternalEditor: createKnownToolId("neovim"),
          externalTools: [createKnownExternalTool("neovim")],
        },
        {
          execFile: vi.fn(async (_command, args: string[]) => {
            if (args[0] === "nvim") {
              return { stdout: "/opt/homebrew/bin/nvim\n", stderr: "" };
            }
            throw new Error("missing");
          }) as never,
          access: vi.fn(async () => undefined) as never,
          spawn: spawned,
        },
      );

      expect(result).toEqual({ ok: true, error: null });
      expect(spawnMock).toHaveBeenCalledWith(
        "/usr/bin/osascript",
        expect.arrayContaining(["-e", 'tell application "Terminal"', "-e", "activate"]),
        expect.any(Object),
      );
      expect(JSON.stringify(spawnMock.mock.calls[0]?.[1])).toContain("/opt/homebrew/bin/nvim");
      expect(JSON.stringify(spawnMock.mock.calls[0]?.[1])).toContain("/workspace/app.ts");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process, "platform", originalDescriptor);
      }
    }
  });

  it("launches Neovim through a custom macOS app-bundle terminal", async () => {
    const spawnMock = vi.fn((_command: string, _args: string[], _options: unknown) => ({
      unref: vi.fn(),
    }));
    const spawned = spawnMock as never;
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const result = await openInEditor(
        {
          kind: "file",
          editorId: createKnownToolId("neovim"),
          filePath: "/workspace/app.ts",
        },
        {
          ...basePaneState,
          preferredExternalEditor: createKnownToolId("neovim"),
          terminalAppCommand: "/Applications/kitty.app",
          externalTools: [createKnownExternalTool("neovim")],
        },
        {
          execFile: vi.fn(async (_command, args: string[]) => {
            if (args[0] === "nvim") {
              return { stdout: "/opt/homebrew/bin/nvim\n", stderr: "" };
            }
            throw new Error("missing");
          }) as never,
          access: vi.fn(async () => undefined) as never,
          spawn: spawned,
        },
      );

      expect(result).toEqual({ ok: true, error: null });
      expect(spawnMock).toHaveBeenCalledWith(
        "/Applications/kitty.app/Contents/MacOS/kitty",
        expect.arrayContaining(["/bin/zsh", "-lc"]),
        expect.any(Object),
      );
      expect(JSON.stringify(spawnMock.mock.calls[0]?.[1])).toContain("/opt/homebrew/bin/nvim");
      expect(JSON.stringify(spawnMock.mock.calls[0]?.[1])).toContain("/workspace/app.ts");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(process, "platform", originalDescriptor);
      }
    }
  });
});
