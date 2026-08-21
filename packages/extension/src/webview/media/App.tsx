import React, { useCallback, useReducer, useEffect } from "react";
import type { AskAnswerWire, OutboundMessage } from "@dsh-vscode/contract";
import { reduce, initialState } from "./store.js";
import { Composer } from "./components/Composer.js";
import { StreamView } from "./components/StreamView.js";
import { ApprovalBanner } from "./components/ApprovalBanner.js";
import { acquireVsCodeApi, type UiCommand } from "./vscode.js";

const vscode = acquireVsCodeApi();

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      // extension -> webview: raw OutboundMessage (has a `kind` discriminant)
      if (typeof data === "object" && data !== null && "kind" in data) {
        dispatch(data as OutboundMessage);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const post = useCallback((cmd: UiCommand["cmd"]): void => {
    const message: UiCommand = { type: "dsh/ui", cmd };
    vscode.postMessage(message);
  }, []);

  const submit = useCallback((text: string): void => post({ kind: "submit", text }), [post]);
  const answer = useCallback(
    (askId: string, answered: AskAnswerWire): void => post({ kind: "answer", askId, answered }),
    [post],
  );
  const cancel = useCallback((): void => post({ kind: "cancel" }), [post]);

  return (
    <div className="dsh-root">
      <header className="dsh-header">
        <span className="dsh-title">DSH</span>
        <button className="dsh-cancel" onClick={cancel} title="Cancel active turn">
          Cancel
        </button>
      </header>
      <StreamView stream={state.stream} diffs={state.diffs} />
      {state.approval ? (
        <ApprovalBanner approval={state.approval} onAnswer={answer} />
      ) : null}
      <Composer onSubmit={submit} />
    </div>
  );
}
