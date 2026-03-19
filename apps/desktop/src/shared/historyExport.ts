export const HISTORY_EXPORT_PROGRESS_CHANNEL = "history:exportProgress";

export type HistoryExportPhase = "preparing" | "collecting" | "formatting" | "writing";

export type HistoryExportProgressPayload = {
  exportId: string;
  phase: HistoryExportPhase;
  percent: number;
  message: string;
};
