import type { Context } from "@deepseek-ai/cordis";
import {
  MAX_WIRE_URL_LENGTH,
  type WebSearchCatalogWire,
  type WebSearchEngineWire,
  type WebSearchSecretRefWire,
  type WebSearchSettingsView,
} from "@dsh-vscode/contract";
import {
  probeWebSearchService,
  type WebSearchCatalogLike,
} from "./optional-services.js";
import { assertBounded, truncatePluginMessage } from "./project.js";

/** Aggregate node ceiling for one emitted Web Search view. */
export const MAX_WEB_SEARCH_VIEW_NODES = 256;
/** Projection depth ceiling for the Web Search view. */
export const MAX_WEB_SEARCH_VIEW_DEPTH = 16;

const ENGINE_IDS = ["tavily", "brave", "searxng"] as const;
const SECRET_REFS = ["TAVILY_API_KEY", "BRAVE_API_KEY"] as const;
const WEB_SEARCH_DEFAULT_BASE_URLS = {
  tavily: "https://api.tavily.com",
  brave: "https://api.search.brave.com",
} as const;

function serviceOf(ctx: Context) {
  const probe = probeWebSearchService(ctx);
  if (probe.state !== "ready") {
    throw new Error("web-search management service is not available");
  }
  return probe.service;
}

function overrideFor(
  catalog: WebSearchCatalogLike,
  engine: WebSearchEngineWire,
): string | undefined {
  const baseURL = catalog.engines[engine]?.baseURL;
  const published = engine === "searxng"
    ? undefined
    : WEB_SEARCH_DEFAULT_BASE_URLS[engine];
  return baseURL === published ? undefined : baseURL;
}

function assertCatalogProjection(catalog: WebSearchCatalogLike): void {
  const selectedEngine: unknown = catalog.engine;
  if (
    selectedEngine !== null
    && !ENGINE_IDS.some((engine) => engine === selectedEngine)
  ) {
    throw new TypeError(truncatePluginMessage(
      `Web Search catalog engine "${String(selectedEngine)}" is not supported`,
    ));
  }
  for (const engine of ENGINE_IDS) {
    const baseURL: unknown = overrideFor(catalog, engine);
    if (baseURL === undefined) continue;
    if (typeof baseURL !== "string") {
      throw new TypeError(
        `Web Search catalog engines.${engine}.baseURL must be a string`,
      );
    }
    if (baseURL.length > MAX_WIRE_URL_LENGTH) {
      throw new RangeError(
        `Web Search catalog engines.${engine}.baseURL exceeds ${MAX_WIRE_URL_LENGTH} characters`,
      );
    }
  }
}

/** Convert the closed wire catalog into the external service's object map. */
export function catalogFromWire(
  catalog: WebSearchCatalogWire,
): WebSearchCatalogLike {
  return {
    engine: catalog.engine,
    engines: Object.fromEntries(catalog.engines.map(({ engine, baseURL }) => [
      engine,
      overrideFor(
        { engine: catalog.engine, engines: { [engine]: { baseURL } } },
        engine,
      ) === undefined
        ? {}
        : { baseURL },
    ])),
  };
}

/** Convert the external service catalog into the closed ordered wire record. */
export function catalogToWire(
  catalog: WebSearchCatalogLike,
): WebSearchCatalogWire {
  return {
    engine: catalog.engine,
    engines: ENGINE_IDS.flatMap((engine) => {
      const baseURL = overrideFor(catalog, engine);
      return baseURL === undefined ? [] : [{ engine, baseURL }];
    }),
  };
}

/** Build a bounded, value-free Web Search settings projection. */
export async function buildWebSearchView(
  ctx: Context,
): Promise<WebSearchSettingsView> {
  const service = serviceOf(ctx);
  const catalog = service.getCatalog();
  assertCatalogProjection(catalog);
  const secretState = await service.describeSecrets();
  const view: WebSearchSettingsView = {
    section: "web-search",
    engine: catalog.engine,
    engines: ENGINE_IDS.map((engine) => ({
      engine,
      ...(overrideFor(catalog, engine) === undefined
        ? {}
        : { baseURL: overrideFor(catalog, engine) }),
      ...(engine === "searxng"
        ? {}
        : { defaultBaseURL: WEB_SEARCH_DEFAULT_BASE_URLS[engine] }),
      baseURLRequired: engine === "searxng",
      ...(engine === "tavily"
        ? { secretRef: "TAVILY_API_KEY" as const }
        : engine === "brave"
          ? { secretRef: "BRAVE_API_KEY" as const }
          : {}),
    })),
    secrets: SECRET_REFS.map((ref) => ({
      ref,
      configured: secretState[ref]?.configured === true,
      writable: true,
    })),
    available: service.available(),
  };
  assertBounded(
    view,
    MAX_WEB_SEARCH_VIEW_NODES,
    MAX_WEB_SEARCH_VIEW_DEPTH,
    "Web Search settings view",
  );
  return view;
}

export interface WebSearchSaveOutcome {
  view: WebSearchSettingsView;
  secretFailures: { ref: WebSearchSecretRefWire; message: string }[];
}

/** Apply catalog then non-empty secrets and return the freshly projected state. */
export async function applyWebSearchConfig(
  ctx: Context,
  catalog: WebSearchCatalogWire,
  secrets: readonly { ref: WebSearchSecretRefWire; value: string }[],
): Promise<WebSearchSaveOutcome> {
  const service = serviceOf(ctx);
  try {
    await service.putCatalog(catalogFromWire(catalog));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(truncatePluginMessage(message));
  }

  const submitted = Object.fromEntries(
    secrets
      .filter(({ value }) => value.length > 0)
      .map(({ ref, value }) => [ref, value]),
  ) as Partial<Record<WebSearchSecretRefWire, string>>;
  const refs = Object.keys(submitted) as WebSearchSecretRefWire[];
  const secretFailures: WebSearchSaveOutcome["secretFailures"] = [];
  if (refs.length > 0) {
    try {
      await service.putSecrets(submitted);
    } catch {
      for (const ref of refs) {
        try {
          await service.putSecrets({ [ref]: submitted[ref]! });
        } catch {
          secretFailures.push({ ref, message: `Could not store ${ref}` });
        }
      }
    }
  }

  return {
    view: await buildWebSearchView(ctx),
    secretFailures,
  };
}
