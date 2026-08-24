import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { ImageAttachmentRef } from "@deepseek-ai/dsh-attachment";
import {
  installModelSelection,
  type AgentHandle,
  type ModelSelectionRef,
} from "@deepseek-ai/dsh-agent";
import type { AgentDefaultModelConfig } from "@deepseek-ai/dsh-agent-default-model";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
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
  EncodedImageAttachment,
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
import { admitImages } from "./image-admission.js";
import { createSlashCatalog } from "./slash-catalog.js";
import { createSlashCommandExecutor } from "./slash-command.js";
import { createSettingsCoordinator } from "./settings/coordinator.js";
import type { SettingsCoordinator } from "./settings/types.js";

const PRESET_LABELS: Record<string, string> = {
  "read-only": "Read Only",
  "workspace-write": "Workspace Write",
  "danger-full-access": "Full Access",
};

/**
 * What one read of the mounted providers found.
 *
 * `usable` is what the picker offers. `providers` and `advertised` exist to tell
 * a model that a provider stopped listing apart from one it still lists but
 * cannot resolve right now — a distinction {@link reconcileSelection} needs and
 * `usable` alone cannot make, since both cases drop out of it.
 */
interface CatalogRead {
  /** Models that resolved, in provider order. */
  usable: ModelListItem[];
  /** Ids of the currently mounted providers. */
  providers: Set<string>;
  /**
   * Model ids per provider, for providers whose list was read successfully and
   * came back non-empty. An absent entry carries no evidence about any model.
   */
  advertised: Map<string, readonly string[]>;
}

/**
 * Read every mounted provider's model list once. A model that lists but fails to
 * resolve (missing credentials, unreachable route) is recorded as advertised and
 * omitted from `usable`, so it is never offered and never treated as retired.
 *
 * @param ctx - plugin context carrying the `llm` service.
 * @returns the provider ids, their advertised model ids, and the usable models.
 */
