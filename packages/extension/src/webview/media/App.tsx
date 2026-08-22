import React, {
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import type { AskAnswerWire, OutboundMessage } from "@dsh-vscode/contract";
import { reduce, initialState } from "./store.js";
import { Composer } from "./components/Composer.js";
import { StreamView } from "./components/StreamView.js";
import { ApprovalBanner } from "./components/ApprovalBanner.js";
import { Header } from "./components/Header.js";
import { RecentPopover } from "./components/RecentPopover.js";
import { acquireVsCodeApi, type UiCommand } from "./vscode.js";

const vscode = acquireVsCodeApi();

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [recentOpen, setRecentOpen] = useState(false);
  const [fullAccessConfirmedFor, setFullAccessConfirmedFor] = useState<
    string | undefined
  >();

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

  useEffect(() => {
    setFullAccessConfirmedFor(undefined);
  }, [state.sessionId]);

  const post = useCallback((cmd: UiCommand["cmd"]): void => {
    const message: UiCommand = { type: "dsh/ui", cmd };
    vscode.postMessage(message);
  }, []);

  const answer = useCallback(
    (askId: string, answered: AskAnswerWire): void => post({ kind: "answer", askId, answered }),
    [post],
  );
  const apply = useCallback((): void => post({ kind: "apply" }), [post]);

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
        sessionId={state.sessionId}
        fullAccessConfirmedFor={fullAccessConfirmedFor}
        onSubmit={(text, options) => post({ kind: "submit", text, ...options })}
        onSelectModel={(provider, model) =>
          post({ kind: "selectModel", provider, model })
        }
        onSelectPermission={(preset) =>
          post({ kind: "selectPermission", preset })
        }
        onConfirmFullAccess={() =>
          setFullAccessConfirmedFor(state.sessionId)
        }
      />
    </div>
  );
}
