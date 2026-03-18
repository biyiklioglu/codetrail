import { asRecord, readString } from "../../parsing/helpers";
import type { ResolvedDiscoveryDependencies } from "../shared";
import { readLeadingNonEmptyLines } from "../shared";

export function readCodexJsonlMeta(
  filePath: string,
  dependencies: ResolvedDiscoveryDependencies,
): {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
} {
  const lines = readLeadingNonEmptyLines(filePath, 120, 256 * 1024, dependencies);

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const record = asRecord(parsed);
    if (!record || readString(record.type) !== "session_meta") {
      continue;
    }

    const payload = asRecord(record.payload);
    const git = asRecord(payload?.git);
    sessionId = readString(payload?.id) ?? sessionId;
    cwd = readString(payload?.cwd) ?? cwd;
    gitBranch = readString(git?.branch) ?? gitBranch;

    if (sessionId && cwd) {
      break;
    }
  }

  return { sessionId, cwd, gitBranch };
}
