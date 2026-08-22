import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { installModelSelection, type ModelSelectionRef } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type {
  CatalogPayload,
  ContextPayload,
  ModelListItem,
  ModelRef,
  OutboundMessage,
  PermissionsPayload,
  SessionEventWire,
} from "@dsh-vscode/contract";
import { PROTOCOL_VERSION } from "@dsh-vscode/contract";
import type { Io } from "./io.js";

const PRESET_LABELS: Record<string, string> = {
  "read-only": "Read Only",
  "workspace-write": "Workspace Write",
  "danger-full-access": "Full Access",
};

async function buildCatalog(ctx: Context, current: ModelRef): Promise<CatalogPayload> {
  const llm = ctx.get("llm");
  const models: ModelListItem[] = [];
  if (llm !== undefined) {
    for (const providerInfo of llm.listProviders()) {
      const provider = providerInfo.id;
      for (const info of await llm.listModels(provider)) {
        try {
          const resolved = await llm.resolveModelInfo(provider, info.id);
          models.push({
            provider,
            model: info.id,
            label: info.name ?? info.id,
            ...(resolved.context?.contextWindow !== undefined
              ? { contextWindow: resolved.context.contextWindow }
              : {}),
          });
        } catch {
          // Unusable model (credentials/config): omit.
        }
      }
    }
  }
  if (!models.some((m) => m.provider === current.provider && m.model === current.model)) {
    models.unshift({
      provider: current.provider,
      model: current.model,
      label: current.model,
    });
  }
  return { current, models };
}

function buildPermissions(ctx: Context, session: Session): PermissionsPayload {
  const presetsSvc = ctx.get("permissionPresets");
  const presets = presetsSvc !== undefined
    ? presetsSvc.names.map((id: string) => ({
        id,
        label: PRESET_LABELS[id] ?? id,
      }))
    : [
        { id: "read-only", label: "Read Only" },
        { id: "workspace-write", label: "Workspace Write" },
        { id: "danger-full-access", label: "Full Access" },
      ];
  const current =
    presetsSvc !== undefined
      ? presetsSvc.current(session.events)
      : "workspace-write";
  return { current, presets };
}

function buildContext(
  ctx: Context,
  session: Session,
  window: number | undefined,
): ContextPayload | undefined {
  if (window === undefined || window <= 0) return undefined;
  const meter = ctx.get("tokenMeter");
  const used = meter !== undefined ? meter.measure(session).totalTokens : 0;
  return { used, window };
}

/** Relay a non-fatal `status:error` for session commands not yet implemented. */
function unavailable(feature: string, io: Io): void {
  io.send({ kind: "status", state: "error", detail: `${feature} is not available yet` });
}

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

/** Optional picker fields forwarded with a submit command. */
export interface SubmitOptions {
  provider?: string;
  model?: string;
  permission?: string;
}

/**
 * Full session command surface the bridge dispatcher routes inbound protocol
 * messages onto. Lifecycle commands beyond submit/cancel emit `status:error`
 * placeholders until Tasks 4/5 wire them.
 */
export interface SessionController {
  submit(text: string, opts?: SubmitOptions): void;
  cancel(): void;
  listSessions(): void;
  newSession(): void;
  resume(sessionId: string): void;
  selectModel(provider: string, model: string): void;
  selectPermission(preset: string): void;
}

/**
 * Create a retained runner: mount the boot recipe once, register the
 * `session/event` relay once (before `agents.create` so no event is missed),
 * emit `hello`/`session`/`ready`, and return a {@link SessionController} that
 * drives repeated turns on the SAME agent/session.
 *
 * Unlike the one-shot {@link runVscode}, this never exits the process and never
 * re-registers the listener per submit — submit is plain `followup`, and the
 * idle/flush tail is chained (and serialized) behind each turn.
 */
export async function createRunner(ctx: Context, io: Io): Promise<SessionController> {
  await ctx.get("loader")?.await();

  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error("runner: required services (agents/agentDefaultModel/sessions) are not mounted");
  }

  const selection = defaultModel.currentSelection();
  const selectionRef: ModelSelectionRef = {
    current: selection,
    assembled: undefined,
  };

  // Version handshake FIRST: the extension records `hello` (host-only, never
  // forwarded to the webview) to learn PROTOCOL_VERSION / dshVersion / cwd /
  // model and to verify protocol compatibility. Must precede the session/event
  // listener registration and definitely precede `agents.create`.
  io.send({
    kind: "hello",
    version: PROTOCOL_VERSION,
    // keep in sync with packages/bridge/package.json
    dshVersion: "0.1.0",
    cwd: process.cwd(),
    model: { provider: selection.provider, model: selection.model },
  });

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
      installModelSelection(agentCtx, selectionRef);
    },
  });

  const catalog = await buildCatalog(ctx, {
    provider: selection.provider,
    model: selection.model,
  });
  const permissions = buildPermissions(ctx, agent.session);
  const window = catalog.models.find(
    (m) => m.provider === catalog.current.provider && m.model === catalog.current.model,
  )?.contextWindow;
  const context = buildContext(ctx, agent.session, window);
  io.send({
    kind: "session",
    sessionId: agent.session.id,
    cwd: process.cwd(),
    createdAt: Date.now(),
  });
  io.send({
    kind: "ready",
    sessionId: agent.session.id,
    cwd: process.cwd(),
    models: catalog,
    permissions,
    ...(context !== undefined ? { context } : {}),
  });

  // Serialize turn tails: each submit appends to this chain so the prior turn's
  // flush + idle relay settles before the next followup is issued. The seed
  // resolves the agent's initial idle state.
  let tail: Promise<void> = agent.whenIdle();

  const submit = (text: string, _opts?: SubmitOptions): void => {
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

  return {
    submit,
    cancel,
    listSessions: () => unavailable("listSessions", io),
    newSession: () => unavailable("newSession", io),
    resume: (_sessionId: string) => unavailable("resume", io),
    selectModel: (_provider: string, _model: string) => unavailable("selectModel", io),
    selectPermission: (_preset: string) => unavailable("selectPermission", io),
  };
}

