import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type BrowserWindow, app, dialog } from "electron";

import type { IpcRequest, IpcResponse, MessageCategory } from "@codetrail/core/browser";

import type { HistoryExportPhase, HistoryExportProgressPayload } from "../shared/historyExport";
import {
  asNonEmptyString,
  asObject,
  asString,
  buildUnifiedDiffFromTextPair,
  parseToolEditPayload,
  parseToolInvocationPayload,
  tryParseJsonRecord,
} from "../shared/toolParsing";
import type { QueryService } from "./data/queryService";

const EXPORT_FETCH_PAGE_SIZE = 500;
const EMPTY_QUERY = "";

type HistoryExportRequest = IpcRequest<"history:exportMessages">;
type HistoryExportResponse = IpcResponse<"history:exportMessages">;
type SessionMessage = IpcResponse<"sessions:getDetail">["messages"][number];
type ProjectMessage = IpcResponse<"projects:getCombinedDetail">["messages"][number];
type BookmarkEntry = IpcResponse<"bookmarks:listProject">["results"][number];

type ExportSection = {
  title: string | null;
  style: "prose" | "code";
  language: "text" | "shell" | "json" | "diff";
  text: string;
};

type ExportMessage = {
  id: string;
  category: MessageCategory;
  label: string;
  createdAt: string;
  operationDurationMs: number | null;
  isOrphaned: boolean;
  sections: ExportSection[];
};

type HistoryExportPayload = {
  exportedAt: string;
  viewLabel: string;
  scopeLabel: string;
  sortLabel: string;
  categoryLabel: string;
  query: string;
  messageCount: number;
  messages: ExportMessage[];
};

type HistoryExportProgressCallback = (payload: HistoryExportProgressPayload) => void;

export async function exportHistoryMessages({
  browserWindow,
  onProgress,
  queryService,
  request,
}: {
  browserWindow: BrowserWindow | null;
  onProgress?: HistoryExportProgressCallback;
  queryService: QueryService;
  request: HistoryExportRequest;
}): Promise<HistoryExportResponse> {
  const outputPath = await showExportSaveDialog(browserWindow, request);
  if (!outputPath) {
    return { canceled: true, path: null };
  }

  await emitHistoryExportProgress(
    request.exportId,
    onProgress,
    "preparing",
    4,
    "Preparing export…",
  );
  const payload = await collectHistoryExportPayloadWithProgress(queryService, request, onProgress);
  const markdown = await buildHistoryExportMarkdownWithProgress(
    payload,
    request.exportId,
    onProgress,
  );
  await emitHistoryExportProgress(
    request.exportId,
    onProgress,
    "writing",
    98,
    "Writing Markdown file…",
  );
  await writeFile(outputPath, markdown, "utf8");
  await emitHistoryExportProgress(request.exportId, onProgress, "writing", 100, "Export complete");

  return {
    canceled: false,
    path: outputPath,
  };
}

export function collectHistoryExportPayload(
  queryService: QueryService,
  request: HistoryExportRequest,
): HistoryExportPayload {
  const query = request.query.trim();
  const messages = collectExportMessages(queryService, request);
  return buildHistoryExportPayload(request, query, messages);
}

export function buildHistoryExportMarkdown(payload: HistoryExportPayload): string {
  return buildHistoryExportMarkdownLines(payload).join("\n");
}

async function collectHistoryExportPayloadWithProgress(
  queryService: QueryService,
  request: HistoryExportRequest,
  onProgress?: HistoryExportProgressCallback,
): Promise<HistoryExportPayload> {
  const query = request.query.trim();
  const messages = await collectExportMessagesWithProgress(queryService, request, onProgress);
  return buildHistoryExportPayload(request, query, messages);
}

async function buildHistoryExportMarkdownWithProgress(
  payload: HistoryExportPayload,
  exportId: string,
  onProgress?: HistoryExportProgressCallback,
): Promise<string> {
  await emitHistoryExportProgress(exportId, onProgress, "formatting", 86, "Formatting Markdown…");
  return (
    await buildHistoryExportMarkdownLinesWithProgress(payload, {
      exportId,
      onProgress,
    })
  ).join("\n");
}

