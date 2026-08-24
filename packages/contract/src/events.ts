// A dependency-free structural subset of dsh-session's SessionEvent, sufficient
// for rendering. The bridge re-serializes the real typed event into this shape;
// the whole typed `event.data` record is forwarded verbatim. `raw` is reserved
// for future passthrough of fields with no dedicated member here and is currently
// unused.
export type ToolCallKind =
  | "read" | "edit" | "delete" | "move" | "search" | "execute" | "fetch" | "other";

export interface FileLocation {
  path: string;
  line?: number;
}

export interface FileDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

export interface GenericCallView {
  card: "generic";
  title: string;
  kind?: ToolCallKind;
  rawInput?: unknown;
  content?: unknown[];
  locations?: FileLocation[];
}

export interface TerminalCallView {
  card: "terminal";
  title: string;
  description?: string;
  cwd?: string;
}

export interface DiffCallView {
  card: "diff";
  title: string;
  diffs: FileDiff[];
  locations?: FileLocation[];
}

export type ToolCallView = GenericCallView | TerminalCallView | DiffCallView;

export interface GenericResultView {
  card: "generic";
  title?: string;
  content?: unknown[];
}

export interface TerminalResultView {
  card: "terminal";
  title?: string;
  output?: string;
  exitCode?: number;
  signal?: string;
}

export interface DiffResultView {
  card: "diff";
  title?: string;
  diffs: FileDiff[];
}

export interface SearchLineMatch {
  lineNumber: number;
  line: string;
}

export interface SearchFileMatches {
  path: string;
  matches: SearchLineMatch[];
}

export interface SearchMatchesResultView {
  card: "search";
  shape: "matches";
  title?: string;
  files: SearchFileMatches[];
  truncated: boolean;
  total: number;
}

export interface SearchPathsResultView {
  card: "search";
  shape: "paths";
  title?: string;
  paths: string[];
  truncated: boolean;
  total: number;
}

export type SearchResultView = SearchMatchesResultView | SearchPathsResultView;

export interface ReadFileLine {
  number: number;
  text: string;
}

export interface ReadResultView {
  card: "read";
  title?: string;
  path: string;
  offset: number;
  lines: ReadFileLine[];
  totalLines: number;
  lang?: string;
  content?: unknown[];
}

export interface WebSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

export interface WebSearchResultView {
  card: "web";
  kind: "search";
  title?: string;
  sources: WebSource[];
  answer?: string;
  truncated: boolean;
}

export interface WebFetchResultView {
  card: "web";
  kind: "fetch";
  title?: string;
  url: string;
  statusCode: number;
  truncated: boolean;
}

export type WebResultView = WebSearchResultView | WebFetchResultView;

export type ToolResultView =
  | GenericResultView
  | TerminalResultView
  | DiffResultView
  | SearchResultView
  | ReadResultView
  | WebResultView;

export type ToolEventView =
  | { for: "call"; view: ToolCallView }
  | { for: "result"; view: ToolResultView };

export type SessionEventWire = {
  type: string;
  seq: number;
  time: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> & { raw?: Record<string, unknown> };
  view?: ToolEventView;
};

// A tool/result's extracted, render-ready diff (from dsh-tool-fs meta / str-replace-editor).
export interface ToolDiff {
  path: string;
  oldText: string;
  newText: string;
}
