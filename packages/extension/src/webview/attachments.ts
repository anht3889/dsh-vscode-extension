import { basename, extname, isAbsolute, relative, sep } from "node:path";
import type { EncodedImageAttachment, ImageMediaType } from "@dsh-vscode/contract";
import type * as vscode from "vscode";

const IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Return a session-workspace-relative POSIX path, or undefined when outside it. */
export function relativeFolderPath(
  cwd: string,
  selected: string,
): string | undefined {
  const path = relative(cwd, selected);
  if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) {
    return undefined;
  }
  if (path === "") return ".";
  return path.replaceAll("\\", "/");
}

export type FolderPickResult =
  | { kind: "cancelled" }
  | { kind: "unavailable" }
  | { kind: "outside" }
  | { kind: "picked"; path: string };

/** Select a folder, then validate it against the workspace current at that time. */
export async function pickRelativeFolder(
  pickFolder: () => Promise<string | undefined>,
  getCwd: () => string | undefined,
): Promise<FolderPickResult> {
  const selected = await pickFolder();
  if (selected === undefined) return { kind: "cancelled" };
  const cwd = getCwd();
  if (cwd === undefined) return { kind: "unavailable" };
  const path = relativeFolderPath(cwd, selected);
  return path === undefined ? { kind: "outside" } : { kind: "picked", path };
}

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

/** Read and encode an image selected through the VS Code extension host. */
export async function encodeImage(
  uri: vscode.Uri,
): Promise<EncodedImageAttachment> {
  const { workspace } = await import("vscode");
  const bytes = await workspace.fs.readFile(uri);
  return encodeImageBytes(bytes, uri.fsPath);
}
