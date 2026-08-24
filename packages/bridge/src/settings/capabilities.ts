import type { Context } from "@deepseek-ai/cordis";
import {
  OPTIONAL_SETTINGS_SECTION_IDS,
  type OptionalSettingsSectionId,
} from "@dsh-vscode/contract";
import {
  MCP_SERVICE_NAME,
  WEB_SEARCH_SERVICE_NAME,
  probeMcpService,
  probeWebSearchService,
} from "./optional-services.js";

export interface OptionalCapabilityWatcher {
  /** Optional sections whose service passes the probe now, in nav order. */
  sections(): OptionalSettingsSectionId[];
  /** Runs the callback whenever the mounted set changes. */
  onChange(listener: (sections: OptionalSettingsSectionId[]) => void): () => void;
  dispose(): void;
}

function sameSections(
  left: readonly OptionalSettingsSectionId[],
  right: readonly OptionalSettingsSectionId[],
): boolean {
  return left.length === right.length &&
    left.every((section, index) => section === right[index]);
}

/** Watch structurally valid optional services without retaining their values. */
export function createCapabilityWatcher(
  ctx: Context,
  warn: (message: string) => void = (message) => console.warn(message),
): OptionalCapabilityWatcher {
  const listeners = new Set<
    (sections: OptionalSettingsSectionId[]) => void
  >();
  const generations = new Map<string, number>([
    [MCP_SERVICE_NAME, 0],
    [WEB_SEARCH_SERVICE_NAME, 0],
  ]);
  const warnedGenerations = new Map<string, number>();
  let active = true;

  const warnIncomplete = (name: string, missing: readonly string[]): void => {
    const generation = generations.get(name) ?? 0;
    if (warnedGenerations.get(name) === generation) return;
    warnedGenerations.set(name, generation);
    warn(
      `optional service "${name}" is incomplete; missing methods: ${
        missing.join(", ")
      }`,
    );
  };

  const compute = (): OptionalSettingsSectionId[] => {
    const mcp = probeMcpService(ctx);
    const webSearch = probeWebSearchService(ctx);
    if (mcp.state === "incomplete") {
      warnIncomplete(MCP_SERVICE_NAME, mcp.missing);
    }
    if (webSearch.state === "incomplete") {
      warnIncomplete(WEB_SEARCH_SERVICE_NAME, webSearch.missing);
    }
    const ready = new Set<OptionalSettingsSectionId>();
    if (mcp.state === "ready") ready.add("mcp");
    if (webSearch.state === "ready") ready.add("web-search");
    return OPTIONAL_SETTINGS_SECTION_IDS.filter((section) => ready.has(section));
  };

  let current = compute();
  const disposeServiceListener = ctx.on(
    "internal/service",
    (name, value) => {
      if (name !== MCP_SERVICE_NAME && name !== WEB_SEARCH_SERVICE_NAME) return;
      if (value === undefined) {
        generations.set(name, (generations.get(name) ?? 0) + 1);
      }
      const next = compute();
      if (sameSections(current, next)) return;
      current = next;
      for (const listener of listeners) listener([...next]);
    },
    { global: true },
  );

  return {
    sections: () => {
      current = compute();
      return [...current];
    },
    onChange: (listener) => {
      if (!active) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (!active) return;
      active = false;
      disposeServiceListener();
      listeners.clear();
    },
  };
}
