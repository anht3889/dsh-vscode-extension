import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-file-reference";
import type { OutboundMessage } from "@dsh-vscode/contract";

/** Coordinates cancellable file-reference requests for the current session. */
export interface FileReferenceSearch {
  /** Start a query, replacing any query still in flight. */
  list(query: string, requestId: string): void;
  /** Abort the active query, if any. */
  dispose(): void;
}

/**
 * Create the bridge's latest-query-wins file-reference coordinator.
 *
 * @param ctx - bridge context carrying the optional file-reference service.
 * @param currentAgent - resolves the current agent at request time.
 * @param send - emits protocol messages to the extension.
 * @returns a cancellable file-reference coordinator.
 */
export function createFileReferenceSearch(
  ctx: Context,
  currentAgent: () => Agent,
  send: (message: OutboundMessage) => void,
): FileReferenceSearch {
  let current: AbortController | undefined;

  const unavailable = (requestId: string): void => {
    send({
      kind: "fileReferences",
      requestId,
      items: [],
      available: false,
    });
  };

  const list = (query: string, requestId: string): void => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const service = ctx.get("fileReferences");
    if (service === undefined) {
      unavailable(requestId);
      return;
    }

    void service
      .list(currentAgent(), query, controller.signal)
      .then((items) => {
        if (current !== controller || controller.signal.aborted) return;
        send({ kind: "fileReferences", requestId, items });
      })
      .catch(() => {
        if (current !== controller || controller.signal.aborted) return;
        unavailable(requestId);
      });
  };

  const dispose = (): void => {
    current?.abort();
    current = undefined;
  };

  return { list, dispose };
}
