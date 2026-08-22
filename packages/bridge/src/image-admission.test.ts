import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { describe, expect, it, vi } from "vitest";
import { admitImages } from "./image-admission.js";

const LIMITS = {
  maxImageBytes: 10,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 20,
  maxImagePixels: 100,
  maxImageDimension: 10,
  mediaTypes: ["image/png"] as const,
};

const IMAGE_REF = {
  attachmentId: `sha256:${"1".repeat(64)}`,
  mediaType: "image/png" as const,
  bytes: 1,
  width: 1,
  height: 1,
  name: "a.png",
};

const agent = {
  options: { provider: "mock-provider", model: "mock-model" },
  session: { requestHeader: () => undefined },
} as unknown as Agent;

function imageContext(options: {
  attachments?: unknown;
  modelInfo?: unknown;
}): Context {
  const llm = {
    resolveModelInfo: vi.fn(async () => options.modelInfo),
  };
  return {
    get(name: string) {
      if (name === "attachments") return options.attachments;
      if (name === "llm") return llm;
      return undefined;
    },
  } as unknown as Context;
}

describe("admitImages", () => {
  it("decodes canonical images, verifies model support, and saves one batch", async () => {
    const saveImages = vi.fn(async () => [IMAGE_REF]);
    const ctx = imageContext({
      attachments: { saveImages, imageLimits: LIMITS },
      modelInfo: { inputModalities: ["text", "image"] },
    });

    await expect(
      admitImages(
        ctx,
        agent,
        [{ mediaType: "image/png", data: "AQ==", name: "/private/a.png" }],
        new AbortController().signal,
      ),
    ).resolves.toEqual([IMAGE_REF]);
    expect(saveImages).toHaveBeenCalledWith([
      {
        mediaType: "image/png",
        data: Uint8Array.of(1),
        name: "a.png",
      },
    ]);
  });

  it("rejects non-canonical base64 before persistence", async () => {
    const saveImages = vi.fn();
    const ctx = imageContext({
      attachments: { saveImages, imageLimits: LIMITS },
      modelInfo: { inputModalities: ["text", "image"] },
    });

    await expect(
      admitImages(
        ctx,
        agent,
        [{ mediaType: "image/png", data: "A===" }],
        new AbortController().signal,
      ),
    ).rejects.toThrow("canonical base64");
    expect(saveImages).not.toHaveBeenCalled();
  });

  it("rejects a route without image input before persistence", async () => {
    const saveImages = vi.fn();
    const ctx = imageContext({
      attachments: { saveImages, imageLimits: LIMITS },
      modelInfo: { inputModalities: ["text"] },
    });

    await expect(
      admitImages(
        ctx,
        agent,
        [{ mediaType: "image/png", data: "AQ==" }],
        new AbortController().signal,
      ),
    ).rejects.toThrow("does not declare image input");
    expect(saveImages).not.toHaveBeenCalled();
  });
});
