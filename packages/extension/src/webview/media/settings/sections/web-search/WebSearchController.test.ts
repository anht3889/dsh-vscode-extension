import { describe, expect, it, vi } from "vitest";
import type {
  WebSearchMutationMessage,
  WebSearchSettingsView,
} from "@dsh-vscode/contract";
import { WebSearchController } from "./WebSearchController.js";

const VIEW: WebSearchSettingsView = {
  section: "web-search",
  engine: "tavily",
  engines: [
    {
      engine: "tavily",
      baseURL: "https://tavily.example",
      defaultBaseURL: "https://api.tavily.com",
      baseURLRequired: false,
      secretRef: "TAVILY_API_KEY",
    },
    {
      engine: "brave",
      defaultBaseURL: "https://api.search.brave.com",
      baseURLRequired: false,
      secretRef: "BRAVE_API_KEY",
    },
    { engine: "searxng", baseURLRequired: true },
  ],
  secrets: [
    { ref: "TAVILY_API_KEY", configured: true, writable: true },
    { ref: "BRAVE_API_KEY", configured: false, writable: true },
  ],
  available: true,
};

function bench() {
  const sent: unknown[] = [];
  const refresh = vi.fn();
  let next = 0;
  const controller = new WebSearchController(
    (command) => sent.push(command),
    refresh,
    () => `web-${++next}`,
  );
  controller.updateView(VIEW);
  return { controller, sent, refresh };
}

function success(
  requestId: string,
  secretFailures: WebSearchMutationMessage["result"] extends infer Result
    ? Result extends { ok: true; secretFailures: infer Failures }
      ? Failures
      : never
    : never = [],
): WebSearchMutationMessage {
  return {
    kind: "webSearchMutation",
    requestId,
    result: { ok: true, view: VIEW, secretFailures },
  };
}

