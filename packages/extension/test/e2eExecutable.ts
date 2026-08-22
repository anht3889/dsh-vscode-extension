import fs from "node:fs";
import path from "node:path";

type PathExists = (candidate: string) => boolean;

export function resolveDownloadedExecutable(
  executablePath: string,
  platform = process.platform,
  pathExists: PathExists = fs.existsSync
): string {
  if (
    platform !== "darwin" ||
    path.basename(executablePath) !== "Electron" ||
    pathExists(executablePath)
  ) {
    return executablePath;
  }

  const codeExecutable = path.join(path.dirname(executablePath), "Code");
  return pathExists(codeExecutable) ? codeExecutable : executablePath;
}