async function readCatalog(ctx: Context): Promise<CatalogRead> {
  const read: CatalogRead = {
    usable: [],
    providers: new Set(),
    advertised: new Map(),
  };
  const llm = ctx.get("llm");
  if (llm === undefined) return read;
  for (const providerInfo of llm.listProviders()) {
    const provider = providerInfo.id;
    read.providers.add(provider);
    let listed;
    try {
      listed = await llm.listModels(provider);
    } catch {
      // Route unreadable (discovery/credentials): no evidence about its models.
      continue;
    }
    if (listed.length > 0) {
      read.advertised.set(
        provider,
        listed.map((info) => info.id),
      );
    }
    for (const info of listed) {
      try {
        const resolved = await llm.resolveModelInfo(provider, info.id);
        read.usable.push({
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
  return read;
}

/** Whether `models` offers `ref`. */
function offers(models: readonly ModelListItem[], ref: ModelRef): boolean {
  return models.some((m) => m.provider === ref.provider && m.model === ref.model);
}

/**
 * Whether `read` proves `saved` is gone: its provider is no longer mounted, or
 * the provider listed models and `saved` was not among them. A provider that
 * could not be read, or that listed nothing, proves nothing.
 */
function isRetired(read: CatalogRead, saved: ModelRef): boolean {
  if (!read.providers.has(saved.provider)) return true;
  const listed = read.advertised.get(saved.provider);
  return listed !== undefined && !listed.includes(saved.model);
}

/**
 * Assemble the catalog payload. A `current` the providers do not offer still
 * needs an entry, because the picker has to show the model the agent runs on:
 * {@link reconcileSelection} has already replaced the selections it could, so
 * this covers a catalog that could not be read at all.
 */
function buildCatalog(
  models: ModelListItem[],
  current: ModelRef,
): CatalogPayload {
  if (offers(models, current)) return { current, models };
  return {
    current,
    models: [
      { provider: current.provider, model: current.model, label: current.model },
      ...models,
    ],
  };
}

/** The catalog payload for `current` against a freshly read provider list. */
async function catalogFor(
  ctx: Context,
  current: ModelRef,
): Promise<CatalogPayload> {
  return buildCatalog((await readCatalog(ctx)).usable, current);
}

/**
 * The model a retired selection falls back to: the first usable model from the
 * same provider when it still has one (a provider whose model list was edited
 * keeps its credentials and base URL), otherwise the first usable model in the
 * catalog. Undefined when nothing is usable.
 */
function replacementFor(
  models: readonly ModelListItem[],
  stale: ModelRef,
): ModelRef | undefined {
  const chosen = models.find((m) => m.provider === stale.provider) ?? models[0];
  return chosen === undefined
    ? undefined
    : { provider: chosen.provider, model: chosen.model };
}

/**
 * Reconcile the saved default selection against the providers, returning the
 * selection the runner starts from.
 *
 * `agentDefaultModel` stores a selection without validating catalog membership
 * and leaves availability diagnostics to its consumer, so a model dropped from a
 * provider's list outlives that edit in user settings. Unreconciled it reaches
 * the picker as an ordinary selectable entry that no request can open. The
 * replacement is persisted so the next launch starts from a live model.
 *
 * Replacement requires positive evidence that the model is gone (see
 * {@link isRetired}) and a usable model to move to. A provider that is merely
 * unreachable or unreadable keeps its selection: providers legitimately serve
 * unadvertised ids, and a transient outage must not rewrite a saved choice.
 *
 * @param defaultModel - default-model service holding the saved selection.
 * @param read - one read of the mounted providers.
 * @param saved - selection read from `defaultModel`.
 * @returns the saved selection, or its replacement once persisted.
 */
async function reconcileSelection(
  defaultModel: AgentDefaultModelConfig,
  read: CatalogRead,
  saved: ModelRef,
): Promise<ModelRef> {
  if (offers(read.usable, saved) || !isRetired(read, saved)) return saved;
  const replacement = replacementFor(read.usable, saved);
  if (replacement === undefined) return saved;
  await defaultModel.saveSelection(replacement);
  process.stderr.write(
    `model ${saved.provider}/${saved.model} is no longer advertised; ` +
      `switched to ${replacement.provider}/${replacement.model}\n`,
  );
  return replacement;
}

/**
 * Read the providers and reconcile the saved default selection against them.
 *
 * @param ctx - plugin context carrying the `llm` service.
 * @param defaultModel - default-model service holding the saved selection.
 * @returns the selection a new Agent should start from.
 */
export async function startupSelection(
  ctx: Context,
  defaultModel: AgentDefaultModelConfig,
): Promise<ModelRef> {
  return reconcileSelection(
    defaultModel,
    await readCatalog(ctx),
    defaultModel.currentSelection(),
  );
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

  const selection = await startupSelection(ctx, defaultModel);

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
  requestId: string;
  mode: "queue" | "steer";
  provider?: string;
  model?: string;
  permission?: string;
  images?: readonly EncodedImageAttachment[];
}

/** Full session command surface for inbound bridge protocol messages. */
export interface SessionController extends SettingsCoordinator {
  submit(text: string, opts: SubmitOptions): void;
  cancel(): void;
  listSessions(): void;
  newSession(): void;
  resume(sessionId: string): void;
  selectModel(provider: string, model: string): void;
  selectPermission(preset: string): void;
  listFileReferences(query: string, requestId: string): void;
  listSlashItems(requestId: string): void;
  executeSlashCommand(
    line: string,
    images?: readonly EncodedImageAttachment[],
  ): void;
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

  const selection = await startupSelection(ctx, defaultModel);
  let refreshModelsCatalog = (_signal: AbortSignal): void => {};
  const settingsCoordinator = createSettingsCoordinator(
    ctx,
    (message) => io.send(message),
    (signal) => refreshModelsCatalog(signal),
  );
  io.onDisconnect(settingsCoordinator.dispose);
  ctx.effect(() => settingsCoordinator.dispose);
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
  let activeAdmission: AbortController | undefined;
  const abortActiveAdmission = (): void => {
    activeAdmission?.abort(new Error("image admission cancelled"));
  };
  const fileReferenceSearch = createFileReferenceSearch(
    ctx,
    () => live.handle.agent,
    (message) => io.send(message),
  );
  const createLiveSlashCatalog = () =>
    createSlashCatalog(
      ctx,
      () => live.handle.agent,
      (message) => io.send(message),
    );
  const createLiveSlashCommandExecutor = () =>
    createSlashCommandExecutor(
      ctx,
      () => live.handle.agent,
      (message) => io.send(message),
    );
  let slashCatalog = createLiveSlashCatalog();
  let slashCommandExecutor = createLiveSlashCommandExecutor();
  // Restore-gate only. Execute uses the current executor object; this flag
  // is false after retire so one matching restore can recreate it.
  let slashCommandExecutorRestored = true;
  let slashCommandGeneration = 0;
  let slashCommandLifecycleDisposed = false;
  const retireSlashCommandExecutor = (): number => {
    slashCommandExecutor.dispose();
    slashCommandExecutorRestored = false;
    slashCommandGeneration += 1;
    return slashCommandGeneration;
  };
  const restoreSlashCommandExecutor = (generation: number): void => {
    if (
      slashCommandLifecycleDisposed ||
      slashCommandExecutorRestored ||
      slashCommandGeneration !== generation
    ) {
      return;
    }
    slashCommandExecutor = createLiveSlashCommandExecutor();
    slashCommandExecutorRestored = true;
  };
  const disposeSlashCommandLifecycle = (): void => {
    slashCommandLifecycleDisposed = true;
    slashCommandGeneration += 1;
    slashCommandExecutorRestored = false;
    slashCommandExecutor.dispose();
  };
  io.onDisconnect(fileReferenceSearch.dispose);
  io.onDisconnect(() => slashCatalog.dispose());
  io.onDisconnect(disposeSlashCommandLifecycle);
  io.onDisconnect(abortActiveAdmission);
  ctx.effect(() => () => {
    slashCatalog.dispose();
    disposeSlashCommandLifecycle();
    abortActiveAdmission();
  });

  const emitLiveSession = async (
    current: LiveSession,
    includeHistory: boolean,
  ): Promise<void> => {
    const { session } = current.handle.agent;
    const catalog = await catalogFor(ctx, current.selectionRef.current);
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
    io.send({
      kind: "settingsCapabilities",
      sections: settingsCoordinator.capabilities(),
    });
  };

  await emitLiveSession(live, false);

  const replaceLive = async (
    create: (selectionRef: LiveSelectionRef) => Promise<AgentHandle>,
    slashGeneration: number,
  ): Promise<void> => {
    idleObservationGeneration += 1;
    abortActiveAdmission();
    fileReferenceSearch.dispose();
    slashCatalog.dispose();
    const previous = live;
    const nextSelectionRef: LiveSelectionRef = {
      current: { ...previous.selectionRef.current },
      assembled: undefined,
    };
    let next: LiveSession;
    try {
      next = {
        handle: await create(nextSelectionRef),
        selectionRef: nextSelectionRef,
      };
    } catch (error) {
      slashCatalog = createLiveSlashCatalog();
      restoreSlashCommandExecutor(slashGeneration);
      throw error;
    }
    try {
      previous.handle.agent.cancel({ kind: "user" });
      await previous.handle.agent.whenIdle();
      await sessions.flush(previous.handle.agent.session);
    } catch (error) {
      await sessions.flush(next.handle.agent.session);
      await next.handle.dispose();
      slashCatalog = createLiveSlashCatalog();
      restoreSlashCommandExecutor(slashGeneration);
      throw error;
    }
    try {
      await previous.handle.dispose();
    } catch (error) {
      live = next;
      slashCatalog = createLiveSlashCatalog();
      restoreSlashCommandExecutor(slashGeneration);
      await next.handle.agent.whenIdle();
      await emitLiveSession(next, true);
      throw error;
    }
    live = next;
    slashCatalog = createLiveSlashCatalog();
    restoreSlashCommandExecutor(slashGeneration);
    await next.handle.agent.whenIdle();
    await emitLiveSession(next, true);
  };

  let tail: Promise<void> = live.handle.agent.whenIdle();
  let idleObservationGeneration = 0;
  let disconnected = false;
  io.onDisconnect(() => {
    disconnected = true;
    idleObservationGeneration += 1;
  });

  const sendError = (error: unknown, code?: string): void => {
    io.send({
      kind: "status",
      state: "error",
      detail: error instanceof Error ? error.message : String(error),
      ...(code !== undefined ? { code } : {}),
    });
  };

  const queue = (operation: () => Promise<void>): void => {
    tail = tail.then(operation).catch((error: unknown) => {
      sendError(error);
    });
  };

  const emitContext = async (): Promise<void> => {
    const catalog =
      live.catalog ?? (await catalogFor(ctx, live.selectionRef.current));
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
  let catalogRefreshGeneration = 0;
  refreshModelsCatalog = (signal: AbortSignal): void => {
    const generation = ++catalogRefreshGeneration;
    void (async () => {
      const catalog = await catalogFor(ctx, live.selectionRef.current);
      if (signal.aborted || generation !== catalogRefreshGeneration) return;
      live.catalog = catalog;
      io.send({ kind: "catalog", ...catalog });
      await emitContext();
    })().catch((error: unknown) => {
      if (!signal.aborted) sendError(error);
    });
  };

  const applyModel = async (provider: string, model: string): Promise<void> => {
    const llm = ctx.get("llm");
    if (llm === undefined) throw new Error("llm is not mounted");
    const resolved = await llm.resolveCallConfig({ provider, model });
    const selected: ModelRef = {
      provider: resolved.provider,
      model: resolved.model,
    };
    const catalog = await catalogFor(ctx, selected);
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

  const submit = (text: string, opts: SubmitOptions): void => {
    queue(async () => {
      if (
        opts.permission !== undefined &&
        buildPermissions(ctx, live.handle.agent.session).current !==
          opts.permission
      ) {
        try {
          applyPermission(opts.permission);
        } catch (error) {
          io.send({
            kind: "permissions",
            ...buildPermissions(ctx, live.handle.agent.session),
          });
          io.send({
            kind: "submitResult",
            requestId: opts.requestId,
            result: {
              ok: false,
              detail: error instanceof Error ? error.message : String(error),
            },
          });
          return;
        }
      }
      if (opts.provider !== undefined || opts.model !== undefined) {
        if (opts.provider === undefined || opts.model === undefined) {
          io.send({
            kind: "submitResult",
            requestId: opts.requestId,
            result: {
              ok: false,
              detail: "submit model selection requires provider and model",
            },
          });
          return;
        } else if (
          opts.provider !== live.selectionRef.current.provider ||
          opts.model !== live.selectionRef.current.model
        ) {
          try {
            await applyModel(opts.provider, opts.model);
          } catch (error) {
            const catalog =
              live.catalog ??
              (await catalogFor(ctx, live.selectionRef.current));
            live.catalog = catalog;
            io.send({ kind: "catalog", ...catalog });
            io.send({
              kind: "submitResult",
              requestId: opts.requestId,
              result: {
                ok: false,
                detail: error instanceof Error ? error.message : String(error),
              },
            });
            return;
          }
        }
      }
      const current = live;
      const admission = new AbortController();
      activeAdmission = admission;
      let refs: readonly ImageAttachmentRef[] = [];
      try {
        refs = opts.images?.length
          ? await admitImages(
              ctx,
              current.handle.agent,
              opts.images,
              admission.signal,
            )
          : [];
      } catch (error) {
        io.send({
          kind: "submitResult",
          requestId: opts.requestId,
          result: {
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          },
        });
        return;
      } finally {
        if (activeAdmission === admission) activeAdmission = undefined;
      }
      const content: ContentBlock[] = [];
      if (text.trim() !== "") {
        content.push({ type: "text", text: text.trim() });
      }
      content.push(
        ...refs.map((attachment) => ({
          type: "image" as const,
          attachment,
        })),
      );
      if (content.length === 0) {
        io.send({
          kind: "submitResult",
          requestId: opts.requestId,
          result: { ok: false, detail: "message has no text or images" },
        });
        return;
      }
      const message = createUserMessage({
        content,
        source: { kind: "user" },
      });
      if (opts.mode === "steer") {
        current.handle.agent.steer(message);
      } else {
        current.handle.agent.followup(message);
      }
      const observation = ++idleObservationGeneration;
      io.send({
        kind: "submitResult",
        requestId: opts.requestId,
        result: { ok: true },
      });
      void (async () => {
        await current.handle.agent.whenIdle();
        if (
          disconnected ||
          live !== current ||
          observation !== idleObservationGeneration
        ) {
          return;
        }
        await sessions.flush(current.handle.agent.session);
        if (
          disconnected ||
          live !== current ||
          observation !== idleObservationGeneration
        ) {
          return;
        }
        await emitContext();
        if (
          disconnected ||
          live !== current ||
          observation !== idleObservationGeneration
        ) {
          return;
        }
        io.send({ kind: "status", state: "idle" });
      })().catch((error: unknown) => {
        if (
          !disconnected &&
          live === current &&
          observation === idleObservationGeneration
        ) {
          sendError(error);
        }
      });
    });
  };

  const cancel = (): void => {
    idleObservationGeneration += 1;
    abortActiveAdmission();
    slashCommandExecutor.cancel();
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
    idleObservationGeneration += 1;
    abortActiveAdmission();
    const slashGeneration = retireSlashCommandExecutor();
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
      }, slashGeneration);
    });
  };

  const resume = (sessionId: string): void => {
    idleObservationGeneration += 1;
    let slashGeneration: number | undefined;
    if (sessionId !== live.handle.agent.session.id) {
      abortActiveAdmission();
      slashGeneration = retireSlashCommandExecutor();
    }
    queue(async () => {
      try {
        if (sessionId === live.handle.agent.session.id) {
          await emitLiveSession(live, true);
          return;
        }
        if (slashGeneration === undefined) {
          abortActiveAdmission();
          slashGeneration = retireSlashCommandExecutor();
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
        await replaceLive(
          (selectionRef) =>
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
          slashGeneration,
        );
      } finally {
        if (slashGeneration !== undefined) {
          restoreSlashCommandExecutor(slashGeneration);
        }
      }
    });
  };

  const selectModel = (provider: string, model: string): void => {
    queue(async () => {
      try {
        await applyModel(provider, model);
      } catch (error) {
        sendError(error);
        const catalog =
          live.catalog ?? (await catalogFor(ctx, live.selectionRef.current));
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
    listSlashItems: (requestId) => slashCatalog.list(requestId),
    executeSlashCommand: (line, images) =>
      slashCommandExecutor.execute(line, images),
    getCapabilities: settingsCoordinator.getCapabilities,
    capabilities: settingsCoordinator.capabilities,
    getSection: settingsCoordinator.getSection,
    getMcpServer: settingsCoordinator.getMcpServer,
    getMcpLogs: settingsCoordinator.getMcpLogs,
    runMcpOperation: settingsCoordinator.runMcpOperation,
    mutate: settingsCoordinator.mutate,
    setWebSearchConfig: settingsCoordinator.setWebSearchConfig,
    setCredential: settingsCoordinator.setCredential,
    unsetCredential: settingsCoordinator.unsetCredential,
    copyPreset: settingsCoordinator.copyPreset,
    deletePreset: settingsCoordinator.deletePreset,
    readPreset: settingsCoordinator.readPreset,
    resolvePath: settingsCoordinator.resolvePath,
    dispose: settingsCoordinator.dispose,
  };
}

