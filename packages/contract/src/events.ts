// A dependency-free structural subset of dsh-session's SessionEvent, sufficient
// for rendering. The bridge re-serializes the real typed event into this shape;
// the whole typed `event.data` record is forwarded verbatim. `raw` is reserved
// for future passthrough of fields with no dedicated member here and is currently
// unused.
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
