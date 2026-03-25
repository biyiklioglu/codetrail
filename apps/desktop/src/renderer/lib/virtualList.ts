export const SIDEBAR_LIST_ROW_HEIGHT = 86;
export const SIDEBAR_LIST_OVERSCAN = 6;
export const SIDEBAR_LIST_VIRTUALIZATION_THRESHOLD = 40;

export function scrollVirtualListIndexIntoView(
  container: HTMLDivElement,
  index: number,
  rowHeight: number,
): void {
  const targetTop = Math.max(0, index * rowHeight);
  const targetBottom = targetTop + rowHeight;
  const viewportTop = container.scrollTop;
  const viewportHeight = container.clientHeight;
  const viewportBottom =
    viewportHeight > 0 ? viewportTop + viewportHeight : viewportTop + rowHeight;

  if (targetTop < viewportTop) {
    container.scrollTop = targetTop;
    return;
  }

  if (targetBottom > viewportBottom) {
    container.scrollTop = Math.max(0, targetBottom - Math.max(viewportHeight, rowHeight));
  }
}
