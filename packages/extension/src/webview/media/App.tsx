import React, {
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";
import type { AskAnswerWire } from "@dsh-vscode/contract";
import { reduce, initialState, type UiMessage } from "./store.js";
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
        status={state.status}
        onSubmit={(text) => post({ kind: "submit", text })}
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
