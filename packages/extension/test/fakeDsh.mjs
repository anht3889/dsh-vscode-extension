import { createInterface } from "node:readline";

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

out({ kind: "hello", version: 1, dshVersion: "fake", cwd: process.cwd() });
out({ kind: "status", state: "idle" });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let m;
  try {
    m = JSON.parse(s);
  } catch {
    return;
  }
  if (m && m.kind === "exit") {
    process.exit(0);
  }
  out({ kind: "status", state: "idle" });
});
