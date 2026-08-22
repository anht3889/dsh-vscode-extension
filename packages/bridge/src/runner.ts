import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import {
  installModelSelection,
  type AgentHandle,
  type ModelSelectionRef,
} from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {
  Session,
  SessionEvent,
  SessionHeader,
} from "@deepseek-ai/dsh-session";
import type {
  CatalogPayload,
  ContextPayload,
  ModelListItem,
  ModelRef,
  OutboundMessage,
  PermissionsPayload,
  SessionEventWire,
  SessionListItem,
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

function firstUserText(event: SessionEvent): string | undefined {
  if (event.type !== "user/message") return undefined;
  const content = event.data.content;
  for (const part of content) {
    if (part.type === "text" && part.text.trim() !== "") {
      return part.text.trim().slice(0, 80);
    }
  }
  return undefined;
}

function sessionTitle(sessionId: string, events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const genericEvent = event as
      | { type: string; data: { title?: unknown } }
      | undefined;
    if (genericEvent?.type === "session/title") {
      const title = genericEvent.data.title;
      if (typeof title === "string") return title;
    }
  }
  for (const event of events) {
    const text = firstUserText(event);
    if (text !== undefined) return text;
  }
  return sessionId;
}

function sessionListItem(
  sessionId: string,
  createdAt: number,
  cwd: string,
  events: readonly SessionEvent[],
): SessionListItem {
  const lastUserTime = events.reduce(
    (latest, event) =>
      event.type === "user/message" ? Math.max(latest, event.time) : latest,
    createdAt,
  );
  return {
    sessionId,
    title: sessionTitle(sessionId, events),
    createdAt,
    updatedAt: lastUserTime,
    cwd,
  };
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
  type LiveSelectionRef = ModelSelectionRef & { current: ModelRef };
  interface SessionPersistenceReader {
    list(): Promise<readonly SessionHeader[]>;
    inspect(id: SessionId): Promise<{
      readonly meta: SessionHeader;
      readonly events: readonly SessionEvent[];
    }>;
  }

  const initialSelectionRef: LiveSelectionRef = {
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

  const initialHandle = await agents.create({
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: {
      provider: selection.provider,
      model: selection.model,
    },
    setup: (agentCtx) => {
      installModelSelection(agentCtx, initialSelectionRef);
    },
  });

  interface LiveSession {
    handle: AgentHandle;
    selectionRef: LiveSelectionRef;
  }

  let live: LiveSession = {
    handle: initialHandle,
    selectionRef: initialSelectionRef,
  };

  const emitLiveSession = async (
    current: LiveSession,
    includeHistory: boolean,
  ): Promise<void> => {
    const { session } = current.handle.agent;
    const catalog = await buildCatalog(ctx, current.selectionRef.current);
    const permissions = buildPermissions(ctx, session);
    const window = catalog.models.find(
      (model) =>
        model.provider === catalog.current.provider &&
        model.model === catalog.current.model,
    )?.contextWindow;
    const context = buildContext(ctx, session, window);
    io.send({
      kind: "session",
      sessionId: session.id,
      cwd: session.header.cwd ?? process.cwd(),
      createdAt: session.header.createdAt,
    });
    if (includeHistory) {
      io.send({
        kind: "history",
        sessionId: session.id,
        events: session.events.map(toWire),
      });
    }
    io.send({
      kind: "ready",
      sessionId: session.id,
      cwd: session.header.cwd ?? process.cwd(),
      models: catalog,
      permissions,
      ...(context !== undefined ? { context } : {}),
    });
  };

  await emitLiveSession(live, false);

  const replaceLive = async (
    create: (selectionRef: LiveSelectionRef) => Promise<AgentHandle>,
  ): Promise<void> => {
    const previous = live;
    const nextSelectionRef: LiveSelectionRef = {
      current: { ...previous.selectionRef.current },
      assembled: undefined,
    };
    const next: LiveSession = {
      handle: await create(nextSelectionRef),
      selectionRef: nextSelectionRef,
    };
    try {
      previous.handle.agent.cancel({ kind: "user" });
      await sessions.flush(previous.handle.agent.session);
      await previous.handle.dispose();
    } catch (error) {
      await sessions.flush(next.handle.agent.session);
      await next.handle.dispose();
      throw error;
    }
    live = next;
    await next.handle.agent.whenIdle();
    await emitLiveSession(next, true);
  };

  let tail: Promise<void> = live.handle.agent.whenIdle();

  const queue = (operation: () => Promise<void>): void => {
    tail = tail.then(operation).catch((error: unknown) => {
      io.send({ kind: "status", state: "error", detail: String(error) });
    });
  };

  const submit = (text: string, _opts?: SubmitOptions): void => {
    queue(async () => {
      const current = live;
      current.handle.agent.followup(
          createUserMessage({
            content: [{ type: "text", text }],
            source: { kind: "user" },
          }),
      );
      await current.handle.agent.whenIdle();
      await sessions.flush(current.handle.agent.session);
      io.send({ kind: "status", state: "idle" });
    });
  };

  const cancel = (): void => {
    live.handle.agent.cancel({ kind: "user" });
  };

  const listSessions = (): void => {
    void (async () => {
      const persistence = ctx.get(
        "sessionPersistence",
      ) as SessionPersistenceReader | undefined;
      const current = live.handle.agent.session;
      if (persistence === undefined) {
        io.send({
          kind: "sessions",
          available: false,
          items: [
            sessionListItem(
              current.id,
              current.header.createdAt,
              current.header.cwd ?? process.cwd(),
              current.events,
            ),
          ],
        });
        return;
      }

      const headers = (await persistence.list()).filter(
        (header) => header.cwd === process.cwd(),
      );
      const items = await Promise.all(
        headers.map(async (header): Promise<SessionListItem> => {
          if (header.id === current.id) {
            return sessionListItem(
              current.id,
              current.header.createdAt,
              current.header.cwd ?? process.cwd(),
              current.events,
            );
          }
          try {
            const inspection = await persistence.inspect(header.id);
            return sessionListItem(
              header.id,
              header.createdAt,
              header.cwd ?? process.cwd(),
              inspection.events,
            );
          } catch {
            return {
              sessionId: header.id,
              title: header.id,
              createdAt: header.createdAt,
              updatedAt: header.createdAt,
              cwd: header.cwd ?? process.cwd(),
            };
          }
        }),
      );
      if (!items.some((item) => item.sessionId === current.id)) {
        items.push(
          sessionListItem(
            current.id,
            current.header.createdAt,
            current.header.cwd ?? process.cwd(),
            current.events,
          ),
        );
      }
      items.sort((left, right) => right.updatedAt - left.updatedAt);
      io.send({ kind: "sessions", available: true, items });
    })().catch((error: unknown) => {
      io.send({ kind: "status", state: "error", detail: String(error) });
    });
  };

  const newSession = (): void => {
    queue(async () => {
      await replaceLive((selectionRef) =>
        agents.create({
          sessionId: SessionId(`session-${randomUUID()}`),
          meta: { cwd: process.cwd() },
          agentOptions: {
            provider: selectionRef.current.provider,
            model: selectionRef.current.model,
          },
          setup: (agentCtx) => {
            installModelSelection(agentCtx, selectionRef);
          },
        }),
      );
    });
  };

  const resume = (sessionId: string): void => {
    queue(async () => {
      const persistence = ctx.get(
        "sessionPersistence",
      ) as SessionPersistenceReader | undefined;
      if (persistence === undefined) {
        throw new Error(`cannot resume ${sessionId} (durable history unavailable)`);
      }
      const inspection = await persistence.inspect(SessionId(sessionId));
      if (
        inspection.meta.cwd !== undefined &&
        inspection.meta.cwd !== process.cwd()
      ) {
        io.send({
          kind: "status",
          state: "error",
          detail: `cannot resume ${sessionId} (cwd mismatch)`,
        });
        return;
      }
      await replaceLive((selectionRef) =>
        agents.resume({
          resumeSessionId: SessionId(sessionId),
          agentOptions: {
            provider: selectionRef.current.provider,
            model: selectionRef.current.model,
          },
          setup: (agentCtx) => {
            installModelSelection(agentCtx, selectionRef);
          },
        }),
      );
    });
  };

  return {
    submit,
    cancel,
    listSessions,
    newSession,
    resume,
    selectModel: (_provider: string, _model: string) => unavailable("selectModel", io),
    selectPermission: (_preset: string) => unavailable("selectPermission", io),
  };
}

