import { parentPort } from "node:worker_threads";

import {
  type IndexingFileIssue,
  type IndexingNotice,
  indexChangedFiles,
  runIncrementalIndexing,
} from "@codetrail/core";
import {
  type IndexingWorkerRequest,
  toChangedFilesIndexingConfig,
  toIncrementalIndexingConfig,
} from "./indexingRequestConfig";
import { serializeError } from "./serializeError";

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

function makeDependencies() {
  return {
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
  };
}

function handleRequest(request: IndexingWorkerRequest): void {
  try {
    if (request.kind === "changedFiles") {
      indexChangedFiles(
        toChangedFilesIndexingConfig(request),
        request.changedFilePaths,
        makeDependencies(),
      );
    } else {
      runIncrementalIndexing(toIncrementalIndexingConfig(request), makeDependencies());
    }
    postMessage({ type: "result", ok: true });
  } catch (error) {
    postMessage({
      type: "result",
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    });
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
