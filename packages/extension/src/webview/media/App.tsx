import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  AskAnswerWire,
  FileReferenceItem,
  SlashMenuItem,
} from "@dsh-vscode/contract";
import {
  reduce,
  initialState,
  serializeCommand,
  serializeDraft,
  type UiMessage,
} from "./store.js";
import { activeAtToken } from "./fileMention.js";
import { activeSlashToken, replaceSlashToken } from "./slashToken.js";
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

function sameSlashToken(
  left: ReturnType<typeof activeSlashToken>,
  right: ReturnType<typeof activeSlashToken>,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.start === right.start &&
    left.end === right.end &&
    left.query === right.query &&
    left.position === right.position
  );
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [recentOpen, setRecentOpen] = useState(false);
  const [focusPickerSearch, setFocusPickerSearch] = useState(false);
  const caretRef = useRef(0);
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

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
    if (picker?.kind === "attachment") {
      post({
        kind: "listFileReferences",
        query: picker.query,
        requestId: picker.requestId,
      });
    }
    if (picker?.kind === "slash") {
      post({ kind: "listSlashItems", requestId: picker.requestId });
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

  const arbitrateDraft = useCallback(
    (text: string, selectionStart: number): void => {
      const attachment = tokenAt(text, selectionStart);
      const slash =
        attachment === undefined
          ? activeSlashToken(text, selectionStart)
          : undefined;
      const picker = state.picker;

      if (attachment !== undefined) {
        setFocusPickerSearch(false);
        if (
          picker?.kind === "attachment" &&
          attachment.quoted === picker.quoted &&
          attachment.start === picker.tokenStart
        ) {
          if (attachment.query === picker.query) {
            dispatch({ kind: "draftChanged", text });
          } else {
            dispatch({
              kind: "pickerQueryChanged",
              query: attachment.query,
              requestId: crypto.randomUUID(),
            });
          }
        } else {
          dispatch({
            kind: "pickerOpened",
            text,
            token: attachment,
            requestId: crypto.randomUUID(),
          });
        }
        return;
      }

      if (slash !== undefined) {
        setFocusPickerSearch(false);
        if (
          picker?.kind === "slash" &&
          slash.start === picker.token.start
        ) {
          dispatch({ kind: "slashTokenChanged", text, token: slash });
        } else {
          dispatch({
            kind: "slashPickerOpened",
            text,
            token: slash,
            requestId: crypto.randomUUID(),
          });
        }
        return;
      }

      dispatch({ kind: "draftChanged", text });
      if (picker !== undefined) {
        setFocusPickerSearch(false);
        dispatch({
          kind:
            picker.kind === "attachment"
              ? "pickerDismissed"
              : "slashPickerDismissed",
        });
      }
    },
    [state.picker],
  );

  const onDraftChange = useCallback(
    (text: string, selectionStart: number): void => {
      caretRef.current = selectionStart;
      draftRef.current = text;
      arbitrateDraft(text, selectionStart);
    },
    [arbitrateDraft],
  );

  const onCaretChange = useCallback(
    (text: string, selectionStart: number): void => {
      caretRef.current = selectionStart;
      if (state.picker?.kind === "slash") {
        arbitrateDraft(text, selectionStart);
      }
    },
    [arbitrateDraft, state.picker?.kind],
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

  const onPickSlashItem = useCallback(
    (item: SlashMenuItem): number | undefined => {
      if (state.picker?.kind !== "slash") return undefined;
      const currentToken =
        tokenAt(state.draft, caretRef.current) === undefined
          ? activeSlashToken(state.draft, caretRef.current)
          : undefined;
      if (
        draftRef.current !== state.draft ||
        !sameSlashToken(currentToken, state.picker.token)
      ) {
        return undefined;
      }
      const replacement =
        item.behavior === "execute" ? "" : `/${item.name} `;
      const result = replaceSlashToken(
        state.draft,
        state.picker.token,
        replacement,
      );
      dispatch({ kind: "slashItemPicked", item });
      if (item.behavior === "execute") {
        post({ kind: "executeSlashCommand", line: `/${item.name}` });
        return undefined;
      }
      return result.caret;
    },
    [post, state.draft, state.picker],
  );

  const onDismissPicker = useCallback((): void => {
    setFocusPickerSearch(false);
    dispatch({
      kind:
        state.picker?.kind === "slash"
          ? "slashPickerDismissed"
          : "pickerDismissed",
    });
  }, [state.picker?.kind]);

  const onRemoveChip = useCallback((id: string): void => {
    dispatch({ kind: "chipRemoved", id });
  }, []);

  const onAttachImage = useCallback((): void => {
    setFocusPickerSearch(false);
    dispatch({ kind: "pickerDismissed" });
    post({ kind: "attachImage" });
  }, [post]);

  const onSubmit = useCallback((): void => {
    const command = serializeCommand(state);
    if (command !== undefined) {
      if (
        command.images !== undefined &&
        !state.commandClaim?.acceptsImages
      ) {
        dispatch({
          kind: "localError",
          detail: `/${state.commandClaim?.name} does not accept images`,
        });
        return;
      }
      dispatch({ kind: "commandSubmitStarted", line: command.line });
      post({ kind: "executeSlashCommand", ...command });
      return;
    }
    dispatch({ kind: "submitStarted" });
    post({ kind: "submit", ...serializeDraft(state) });
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
      <StreamView
        transcript={state.transcript}
        diffs={state.diffs}
        onApply={apply}
      />
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
        commandClaim={state.commandClaim}
        submitPending={state.submitPending}
        focusPickerSearch={focusPickerSearch}
        onDraftChange={onDraftChange}
        onCaretChange={onCaretChange}
        onOpenPicker={onOpenPicker}
        onPickerQuery={onPickerQuery}
        onPickReference={onPickReference}
        onMoveSlashHighlight={(delta) =>
          dispatch({ kind: "slashHighlightMoved", delta })
        }
        onPickSlashItem={onPickSlashItem}
        onDismissPicker={onDismissPicker}
        onRemoveChip={onRemoveChip}
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
