import type { ExternalEditorId, ExternalToolConfig } from "../../../shared/uiPreferences";

export function parseSingleLineArgs(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  for (const character of value) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaping) {
    current += "\\";
  }
  if (current.length > 0 || quote !== null) {
    args.push(current);
  }
  return args;
}

export function serializeSingleLineArgs(args: string[]): string {
  return args
    .map((arg) => {
      if (!/[\s"'\\]/.test(arg)) {
        return arg;
      }
      return `"${arg.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    })
    .join(" ");
}
export function pickPreferredToolId(
  preferredId: ExternalEditorId,
  tools: Array<{ id: ExternalEditorId }>,
): ExternalEditorId {
  if (tools.some((tool) => tool.id === preferredId)) {
    return preferredId;
  }
  return tools[0]?.id ?? "";
}

export function createToolMonogram(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? (trimmed[0]?.toUpperCase() ?? "?") : "?";
}

export function moveToolById(
  tools: ExternalToolConfig[],
  toolId: string,
  direction: "up" | "down",
): ExternalToolConfig[] {
  const currentIndex = tools.findIndex((tool) => tool.id === toolId);
  if (currentIndex < 0) {
    return tools;
  }
  const currentTool = tools[currentIndex];
  if (!currentTool) {
    return tools;
  }
  const isPresetTool = currentTool.kind === "known";
  const sectionIndexes = tools.reduce<number[]>((indexes, tool, index) => {
    if ((tool.kind === "known") === isPresetTool) {
      indexes.push(index);
    }
    return indexes;
  }, []);
  const sectionIndex = sectionIndexes.indexOf(currentIndex);
  if (sectionIndex < 0) {
    return tools;
  }
  const targetSectionIndex = direction === "up" ? sectionIndex - 1 : sectionIndex + 1;
  const targetIndex = sectionIndexes[targetSectionIndex];
  if (targetIndex === undefined) {
    return tools;
  }
  const next = [...tools];
  const targetTool = next[targetIndex];
  if (!targetTool) {
    return tools;
  }
  next[targetIndex] = currentTool;
  next[currentIndex] = targetTool;
  return next;
}
