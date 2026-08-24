import React, {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import type {
  AgentPresetContentMessage,
  AskAnswerWire,
  FileReferenceItem,
  McpLogsMessage,
  McpOAuthDiscoveryMessage,
  McpOperationMessage,
  McpServerMessage,
  SettingsCapabilitiesMessage,
  SettingsInvalidatedMessage,
  SettingsMutationMessage,
  SettingsSectionMessage,
  SettingsSectionId,
  SlashMenuItem,
  WebSearchMutationMessage,
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
import {
  SettingsModal,
  type SettingsCloseReason,
} from "./settings/SettingsModal.js";
import {
  initialSettingsState,
  settingsReducer,
} from "./settings/reducer.js";
import {
  readRetainedLocale,
  retainedLocaleState,
} from "./settings/retainedLocale.js";
import type { SettingsUiSectionId } from "./settings/types.js";
import { GeneralSection } from "./settings/sections/general/GeneralSection.js";
import { GeneralController } from "./settings/sections/general/GeneralController.js";
import { ExtensionSection } from "./settings/sections/extension/ExtensionSection.js";
import { ExtensionController } from "./settings/sections/extension/ExtensionController.js";
import { ModelsSection } from "./settings/sections/models/ModelsSection.js";
import { ModelsController } from "./settings/sections/models/ModelsController.js";
import { PluginsSection } from "./settings/sections/plugins/PluginsSection.js";
import { PluginsController } from "./settings/sections/plugins/PluginsController.js";
import { AgentPresetsSection } from "./settings/sections/agent-presets/AgentPresetsSection.js";
import { AgentPresetsController } from "./settings/sections/agent-presets/AgentPresetsController.js";
import { McpSection } from "./settings/sections/mcp/McpSection.js";
import { McpController } from "./settings/sections/mcp/McpController.js";
import { WebSearchSection } from "./settings/sections/web-search/WebSearchSection.js";
import { WebSearchController } from "./settings/sections/web-search/WebSearchController.js";
import {
  acquireVsCodeApi,
  type SettingsHostResultMessage,
  type UiCommand,
} from "./vscode.js";

const vscode = acquireVsCodeApi();

/**
 * MCP list, detail, and log refresh cadence, matching DSH Web's MCP section.
 * A webview refresh interval, not a deployment-varying plugin tunable.
 */
const MCP_POLL_INTERVAL_MS = 2_000;

function initialSettingsFromHost(): typeof initialSettingsState {
  const locale = readRetainedLocale(vscode.getState());
  return locale === undefined
    ? initialSettingsState
    : { ...initialSettingsState, locale };
}

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

type OwnedMutationAcceptance = {
  ownsNamespace: (namespace: string) => boolean | undefined;
  accepted: boolean;
  coAccepted?: boolean;
};

function suppressOwnedMutationSuccess(
  mutation: SettingsMutationMessage,
  owners: readonly OwnedMutationAcceptance[],
): boolean {
  if (!mutation.result.ok || mutation.result.namespace === undefined) {
    return false;
  }
  const namespace = mutation.result.namespace.namespace;
  for (const owner of owners) {
    if (owner.ownsNamespace(namespace) !== true) continue;
    if (!owner.accepted && owner.coAccepted !== true) {
      return true;
    }
  }
  return false;
}

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [sectionConfirmation, setSectionConfirmation] = useState(false);
  const [settingsState, settingsDispatch] = useReducer(
    settingsReducer,
    undefined,
    initialSettingsFromHost,
  );
  const [, renderExtensionController] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [, renderModelsController] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [, renderPluginsController] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [, renderAgentPresetsController] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [, renderMcpController] = useReducer((value: number) => value + 1, 0);
  const [, renderWebSearchController] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [recentOpen, setRecentOpen] = useState(false);
  const [focusPickerSearch, setFocusPickerSearch] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsStateRef = useRef(settingsState);
  const settingsConfirmationResolvers = useRef(
    new Map<string, (confirmed: boolean) => void>(),
  );
  const generalControllerRef = useRef<GeneralController>();
  const extensionControllerRef = useRef<ExtensionController>();
  const modelsControllerRef = useRef<ModelsController>();
  const pluginsControllerRef = useRef<PluginsController>();
  const agentPresetsControllerRef = useRef<AgentPresetsController>();
  const mcpControllerRef = useRef<McpController>();
  const webSearchControllerRef = useRef<WebSearchController>();
  settingsStateRef.current = settingsState;
  useEffect(() => {
    vscode.setState(retainedLocaleState(settingsState.locale));
  }, [settingsState.locale]);
  const caretRef = useRef(0);
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  useEffect(() => {
    const settleSettingsConfirmations = (): void => {
      for (const resolve of settingsConfirmationResolvers.current.values()) {
        resolve(false);
      }
      settingsConfirmationResolvers.current.clear();
    };
    // Routes an MCP reply and, when it changed the controller's authoritative
    // list, republishes that list as the cached section view. A rejected or
    // stale reply leaves the revision alone, so the cache is untouched.
    const receiveMcpReply = (
      receive: (controller: McpController) => void,
    ): void => {
      const controller = mcpControllerRef.current;
      if (controller === undefined) return;
      const revision = controller.listRevision();
      receive(controller);
      if (controller.listRevision() === revision) return;
      const view = controller.listView();
      if (view !== undefined) {
        settingsDispatch({ kind: "mcpViewSynchronized", view });
      }
    };
    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      // extension -> webview: raw OutboundMessage (has a `kind` discriminant)
      if (typeof data === "object" && data !== null && "kind" in data) {
        if (data.kind === "settingsFullAccessConfirmation") {
          const response = data as {
            requestId?: unknown;
            confirmed?: unknown;
          };
          if (
            typeof response.requestId === "string" &&
            typeof response.confirmed === "boolean"
          ) {
            const resolve = settingsConfirmationResolvers.current.get(
              response.requestId,
            );
            settingsConfirmationResolvers.current.delete(response.requestId);
            resolve?.(response.confirmed);
          }
          return;
        } else if (data.kind === "settingsHostResult") {
          extensionControllerRef.current?.receive(
            data as SettingsHostResultMessage,
          );
          agentPresetsControllerRef.current?.receiveHost(
            data as SettingsHostResultMessage,
          );
          return;
        } else if (data.kind === "settingsSection") {
          const message = data as SettingsSectionMessage;
          const modelsState = settingsStateRef.current.sections.models;
          if (
            message.view !== undefined &&
            message.view.section === "models" &&
            modelsState.status === "loading" &&
            modelsState.requestId === message.requestId
          ) {
            modelsControllerRef.current?.updateView(message.view);
          }
          const pluginsState = settingsStateRef.current.sections.plugins;
          if (
            message.view !== undefined &&
            message.view.section === "plugins" &&
            pluginsState.status === "loading" &&
            pluginsState.requestId === message.requestId
          ) {
            pluginsControllerRef.current?.updateView(message.view);
          }
          const presetsState =
            settingsStateRef.current.sections["agent-presets"];
          if (
            message.view !== undefined &&
            message.view.section === "agent-presets" &&
            presetsState.status === "loading" &&
            presetsState.requestId === message.requestId
          ) {
            agentPresetsControllerRef.current?.updateView(message.view);
          }
          const webSearchState =
            settingsStateRef.current.sections["web-search"];
          if (
            message.view !== undefined &&
            message.view.section === "web-search" &&
            webSearchState.status === "loading" &&
            webSearchState.requestId === message.requestId
          ) {
            webSearchControllerRef.current?.updateView(message.view);
          }
          const mcpState = settingsStateRef.current.sections.mcp;
          if (
            mcpState.status === "loading" &&
            mcpState.requestId === message.requestId
          ) {
            if (message.view === undefined) {
              // Clears the controller's single-flight list slot so the next
              // poll tick refreshes instead of stalling behind a lost read.
              mcpControllerRef.current?.receiveListFailure();
            } else if (message.view.section === "mcp") {
              mcpControllerRef.current?.updateView(message.view);
            }
          }
          settingsDispatch({
            kind: "settingsSectionReceived",
            message,
          });
        } else if (data.kind === "settingsCapabilities") {
          const message = data as SettingsCapabilitiesMessage;
          const advertised: readonly string[] = message.sections;
          const previous = settingsStateRef.current.capabilities;
          if (previous.includes("mcp") && !advertised.includes("mcp")) {
            mcpControllerRef.current?.unavailable();
          }
          if (
            previous.includes("web-search") &&
            !advertised.includes("web-search")
          ) {
            webSearchControllerRef.current?.discardAll();
          }
          settingsDispatch({
            kind: "settingsCapabilitiesReceived",
            message,
          });
        } else if (data.kind === "mcpServer") {
          receiveMcpReply((controller) =>
            controller.receiveDetail(data as McpServerMessage));
        } else if (data.kind === "mcpLogs") {
          mcpControllerRef.current?.receiveLogs(data as McpLogsMessage);
        } else if (data.kind === "mcpOperation") {
          receiveMcpReply((controller) =>
            controller.receiveOperation(data as McpOperationMessage));
        } else if (data.kind === "mcpOAuthDiscovery") {
          mcpControllerRef.current?.receiveDiscovery(
            data as McpOAuthDiscoveryMessage,
          );
        } else if (data.kind === "agentPresetContent") {
          agentPresetsControllerRef.current?.receiveContent(
            data as AgentPresetContentMessage,
          );
        } else if (data.kind === "settingsInvalidated") {
          settingsDispatch({
            kind: "settingsInvalidated",
            message: data as SettingsInvalidatedMessage,
          });
        } else if (data.kind === "settingsMutation") {
          const mutation = data as SettingsMutationMessage;
          const modelsAccepted =
            modelsControllerRef.current?.receive(mutation) === true;
          const pluginsAccepted =
            pluginsControllerRef.current?.receive(mutation) === true;
          const presetsAccepted =
            agentPresetsControllerRef.current?.receiveMutation(mutation) === true;
          const generalAccepted =
            generalControllerRef.current?.receive(mutation) === true;
          if (
            suppressOwnedMutationSuccess(mutation, [
              {
                ownsNamespace: (namespace) =>
                  modelsControllerRef.current?.ownsNamespace(namespace),
                accepted: modelsAccepted,
              },
              {
                ownsNamespace: (namespace) =>
                  generalControllerRef.current?.ownsNamespace(namespace),
                accepted: generalAccepted,
                coAccepted: presetsAccepted,
              },
              {
                ownsNamespace: (namespace) =>
                  pluginsControllerRef.current?.ownsNamespace(namespace),
                accepted: pluginsAccepted,
              },
            ])
          ) {
            return;
          }
          settingsDispatch({
            kind: "settingsMutationReceived",
            message: mutation,
          });
        } else if (data.kind === "webSearchMutation") {
          webSearchControllerRef.current?.receive(
            data as WebSearchMutationMessage,
          );
        } else if (data.kind === "hostDisconnected") {
          settleSettingsConfirmations();
          extensionControllerRef.current?.invalidate();
          generalControllerRef.current?.disconnect();
          modelsControllerRef.current?.disconnect();
          pluginsControllerRef.current?.disconnect();
          agentPresetsControllerRef.current?.disconnect();
          mcpControllerRef.current?.disconnect();
          webSearchControllerRef.current?.disconnect();
          const detail =
            "detail" in data && typeof data.detail === "string"
              ? data.detail
              : "DeepSeek Harness disconnected";
          settingsDispatch({ kind: "settingsDisconnected", detail });
        } else if (data.kind === "ready") {
          settingsDispatch({ kind: "settingsConnected" });
          const requestId = crypto.randomUUID();
          const command: UiCommand = {
            type: "dsh/ui",
            cmd: { kind: "getSettingsCapabilities", requestId },
          };
          vscode.postMessage(command);
        }
        dispatch(data as UiMessage);
      }
    };
    window.addEventListener("message", onMessage);
    const message: UiCommand = {
      type: "dsh/ui",
      cmd: { kind: "webviewReady" },
    };
    vscode.postMessage(message);
    return () => {
      window.removeEventListener("message", onMessage);
      settleSettingsConfirmations();
      extensionControllerRef.current?.invalidate();
      generalControllerRef.current?.disconnect();
      modelsControllerRef.current?.disconnect();
      pluginsControllerRef.current?.disconnect();
      agentPresetsControllerRef.current?.disconnect();
      mcpControllerRef.current?.disconnect();
      webSearchControllerRef.current?.disconnect();
    };
  }, []);

  const post = useCallback((cmd: UiCommand["cmd"]): void => {
    const message: UiCommand = { type: "dsh/ui", cmd };
    vscode.postMessage(message);
  }, []);

  const requestSettingsSection = useCallback(
    (section: SettingsSectionId, force = false): void => {
      const current = settingsStateRef.current.sections[section];
      if (!settingsStateRef.current.connected) return;
      if (
        !force &&
        (current.status === "loading" ||
          (current.status === "ready" && !current.stale))
      ) {
        return;
      }
      const requestId = crypto.randomUUID();
      const action = {
        kind: "settingsSectionRequested",
        section,
        requestId,
      } as const;
      settingsStateRef.current = settingsReducer(
        settingsStateRef.current,
        action,
      );
      settingsDispatch(action);
      post({ kind: "getSettingsSection", requestId, section });
    },
    [post],
  );
  if (generalControllerRef.current === undefined) {
    generalControllerRef.current = new GeneralController(
      (command) => post(command),
      () => requestSettingsSection("general", true),
    );
  }
  const generalController = generalControllerRef.current;
  if (modelsControllerRef.current === undefined) {
    modelsControllerRef.current = new ModelsController(
      (command) => post(command),
      () => requestSettingsSection("models", true),
    );
  }
  const modelsController = modelsControllerRef.current;
  useEffect(
    () => modelsController.subscribe(() => renderModelsController()),
    [modelsController],
  );
  if (pluginsControllerRef.current === undefined) {
    pluginsControllerRef.current = new PluginsController(
      (command) => post(command),
      () => requestSettingsSection("plugins", true),
      undefined,
      () =>
        settingsDispatch({ kind: "settingsRestartRequired", required: true }),
    );
  }
  const pluginsController = pluginsControllerRef.current;
  useEffect(
    () => pluginsController.subscribe(() => renderPluginsController()),
    [pluginsController],
  );
  if (agentPresetsControllerRef.current === undefined) {
    agentPresetsControllerRef.current = new AgentPresetsController(
      (command) => post(command),
      (command) => post(command),
      () => requestSettingsSection("agent-presets", true),
      () => requestSettingsSection("general", true),
    );
  }
  const agentPresetsController = agentPresetsControllerRef.current;
  useEffect(
    () =>
      agentPresetsController.subscribe(() => renderAgentPresetsController()),
    [agentPresetsController],
  );
  if (mcpControllerRef.current === undefined) {
    mcpControllerRef.current = new McpController(
      (command) => post(command),
      () => requestSettingsSection("mcp", true),
    );
  }
  const mcpController = mcpControllerRef.current;
  useEffect(
    () => mcpController.subscribe(() => renderMcpController()),
    [mcpController],
  );
  if (webSearchControllerRef.current === undefined) {
    webSearchControllerRef.current = new WebSearchController(
      (command) => post(command),
      () => requestSettingsSection("web-search", true),
    );
  }
  const webSearchController = webSearchControllerRef.current;
  useEffect(
    () => webSearchController.subscribe(() => renderWebSearchController()),
    [webSearchController],
  );
  if (extensionControllerRef.current === undefined) {
    extensionControllerRef.current = new ExtensionController(
      (command) => post(command),
      (required) =>
        settingsDispatch({ kind: "settingsRestartRequired", required }),
    );
  }
  const extensionController = extensionControllerRef.current;
  useEffect(
    () => extensionController.subscribe(() => renderExtensionController()),
    [extensionController],
  );

  const activeSettingsSection =
    settingsState.activeSection === "extension"
      ? undefined
      : settingsState.sections[settingsState.activeSection];

  useEffect(() => {
    const current = settingsStateRef.current.sections.general;
    if (
      settingsState.connectionEpoch === 0 ||
      !settingsState.connected ||
      (current.status !== "idle" && !current.stale && current.available)
    ) {
      return;
    }
    requestSettingsSection("general");
  }, [
    requestSettingsSection,
    settingsState.connected,
    settingsState.connectionEpoch,
  ]);

  useEffect(() => {
    if (!settingsState.open || !settingsState.connected) return;
    const section = settingsState.activeSection;
    if (section === "extension") return;
    if (
      activeSettingsSection?.status === "idle" ||
      (activeSettingsSection?.stale === true &&
        activeSettingsSection.status !== "error")
    ) {
      requestSettingsSection(section);
    }
  }, [
    activeSettingsSection?.stale,
    activeSettingsSection?.status,
    requestSettingsSection,
    settingsState.activeSection,
    settingsState.connected,
    settingsState.open,
  ]);

  useEffect(() => {
    if (settingsState.invalidationSeq === 0) return;
    const current = settingsStateRef.current;
    if (!current.open || !current.connected) return;
    const section = current.activeSection;
    if (section === "extension") return;
    if (current.sections[section].status === "error") {
      requestSettingsSection(section, true);
    }
  }, [requestSettingsSection, settingsState.invalidationSeq]);

  const mcpPolling =
    settingsState.open &&
    settingsState.activeSection === "mcp" &&
    settingsState.connected &&
    settingsState.capabilities.includes("mcp");

  useEffect(() => {
    if (!mcpPolling) return;
    // The lazy section read already fetched the list, so the first tick lands
    // one interval later.
    const interval = setInterval(
      () => mcpController.poll(),
      MCP_POLL_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [mcpController, mcpPolling]);

  const openSettings = useCallback((): void => {
    if (settingsStateRef.current.open) return;
    setRecentOpen(false);
    setFocusPickerSearch(false);
    dispatch({ kind: "pickerClosedForSettings" });
    settingsDispatch({ kind: "openSettings" });
    requestSettingsSection("general");
  }, [requestSettingsSection]);

  const activateSettingsSection = useCallback(
    (section: SettingsUiSectionId): void => {
      settingsDispatch({ kind: "activateSettingsSection", section });
    },
    [],
  );

  const retrySettingsSection = useCallback(
    (section: SettingsSectionId): void => {
      requestSettingsSection(section, true);
    },
    [requestSettingsSection],
  );

  const confirmSettingsFullAccess = useCallback((): Promise<boolean> => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      settingsConfirmationResolvers.current.set(requestId, resolve);
      post({ kind: "confirmSettingsFullAccess", requestId });
    });
  }, [post]);

  const closeSettings = useCallback((
    _reason: SettingsCloseReason,
    dirty: boolean,
  ): void => {
    settingsDispatch(
      dirty
        ? {
            kind: "settingsConfirmationChanged",
            confirmation: { kind: "dirty-close" },
          }
        : { kind: "closeSettings" },
    );
  }, []);

  const toggleSettings = useCallback((): void => {
    if (!settingsStateRef.current.open) {
      openSettings();
      return;
    }
    closeSettings(
      "gear",
      extensionController.snapshot().dirty ||
        modelsController.snapshot().dirty ||
        pluginsController.snapshot().dirty ||
        agentPresetsController.snapshot().dirty ||
        mcpController.snapshot().dirty ||
        webSearchController.snapshot().dirty,
    );
  }, [
    agentPresetsController,
    closeSettings,
    extensionController,
    mcpController,
    modelsController,
    openSettings,
    pluginsController,
    webSearchController,
  ]);

  const cancelSettingsClose = useCallback((): void => {
    settingsDispatch({
      kind: "settingsConfirmationChanged",
      confirmation: undefined,
    });
  }, []);

  const discardSettingsClose = useCallback((): void => {
    extensionController.discard();
    modelsController.discardAll();
    pluginsController.discardAll();
    agentPresetsController.discardAll();
    mcpController.discardAll();
    webSearchController.discardAll();
    settingsDispatch({ kind: "closeSettings" });
  }, [
    agentPresetsController,
    extensionController,
    mcpController,
    modelsController,
    pluginsController,
    webSearchController,
  ]);

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

  const onSubmit = useCallback((mode: "queue" | "steer"): void => {
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
    const requestId = crypto.randomUUID();
    dispatch({ kind: "submitStarted", requestId, mode });
    post({ kind: "submit", requestId, mode, ...serializeDraft(state) });
  }, [post, state]);

  const busyEnterNamespace =
    settingsState.sections.general.view?.section === "general"
      ? settingsState.sections.general.view.namespaces.find(
          (namespace) => namespace.namespace === "ui-conversation",
        )
      : undefined;
  const busyEnter =
    busyEnterNamespace?.value.busyEnter === "steer" ? "steer" : "queue";

  return (
    <div className="dsh-root">
      <Header
        busy={state.starting || state.status === "thinking"}
        recentOpen={recentOpen}
        settingsOpen={settingsState.open}
        settingsButtonRef={settingsButtonRef}
        onRecent={() => {
          setRecentOpen((open) => {
            if (!open) post({ kind: "listSessions" });
            return !open;
          });
        }}
        onCloseRecent={() => setRecentOpen(false)}
        onSettings={toggleSettings}
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
        timeline={state.timeline}
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
        busyEnter={busyEnter}
        locale={settingsState.locale}
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
      {settingsState.open ? (
        <SettingsModal
          state={settingsState}
          controller={{
            dirty:
              extensionController.snapshot().dirty ||
              modelsController.snapshot().dirty ||
              pluginsController.snapshot().dirty ||
              agentPresetsController.snapshot().dirty ||
              mcpController.snapshot().dirty ||
              webSearchController.snapshot().dirty,
            confirmation: sectionConfirmation,
          }}
          returnFocusRef={settingsButtonRef}
          onSection={activateSettingsSection}
          onRetry={retrySettingsSection}
          onRequestClose={closeSettings}
          onCancelClose={cancelSettingsClose}
          onDiscardClose={discardSettingsClose}
        >
          {settingsState.activeSection === "general" &&
          settingsState.sections.general.view?.section === "general" ? (
            <GeneralSection
              controller={generalController}
              view={settingsState.sections.general.view}
              locale={settingsState.locale}
              confirmFullAccess={confirmSettingsFullAccess}
            />
          ) : null}
          {settingsState.activeSection === "extension" ? (
            <ExtensionSection
              controller={extensionController}
              locale={settingsState.locale}
              restartDisabled={
                state.starting ||
                state.status === "thinking" ||
                state.status === "awaiting-approval"
              }
            />
          ) : null}
          {settingsState.activeSection === "models" &&
          settingsState.sections.models.view?.section === "models" ? (
            <ModelsSection
              controller={modelsController}
              view={settingsState.sections.models.view}
              locale={settingsState.locale}
              onCredential={(command) => post(command)}
              onConfirmationChange={setSectionConfirmation}
            />
          ) : null}
          {settingsState.activeSection === "plugins" &&
          settingsState.sections.plugins.view?.section === "plugins" ? (
            <PluginsSection
              controller={pluginsController}
              view={settingsState.sections.plugins.view}
              locale={settingsState.locale}
              onCredential={(command) => post(command)}
            />
          ) : null}
          {settingsState.activeSection === "agent-presets" &&
          settingsState.sections["agent-presets"].view?.section ===
            "agent-presets" ? (
            <AgentPresetsSection
              controller={agentPresetsController}
              view={settingsState.sections["agent-presets"].view}
              locale={settingsState.locale}
              onConfirmationChange={setSectionConfirmation}
            />
          ) : null}
          {settingsState.activeSection === "mcp" ? (
            <McpSection
              controller={mcpController}
              locale={settingsState.locale}
              state={settingsState.sections.mcp}
              onConfirmationChange={setSectionConfirmation}
            />
          ) : null}
          {settingsState.activeSection === "web-search" &&
          settingsState.sections["web-search"].view?.section ===
            "web-search" ? (
            <WebSearchSection
              controller={webSearchController}
              view={settingsState.sections["web-search"].view}
              locale={settingsState.locale}
            />
          ) : null}
        </SettingsModal>
      ) : null}
    </div>
  );
}
