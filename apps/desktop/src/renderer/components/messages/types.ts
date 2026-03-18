import type { IpcResponse } from "@codetrail/core/browser";

export type SessionMessage =
  | IpcResponse<"sessions:getDetail">["messages"][number]
  | IpcResponse<"projects:getCombinedDetail">["messages"][number];
