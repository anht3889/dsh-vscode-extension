import { Buffer } from "node:buffer";
import { basename } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import {
  isImageAdmissionError,
  type ImageAttachmentRef,
  type SaveImageAttachment,
} from "@deepseek-ai/dsh-attachment";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { EncodedImageAttachment } from "@dsh-vscode/contract";

const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeImage(image: EncodedImageAttachment): SaveImageAttachment {
  if (!CANONICAL_BASE64.test(image.data)) {
    throw new Error("image data must be canonical base64");
  }
  const data = Buffer.from(image.data, "base64");
  if (data.toString("base64") !== image.data) {
    throw new Error("image data must be canonical base64");
  }
  return {
    mediaType: image.mediaType,
    data: new Uint8Array(data),
    ...(image.name !== undefined ? { name: basename(image.name) } : {}),
  };
}

async function assertImageRoute(
  ctx: Context,
  agent: Agent,
  signal: AbortSignal,
): Promise<void> {
  const routed = agent.session.requestHeader()?.config;
  const provider = routed?.provider ?? agent.options.provider;
  const model = routed?.model ?? agent.options.model;
  const llm = ctx.get("llm");
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error("the current model route could not be resolved for image input");
  }
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>;
  try {
    info = await llm.resolveModelInfo(provider, model, signal);
  } catch (error: unknown) {
    throw new Error(
      "the current model route could not be verified for image input",
      { cause: error },
    );
  }
  if (info.inputModalities?.includes("image") !== true) {
    throw new Error(`model "${model}" does not declare image input`);
  }
}

/**
 * Decode, validate, and durably save one submitted image batch.
 *
 * @param ctx - Bridge context carrying attachment and model services.
 * @param agent - Current agent whose live route controls image capability.
 * @param images - Canonical base64 image uploads in caller order.
 * @param signal - Cancellation signal for the queued admission.
 * @returns Durable image references in caller order.
 */
export async function admitImages(
  ctx: Context,
  agent: Agent,
  images: readonly EncodedImageAttachment[],
  signal: AbortSignal,
): Promise<readonly ImageAttachmentRef[]> {
  const inputs = images.map(decodeImage);
  const attachments = ctx.get("attachments");
  if (attachments === undefined) {
    throw new Error("no attachment store is mounted");
  }
  await assertImageRoute(ctx, agent, signal);
  signal.throwIfAborted();
  let refs: readonly ImageAttachmentRef[];
  try {
    refs = await attachments.saveImages(inputs);
  } catch (error: unknown) {
    if (isImageAdmissionError(error)) throw error;
    throw new Error("unable to persist the submitted image batch", {
      cause: error,
    });
  }
  signal.throwIfAborted();
  return refs;
}
