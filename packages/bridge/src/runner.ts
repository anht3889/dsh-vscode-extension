import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type { OutboundMessage, SessionEventWire } from "@dsh-vscode/contract";
import type { Io } from "./io.js";

/**
 * Re-serialize one typed {@link SessionEvent} into the dependency-free wire
 * shape the extension renders. `type`/`seq`/`time` map one-to-one and `data`
 * is passed through verbatim (it holds frozen message/diff payloads that the
 * webview detail view must never lose).
 */
export function toWire(event: SessionEvent): SessionEventWire {
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    // event.data is the concrete SessionEventMap[K] record; widening via unknown
    // preserves the verbatim payload for the webview.
    data: event.data as unknown as SessionEventWire["data"],
  };
}

/**
 * Run one task through a freshly created Agent in `ctx`, relaying every session
 * event out via `io` and finishing with an `idle` status. Unlike the headless
 * one-shot driver this does NOT exit the process: the bridge stays alive to
 * service further commands from the extension.
 *
 * @param ctx  - plugin context carrying the Agent registry, default model,
 *               Session store, and the model adapter.
 * @param io   - process-facing effects the bridge relays outbound messages through.
 * @param task - one-shot task text.
 */
export async function runVscode(
  ctx: Context,
  io: Io,
  task: string,
): Promise<void> {
  await ctx.get("loader")?.await();

  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error("runner: required services (agents/agentDefaultModel/sessions) are not mounted");
  }

  const selection = defaultModel.currentSelection();

  // Relay the session firehose before creation so nothing — turn/start through
  // turn/end — is missed.
  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    const out: OutboundMessage = {
      kind: "event",
      sessionId: session.id,
      event: toWire(event),
    };
    io.send(out);
  });

  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: selection.provider,
      model: selection.model,
    },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, {
        current: selection,
        assembled: undefined,
      });
    },
  });

  await agent.whenIdle();
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text: task }],
      source: { kind: "user" },
    }),
  );
  await agent.whenIdle();
  await sessions.flush(agent.session);

  io.send({ kind: "status", state: "idle" });
}

/**
 * A runner returned by {@link createRunner}, retaining a single live Agent and
 * exposing repeated {@link submit} / {@link cancel} on it. Message construction
 * accepts the same wire-bound `Io` and the shared `session/event` listener that
 * `createRunner` registers once.
 */
export interface RetainedRunner {
  /** Queue a follow-up turn on the retained agent and relay quiescence + idle. */
  submit(text: string): void;
  /** Cancel the retained agent's active turn (user-initiated). */
  cancel(): void;
}

/**
 * Create a retained runner: mount the boot recipe once, register the
 * `session/event` relay once (before `agents.create` so no event is missed),
 * and return a handler that drives repeated turns on the SAME agent/session.
 *
 * Unlike the one-shot {@link runVscode}, this never exits the process and never
 * re-registers the listener per submit — submit is plain `followup`, and the
 * idle/flush tail is chained (and serialized) behind each turn.
 */
export async function createRunner(ctx: Context, io: Io): Promise<RetainedRunner> {
  await ctx.get("loader")?.await();

  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error("runner: required services (agents/agentDefaultModel/sessions) are not mounted");
  }

  const selection = defaultModel.currentSelection();

  // Relay the session firehose before creation so nothing — turn/start through
  // turn/end — is missed. Registered exactly once for the lifetime of the runner.
  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    const out: OutboundMessage = {
      kind: "event",
      sessionId: session.id,
      event: toWire(event),
    };
    io.send(out);
  });

  const { agent } = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: selection.provider,
      model: selection.model,
    },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, {
        current: selection,
        assembled: undefined,
      });
    },
  });

  // Serialize turn tails: each submit appends to this chain so the prior turn's
  // flush + idle relay settles before the next followup is issued. The seed
  // resolves the agent's initial idle state.
  let tail: Promise<void> = agent.whenIdle();

  const submit = (text: string): void => {
    const turn: Promise<void> = tail
      .then(() => {
        agent.followup(
          createUserMessage({
            content: [{ type: "text", text }],
            source: { kind: "user" },
          }),
        );
      })
      .then(() => agent.whenIdle())
      .then(() => sessions.flush(agent.session))
      .then(() => {
        io.send({ kind: "status", state: "idle" });
      });
    tail = turn;
    // A rejected turn must not poison the tail: surface the failure as a
    // status:error, then reset the chain so later submits keep working.
    turn.catch((error: unknown) => {
      io.send({ kind: "status", state: "error", detail: String(error) });
      tail = Promise.resolve();
    });
  };

  const cancel = (): void => {
    agent.cancel({ kind: "user" });
  };

  return { submit, cancel };
}

