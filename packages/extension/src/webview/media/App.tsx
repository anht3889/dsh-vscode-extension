import React, {
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import type { AskAnswerWire, FileReferenceItem } from "@dsh-vscode/contract";
import { reduce, initialState, serializeDraft, type UiMessage } from "./store.js";
import { activeAtToken } from "./fileMention.js";
import { Composer } from "./components/Composer.js";
import { StreamView } from "./components/StreamView.js";
import { ApprovalBanner } from "./components/ApprovalBanner.js";
import { Header } from "./components/Header.js";
import { RecentPopover } from "./components/RecentPopover.js";
import { acquireVsCodeApi, type UiCommand } from "./vscode.js";

const vscode = acquireVsCodeApi();

function tokenAt(
  text: string,
  selectionStart: number,
):
  | {
      start: number;
      end: number;
      query: string;
      quoted: boolean;
    }
  | undefined {
  const token = activeAtToken(text, selectionStart);
  if (token === undefined) return undefined;
  return {
    start: selectionStart - token.prefix.length,
    end: selectionStart,
    query: token.query,
    quoted: token.quoted,
  };
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [recentOpen, setRecentOpen] = useState(false);
  const [focusPickerSearch, setFocusPickerSearch] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      // extension -> webview: raw OutboundMessage (has a `kind` discriminant)
      if (typeof data === "object" && data !== null && "kind" in data) {
        dispatch(data as UiMessage);
      }
    };
    window.addEventListener("message", onMessage);
    const message: UiCommand = {
      type: "dsh/ui",
      cmd: { kind: "webviewReady" },
    };
    vscode.postMessage(message);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const post = useCallback((cmd: UiCommand["cmd"]): void => {
    const message: UiCommand = { type: "dsh/ui", cmd };
    vscode.postMessage(message);
  }, []);

  useEffect(() => {
    const picker = state.picker;
    if (picker !== undefined) {
      post({
        kind: "listFileReferences",
        query: picker.query,
        requestId: picker.requestId,
      });
    }
  }, [post, state.picker?.requestId]);

  const answer = useCallback(
    (askId: string, answered: AskAnswerWire): void => {
      dispatch({ kind: "askSettled", askId });
      post({ kind: "answer", askId, answered });
    },
    [post],
  );
  const apply = useCallback((): void => post({ kind: "apply" }), [post]);

  const onDraftChange = useCallback(
    (text: string, selectionStart: number): void => {
      const token = tokenAt(text, selectionStart);
      if (state.picker === undefined) {
        if (token === undefined) {
          dispatch({ kind: "draftChanged", text });
          return;
        }
        setFocusPickerSearch(false);
        dispatch({
          kind: "pickerOpened",
          text,
          token,
          requestId: crypto.randomUUID(),
        });
        return;
      }
      if (token === undefined) {
        setFocusPickerSearch(false);
        dispatch({ kind: "draftChanged", text });
        dispatch({ kind: "pickerDismissed" });
        return;
      }
      if (
        token.quoted === state.picker.quoted &&
        token.start === state.picker.tokenStart &&
        token.query !== state.picker.query
      ) {
        dispatch({
          kind: "pickerQueryChanged",
          query: token.query,
          requestId: crypto.randomUUID(),
        });
        return;
      }
      if (
        token.quoted === state.picker.quoted &&
        token.start === state.picker.tokenStart &&
        token.query === state.picker.query
      ) {
        dispatch({ kind: "draftChanged", text });
        return;
      }
      setFocusPickerSearch(false);
      dispatch({
        kind: "pickerOpened",
        text,
        token,
        requestId: crypto.randomUUID(),
      });
    },
    [state.picker],
  );

  const onOpenPicker = useCallback(
    (selectionStart: number): void => {
      setFocusPickerSearch(true);
      const existing = tokenAt(state.draft, selectionStart);
      if (existing !== undefined) {
        dispatch({
          kind: "pickerOpened",
          text: state.draft,
          token: existing,
          requestId: crypto.randomUUID(),
        });
        return;
      }
      const text = `${state.draft.slice(0, selectionStart)}@${state.draft.slice(selectionStart)}`;
      dispatch({
        kind: "pickerOpened",
        text,
        token: {
          start: selectionStart,
          end: selectionStart + 1,
          query: "",
          quoted: false,
        },
        requestId: crypto.randomUUID(),
      });
    },
    [state.draft],
  );

  const onPickerQuery = useCallback((query: string): void => {
    dispatch({
      kind: "pickerQueryChanged",
      query,
      requestId: crypto.randomUUID(),
    });
  }, []);

  const onPickReference = useCallback((item: FileReferenceItem): void => {
    setFocusPickerSearch(false);
    dispatch({
      kind: "referencePicked",
      id: crypto.randomUUID(),
      item,
    });
  }, []);

  const onDismissPicker = useCallback((): void => {
    setFocusPickerSearch(false);
    dispatch({ kind: "pickerDismissed" });
  }, []);

  const onRemoveChip = useCallback((id: string): void => {
    dispatch({ kind: "chipRemoved", id });
  }, []);

  const onBrowseFolder = useCallback((): void => {
    setFocusPickerSearch(false);
    dispatch({ kind: "pickerDismissed" });
    post({ kind: "browseFolder" });
  }, [post]);

  const onAttachImage = useCallback((): void => {
    setFocusPickerSearch(false);
    dispatch({ kind: "pickerDismissed" });
    post({ kind: "attachImage" });
  }, [post]);

  const onSubmit = useCallback((): void => {
    const payload = serializeDraft(state);
    dispatch({ kind: "submitStarted" });
    post({ kind: "submit", ...payload });
  }, [post, state]);

  return (
    <div className="dsh-root">
      <Header
        busy={state.starting || state.status === "thinking"}
        recentOpen={recentOpen}
        onRecent={() => {
          setRecentOpen((open) => {
            if (!open) post({ kind: "listSessions" });
            return !open;
          });
        }}
        onCloseRecent={() => setRecentOpen(false)}
        onNewChat={() => {
          if (
            state.status === "thinking" ||
            state.status === "awaiting-approval"
          ) {
            post({ kind: "confirmNewChat" });
          } else {
            post({ kind: "newSession" });
          }
        }}
      >
        {recentOpen ? (
          <RecentPopover
            items={state.sessions}
            unavailable={state.sessionsUnavailable}
            onClose={() => setRecentOpen(false)}
            onPick={(sessionId) => {
              post({ kind: "resume", sessionId });
              setRecentOpen(false);
            }}
          />
        ) : null}
      </Header>
      <StreamView stream={state.stream} diffs={state.diffs} onApply={apply} />
      {state.error ? (
        <div className="dsh-error" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.approval ? (
        <ApprovalBanner approval={state.approval} onAnswer={answer} />
      ) : null}
      <Composer
        ready={state.ready}
        models={state.models}
        permissions={state.permissions}
        context={state.context}
        status={state.status}
        draft={state.draft}
        chips={state.chips}
        picker={state.picker}
        submitPending={state.submitPending}
        focusPickerSearch={focusPickerSearch}
        onDraftChange={onDraftChange}
        onOpenPicker={onOpenPicker}
        onPickerQuery={onPickerQuery}
        onPickReference={onPickReference}
        onDismissPicker={onDismissPicker}
        onRemoveChip={onRemoveChip}
        onBrowseFolder={onBrowseFolder}
        onAttachImage={onAttachImage}
        onSubmit={onSubmit}
        onCancel={() => post({ kind: "cancel", cause: "user" })}
        onSelectModel={(provider, model) =>
          post({ kind: "selectModel", provider, model })
        }
        onSelectPermission={(preset) =>
          post({ kind: "selectPermission", preset })
        }
        onRequestFullAccess={() => post({ kind: "confirmFullAccess" })}
      />
    </div>
  );
}
