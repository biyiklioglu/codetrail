# History Refresh Policy

This document is the source of truth for history pagination and refresh behavior.

## Core rules

- Visual edge and live-edge page are different concepts.
- Visual edge means:
  - `asc`: pinned to the bottom within the refresh threshold.
  - `desc`: pinned to the top within the refresh threshold.
- Live-edge page means:
  - `asc`: the last page.
  - `desc`: page `0`.
- Auto-follow is only eligible when the selected scope is both visually pinned and already on its live-edge page.
- Auto-follow applies only to the selected scope:
  - `session:${selectedSessionId}`
  - `project_all:${selectedProjectId}`
  - `bookmarks:${selectedProjectId}`
- Page movement during auto-refresh requires actual growth in the selected scope's total message count.
- Unrelated project changes may update badges, counts, and ordering, but they must not move the current page.
- Bookmarks refresh when visible, but they do not adopt follow-newest behavior.
- When totals shrink and the requested page becomes invalid, the server clamp is authoritative.

## Refresh scope

- Manual refresh is broad. It refreshes history surfaces, tree sessions, and search.
- Auto-refresh is scoped. It always refreshes project summaries, refreshes the selected project's session list when History is visible, and refreshes only the visible detail surface when its selected summary fingerprint changed.
- Search auto-refresh runs only when Search is the active view and the debounced query is non-empty.
- Tree session auto-refresh runs only when tree view is active and expanded project session rows are already loaded.

## Expected outcomes

- If the user is on the live edge and the selected scope grows, auto-refresh follows the newest messages.
- If the user is not on the live edge, auto-refresh preserves the current page and viewport.
- If the selected scope did not grow, auto-refresh preserves the current page and viewport.
- If another project changed, the current project or session view stays on its current page.
