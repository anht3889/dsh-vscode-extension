// A dependency-free structural subset of dsh-session's SessionEvent, sufficient
// for rendering. The bridge re-serializes the real typed event into this shape;
// unknown/extra fields are passed through `raw` verbatim so the webview's detail
// view never loses data.
export type SessionEventWire = {
  type: string;
  seq: number;
  time: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> & { raw?: Record<string, unknown> };
};

// A tool/result's extracted, render-ready diff (from dsh-tool-fs meta / str-replace-editor).
export interface ToolDiff {
  path: string;
  oldText: string;
  newText: string;
}
