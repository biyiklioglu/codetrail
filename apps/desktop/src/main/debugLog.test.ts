import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { appendDebugLog, rotateDebugLogIfNeeded } from "./debugLog";

describe("debugLog retention", () => {
  it("appends without rotating when under the size cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-debug-log-"));
    const logPath = join(dir, "codetrail-debug.log");

    appendDebugLog(logPath, "first line\n", { maxBytes: 1024, maxArchives: 2 });
    appendDebugLog(logPath, "second line\n", { maxBytes: 1024, maxArchives: 2 });

    expect(readFileSync(logPath, "utf8")).toBe("first line\nsecond line\n");
    expect(existsSync(`${logPath}.1`)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("rotates the active log and keeps numbered archives", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-debug-log-"));
    const logPath = join(dir, "codetrail-debug.log");
    writeFileSync(logPath, "1234567890");

    appendDebugLog(logPath, "abcdefghij\n", { maxBytes: 12, maxArchives: 2 });

    expect(readFileSync(logPath, "utf8")).toBe("abcdefghij\n");
    expect(readFileSync(`${logPath}.1`, "utf8")).toBe("1234567890");

    writeFileSync(logPath, "klmnopqrst");
    appendDebugLog(logPath, "uvwxyz\n", { maxBytes: 12, maxArchives: 2 });

    expect(readFileSync(logPath, "utf8")).toBe("uvwxyz\n");
    expect(readFileSync(`${logPath}.1`, "utf8")).toBe("klmnopqrst");
    expect(readFileSync(`${logPath}.2`, "utf8")).toBe("1234567890");

    rmSync(dir, { recursive: true, force: true });
  });

  it("drops archives beyond the configured retention count", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-debug-log-"));
    const logPath = join(dir, "codetrail-debug.log");
    writeFileSync(logPath, "current");
    writeFileSync(`${logPath}.1`, "older-1");
    writeFileSync(`${logPath}.2`, "older-2");
    writeFileSync(`${logPath}.3`, "older-3");

    const rotated = rotateDebugLogIfNeeded(logPath, 10, { maxBytes: 6, maxArchives: 2 });

    expect(rotated).toBe(true);
    expect(readFileSync(`${logPath}.1`, "utf8")).toBe("current");
    expect(readFileSync(`${logPath}.2`, "utf8")).toBe("older-1");
    expect(existsSync(`${logPath}.3`)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
