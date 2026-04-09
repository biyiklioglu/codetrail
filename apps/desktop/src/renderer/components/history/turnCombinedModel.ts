import { countUnifiedDiffLines } from "@codetrail/core/tooling/unifiedDiff";

export type TurnCombinedRenderMode = "diff" | "sequence";

export type TurnCombinedSourceMessage = {
  id: string;
  provider: string;
  category: string;
  content: string;
  createdAt: string;
  toolEditFiles?:
    | Array<{
        filePath: string;
        previousFilePath: string | null;
        changeType: "add" | "update" | "delete" | "move";
        unifiedDiff: string | null;
        addedLineCount: number;
        removedLineCount: number;
        exactness: "exact" | "best_effort";
      }>
    | null
    | undefined;
};

export type TurnSequenceEdit = {
  key: string;
  messageId: string;
  createdAt: string;
  provider: string;
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  unifiedDiff: string;
  addedLineCount: number;
  removedLineCount: number;
  exactness: "exact" | "best_effort";
};

export type TurnCombinedFile = {
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  renderMode: TurnCombinedRenderMode;
  displayUnifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  sequenceEdits: TurnSequenceEdit[];
};

export function buildDeleteOnlyDiff(filePath: string): string {
  return [`--- a/${filePath}`, "+++ /dev/null", "@@ -1,1 +0,0 @@", "-[deleted]"].join("\n");
}

export function countDiffLines(diff: string | null): { added: number; removed: number } {
  const counts = countUnifiedDiffLines(diff);
  return { added: counts.addedLineCount, removed: counts.removedLineCount };
}

export function ensureRenderableCombinedDiff(args: {
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: "exact" | "best_effort";
}): {
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  unifiedDiff: string;
  addedLineCount: number;
  removedLineCount: number;
  exactness: "exact" | "best_effort";
} | null {
  if (
    isInternalAssistantArtifactPath(args.filePath) ||
    isInternalAssistantArtifactPath(args.previousFilePath)
  ) {
    return null;
  }
  if (args.unifiedDiff) {
    return {
      ...args,
      unifiedDiff: args.unifiedDiff,
    };
  }
  if (args.changeType !== "delete") {
    return null;
  }
  return {
    ...args,
    unifiedDiff: buildDeleteOnlyDiff(args.previousFilePath ?? args.filePath),
    removedLineCount: Math.max(args.removedLineCount, 1),
    exactness: "best_effort",
  };
}

export function isInternalAssistantArtifactPath(filePath: string | null | undefined): boolean {
  if (!filePath) {
    return false;
  }
  return (
    filePath.includes("/.claude/file-history/") ||
    filePath.includes("/.claude/projects/") ||
    filePath.includes("/tool-results/")
  );
}