function collectExportMessages(
  queryService: QueryService,
  request: HistoryExportRequest,
): ExportMessage[] {
  switch (request.mode) {
    case "session":
      return collectPagedExportMessages({
        request,
        mapMessages: mapSessionMessages,
        loadCurrentPage: () =>
          expectSessionDetail(
            queryService.getSessionDetail({
              sessionId: expectSessionId(request),
              page: request.page,
              pageSize: request.pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
        loadPage: (page, pageSize) =>
          expectSessionDetail(
            queryService.getSessionDetail({
              sessionId: expectSessionId(request),
              page,
              pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
      });
    case "project_all":
      return collectPagedExportMessages({
        request,
        mapMessages: mapProjectMessages,
        loadCurrentPage: () =>
          expectProjectDetail(
            queryService.getProjectCombinedDetail({
              projectId: request.projectId,
              page: request.page,
              pageSize: request.pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
        loadPage: (page, pageSize) =>
          expectProjectDetail(
            queryService.getProjectCombinedDetail({
              projectId: request.projectId,
              page,
              pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
      });
    case "bookmarks":
      return collectBookmarkExportMessages(queryService, request);
  }
}

async function collectExportMessagesWithProgress(
  queryService: QueryService,
  request: HistoryExportRequest,
  onProgress?: HistoryExportProgressCallback,
): Promise<ExportMessage[]> {
  await emitHistoryExportProgress(
    request.exportId,
    onProgress,
    "collecting",
    10,
    request.scope === "all_pages" ? "Collecting all pages…" : "Collecting current page…",
  );

  switch (request.mode) {
    case "session":
      return collectPagedExportMessagesWithProgress({
        request,
        onProgress,
        mapMessages: mapSessionMessages,
        loadCurrentPage: () =>
          expectSessionDetail(
            queryService.getSessionDetail({
              sessionId: expectSessionId(request),
              page: request.page,
              pageSize: request.pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
        loadPage: (page, pageSize) =>
          expectSessionDetail(
            queryService.getSessionDetail({
              sessionId: expectSessionId(request),
              page,
              pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
      });
    case "project_all":
      return collectPagedExportMessagesWithProgress({
        request,
        onProgress,
        mapMessages: mapProjectMessages,
        loadCurrentPage: () =>
          expectProjectDetail(
            queryService.getProjectCombinedDetail({
              projectId: request.projectId,
              page: request.page,
              pageSize: request.pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
        loadPage: (page, pageSize) =>
          expectProjectDetail(
            queryService.getProjectCombinedDetail({
              projectId: request.projectId,
              page,
              pageSize,
              categories: request.categories,
              query: request.query,
              searchMode: request.searchMode,
              sortDirection: request.sortDirection,
            }),
          ),
      });
    case "bookmarks":
      return collectBookmarkExportMessagesWithProgress(queryService, request, onProgress);
  }
}

function collectBookmarkExportMessages(
  queryService: QueryService,
  request: HistoryExportRequest,
): ExportMessage[] {
  const response = queryService.listProjectBookmarks({
    projectId: request.projectId,
    categories: request.categories,
    query: request.query.length > 0 ? request.query : EMPTY_QUERY,
    searchMode: request.searchMode,
  });
  if (response.queryError) {
    throw new Error(response.queryError);
  }

  return sortBookmarkEntries(response.results, request.sortDirection).map((entry) =>
    formatExportMessage(entry.message, entry.isOrphaned),
  );
}

async function collectBookmarkExportMessagesWithProgress(
  queryService: QueryService,
  request: HistoryExportRequest,
  onProgress?: HistoryExportProgressCallback,
): Promise<ExportMessage[]> {
  const messages = collectBookmarkExportMessages(queryService, request);
  await emitHistoryExportProgress(
    request.exportId,
    onProgress,
    "collecting",
    84,
    `Collected ${messages.length} messages`,
  );
  return messages;
}

function expectSessionDetail(response: IpcResponse<"sessions:getDetail">) {
  if (response.queryError) {
    throw new Error(response.queryError);
  }
  return response;
}

function expectProjectDetail(response: IpcResponse<"projects:getCombinedDetail">) {
  if (response.queryError) {
    throw new Error(response.queryError);
  }
  return response;
}

function loadAllPages<T extends { totalCount: number; messages: unknown[] }>(
  loadPage: (page: number, pageSize: number) => T,
  initialPageSize: number,
): T["messages"] {
  const pageSize = Math.max(initialPageSize, EXPORT_FETCH_PAGE_SIZE);
  const firstPage = loadPage(0, pageSize);
  const allMessages = [...firstPage.messages];
  const totalPages = Math.max(1, Math.ceil(firstPage.totalCount / pageSize));

  for (let page = 1; page < totalPages; page += 1) {
    const nextPage = loadPage(page, pageSize);
    allMessages.push(...nextPage.messages);
  }

  return allMessages;
}

function buildHistoryExportPayload(
  request: HistoryExportRequest,
  query: string,
  messages: ExportMessage[],
): HistoryExportPayload {
  return {
    exportedAt: new Date().toISOString(),
    viewLabel: formatViewLabel(request.mode),
    scopeLabel: request.scope === "all_pages" ? "All pages" : "Current page",
    sortLabel: formatSortLabel(request.sortDirection),
    categoryLabel: formatCategoryLabel(request.categories),
    query,
    messageCount: messages.length,
    messages,
  };
}

function buildHistoryExportMarkdownLines(payload: HistoryExportPayload): string[] {
  const lines = [
    "# Messages Export",
    "",
    `- Exported at: ${formatMarkdownInlineValue(payload.exportedAt)}`,
    `- View: ${formatMarkdownInlineValue(payload.viewLabel)}`,
    `- Scope: ${formatMarkdownInlineValue(payload.scopeLabel)}`,
    `- Sort: ${formatMarkdownInlineValue(payload.sortLabel)}`,
    `- Categories: ${formatMarkdownInlineValue(payload.categoryLabel)}`,
    `- Messages: ${payload.messageCount}`,
  ];

  if (payload.query.length > 0) {
    lines.push(`- Query: ${formatMarkdownInlineValue(payload.query)}`);
  }

  lines.push("");

  if (payload.messages.length === 0) {
    lines.push("_No messages matched the selected export scope._", "");
    return lines;
  }

  for (const [index, message] of payload.messages.entries()) {
    appendHistoryExportMarkdownMessage(lines, index, message);
  }

  return lines;
}

async function buildHistoryExportMarkdownLinesWithProgress(
  payload: HistoryExportPayload,
  args: {
    exportId: string;
    onProgress: HistoryExportProgressCallback | undefined;
  },
): Promise<string[]> {
  const lines = buildHistoryExportMarkdownHeaderLines(payload);
  if (payload.messages.length === 0) {
    lines.push("_No messages matched the selected export scope._", "");
    return lines;
  }

  const totalMessages = payload.messages.length;
  for (const [index, message] of payload.messages.entries()) {
    appendHistoryExportMarkdownMessage(lines, index, message);
    if ((index + 1) % 200 === 0 || index === totalMessages - 1) {
      const percent = 86 + Math.round(((index + 1) / totalMessages) * 11);
      await emitHistoryExportProgress(
        args.exportId,
        args.onProgress,
        "formatting",
        percent,
        `Formatting Markdown… ${index + 1} / ${totalMessages} messages`,
      );
    }
  }

  return lines;
}

function buildHistoryExportMarkdownHeaderLines(payload: HistoryExportPayload): string[] {
  const lines = [
    "# Messages Export",
    "",
    `- Exported at: ${formatMarkdownInlineValue(payload.exportedAt)}`,
    `- View: ${formatMarkdownInlineValue(payload.viewLabel)}`,
    `- Scope: ${formatMarkdownInlineValue(payload.scopeLabel)}`,
    `- Sort: ${formatMarkdownInlineValue(payload.sortLabel)}`,
    `- Categories: ${formatMarkdownInlineValue(payload.categoryLabel)}`,
    `- Messages: ${payload.messageCount}`,
  ];

  if (payload.query.length > 0) {
    lines.push(`- Query: ${formatMarkdownInlineValue(payload.query)}`);
  }

  lines.push("");
  return lines;
}

function appendHistoryExportMarkdownMessage(
  lines: string[],
  index: number,
  message: ExportMessage,
): void {
  if (index > 0) {
    lines.push("---", "");
  }

  lines.push(`## ${index + 1}. ${message.label}`);
  lines.push("");
  lines.push(`- Time: ${formatMarkdownInlineValue(message.createdAt)}`);
  if (message.operationDurationMs !== null) {
    lines.push(
      `- Duration: ${formatMarkdownInlineValue(formatDuration(message.operationDurationMs))}`,
    );
  }
  if (message.isOrphaned) {
    lines.push("- Orphaned bookmark: Yes");
  }
  lines.push("");
  lines.push(...buildMarkdownSections(message.sections));
}

function expectSessionId(request: HistoryExportRequest): string {
  if (!request.sessionId) {
    throw new Error("A session export requires a sessionId.");
  }
  return request.sessionId;
}

function collectPagedExportMessages<T extends { totalCount: number; messages: unknown[] }>(args: {
  request: HistoryExportRequest;
  mapMessages: (messages: T["messages"]) => ExportMessage[];
  loadCurrentPage: () => T;
  loadPage: (page: number, pageSize: number) => T;
}): ExportMessage[] {
  if (args.request.scope === "current_page") {
    return args.mapMessages(args.loadCurrentPage().messages);
  }

  return args.mapMessages(loadAllPages(args.loadPage, args.request.pageSize));
}

async function collectPagedExportMessagesWithProgress<
  T extends { totalCount: number; messages: unknown[] },
>(args: {
  request: HistoryExportRequest;
  onProgress: HistoryExportProgressCallback | undefined;
  mapMessages: (messages: T["messages"]) => ExportMessage[];
  loadCurrentPage: () => T;
  loadPage: (page: number, pageSize: number) => T;
}): Promise<ExportMessage[]> {
  if (args.request.scope === "current_page") {
    const response = args.loadCurrentPage();
    await emitHistoryExportProgress(
      args.request.exportId,
      args.onProgress,
      "collecting",
      84,
      `Collected ${response.messages.length} messages`,
    );
    return args.mapMessages(response.messages);
  }

  return args.mapMessages(
    await loadAllPagesWithProgress(
      args.loadPage,
      args.request.pageSize,
      args.request.exportId,
      args.onProgress,
    ),
  );
}

async function loadAllPagesWithProgress<T extends { totalCount: number; messages: unknown[] }>(
  loadPage: (page: number, pageSize: number) => T,
  initialPageSize: number,
  exportId: string,
  onProgress?: HistoryExportProgressCallback,
): Promise<T["messages"]> {
  const pageSize = Math.max(initialPageSize, EXPORT_FETCH_PAGE_SIZE);
  const firstPage = loadPage(0, pageSize);
  const allMessages = [...firstPage.messages];
  const totalPages = Math.max(1, Math.ceil(firstPage.totalCount / pageSize));

  await emitHistoryExportProgress(
    exportId,
    onProgress,
    "collecting",
    calculateCollectionPercent(1, totalPages),
    formatCollectionMessage(1, totalPages, allMessages.length, firstPage.totalCount),
  );

  for (let page = 1; page < totalPages; page += 1) {
    const nextPage = loadPage(page, pageSize);
    allMessages.push(...nextPage.messages);
    await emitHistoryExportProgress(
      exportId,
      onProgress,
      "collecting",
      calculateCollectionPercent(page + 1, totalPages),
      formatCollectionMessage(page + 1, totalPages, allMessages.length, firstPage.totalCount),
    );
  }

  return allMessages;
}

function mapSessionMessages(messages: SessionMessage[]): ExportMessage[] {
  return messages.map((message) => formatExportMessage(message, false));
}

function mapProjectMessages(messages: ProjectMessage[]): ExportMessage[] {
  return messages.map((message) => formatExportMessage(message, false));
}

function sortBookmarkEntries(
  entries: BookmarkEntry[],
  sortDirection: HistoryExportRequest["sortDirection"],
): BookmarkEntry[] {
  return [...entries].sort((left, right) => {
    const byTime = compareCreatedAt(left.message.createdAt, right.message.createdAt);
    const byId = left.message.id.localeCompare(right.message.id);
    const comparison = byTime !== 0 ? byTime : byId;
    return sortDirection === "asc" ? comparison : -comparison;
  });
}

async function showExportSaveDialog(
  browserWindow: BrowserWindow | null,
  request: HistoryExportRequest,
): Promise<string | null> {
  const filename = buildExportFilename(request);
  const options = {
    defaultPath: join(app.getPath("documents"), filename),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  };
  const result = browserWindow
    ? await dialog.showSaveDialog(browserWindow, options)
    : await dialog.showSaveDialog(options);

  return result.canceled ? null : (result.filePath ?? null);
}

function buildExportFilename(request: HistoryExportRequest): string {
  const mode =
    request.mode === "project_all"
      ? "all-sessions"
      : request.mode === "bookmarks"
        ? "bookmarks"
        : "session";
  const scope = request.scope === "all_pages" ? "all-pages" : "current-page";
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return `codetrail-messages-${mode}-${scope}-${stamp}.md`;
}

function formatExportMessage(
  message: {
    id: string;
    category: MessageCategory;
    content: string;
    createdAt: string;
    operationDurationMs: number | null;
  },
  isOrphaned: boolean,
): ExportMessage {
  return {
    id: message.id,
    category: message.category,
    label: formatMessageLabel(message.category, message.content),
    createdAt: message.createdAt,
    operationDurationMs: message.operationDurationMs,
    isOrphaned,
    sections: formatMessageSections(message.category, message.content),
  };
}

function formatMessageLabel(category: MessageCategory, content: string): string {
  if (category !== "tool_use" && category !== "tool_edit") {
    return CATEGORY_LABELS[category];
  }
  const parsed = parseToolInvocationPayload(content);
  return parsed?.prettyName
    ? `${CATEGORY_LABELS[category]}: ${parsed.prettyName}`
    : CATEGORY_LABELS[category];
}

function formatMessageSections(category: MessageCategory, content: string): ExportSection[] {
  if (category === "tool_use") {
    const parsed = parseToolInvocationPayload(content);
    if (parsed?.isWrite) {
      return formatToolEditSections(content);
    }
    return formatToolUseSections(content);
  }
  if (category === "tool_edit") {
    return formatToolEditSections(content);
  }
  if (category === "tool_result") {
    return formatToolResultSections(content);
  }
  if (category === "thinking") {
    return [{ title: null, style: "code", language: "text", text: normalizeLineEndings(content) }];
  }
  return [{ title: null, style: "prose", language: "text", text: normalizeLineEndings(content) }];
}

function formatToolUseSections(content: string): ExportSection[] {
  const parsed = parseToolInvocationPayload(content);
  if (!parsed) {
    return [{ title: null, style: "code", language: "json", text: formatJsonIfParsable(content) }];
  }

  const sections: ExportSection[] = [];
  const targetPath = asNonEmptyString(
    parsed.inputRecord?.file_path ?? parsed.inputRecord?.path ?? parsed.inputRecord?.file,
  );
  if (targetPath) {
    sections.push({
      title: "Path",
      style: "prose",
      language: "text",
      text: targetPath,
    });
  }

  const command = asNonEmptyString(parsed.inputRecord?.cmd ?? parsed.inputRecord?.command);
  if (command) {
    sections.push({
      title: "Command",
      style: "code",
      language: "shell",
      text: normalizeLineEndings(command),
    });
  }

  sections.push({
    title: parsed.inputRecord ? "Arguments" : "Payload",
    style: "code",
    language: "json",
    text: JSON.stringify(parsed.inputRecord ?? parsed.record, null, 2),
  });
  return sections;
}

function formatToolEditSections(content: string): ExportSection[] {
  const parsed = parseToolEditPayload(content);
  if (!parsed) {
    return [{ title: null, style: "code", language: "json", text: formatJsonIfParsable(content) }];
  }

  const sections: ExportSection[] = [];
  if (parsed.filePath) {
    sections.push({
      title: "Path",
      style: "prose",
      language: "text",
      text: parsed.filePath,
    });
  }
  if (parsed.diff) {
    sections.push({
      title: "Diff",
      style: "code",
      language: "diff",
      text: normalizeLineEndings(parsed.diff),
    });
    return sections;
  }
  if (parsed.oldText !== null && parsed.newText !== null) {
    sections.push({
      title: "Diff",
      style: "code",
      language: "diff",
      text: buildUnifiedDiffFromTextPair({
        oldText: parsed.oldText,
        newText: parsed.newText,
        filePath: parsed.filePath,
      }),
    });
    return sections;
  }
  if (parsed.newText !== null) {
    sections.push({
      title: "Written Content",
      style: "code",
      language: "text",
      text: normalizeLineEndings(parsed.newText),
    });
    return sections;
  }

  sections.push({
    title: null,
    style: "code",
    language: "json",
    text: formatJsonIfParsable(content),
  });
  return sections;
}

function formatToolResultSections(content: string): ExportSection[] {
  const parsed = tryParseJsonRecord(content);
  if (!parsed) {
    return [{ title: null, style: "code", language: "text", text: formatJsonIfParsable(content) }];
  }

  const metadata = asObject(parsed.metadata);
  const output = asString(parsed.output);
  const sections: ExportSection[] = [];

  if (metadata) {
    sections.push({
      title: "Metadata",
      style: "code",
      language: "json",
      text: JSON.stringify(metadata, null, 2),
    });
  }
  if (output) {
    const outputJson = tryParseJsonRecord(output);
    sections.push({
      title: "Output",
      style: "code",
      language: outputJson ? "json" : "text",
      text: outputJson ? JSON.stringify(outputJson, null, 2) : normalizeLineEndings(output),
    });
    return sections;
  }
  sections.push({
    title: null,
    style: "code",
    language: "json",
    text: JSON.stringify(parsed, null, 2),
  });
  return sections;
}

function buildMarkdownSections(sections: ExportSection[]): string[] {
  const lines: string[] = [];
  for (const [index, section] of sections.entries()) {
    if (index > 0) {
      lines.push("");
    }
    if (section.title) {
      lines.push(`**${section.title}**`, "");
    }
    if (section.style === "prose") {
      lines.push(...toMarkdownBlockquote(section.text));
    } else {
      lines.push(buildMarkdownCodeFence(section.text, section.language));
    }
  }
  lines.push("");
  return lines;
}

function toMarkdownBlockquote(text: string): string[] {
  const normalized = normalizeLineEndings(text);
  if (normalized.length === 0) {
    return [">"];
  }
  return normalized.split("\n").map((line) => (line.length > 0 ? `> ${line}` : ">"));
}

function buildMarkdownCodeFence(content: string, language: ExportSection["language"]): string {
  const normalizedContent = normalizeLineEndings(content);
  const longestBacktickRun = Math.max(
    ...Array.from(normalizedContent.matchAll(/`+/g), (match) => match[0].length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  const infoString = language === "text" ? "" : language;
  return `${fence}${infoString}\n${normalizedContent}\n${fence}`;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function formatMarkdownInlineValue(value: string): string {
  return normalizeLineEndings(value).replace(/\n+/g, " ").trim();
}

function formatJsonIfParsable(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return normalizeLineEndings(value);
  }
}

function calculateCollectionPercent(completedPages: number, totalPages: number): number {
  if (totalPages <= 1) {
    return 84;
  }
  const ratio = completedPages / totalPages;
  return 10 + Math.round(ratio * 74);
}

function formatCollectionMessage(
  completedPages: number,
  totalPages: number,
  loadedMessages: number,
  totalMessages: number,
): string {
  if (totalPages <= 1) {
    return `Collected ${loadedMessages} messages`;
  }
  return `Collected page ${completedPages} of ${totalPages} · ${loadedMessages} / ${totalMessages} messages`;
}

async function emitHistoryExportProgress(
  exportId: string,
  onProgress: HistoryExportProgressCallback | undefined,
  phase: HistoryExportPhase,
  percent: number,
  message: string,
): Promise<void> {
  if (onProgress) {
    onProgress({
      exportId,
      phase,
      percent: Math.max(0, Math.min(100, percent)),
      message,
    });
  }
  await yieldToUi();
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function formatViewLabel(mode: HistoryExportRequest["mode"]): string {
  switch (mode) {
    case "session":
      return "Session";
    case "project_all":
      return "All Sessions";
    case "bookmarks":
      return "Bookmarks";
  }
}

function formatSortLabel(sortDirection: HistoryExportRequest["sortDirection"]): string {
  return sortDirection === "asc" ? "Oldest to newest" : "Newest to oldest";
}

function formatCategoryLabel(categories: MessageCategory[] | undefined): string {
  if (categories === undefined) {
    return "All";
  }
  if (categories.length === 0) {
    return "None";
  }
  return categories.map((category) => CATEGORY_LABELS[category]).join(", ");
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
  return `${(durationMs / 60_000).toFixed(1)}m`;
}

function compareCreatedAt(left: string, right: string): number {
  return left.localeCompare(right);
}

const CATEGORY_LABELS: Record<MessageCategory, string> = {
  user: "User",
  assistant: "Assistant",
  tool_use: "Tool Use",
  tool_edit: "Tool Edit",
  tool_result: "Tool Result",
  thinking: "Thinking",
  system: "System",
};
