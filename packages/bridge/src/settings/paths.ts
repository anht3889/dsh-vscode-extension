import type { Context } from "@deepseek-ai/cordis";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import type {
  ResolveSettingsPathTargetWire,
  SettingsPathMessage,
} from "@dsh-vscode/contract";

type ResolvedSettingsTarget = Extract<
  SettingsPathMessage["result"],
  { ok: true }
> extends infer Result
  ? Omit<Result & object, "ok">
  : never;

/** Resolve only Host-authorized settings targets to local absolute paths. */
export async function resolveSettingsTarget(
  ctx: Context,
  target: ResolveSettingsPathTargetWire,
): Promise<ResolvedSettingsTarget> {
  switch (target.kind) {
    case "dsh-home":
      return { target: "dsh-home", path: resolveDshHome() };
    case "settings-document": {
      const settings = ctx.get("settings");
      if (settings === undefined) {
        throw new Error("settings document is not available");
      }
      const path = target.prepare
        ? await settings.prepareDocument()
        : settings.documentPath;
      if (path === undefined) {
        throw new Error("settings document is not available");
      }
      return { target: "settings-document", path };
    }
    case "agent-preset": {
      const presets = ctx.get("agentPresets");
      if (presets === undefined) {
        throw new Error("agent presets are not available");
      }
      const preset = await presets.resolve(target.presetId);
      if (preset.trust !== "user") {
        throw new Error(`only a user preset can be opened: ${target.presetId}`);
      }
      return { target: "agent-preset", path: preset.path };
    }
  }
}
