import { parentPort } from "node:worker_threads";

import {
  type IndexingFileIssue,
  type IndexingNotice,
  type SystemMessageRegexRuleOverrides,
  runIncrementalIndexing,
} from "@codetrail/core";

type IndexingWorkerRequest = {
  dbPath: string;
  forceReindex: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
};

type IndexingWorkerResult =
  | {
      type: "result";
      ok: true;
    }
  | {
      type: "result";
      ok: false;
      message: string;
      stack?: string;
    };

type IndexingWorkerMessage =
  | IndexingWorkerResult
  | {
      type: "file-issue";
      issue: Omit<IndexingFileIssue, "error"> & {
        error: unknown;
      };
    }
  | {
      type: "notice";
      notice: IndexingNotice;
    };

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(error.cause !== undefined ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return error;
}

function postMessage(message: IndexingWorkerMessage): void {
  if (parentPort) {
    parentPort.postMessage(message);
    return;
  }
  if (typeof process.send === "function") {
    process.send(message);
    return;
  }
  throw new Error("Indexing worker started without a parent communication channel.");
}

function handleRequest(request: IndexingWorkerRequest): void {
  try {
    runIncrementalIndexing(
      {
        dbPath: request.dbPath,
        forceReindex: request.forceReindex,
        ...(request.systemMessageRegexRules
          ? { systemMessageRegexRules: request.systemMessageRegexRules }
          : {}),
      },
      {
        onFileIssue: (issue: IndexingFileIssue) => {
          postMessage({
            type: "file-issue",
            issue: {
              ...issue,
              error: serializeError(issue.error),
            },
          });
        },
        onNotice: (notice: IndexingNotice) => {
          postMessage({
            type: "notice",
            notice,
          });
        },
      },
    );
    const response: IndexingWorkerResult = { type: "result", ok: true };
    postMessage(response);
  } catch (error) {
    const response: IndexingWorkerResult = {
      type: "result",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    };
    postMessage(response);
  }
}

if (parentPort) {
  parentPort.on("message", (request: IndexingWorkerRequest) => {
    handleRequest(request);
  });
} else if (typeof process.send === "function") {
  process.on("message", (request: IndexingWorkerRequest) => {
    handleRequest(request);
  });
} else {
  throw new Error("Indexing worker started without a parent communication channel.");
}
