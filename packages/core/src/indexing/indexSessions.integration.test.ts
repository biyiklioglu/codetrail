import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { openDatabase } from "../db/bootstrap";
import type { DiscoveryConfig } from "../discovery";
import { makeSessionId } from "./ids";
import { runIncrementalIndexing } from "./indexSessions";

function createDiscoveryConfig(dir: string): DiscoveryConfig {
  return {
    claudeRoot: join(dir, ".claude", "projects"),
    codexRoot: join(dir, ".codex", "sessions"),
    geminiRoot: join(dir, ".gemini", "tmp"),
    geminiHistoryRoot: join(dir, ".gemini", "history"),
    geminiProjectsPath: join(dir, ".gemini", "projects.json"),
    cursorRoot: join(dir, ".cursor", "projects"),
    copilotRoot: join(dir, ".copilot-workspace"),
    includeClaudeSubagents: false,
  };
}

function tombstoneSession(dbPath: string, filePath: string): void {
  const db = openDatabase(dbPath);
  // These indexing tests live below the query-service layer, so they build the tombstone row
  // directly instead of reaching across package boundaries into the desktop delete plumbing.
  const indexed = db
    .prepare(
      `SELECT file_path, provider, project_path, session_identity, file_size, file_mtime_ms
       FROM indexed_files
       WHERE file_path = ?`,
    )
    .get(filePath) as {
    file_path: string;
    provider: string;
    project_path: string;
    session_identity: string;
    file_size: number;
    file_mtime_ms: number;
  };
  const checkpoint = db
    .prepare(
      `SELECT session_id, last_offset_bytes, last_line_number, last_event_index,
              next_message_sequence, processing_state_json, source_metadata_json,
              head_hash, tail_hash
       FROM index_checkpoints
       WHERE file_path = ?`,
    )
    .get(filePath) as
    | {
        session_id: string;
        last_offset_bytes: number | null;
        last_line_number: number | null;
        last_event_index: number | null;
        next_message_sequence: number | null;
        processing_state_json: string | null;
        source_metadata_json: string | null;
        head_hash: string | null;
        tail_hash: string | null;
      }
    | undefined;
  const session = db.prepare("SELECT id FROM sessions WHERE file_path = ?").get(filePath) as {
    id: string;
  };

  db.prepare(
    `INSERT INTO deleted_sessions (
      file_path,
      provider,
      project_path,
      session_identity,
      session_id,
      deleted_at_ms,
      file_size,
      file_mtime_ms,
      last_offset_bytes,
      last_line_number,
      last_event_index,
      next_message_sequence,
      processing_state_json,
      source_metadata_json,
      head_hash,
      tail_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    indexed.file_path,
    indexed.provider,
    indexed.project_path,
    indexed.session_identity,
    checkpoint?.session_id ?? session.id,
    Date.now(),
    indexed.file_size,
    indexed.file_mtime_ms,
    checkpoint?.last_offset_bytes ?? null,
    checkpoint?.last_line_number ?? null,
    checkpoint?.last_event_index ?? null,
    checkpoint?.next_message_sequence ?? null,
    checkpoint?.processing_state_json ?? null,
    checkpoint?.source_metadata_json ?? null,
    checkpoint?.head_hash ?? null,
    checkpoint?.tail_hash ?? null,
  );

  db.prepare(
    "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
  ).run(session.id);
  db.prepare("DELETE FROM message_fts WHERE session_id = ?").run(session.id);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(session.id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
  db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(filePath);
  db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(filePath);
  db.close();
}

describe("runIncrementalIndexing", () => {
  it("purges disabled providers during incremental indexing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-enabled-providers-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session-1.jsonl"),
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello Claude" }],
        },
      })}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, "rollout-codex-1.jsonl"),
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T11:00:00Z",
          type: "session_meta",
          payload: { id: "codex-session-1", cwd: "/workspace/codex", git: { branch: "dev" } },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done Codex" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      includeClaudeSubagents: false,
    };

    runIncrementalIndexing({ dbPath, discoveryConfig });
    const filtered = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
      enabledProviders: ["claude"],
    });

    expect(filtered.discoveredFiles).toBe(1);
    expect(filtered.removedFiles).toBe(1);

    const db = openDatabase(dbPath);
    try {
      expect(
        (
          db.prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'claude'").get() as {
            c: number;
          }
        ).c,
      ).toBe(1);
      expect(
        (
          db.prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'codex'").get() as {
            c: number;
          }
        ).c,
      ).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retains missing session files during incremental indexing by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-missing-retain-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello Claude" }],
        },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      includeClaudeSubagents: false,
    };

    runIncrementalIndexing({ dbPath, discoveryConfig });
    rmSync(sessionFile);

    const second = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(second.removedFiles).toBe(0);

    const db = openDatabase(dbPath);
    try {
      expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(1);
      expect((db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c).toBe(
        1,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes missing session files during incremental indexing when enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-missing-prune-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello Claude" }],
        },
      })}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      includeClaudeSubagents: false,
    };

    runIncrementalIndexing({ dbPath, discoveryConfig });
    rmSync(sessionFile);

    const second = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
      removeMissingSessionsDuringIncrementalIndexing: true,
    });
    expect(second.removedFiles).toBe(1);

    const db = openDatabase(dbPath);
    try {
      expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
      expect((db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }).c).toBe(
        0,
      );
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("indexes incrementally, supports force rebuild, and rebuilds on schema-version mismatch", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-a");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session-1.jsonl"),
      `${[
        JSON.stringify({
          sessionId: "claude-session-1",
          type: "user",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-02-27T10:00:00Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "Hello Claude" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-session-1",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-02-27T10:00:05Z",
          message: {
            model: "claude-opus-4-6",
            role: "assistant",
            content: [
              { type: "thinking", text: "Thinking" },
              { type: "text", text: "Done" },
              { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
            ],
            usage: { input_tokens: 10, output_tokens: 7 },
          },
        }),
      ].join("\n")}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    const codexFile = join(codexRoot, "rollout-codex-1.jsonl");
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T11:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            cwd: "/workspace/codex",
            git: { branch: "dev" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:01Z",
          type: "turn_context",
          payload: {
            model: "gpt-5-codex",
            cwd: "/workspace/codex",
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:02Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello Codex" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Done Codex" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const geminiRoot = join(dir, ".gemini", "tmp");
    const geminiHistoryRoot = join(dir, ".gemini", "history");
    mkdirSync(join(geminiRoot, "dux", "chats"), { recursive: true });
    mkdirSync(join(geminiHistoryRoot, "dux"), { recursive: true });
    writeFileSync(join(geminiRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(join(geminiHistoryRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(
      join(geminiRoot, "dux", "chats", "session-1.json"),
      JSON.stringify({
        sessionId: "gemini-session-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
        startTime: "2026-02-27T12:00:00Z",
        lastUpdated: "2026-02-27T12:00:10Z",
        messages: [
          {
            id: "g-user-1",
            type: "user",
            timestamp: "2026-02-27T12:00:00Z",
            content: "Hello Gemini",
          },
          {
            id: "g-assistant-1",
            type: "gemini",
            model: "gemini-2.5-pro",
            timestamp: "2026-02-27T12:00:01Z",
            content: "Done Gemini",
          },
        ],
      }),
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot,
      geminiHistoryRoot,
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      includeClaudeSubagents: false,
    };

    const first = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(first.discoveredFiles).toBe(3);
    expect(first.indexedFiles).toBe(3);
    expect(first.skippedFiles).toBe(0);
    expect(first.removedFiles).toBe(0);

    const dbAfterFirst = openDatabase(dbPath);
    const countsAfterFirst = {
      projects: (dbAfterFirst.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number })
        .c,
      sessions: (dbAfterFirst.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number })
        .c,
      messages: (dbAfterFirst.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number })
        .c,
      indexed: (
        dbAfterFirst.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number }
      ).c,
      checkpoints: (
        dbAfterFirst.prepare("SELECT COUNT(*) as c FROM index_checkpoints").get() as { c: number }
      ).c,
    };
    const claudeSessionId = makeSessionId("claude", "claude-session-1");
    const claudeAggregate = dbAfterFirst
      .prepare(
        `SELECT title, message_count, token_input_total, token_output_total, model_names, git_branch, cwd
         FROM sessions WHERE id = ?`,
      )
      .get(claudeSessionId) as {
      title: string;
      message_count: number;
      token_input_total: number;
      token_output_total: number;
      model_names: string;
      git_branch: string;
      cwd: string;
    };
    const derivedDurationCount = (
      dbAfterFirst
        .prepare(
          `SELECT COUNT(*) as c
           FROM messages
           WHERE operation_duration_source = 'derived'
             AND operation_duration_confidence = 'high'
             AND operation_duration_ms IS NOT NULL`,
        )
        .get() as { c: number }
    ).c;
    dbAfterFirst.close();

    expect(countsAfterFirst.projects).toBe(3);
    expect(countsAfterFirst.sessions).toBe(3);
    expect(countsAfterFirst.messages).toBeGreaterThan(0);
    expect(countsAfterFirst.indexed).toBe(3);
    expect(countsAfterFirst.checkpoints).toBe(2);
    expect(claudeAggregate.title).toBe("Hello Claude");
    expect(claudeAggregate.message_count).toBeGreaterThanOrEqual(3);
    expect(claudeAggregate.token_input_total).toBe(10);
    expect(claudeAggregate.token_output_total).toBe(7);
    expect(claudeAggregate.model_names).toContain("claude-opus-4-6");
    expect(claudeAggregate.git_branch).toBe("main");
    expect(claudeAggregate.cwd).toBe("/workspace/claude");
    expect(derivedDurationCount).toBeGreaterThan(0);

    const second = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(second.indexedFiles).toBe(0);
    expect(second.skippedFiles).toBe(3);

    const dbBeforeHeal = openDatabase(dbPath);
    const codexSessionRow = dbBeforeHeal
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string } | undefined;
    if (codexSessionRow) {
      dbBeforeHeal
        .prepare(
          "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
        )
        .run(codexSessionRow.id);
      dbBeforeHeal.prepare("DELETE FROM message_fts WHERE session_id = ?").run(codexSessionRow.id);
      dbBeforeHeal.prepare("DELETE FROM messages WHERE session_id = ?").run(codexSessionRow.id);
      dbBeforeHeal.prepare("DELETE FROM sessions WHERE id = ?").run(codexSessionRow.id);
    }
    dbBeforeHeal.close();

    const healed = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(healed.indexedFiles).toBe(1);
    expect(healed.skippedFiles).toBe(2);

    appendFileSync(
      codexFile,
      `${JSON.stringify({
        timestamp: "2026-02-27T11:00:04Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Extra line" }],
        },
      })}\n`,
    );
    const now = new Date();
    utimesSync(codexFile, now, now);

    const third = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(third.indexedFiles).toBe(1);
    expect(third.skippedFiles).toBe(2);

    const dbAfterThird = openDatabase(dbPath);
    const codexMessageCount = dbAfterThird
      .prepare("SELECT message_count FROM sessions WHERE provider = 'codex' AND file_path = ?")
      .get(codexFile) as { message_count: number };
    const codexCheckpoint = dbAfterThird
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    dbAfterThird.close();

    expect(codexMessageCount.message_count).toBeGreaterThanOrEqual(3);
    expect(codexCheckpoint.last_offset_bytes).toBe(codexCheckpoint.file_size);

    const force = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
      forceReindex: true,
    });

    expect(force.indexedFiles).toBe(3);
    expect(force.skippedFiles).toBe(0);

    const dbBeforeRebuild = openDatabase(dbPath);
    dbBeforeRebuild.exec(`UPDATE meta SET value = '999' WHERE key = 'schema_version'`);
    dbBeforeRebuild.close();

    const rebuilt = runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    expect(rebuilt.schemaRebuilt).toBe(true);
    expect(rebuilt.indexedFiles).toBe(3);

    rmSync(dir, { recursive: true, force: true });
  });

  it("streams large codex session files without routing them through readFileText", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-oversized-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "08", "oversized.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-oversized",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Indexed before it grew too large" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const oversizedRead = vi.fn(() => {
      throw new Error("streamed codex file should not use readFileText");
    });
    const sessionIdentity = "codex:codex-session-oversized:test";
    const result = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles: () => [
          {
            provider: "codex",
            projectPath: "/workspace/codex",
            projectName: "codex",
            sessionIdentity,
            sourceSessionId: "codex-session-oversized",
            filePath: codexFile,
            fileSize: 256 * 1024 * 1024,
            fileMtimeMs: Date.parse("2026-03-08T10:05:00Z"),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: "main",
              cwd: "/workspace/codex",
            },
          },
        ],
        readFileText: oversizedRead,
      },
    );

    expect(result.discoveredFiles).toBe(1);
    expect(result.indexedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(oversizedRead).not.toHaveBeenCalled();

    const db = openDatabase(dbPath);
    const sessionCount = db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number };
    const messageCount = db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number };
    db.close();

    expect(sessionCount.c).toBe(1);
    expect(messageCount.c).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not checkpoint past an unterminated trailing codex JSONL line", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-partial-line-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "19", "partial.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-19T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-partial",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-19T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            id: "before-append",
            role: "user",
            content: [{ type: "input_text", text: "Before append" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoveryConfig: Partial<DiscoveryConfig> = {
      codexRoot: join(dir, ".codex", "sessions"),
      enabledProviders: ["codex"],
    };

    const first = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(first.indexedFiles).toBe(1);

    appendFileSync(
      codexFile,
      JSON.stringify({
        timestamp: "2026-03-19T10:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "after-append",
          role: "assistant",
          content: [{ type: "output_text", text: "After append" }],
        },
      }).slice(0, -12),
    );
    const partialNow = new Date();
    utimesSync(codexFile, partialNow, partialNow);

    const second = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(second.indexedFiles).toBe(1);

    const dbAfterPartial = openDatabase(dbPath);
    const partialCheckpoint = dbAfterPartial
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const partialSession = dbAfterPartial
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const partialMessages = dbAfterPartial
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(partialSession.id) as Array<{
      content: string;
    }>;
    dbAfterPartial.close();

    expect(partialCheckpoint.last_offset_bytes).toBeLessThan(partialCheckpoint.file_size);
    expect(partialMessages.map((message) => message.content)).toEqual(["Before append"]);

    appendFileSync(codexFile, ' append"}]}}\n');
    const completedNow = new Date();
    utimesSync(codexFile, completedNow, completedNow);

    const third = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(third.indexedFiles).toBe(1);

    const dbAfterCompletion = openDatabase(dbPath);
    const completedCheckpoint = dbAfterCompletion
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const completedSession = dbAfterCompletion
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const completedMessages = dbAfterCompletion
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(completedSession.id) as Array<{
      content: string;
    }>;
    dbAfterCompletion.close();

    expect(completedCheckpoint.last_offset_bytes).toBe(completedCheckpoint.file_size);
    expect(completedMessages.map((message) => message.content)).toEqual([
      "Before append",
      "After append",
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("does not checkpoint past an unterminated trailing oversized codex JSONL line", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-partial-oversized-line-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "19", "partial-oversized.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-19T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-partial-oversized",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-19T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            id: "before-append",
            role: "user",
            content: [{ type: "input_text", text: "Before append" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoveryConfig: Partial<DiscoveryConfig> = {
      codexRoot: join(dir, ".codex", "sessions"),
      enabledProviders: ["codex"],
    };

    const first = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(first.indexedFiles).toBe(1);

    appendFileSync(
      codexFile,
      JSON.stringify({
        timestamp: "2026-03-19T10:00:02Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          output: "x".repeat(33 * 1024 * 1024),
        },
      }).slice(0, -32),
    );
    const partialNow = new Date();
    utimesSync(codexFile, partialNow, partialNow);

    const second = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(second.indexedFiles).toBe(1);

    const dbAfterPartial = openDatabase(dbPath);
    const partialCheckpoint = dbAfterPartial
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const partialSession = dbAfterPartial
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const partialMessages = dbAfterPartial
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(partialSession.id) as Array<{
      content: string;
    }>;
    dbAfterPartial.close();

    expect(partialCheckpoint.last_offset_bytes).toBeLessThan(partialCheckpoint.file_size);
    expect(partialMessages.map((message) => message.content)).toEqual(["Before append"]);

    appendFileSync(
      codexFile,
      `${'x'.repeat(32)}"}\n${JSON.stringify({
        timestamp: "2026-03-19T10:00:03Z",
        type: "response_item",
        payload: {
          type: "message",
          id: "after-append",
          role: "assistant",
          content: [{ type: "output_text", text: "After append" }],
        },
      })}\n`,
    );
    const completedNow = new Date();
    utimesSync(codexFile, completedNow, completedNow);

    const third = runIncrementalIndexing({ dbPath, discoveryConfig });
    expect(third.indexedFiles).toBe(1);

    const dbAfterCompletion = openDatabase(dbPath);
    const completedCheckpoint = dbAfterCompletion
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    const completedSession = dbAfterCompletion
      .prepare("SELECT id FROM sessions WHERE file_path = ?")
      .get(codexFile) as { id: string };
    const completedMessages = dbAfterCompletion
      .prepare("SELECT content FROM messages WHERE session_id = ? ORDER BY created_at, id")
      .all(completedSession.id) as Array<{
      content: string;
    }>;
    dbAfterCompletion.close();

    expect(completedCheckpoint.last_offset_bytes).toBe(completedCheckpoint.file_size);
    expect(completedMessages.map((message) => message.content)).toEqual([
      "Before append",
      expect.stringContaining("Oversized JSONL line omitted."),
      "After append",
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("resumes append-only indexing and rescues oversized JSONL lines within the hard ceiling", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-resume-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "08", "resume.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-resume",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Before append" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoverSessionFiles = () => [
      {
        provider: "codex" as const,
        projectPath: "/workspace/codex",
        projectName: "codex",
        sessionIdentity: "codex:codex-session-resume:test",
        sourceSessionId: "codex-session-resume",
        filePath: codexFile,
        fileSize: Buffer.byteLength(readFileSync(codexFile)),
        fileMtimeMs: Date.now(),
        metadata: {
          includeInHistory: true,
          isSubagent: false,
          unresolvedProject: false,
          gitBranch: "main",
          cwd: "/workspace/codex",
        },
      },
    ];

    const notices: Array<{ code: string; message: string }> = [];
    const first = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles,
        onNotice: (notice) => {
          notices.push({ code: notice.code, message: notice.message });
        },
      },
    );
    expect(first.indexedFiles).toBe(1);

    const oversizedOutput = "x".repeat(9 * 1024 * 1024);
    appendFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:02Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: oversizedOutput,
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "After append" }],
          },
        }),
      ].join("\n")}\n`,
    );
    const appendedNow = new Date();
    utimesSync(codexFile, appendedNow, appendedNow);

    const second = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles,
        onNotice: (notice) => {
          notices.push({ code: notice.code, message: notice.message });
        },
      },
    );

    expect(second.indexedFiles).toBe(1);
    expect(second.diagnostics.warnings).toBeGreaterThan(0);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare(
        "SELECT category, content FROM messages WHERE session_id = ? ORDER BY created_at, id",
      )
      .all(makeSessionId("codex", "codex:codex-session-resume:test")) as Array<{
      category: string;
      content: string;
    }>;
    const checkpoint = db
      .prepare("SELECT last_offset_bytes, file_size FROM index_checkpoints WHERE file_path = ?")
      .get(codexFile) as { last_offset_bytes: number; file_size: number };
    db.close();

    expect(messages.map((message) => message.content)).toEqual(
      expect.arrayContaining(["Before append", "After append"]),
    );
    expect(
      messages.some(
        (message) =>
          message.category === "tool_result" && message.content.includes("[truncated from"),
      ),
    ).toBe(true);
    expect(checkpoint.last_offset_bytes).toBe(checkpoint.file_size);
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "parser.oversized_jsonl_line_rescued" }),
      ]),
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("rescues oversized Claude JSONL lines by replacing inline image payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-claude-oversized-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "oversized", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });

    const inlineImageBase64 = "a".repeat(9 * 1024 * 1024);
    writeFileSync(
      claudeFile,
      `${JSON.stringify({
        sessionId: "claude-session-oversized-inline-image",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-03-22T10:00:00Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "Before image" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: inlineImageBase64,
              },
            },
            { type: "text", text: "After image text survives" },
          ],
        },
      })}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          ...createDiscoveryConfig(dir),
          enabledProviders: ["claude"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db.prepare("SELECT content FROM messages ORDER BY created_at, id").all() as Array<{
      content: string;
    }>;
    db.close();

    expect(messages.map((message) => message.content)).toEqual(
      expect.arrayContaining([
        "Before image",
        "After image text survives",
        expect.stringContaining("[image omitted mime=image/png"),
      ]),
    );
    expect(notices).toContain("parser.oversized_jsonl_line_rescued");

    rmSync(dir, { recursive: true, force: true });
  });

  it("rescues oversized Codex compacted lines into searchable snapshot messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-compacted-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "22", "compacted.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });

    const inlineImageBase64 = "a".repeat(9 * 1024 * 1024);
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-22T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-compacted",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T10:00:01Z",
          type: "compacted",
          payload: {
            replacement_history: [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: "Before compacted image" },
                  { type: "input_image", image_url: `data:image/png;base64,${inlineImageBase64}` },
                  { type: "input_text", text: "After compacted image" },
                ],
              },
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: "Looks good" }],
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          ...createDiscoveryConfig(dir),
          enabledProviders: ["codex"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db.prepare("SELECT category, content, created_at FROM messages ORDER BY created_at, id").all() as Array<{
      category: string;
      content: string;
      created_at: string;
    }>;
    db.close();

    expect(messages).toEqual([
      expect.objectContaining({
        category: "system",
        content: expect.stringContaining("[Codex compacted history snapshot]"),
      }),
    ]);
    expect(messages[0]?.content).toContain("Before compacted image");
    expect(messages[0]?.content).toContain("After compacted image");
    expect(messages[0]?.content).toContain("[image omitted mime=image/png");
    expect(messages[0]?.content).toContain("Assistant:\nLooks good");
    expect(notices).toContain("parser.oversized_jsonl_line_rescued");

    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts tombstone messages for JSONL lines above the hard ceiling", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-jsonl-hard-omit-"));
    const dbPath = join(dir, "index.db");
    const codexFile = join(dir, ".codex", "sessions", "2026", "03", "22", "hard-omit.jsonl");
    mkdirSync(dirname(codexFile), { recursive: true });
    writeFileSync(
      codexFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-22T11:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-hard-omit",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T11:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Before hard omit" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T11:00:02Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            output: "x".repeat(33 * 1024 * 1024),
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-22T11:00:03Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "After hard omit" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          ...createDiscoveryConfig(dir),
          enabledProviders: ["codex"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db.prepare("SELECT category, content FROM messages ORDER BY created_at, id").all() as Array<{
      category: string;
      content: string;
    }>;
    db.close();

    expect(messages.map((message) => message.content)).toEqual([
      "Before hard omit",
      expect.stringContaining("Oversized JSONL line omitted."),
      "After hard omit",
    ]);
    expect(messages[1]?.category).toBe("system");
    expect(notices).toContain("parser.oversized_jsonl_line_omitted");

    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts tombstone sessions for oversized materialized JSON files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-materialized-hard-omit-"));
    const dbPath = join(dir, "index.db");
    const geminiFile = join(dir, ".gemini", "tmp", "project", "chats", "session-large.json");
    mkdirSync(dirname(geminiFile), { recursive: true });
    writeFileSync(geminiFile, "x".repeat(33 * 1024 * 1024));

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles: () => [
          {
            provider: "gemini" as const,
            projectPath: "/workspace/gemini",
            projectName: "gemini",
            sessionIdentity: "gemini:materialized-hard-omit:test",
            sourceSessionId: "gemini-materialized-hard-omit",
            filePath: geminiFile,
            fileSize: Buffer.byteLength(readFileSync(geminiFile)),
            fileMtimeMs: Date.now(),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: null,
              cwd: "/workspace/gemini",
            },
          },
        ],
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db.prepare("SELECT category, content FROM messages ORDER BY created_at, id").all() as Array<{
      category: string;
      content: string;
    }>;
    db.close();

    expect(messages).toEqual([
      expect.objectContaining({
        category: "system",
        content: expect.stringContaining("Oversized transcript file omitted."),
      }),
    ]);
    expect(notices).toContain("parser.oversized_source_file_omitted");

    rmSync(dir, { recursive: true, force: true });
  });

  it("truncates oversized stored message and tool payload content", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-truncate-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "truncate", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });
    const hugeInput = "a".repeat(400 * 1024);
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-session-truncate",
          type: "assistant",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-08T10:00:00Z",
          message: {
            model: "claude-opus-4-6",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Read",
                input: { payload: hugeInput },
              },
            ],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          claudeRoot: join(dir, ".claude", "projects"),
          codexRoot: join(dir, ".codex", "sessions"),
          geminiRoot: join(dir, ".gemini", "tmp"),
          geminiHistoryRoot: join(dir, ".gemini", "history"),
          geminiProjectsPath: join(dir, ".gemini", "projects.json"),
          cursorRoot: join(dir, ".cursor", "projects"),
          copilotRoot: join(dir, ".copilot-workspace"),
          includeClaudeSubagents: false,
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messageRow = db.prepare("SELECT content FROM messages LIMIT 1").get() as {
      content: string;
    };
    const ftsRow = db.prepare("SELECT content FROM message_fts LIMIT 1").get() as {
      content: string;
    };
    const toolCallRow = db.prepare("SELECT args_json FROM tool_calls LIMIT 1").get() as {
      args_json: string;
    };
    db.close();

    expect(Buffer.byteLength(messageRow.content, "utf8")).toBeLessThan(300 * 1024);
    expect(messageRow.content).toContain("[truncated from");
    expect(Buffer.byteLength(ftsRow.content, "utf8")).toBeLessThan(64 * 1024);
    expect(Buffer.byteLength(toolCallRow.args_json, "utf8")).toBeLessThan(80 * 1024);
    expect(notices).toEqual(
      expect.arrayContaining(["index.message_fts_truncated", "index.tool_call_raw_truncated"]),
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("surfaces streamed event persistence failures instead of reporting them as invalid JSONL", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-streamed-persist-failure-"));
    const dbPath = join(dir, "index.db");
    const claudeFile = join(dir, ".claude", "projects", "persist-failure", "session.jsonl");
    mkdirSync(dirname(claudeFile), { recursive: true });
    writeFileSync(
      claudeFile,
      `${[
        JSON.stringify({
          sessionId: "claude-session-persist-failure",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:00Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "First version" }],
          },
        }),
        JSON.stringify({
          sessionId: "claude-session-persist-failure",
          type: "assistant",
          id: "duplicate-message",
          cwd: "/workspace/claude",
          gitBranch: "main",
          timestamp: "2026-03-19T10:00:01Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Second version" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const notices: string[] = [];
    const issues: Array<{ stage: string; error: unknown }> = [];
    const result = runIncrementalIndexing(
      {
        dbPath,
        discoveryConfig: {
          claudeRoot: join(dir, ".claude", "projects"),
          enabledProviders: ["claude"],
        },
      },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
        onFileIssue: (issue) => {
          issues.push({ stage: issue.stage, error: issue.error });
        },
      },
    );

    expect(result.indexedFiles).toBe(0);
    expect(result.diagnostics.errors).toBe(1);
    expect(notices).not.toContain("parser.invalid_jsonl_line");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.stage).toBe("persist");

    rmSync(dir, { recursive: true, force: true });
  });

  it("continues indexing other files when one file cannot be read and reports the failing path", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-file-issue-"));
    const dbPath = join(dir, "index.db");
    const goodFile = join(dir, ".codex", "sessions", "2026", "03", "08", "good.jsonl");
    const missingFile = join(dir, ".codex", "sessions", "2026", "03", "08", "missing.jsonl");
    mkdirSync(dirname(goodFile), { recursive: true });
    writeFileSync(
      goodFile,
      `${[
        JSON.stringify({
          timestamp: "2026-03-08T10:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-good",
            cwd: "/workspace/codex",
            git: { branch: "main" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-03-08T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Good file indexed" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const onFileIssue = vi.fn();
    const result = runIncrementalIndexing(
      { dbPath },
      {
        discoverSessionFiles: () => [
          {
            provider: "codex",
            projectPath: "/workspace/codex",
            projectName: "codex",
            sessionIdentity: "codex:codex-session-good:test",
            sourceSessionId: "codex-session-good",
            filePath: goodFile,
            fileSize: 1024,
            fileMtimeMs: Date.parse("2026-03-08T10:05:00Z"),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: "main",
              cwd: "/workspace/codex",
            },
          },
          {
            provider: "codex",
            projectPath: "/workspace/codex",
            projectName: "codex",
            sessionIdentity: "codex:codex-session-missing:test",
            sourceSessionId: "codex-session-missing",
            filePath: missingFile,
            fileSize: 1024,
            fileMtimeMs: Date.parse("2026-03-08T10:06:00Z"),
            metadata: {
              includeInHistory: true,
              isSubagent: false,
              unresolvedProject: false,
              gitBranch: "main",
              cwd: "/workspace/codex",
            },
          },
        ],
        onFileIssue,
      },
    );

    expect(result.discoveredFiles).toBe(2);
    expect(result.indexedFiles).toBe(1);
    expect(result.skippedFiles).toBe(0);
    expect(result.diagnostics.errors).toBe(1);
    expect(onFileIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        sessionId: "codex-session-missing",
        filePath: missingFile,
        stage: "read",
      }),
    );

    const db = openDatabase(dbPath);
    const sessionCount = db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number };
    const indexedFileCount = db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as {
      c: number;
    };
    db.close();

    expect(sessionCount.c).toBe(1);
    expect(indexedFileCount.c).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps copied codex sessions with identical source ids as distinct sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-codex-dupe-"));
    const dbPath = join(dir, "index.db");
    const codexRoot = join(dir, ".codex", "sessions");
    const fileA = join(codexRoot, "2026", "02", "27", "one", "same-id.jsonl");
    const fileB = join(codexRoot, "2026", "02", "27", "two", "same-id.jsonl");
    mkdirSync(join(codexRoot, "2026", "02", "27", "one"), { recursive: true });
    mkdirSync(join(codexRoot, "2026", "02", "27", "two"), { recursive: true });

    const content = `${[
      JSON.stringify({
        timestamp: "2026-02-27T11:00:00Z",
        type: "session_meta",
        payload: {
          id: "copied-session-id",
          cwd: "/workspace/codex",
          git: { branch: "dev" },
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T11:00:02Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Done" }],
        },
      }),
    ].join("\n")}\n`;
    writeFileSync(fileA, content);
    writeFileSync(fileB, content);

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        claudeRoot: join(dir, ".claude", "projects"),
        codexRoot,
        geminiRoot: join(dir, ".gemini", "tmp"),
        geminiHistoryRoot: join(dir, ".gemini", "history"),
        geminiProjectsPath: join(dir, ".gemini", "projects.json"),
        cursorRoot: join(dir, ".cursor", "projects"),
        copilotRoot: join(dir, ".copilot-workspace"),
        includeClaudeSubagents: false,
      },
    });

    expect(result.discoveredFiles).toBe(2);
    expect(result.indexedFiles).toBe(2);

    const db = openDatabase(dbPath);
    const rows = db
      .prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'codex'")
      .get() as {
      c: number;
    };
    db.close();

    expect(rows.c).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies default and overridden system message regex rules during ingestion", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-system-rules-"));
    const dbPath = join(dir, "index.db");

    const claudeRoot = join(dir, ".claude", "projects");
    const claudeProject = join(claudeRoot, "project-system-rules");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      join(claudeProject, "claude-session-1.jsonl"),
      `${[
        JSON.stringify({
          type: "user",
          timestamp: "2026-02-27T10:00:00Z",
          message: {
            role: "user",
            content: [{ type: "text", text: "<command-name>/exit</command-name>" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const codexRoot = join(dir, ".codex", "sessions", "2026", "02", "27");
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, "codex-session-1.jsonl"),
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T11:00:00Z",
          type: "session_meta",
          payload: {
            id: "codex-session-1",
            cwd: "/workspace/codex",
            git: { branch: "dev" },
          },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T11:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<environment_context>" }],
          },
        }),
      ].join("\n")}\n`,
    );

    const discoveryConfig = {
      claudeRoot,
      codexRoot: join(dir, ".codex", "sessions"),
      geminiRoot: join(dir, ".gemini", "tmp"),
      geminiHistoryRoot: join(dir, ".gemini", "history"),
      geminiProjectsPath: join(dir, ".gemini", "projects.json"),
      cursorRoot: join(dir, ".cursor", "projects"),
      copilotRoot: join(dir, ".copilot-workspace"),
      includeClaudeSubagents: false,
    };

    runIncrementalIndexing({
      dbPath,
      discoveryConfig,
    });

    const dbAfterDefault = openDatabase(dbPath);
    const defaultRows = dbAfterDefault
      .prepare("SELECT provider, category FROM messages WHERE category = 'system'")
      .all() as Array<{ provider: string; category: string }>;
    dbAfterDefault.close();

    expect(defaultRows.some((row) => row.provider === "claude")).toBe(true);
    expect(defaultRows.some((row) => row.provider === "codex")).toBe(true);

    runIncrementalIndexing({
      dbPath,
      forceReindex: true,
      discoveryConfig,
      systemMessageRegexRules: {
        claude: [],
        codex: [],
        gemini: [],
      },
    });

    const dbAfterOverride = openDatabase(dbPath);
    const overriddenRows = dbAfterOverride
      .prepare("SELECT provider, category FROM messages WHERE content = '<environment_context>'")
      .all() as Array<{ provider: string; category: string }>;
    dbAfterOverride.close();

    expect(overriddenRows).toEqual([
      {
        provider: "codex",
        category: "user",
      },
    ]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to file mtime for cursor messages with invalid timestamps", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-cursor-time-"));
    const dbPath = join(dir, "index.db");
    const cursorRoot = join(dir, ".cursor", "projects");
    const actualProjectPath = join(dir, "workspace", "cursor-app");
    const encodedProjectName = actualProjectPath.slice(1).replaceAll("/", "-");
    const sessionUuid = "cursor-session-1";
    const transcriptPath = join(
      cursorRoot,
      encodedProjectName,
      "agent-transcripts",
      sessionUuid,
      `${sessionUuid}.jsonl`,
    );
    mkdirSync(join(cursorRoot, encodedProjectName, "terminals"), { recursive: true });
    mkdirSync(join(actualProjectPath), { recursive: true });
    mkdirSync(dirname(transcriptPath), { recursive: true });

    writeFileSync(
      join(cursorRoot, encodedProjectName, "terminals", "1.txt"),
      [
        "---",
        `cwd: "${actualProjectPath}"`,
        'command: "ls"',
        "started_at: 2026-03-04T00:00:00.000Z",
        "---",
        "",
      ].join("\n"),
    );
    writeFileSync(
      transcriptPath,
      `${[
        JSON.stringify({
          id: "cur-u-1",
          role: "user",
          timestamp: "not-a-date",
          message: {
            content: [{ type: "text", text: "<user_query>\nCheck timestamps\n</user_query>" }],
          },
        }),
        JSON.stringify({
          id: "cur-a-1",
          message: {
            role: "assistant",
            created_at: "still-not-a-date",
            content: [{ type: "text", text: "Working on it." }],
          },
        }),
        JSON.stringify({
          id: "cur-a-2",
          role: "assistant",
          timestamp: "2026-03-04T10:00:05.000Z",
          message: {
            content: [{ type: "text", text: "Done." }],
          },
        }),
      ].join("\n")}\n`,
    );
    const fileMtime = new Date("2026-03-04T10:00:00.000Z");
    utimesSync(transcriptPath, fileMtime, fileMtime);

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        claudeRoot: join(dir, ".claude", "projects"),
        codexRoot: join(dir, ".codex", "sessions"),
        geminiRoot: join(dir, ".gemini", "tmp"),
        geminiHistoryRoot: join(dir, ".gemini", "history"),
        geminiProjectsPath: join(dir, ".gemini", "projects.json"),
        cursorRoot,
        copilotRoot: join(dir, ".copilot-workspace"),
        includeClaudeSubagents: false,
      },
    });

    expect(result.discoveredFiles).toBe(1);
    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const session = db
      .prepare(
        "SELECT started_at, ended_at, cwd, title FROM sessions WHERE provider = 'cursor' AND file_path = ?",
      )
      .get(transcriptPath) as {
      started_at: string;
      ended_at: string;
      cwd: string;
      title: string;
    };
    const fallbackMessage = db
      .prepare("SELECT created_at FROM messages WHERE source_id = ?")
      .get("cur-u-1") as { created_at: string };
    const nestedFallbackMessage = db
      .prepare("SELECT created_at FROM messages WHERE source_id = ?")
      .get("cur-a-1") as { created_at: string };
    const validMessage = db
      .prepare("SELECT created_at FROM messages WHERE source_id = ?")
      .get("cur-a-2") as { created_at: string };
    const orderedSourceIds = db
      .prepare("SELECT source_id FROM messages ORDER BY created_at ASC, id ASC")
      .all() as Array<{ source_id: string }>;
    db.close();

    expect(session.cwd).toBe(actualProjectPath);
    expect(session.title).toBe("Check timestamps");
    expect(session.started_at).toBe("2026-03-04T10:00:00.000Z");
    expect(session.ended_at).toBe("2026-03-04T10:00:05.000Z");
    expect(fallbackMessage.created_at).toBe("2026-03-04T10:00:00.000Z");
    expect(nestedFallbackMessage.created_at).toBe("2026-03-04T10:00:00.001Z");
    expect(validMessage.created_at).toBe("2026-03-04T10:00:05.000Z");
    expect(orderedSourceIds.map((row) => row.source_id)).toEqual(["cur-u-1", "cur-a-1", "cur-a-2"]);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps cursor sessions with identical source ids in distinct projects", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-index-cursor-dupe-"));
    const dbPath = join(dir, "index.db");
    const cursorRoot = join(dir, ".cursor", "projects");
    const sessionUuid = "shared-cursor-session";
    const projectAPath = join(dir, "workspace", "cursor-one");
    const projectBPath = join(dir, "workspace", "cursor-two");
    const encodedA = projectAPath.slice(1).replaceAll("/", "-");
    const encodedB = projectBPath.slice(1).replaceAll("/", "-");
    mkdirSync(projectAPath, { recursive: true });
    mkdirSync(projectBPath, { recursive: true });

    const transcriptA = join(
      cursorRoot,
      encodedA,
      "agent-transcripts",
      sessionUuid,
      `${sessionUuid}.jsonl`,
    );
    const transcriptB = join(
      cursorRoot,
      encodedB,
      "agent-transcripts",
      sessionUuid,
      `${sessionUuid}.jsonl`,
    );
    mkdirSync(join(cursorRoot, encodedA, "terminals"), { recursive: true });
    mkdirSync(join(cursorRoot, encodedB, "terminals"), { recursive: true });
    mkdirSync(dirname(transcriptA), { recursive: true });
    mkdirSync(dirname(transcriptB), { recursive: true });
    writeFileSync(
      join(cursorRoot, encodedA, "terminals", "a.txt"),
      `---\ncwd: "${projectAPath}"\n---\n`,
    );
    writeFileSync(
      join(cursorRoot, encodedB, "terminals", "b.txt"),
      `---\ncwd: "${projectBPath}"\n---\n`,
    );

    const content = `${JSON.stringify({
      id: "cur-1",
      role: "assistant",
      timestamp: "2026-03-04T10:00:00.000Z",
      message: { content: [{ type: "text", text: "Done." }] },
    })}\n`;
    writeFileSync(transcriptA, content);
    writeFileSync(transcriptB, content);

    const result = runIncrementalIndexing({
      dbPath,
      discoveryConfig: {
        claudeRoot: join(dir, ".claude", "projects"),
        codexRoot: join(dir, ".codex", "sessions"),
        geminiRoot: join(dir, ".gemini", "tmp"),
        geminiHistoryRoot: join(dir, ".gemini", "history"),
        geminiProjectsPath: join(dir, ".gemini", "projects.json"),
        cursorRoot,
        copilotRoot: join(dir, ".copilot-workspace"),
        includeClaudeSubagents: false,
      },
    });

    expect(result.discoveredFiles).toBe(2);
    expect(result.indexedFiles).toBe(2);

    const db = openDatabase(dbPath);
    const sessionCount = db
      .prepare("SELECT COUNT(*) as c FROM sessions WHERE provider = 'cursor'")
      .get() as { c: number };
    const identities = db
      .prepare(
        "SELECT id, file_path FROM sessions WHERE provider = 'cursor' ORDER BY file_path ASC",
      )
      .all() as Array<{ id: string; file_path: string }>;
    db.close();

    expect(sessionCount.c).toBe(2);
    expect(identities[0]?.id).not.toBe(identities[1]?.id);

    rmSync(dir, { recursive: true, force: true });
  });

  it("ingests only appended tail content for a tombstoned JSONL session", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-session-append-"));
    const dbPath = join(dir, "index.db");
    const claudeProject = join(dir, ".claude", "projects", "project-a");
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Before delete" }],
        },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    appendFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "assistant",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:01Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "After append" }],
        },
      })}\n`,
    );
    const appendedAt = new Date("2026-02-27T10:00:02Z");
    utimesSync(sessionFile, appendedAt, appendedAt);

    const result = runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{ content: string }>;
    const deletedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(sessionFile) as {
        c: number;
      }
    ).c;
    db.close();

    expect(messages).toEqual([{ content: "After append" }]);
    expect(deletedCount).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a tombstoned JSONL session deleted when the file is rewritten in place with the same identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-session-same-identity-"));
    const dbPath = join(dir, "index.db");
    const claudeProject = join(dir, ".claude", "projects", "project-a");
    const sessionFile = join(claudeProject, "claude-session-1.jsonl");
    mkdirSync(claudeProject, { recursive: true });
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "user",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Original" }],
        },
      })}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        sessionId: "claude-session-1",
        type: "assistant",
        cwd: "/workspace/claude",
        gitBranch: "main",
        timestamp: "2026-02-27T10:05:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Rewritten but same identity" }],
        },
      })}\n`,
    );
    const rewrittenAt = new Date("2026-02-27T10:05:01Z");
    utimesSync(sessionFile, rewrittenAt, rewrittenAt);

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      { dbPath, discoveryConfig: createDiscoveryConfig(dir) },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(0);

    const db = openDatabase(dbPath);
    const sessionCount = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number })
      .c;
    const deletedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(sessionFile) as {
        c: number;
      }
    ).c;
    db.close();

    expect(sessionCount).toBe(0);
    expect(deletedCount).toBe(1);
    expect(notices).toContain("index.deleted_session_rewrite_ignored");

    rmSync(dir, { recursive: true, force: true });
  });

  it("ingests a rewritten tombstoned JSONL file as new when the session identity changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-codex-new-identity-"));
    const dbPath = join(dir, "index.db");
    const codexDayDir = join(dir, ".codex", "sessions", "2026", "02", "27");
    const sessionFile = join(codexDayDir, "rollout-codex-1.jsonl");
    mkdirSync(codexDayDir, { recursive: true });
    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T10:00:00Z",
          type: "session_meta",
          payload: { id: "codex-session-1", cwd: "/workspace/codex", git: { branch: "main" } },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T10:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Original" }],
          },
        }),
      ].join("\n")}\n`,
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    writeFileSync(
      sessionFile,
      `${[
        JSON.stringify({
          timestamp: "2026-02-27T10:06:00Z",
          type: "session_meta",
          payload: { id: "codex-session-2", cwd: "/workspace/codex", git: { branch: "main" } },
        }),
        JSON.stringify({
          timestamp: "2026-02-27T10:06:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Imported as new" }],
          },
        }),
      ].join("\n")}\n`,
    );
    const rewrittenAt = new Date("2026-02-27T10:06:01Z");
    utimesSync(sessionFile, rewrittenAt, rewrittenAt);

    const notices: string[] = [];
    const result = runIncrementalIndexing(
      { dbPath, discoveryConfig: createDiscoveryConfig(dir) },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );

    expect(result.indexedFiles).toBe(1);

    const db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{ content: string }>;
    const deletedCount = (
      db
        .prepare("SELECT COUNT(*) as c FROM deleted_sessions WHERE file_path = ?")
        .get(sessionFile) as {
        c: number;
      }
    ).c;
    db.close();

    expect(messages).toEqual([{ content: "Imported as new" }]);
    expect(deletedCount).toBe(0);
    expect(notices).toContain("index.deleted_session_replaced");

    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a tombstoned materialized-json session deleted during normal refresh but restores it on force reindex", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-deleted-gemini-session-"));
    const dbPath = join(dir, "index.db");
    const geminiRoot = join(dir, ".gemini", "tmp");
    const geminiHistoryRoot = join(dir, ".gemini", "history");
    mkdirSync(join(geminiRoot, "dux", "chats"), { recursive: true });
    mkdirSync(join(geminiHistoryRoot, "dux"), { recursive: true });
    writeFileSync(join(geminiRoot, "dux", ".project_root"), "/workspace/dux");
    writeFileSync(join(geminiHistoryRoot, "dux", ".project_root"), "/workspace/dux");
    const sessionFile = join(geminiRoot, "dux", "chats", "session-1.json");
    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessionId: "gemini-session-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
        startTime: "2026-02-27T12:00:00Z",
        lastUpdated: "2026-02-27T12:00:10Z",
        messages: [
          {
            id: "g-user-1",
            type: "user",
            timestamp: "2026-02-27T12:00:00Z",
            content: "Hello Gemini",
          },
        ],
      }),
    );

    runIncrementalIndexing({ dbPath, discoveryConfig: createDiscoveryConfig(dir) });
    tombstoneSession(dbPath, sessionFile);

    writeFileSync(
      sessionFile,
      JSON.stringify({
        sessionId: "gemini-session-1",
        projectHash: "ddd29e90e8e0e53b3e06996841fdaf7a26e33cdca62e0678fb37e500d58d2bf8",
        startTime: "2026-02-27T12:00:00Z",
        lastUpdated: "2026-02-27T12:00:20Z",
        messages: [
          {
            id: "g-user-1",
            type: "user",
            timestamp: "2026-02-27T12:00:00Z",
            content: "Hello Gemini",
          },
          {
            id: "g-assistant-1",
            type: "gemini",
            model: "gemini-2.5-pro",
            timestamp: "2026-02-27T12:00:10Z",
            content: "Rewritten Gemini content",
          },
        ],
      }),
    );
    const rewrittenAt = new Date("2026-02-27T12:00:21Z");
    utimesSync(sessionFile, rewrittenAt, rewrittenAt);

    const notices: string[] = [];
    const normal = runIncrementalIndexing(
      { dbPath, discoveryConfig: createDiscoveryConfig(dir) },
      {
        onNotice: (notice) => {
          notices.push(notice.code);
        },
      },
    );
    expect(normal.indexedFiles).toBe(0);

    let db = openDatabase(dbPath);
    expect((db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c).toBe(0);
    db.close();

    const forced = runIncrementalIndexing({
      dbPath,
      discoveryConfig: createDiscoveryConfig(dir),
      forceReindex: true,
    });
    expect(forced.indexedFiles).toBe(1);

    db = openDatabase(dbPath);
    const messages = db
      .prepare("SELECT content FROM messages ORDER BY created_at, id")
      .all() as Array<{ content: string }>;
    const deletedCount = (
      db.prepare("SELECT COUNT(*) as c FROM deleted_sessions").get() as { c: number }
    ).c;
    db.close();

    expect(messages.map((message) => message.content)).toEqual([
      "Hello Gemini",
      "Rewritten Gemini content",
    ]);
    expect(deletedCount).toBe(0);
    expect(notices).toContain("index.deleted_session_rewrite_ignored");

    rmSync(dir, { recursive: true, force: true });
  });
});
