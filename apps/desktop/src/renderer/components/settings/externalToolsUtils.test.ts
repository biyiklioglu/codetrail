import { describe, expect, it } from "vitest";

import { createCustomExternalTool, createKnownExternalTool } from "../../../shared/uiPreferences";
import { moveToolById, parseSingleLineArgs, serializeSingleLineArgs } from "./externalToolsUtils";

describe("externalToolsUtils", () => {
  it("keeps preset moves inside the preset section", () => {
    const presetA = createKnownExternalTool("vscode");
    const custom = {
      ...createCustomExternalTool("editor", 1),
      id: "custom:1",
      label: "Custom",
    };
    const presetB = createKnownExternalTool("cursor");

    const moved = moveToolById([presetA, custom, presetB], presetA.id, "down");

    expect(moved.map((tool) => tool.id)).toEqual([presetB.id, custom.id, presetA.id]);
  });

  it("keeps custom moves inside the custom section", () => {
    const preset = createKnownExternalTool("vscode");
    const customA = {
      ...createCustomExternalTool("editor", 1),
      id: "custom:1",
      label: "Custom A",
    };
    const customB = {
      ...createCustomExternalTool("editor", 2),
      id: "custom:2",
      label: "Custom B",
    };

    const moved = moveToolById([preset, customA, customB], customB.id, "up");

    expect(moved.map((tool) => tool.id)).toEqual([preset.id, customB.id, customA.id]);
  });

  it("parses quoted and escaped single-line args", () => {
    expect(
      parseSingleLineArgs(`--title "hello world" --path src\\/main.ts 'two words' plain\\ value`),
    ).toEqual(["--title", "hello world", "--path", "src/main.ts", "two words", "plain value"]);
  });

  it("serializes args so they round-trip through the parser", () => {
    const args = ["--title", "hello world", 'say "hi"', "plain"];

    expect(parseSingleLineArgs(serializeSingleLineArgs(args))).toEqual(args);
  });
});
