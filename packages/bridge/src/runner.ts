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
import type { SessionPersistence } from "@deepseek-ai/dsh-session-persistence";
import type {} from "@deepseek-ai/dsh-session-query";
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
import { createFileReferenceSearch } from "./file-references.js";

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

function getSessionPersistence(ctx: Context): SessionPersistence | undefined {
  return ctx.get("sessionPersistence");
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
  listFileReferences(query: string, requestId: string): void;
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
    catalog?: CatalogPayload;
  }

  let live: LiveSession = {
    handle: initialHandle,
    selectionRef: initialSelectionRef,
  };
  const fileReferenceSearch = createFileReferenceSearch(
    ctx,
    () => live.handle.agent,
    (message) => io.send(message),
  );
  io.onDisconnect(fileReferenceSearch.dispose);

  const emitLiveSession = async (
    current: LiveSession,
    includeHistory: boolean,
  ): Promise<void> => {
    const { session } = current.handle.agent;
    const catalog = await buildCatalog(ctx, current.selectionRef.current);
    current.catalog = catalog;
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
    fileReferenceSearch.dispose();
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
      await previous.handle.agent.whenIdle();
      await sessions.flush(previous.handle.agent.session);
    } catch (error) {
      await sessions.flush(next.handle.agent.session);
      await next.handle.dispose();
      throw error;
    }
    try {
      await previous.handle.dispose();
    } catch (error) {
      live = next;
      await next.handle.agent.whenIdle();
      await emitLiveSession(next, true);
      throw error;
    }
    live = next;
    await next.handle.agent.whenIdle();
    await emitLiveSession(next, true);
  };

  let tail: Promise<void> = live.handle.agent.whenIdle();

  const sendError = (error: unknown): void => {
    io.send({
      kind: "status",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
    });
  };

  const queue = (operation: () => Promise<void>): void => {
    tail = tail.then(operation).catch((error: unknown) => {
      sendError(error);
    });
  };

  const emitContext = async (): Promise<void> => {
    const catalog =
      live.catalog ?? (await buildCatalog(ctx, live.selectionRef.current));
    live.catalog = catalog;
    const window = catalog.models.find(
      (model) =>
        model.provider === catalog.current.provider &&
        model.model === catalog.current.model,
    )?.contextWindow;
    const context = buildContext(ctx, live.handle.agent.session, window);
    if (context !== undefined) {
      io.send({ kind: "context", ...context });
    }
  };

  const applyModel = async (provider: string, model: string): Promise<void> => {
    const llm = ctx.get("llm");
    if (llm === undefined) throw new Error("llm is not mounted");
    const resolved = await llm.resolveCallConfig({ provider, model });
    const selected: ModelRef = {
      provider: resolved.provider,
      model: resolved.model,
    };
    const catalog = await buildCatalog(ctx, selected);
    live.selectionRef.current = {
      ...live.selectionRef.current,
      ...selected,
    };
    live.catalog = catalog;
    io.send({ kind: "catalog", ...catalog });
    await emitContext();
  };

  const applyPermission = (preset: string): void => {
    const permissionPresets = ctx.get("permissionPresets");
    if (permissionPresets === undefined) {
      throw new Error("permission presets are not mounted");
    }
    permissionPresets.set(live.handle.agent.session, preset);
    io.send({
      kind: "permissions",
      ...buildPermissions(ctx, live.handle.agent.session),
    });
  };

  ctx.on("session/event", (session: Session, event: SessionEvent) => {
    if (
      event.type === "request/context" &&
      session.id === live.handle.agent.session.id
    ) {
      void emitContext().catch(sendError);
    }
  });

  const submit = (text: string, opts: SubmitOptions = {}): void => {
    queue(async () => {
      if (
        opts.permission !== undefined &&
        buildPermissions(ctx, live.handle.agent.session).current !==
          opts.permission
      ) {
        try {
          applyPermission(opts.permission);
        } catch (error) {
          sendError(error);
          io.send({
            kind: "permissions",
            ...buildPermissions(ctx, live.handle.agent.session),
          });
        }
      }
      if (opts.provider !== undefined || opts.model !== undefined) {
        if (opts.provider === undefined || opts.model === undefined) {
          sendError(new Error("submit model selection requires provider and model"));
        } else if (
          opts.provider !== live.selectionRef.current.provider ||
          opts.model !== live.selectionRef.current.model
        ) {
          try {
            await applyModel(opts.provider, opts.model);
          } catch (error) {
            sendError(error);
            const catalog =
              live.catalog ??
              (await buildCatalog(ctx, live.selectionRef.current));
            live.catalog = catalog;
            io.send({ kind: "catalog", ...catalog });
          }
        }
      }
      const current = live;
      current.handle.agent.followup(
        createUserMessage({
          content: [{ type: "text", text }],
          source: { kind: "user" },
        }),
      );
      await current.handle.agent.whenIdle();
      await sessions.flush(current.handle.agent.session);
      await emitContext();
      io.send({ kind: "status", state: "idle" });
    });
  };

  const cancel = (): void => {
    live.handle.agent.cancel({ kind: "user" });
  };

  const listSessions = (): void => {
    void (async () => {
      const current = live.handle.agent.session;
      const cwd = process.cwd();
      const liveItem = sessionListItem(
        current.id,
        current.header.createdAt,
        current.header.cwd ?? cwd,
        current.events,
      );
      const sendItems = (items: SessionListItem[]): void => {
        if (!items.some((item) => item.sessionId === current.id)) {
          items.push(liveItem);
        }
        items.sort((left, right) => right.updatedAt - left.updatedAt);
        io.send({ kind: "sessions", available: true, items });
      };
      const fallback = (): void => {
        io.send({
          kind: "sessions",
          available: false,
          items: [liveItem],
        });
      };
      const query = ctx.get("sessionQuery");
      if (query !== undefined) {
        try {
          const records = await query.filterSessions([
            { kind: "cwd", values: [cwd] },
          ]);
          const titles = await query.readTitleSnapshots(
            records.map((record) => record.header.id),
          );
          const titlesBySession = new Map(
            titles.map((result) => [result.sessionId, result]),
          );
          sendItems(
            records.map((record) => {
              if (record.header.id === current.id) return liveItem;
              const titleResult = titlesBySession.get(record.header.id);
              const title =
                titleResult?.status === "fulfilled"
                  ? titleResult.value.title
                  : undefined;
              return {
                sessionId: record.header.id,
                title: title?.title ?? record.header.id,
                createdAt: record.header.createdAt,
                updatedAt: title?.updatedAt ?? record.header.createdAt,
                cwd: record.header.cwd ?? cwd,
              };
            }),
          );
          return;
        } catch {
          // The optional query projection may be unavailable; persistence remains authoritative.
        }
      }
      const persistence = getSessionPersistence(ctx);
      if (persistence === undefined) {
        fallback();
        return;
      }

      let headers: SessionHeader[];
      try {
        headers = (await persistence.list()).filter(
          (header) => header.cwd === cwd,
        );
      } catch {
        // A failed durable list still leaves the current live chat usable.
        fallback();
        return;
      }
      const items: SessionListItem[] = [];
      for (const header of headers) {
        if (header.id === current.id) {
          items.push(liveItem);
          continue;
        }
        try {
          const inspection = await persistence.inspect(header.id);
          items.push(
            sessionListItem(
              header.id,
              header.createdAt,
              header.cwd ?? cwd,
              inspection.events,
            ),
          );
        } catch {
          // A malformed individual log keeps an identity-only recent row.
          items.push({
            sessionId: header.id,
            title: header.id,
            createdAt: header.createdAt,
            updatedAt: header.createdAt,
            cwd: header.cwd ?? cwd,
          });
        }
      }
      sendItems(items);
    })().catch((error: unknown) => {
      io.send({ kind: "status", state: "error", detail: String(error) });
    });
  };

  const newSession = (): void => {
    queue(async () => {
      await replaceLive(async (selectionRef) => {
        const handle = await agents.create({
          sessionId: SessionId(`session-${randomUUID()}`),
          meta: { cwd: process.cwd() },
          agentOptions: {
            provider: selectionRef.current.provider,
            model: selectionRef.current.model,
          },
          setup: (agentCtx) => {
            installModelSelection(agentCtx, selectionRef);
          },
        });
        const permissionPresets = ctx.get("permissionPresets");
        if (
          permissionPresets !== undefined &&
          permissionPresets.current(handle.agent.session.events) !==
            "workspace-write"
        ) {
          permissionPresets.set(handle.agent.session, "workspace-write");
        }
        return handle;
      });
    });
  };

  const resume = (sessionId: string): void => {
    queue(async () => {
      if (sessionId === live.handle.agent.session.id) {
        await emitLiveSession(live, true);
        return;
      }
      const persistence = getSessionPersistence(ctx);
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

  const selectModel = (provider: string, model: string): void => {
    queue(async () => {
      try {
        await applyModel(provider, model);
      } catch (error) {
        sendError(error);
        const catalog =
          live.catalog ?? (await buildCatalog(ctx, live.selectionRef.current));
        live.catalog = catalog;
        io.send({ kind: "catalog", ...catalog });
      }
    });
  };

  const selectPermission = (preset: string): void => {
    queue(async () => {
      try {
        applyPermission(preset);
      } catch (error) {
        sendError(error);
        io.send({
          kind: "permissions",
          ...buildPermissions(ctx, live.handle.agent.session),
        });
      }
    });
  };

  return {
    submit,
    cancel,
    listSessions,
    newSession,
    resume,
    selectModel,
    selectPermission,
    listFileReferences: fileReferenceSearch.list,
  };
}

