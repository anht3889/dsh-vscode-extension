import { basename, extname } from "node:path";
import type { EncodedImageAttachment, ImageMediaType } from "@dsh-vscode/contract";

const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Encode image bytes for the bridge while exposing only the file's base name. */
export function encodeImageBytes(
  bytes: Uint8Array,
  filePath: string,
): EncodedImageAttachment {
  const name = basename(filePath);
  const mediaType = IMAGE_MEDIA_TYPES[extname(name).toLowerCase()];
  if (mediaType === undefined) {
    throw new Error(`Unsupported image type: ${name}`);
  }
  return {
    mediaType,
    data: Buffer.from(bytes).toString("base64"),
    name,
  };
}

/** The only member of a dialog selection this module reads. */
export interface ImageSource {
  fsPath: string;
}

/** Encoded images plus the base names that could not be read or typed. */
export interface ImageSelection {
  images: EncodedImageAttachment[];
  failed: string[];
}

/**
 * Encode every image in a dialog selection independently.
 *
 * The byte reader is injected (the panel passes `vscode.workspace.fs.readFile`)
 * so this orchestration runs under unit test without the editor API.
 * @param selected - dialog result; `undefined` means the user cancelled.
 * @param readBytes - reads one selected file's bytes.
 * @returns successes in selection order plus the base name of each failure.
 */
export async function encodeImageSelection<T extends ImageSource>(
  selected: readonly T[] | undefined,
  readBytes: (source: T) => Promise<Uint8Array>,
): Promise<ImageSelection> {
  const images: EncodedImageAttachment[] = [];
  const failed: string[] = [];
  for (const source of selected ?? []) {
    try {
      images.push(encodeImageBytes(await readBytes(source), source.fsPath));
    } catch {
      // Swallowed deliberately: the reason is either an unreadable file or an
      // unsupported extension, and neither may reach the webview with its
      // absolute path. The caller reports the base name instead.
      failed.push(basename(source.fsPath));
    }
  }
  return { images, failed };
}
