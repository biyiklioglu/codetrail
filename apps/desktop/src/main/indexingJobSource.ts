export type IndexingJobSource =
  | "startup_incremental"
  | "manual_incremental"
  | "manual_force_reindex"
  | "watch_targeted"
  | "watch_fallback_incremental"
  | "watch_initial_scan";
