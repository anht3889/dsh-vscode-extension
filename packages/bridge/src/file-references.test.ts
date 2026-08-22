import type { OutboundMessage } from "@dsh-vscode/contract";
import { describe, expect, it, vi } from "vitest";
import { createFileReferenceSearch } from "./file-references.js";

const agent = {} as never;

function contextWithFileReferences(service: {
  list(
    agent: never,
    query: string,
    signal: AbortSignal,
  ): Promise<{ path: string; kind: "file" }[]>;
}) {
  return {
    get: vi.fn((name: string) =>
      name === "fileReferences" ? service : undefined),
  } as never;
}

describe("createFileReferenceSearch", () => {
  it("aborts the previous query and emits only the latest result", async () => {
    const calls: AbortSignal[] = [];
    const service = {
      list: vi.fn(async (_agent: never, query: string, signal: AbortSignal) => {
        calls.push(signal);
        await Promise.resolve();
        signal.throwIfAborted();
        return [{ path: query, kind: "file" as const }];
      }),
    };
    const sent: OutboundMessage[] = [];
    const search = createFileReferenceSearch(
      contextWithFileReferences(service),
      () => agent,
      (message) => sent.push(message),
    );

    search.list("old", "r1");
    search.list("new", "r2");

    await vi.waitFor(() =>
      expect(sent).toContainEqual({
        kind: "fileReferences",
        requestId: "r2",
        items: [{ path: "new", kind: "file" }],
      }),
    );
    expect(calls[0]?.aborted).toBe(true);
    expect(
      sent.some(
        (message) =>
          message.kind === "fileReferences" && message.requestId === "r1",
      ),
    ).toBe(false);
  });

  it("reports unavailable when the service is absent", async () => {
    const sent: OutboundMessage[] = [];
    const search = createFileReferenceSearch(
      { get: vi.fn(() => undefined) } as never,
      () => agent,
      (message) => sent.push(message),
    );

    search.list("src", "r1");

    await vi.waitFor(() =>
      expect(sent).toContainEqual({
        kind: "fileReferences",
        requestId: "r1",
        items: [],
        available: false,
      }),
    );
  });
});