describe("WebSearchController", () => {
  it("seeds clean catalog drafts and configured secret indicators", () => {
    const { controller } = bench();

    expect(controller.snapshot()).toMatchObject({
      status: "idle",
      dirty: false,
      engine: "tavily",
      available: true,
      connected: true,
      engines: [
        { engine: "tavily", baseURL: "https://tavily.example" },
        { engine: "brave", baseURL: "" },
        { engine: "searxng", baseURL: "" },
      ],
      secrets: [
        { ref: "TAVILY_API_KEY", configured: true, staged: false },
        { ref: "BRAVE_API_KEY", configured: false, staged: false },
      ],
    });
  });

  it("tracks catalog edits and restores the last committed view on discard", () => {
    const { controller } = bench();
    controller.selectEngine("searxng");
    controller.setBaseURL("searxng", "https://search.example");
    controller.stageSecret("BRAVE_API_KEY", "never-retain-this");

    expect(controller.snapshot()).toMatchObject({ dirty: true });
    expect(JSON.stringify(controller.snapshot())).not.toContain("never-retain-this");
    controller.discardAll();
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      engine: "tavily",
      secrets: expect.arrayContaining([
        { ref: "BRAVE_API_KEY", configured: false, staged: false },
      ]),
    });
  });

  it.each([
    ["", "webSearchBaseUrlRequired"],
    ["searx.example", "webSearchBaseUrlInvalid"],
    ["ftp://searx.example", "webSearchBaseUrlInvalid"],
  ] as const)("rejects invalid selected SearXNG endpoint %j", (value, errorKey) => {
    const { controller } = bench();
    controller.selectEngine("searxng");
    controller.setBaseURL("searxng", value);

    expect(controller.snapshot()).toMatchObject({
      canSave: false,
      engines: expect.arrayContaining([
        expect.objectContaining({
          engine: "searxng",
          baseURLError: errorKey,
        }),
      ]),
    });
  });

  it("normalizes published defaults and passes secret literals only into the command", () => {
    const { controller, sent } = bench();
    controller.setBaseURL("tavily", "https://api.tavily.com");
    controller.stageSecret("TAVILY_API_KEY", "tavily-literal");

    expect(controller.save({
      TAVILY_API_KEY: "tavily-literal",
      BRAVE_API_KEY: "",
    })).toBe(true);
    expect(controller.save({ TAVILY_API_KEY: "second-literal" })).toBe(false);
    expect(sent).toEqual([{
      kind: "setWebSearchConfig",
      requestId: "web-1",
      catalog: {
        engine: "tavily",
        engines: [
          { engine: "tavily" },
          { engine: "brave" },
          { engine: "searxng" },
        ],
      },
      secrets: [{ ref: "TAVILY_API_KEY", value: "tavily-literal" }],
    }]);
    expect(JSON.stringify(controller.snapshot())).not.toContain("tavily-literal");
  });

  it("rebases and clears staged indicators after complete success", () => {
    const { controller } = bench();
    controller.stageSecret("TAVILY_API_KEY", "literal-one");
    controller.setBaseURL("brave", "https://brave.example");
    controller.save({ TAVILY_API_KEY: "literal-one" });

    expect(controller.receive(success("web-1"))).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      status: "idle",
      dirty: false,
      secretFailures: [],
      secrets: expect.arrayContaining([
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
      ]),
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("literal-one");
  });

  it("keeps only failed secret intent and retries it with the committed catalog", () => {
    const { controller, sent } = bench();
    controller.setBaseURL("brave", "https://brave.example");
    controller.stageSecret("TAVILY_API_KEY", "tavily-literal");
    controller.stageSecret("BRAVE_API_KEY", "brave-literal");
    controller.save({
      TAVILY_API_KEY: "tavily-literal",
      BRAVE_API_KEY: "brave-literal",
    });

    controller.receive(success("web-1", [{
      ref: "BRAVE_API_KEY",
      message: "BRAVE_API_KEY could not be stored",
    }]));
    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      secretFailures: ["BRAVE_API_KEY"],
      engines: expect.arrayContaining([
        expect.objectContaining({ engine: "brave", baseURL: "" }),
      ]),
      secrets: expect.arrayContaining([
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
        expect.objectContaining({ ref: "BRAVE_API_KEY", staged: true }),
      ]),
    });
    expect(controller.retrySecrets({ BRAVE_API_KEY: "brave-literal" })).toBe(true);
    expect(sent[1]).toMatchObject({
      kind: "setWebSearchConfig",
      requestId: "web-2",
      catalog: {
        engine: "tavily",
        engines: [
          { engine: "tavily", baseURL: "https://tavily.example" },
          { engine: "brave" },
          { engine: "searxng" },
        ],
      },
      secrets: [{ ref: "BRAVE_API_KEY", value: "brave-literal" }],
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("brave-literal");
  });

  it("retries outstanding failures together with newly staged keys", () => {
    const { controller, sent } = bench();
    controller.stageSecret("BRAVE_API_KEY", "first-brave-literal");
    controller.save({ BRAVE_API_KEY: "first-brave-literal" });
    controller.receive(success("web-1", [{
      ref: "BRAVE_API_KEY",
      message: "BRAVE_API_KEY could not be stored",
    }]));
    controller.stageSecret("TAVILY_API_KEY", "new-tavily-literal");

    expect(controller.retrySecrets({
      TAVILY_API_KEY: "new-tavily-literal",
      BRAVE_API_KEY: "retry-brave-literal",
    })).toBe(true);
    expect(sent[1]).toMatchObject({
      kind: "setWebSearchConfig",
      secrets: [
        { ref: "TAVILY_API_KEY", value: "new-tavily-literal" },
        { ref: "BRAVE_API_KEY", value: "retry-brave-literal" },
      ],
    });
    controller.receive(success("web-2"));
    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      secretFailures: [],
      secrets: [
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
        expect.objectContaining({ ref: "BRAVE_API_KEY", staged: false }),
      ],
    });
    expect(JSON.stringify(controller.snapshot())).not.toContain("literal");
  });

  it("drops staged intent when a requested local value is empty", () => {
    const { controller, sent } = bench();
    controller.stageSecret("TAVILY_API_KEY", "local-only-literal");

    expect(controller.save({ TAVILY_API_KEY: "" })).toBe(true);
    expect(sent[0]).toMatchObject({ secrets: [] });
    controller.receive(success("web-1"));

    expect(controller.snapshot()).toMatchObject({
      dirty: false,
      secrets: expect.arrayContaining([
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
      ]),
    });
  });

  it("preserves draft intent on rejection and settles disconnect safely", () => {
    const { controller } = bench();
    controller.selectEngine("searxng");
    controller.setBaseURL("searxng", "https://search.example");
    controller.stageSecret("TAVILY_API_KEY", "private-literal");
    controller.save({ TAVILY_API_KEY: "private-literal" });

    expect(controller.receive({
      kind: "webSearchMutation",
      requestId: "web-1",
      result: {
        ok: false,
        error: { code: "web-search-rejected", message: "Catalog rejected" },
      },
    })).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      dirty: true,
      engine: "searxng",
      errorKey: "webSearchSaveFailed",
      errorDetail: "Catalog rejected",
      secrets: expect.arrayContaining([
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: true }),
      ]),
    });

    controller.save({ TAVILY_API_KEY: "private-literal" });
    controller.disconnect();
    expect(controller.snapshot()).toMatchObject({
      connected: false,
      status: "idle",
      dirty: true,
      errorKey: "webSearchDisconnectedSave",
      secrets: expect.arrayContaining([
        expect.objectContaining({ ref: "TAVILY_API_KEY", staged: false }),
      ]),
    });
    expect(controller.receive(success("web-2"))).toBe(false);
    expect(JSON.stringify(controller.snapshot())).not.toContain("private-literal");
  });
});
