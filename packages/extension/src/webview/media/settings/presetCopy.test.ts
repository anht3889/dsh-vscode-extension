import { describe, expect, it } from "vitest";
import { resolvePresetDisplayCopy } from "./presetCopy.js";

const STANDARD_UPSTREAM = {
  name: "标准模式",
  description:
    "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流。",
};

describe("resolvePresetDisplayCopy", () => {
  it("returns English copy for a known system preset in English", () => {
    expect(resolvePresetDisplayCopy("en", "system", "standard", STANDARD_UPSTREAM)).toEqual({
      name: "Standard Mode",
      description:
        "A full-featured coding agent with file editing, shell, file and web search, skills, plan, goals, subagents, and workflows.",
    });
    expect(resolvePresetDisplayCopy("en", "system", "code", {
      name: "PTC 模式",
      description: "具备标准模式的全部能力。",
    })).toEqual({
      name: "PTC Mode",
      description:
        "Has all Standard Mode capabilities, and presents tools through the Code Mode SDK so the model can compose multi-step operations as one TypeScript program.",
    });
    expect(resolvePresetDisplayCopy("en", "system", "minimal", {
      name: "极简模式",
      description: "仅提供持久 bash 与 str_replace_editor。",
    })).toEqual({
      name: "Minimal Mode",
      description:
        "A two-tool coding agent with persistent bash and str_replace_editor only.",
    });
    expect(resolvePresetDisplayCopy("en", "system", "cordis", {
      name: "创造模式",
      description: "用于创建自定义 Agent preset。",
    })).toEqual({
      name: "Creation Mode",
      description:
        "For creating custom Agent presets: has all Standard Mode capabilities, plus runtime inspection, plugin experiments, and preset-authoring guidance.",
    });
  });

  it("passes through DSH copy for a system preset in Chinese", () => {
    expect(resolvePresetDisplayCopy("zh", "system", "standard", STANDARD_UPSTREAM))
      .toEqual(STANDARD_UPSTREAM);
  });

  it("passes through a user-authored preset even when the id matches a system preset", () => {
    const user = { name: "My Standard", description: "User authored" };
    expect(resolvePresetDisplayCopy("en", "user", "standard", user)).toEqual(user);
  });

  it("passes through an unknown system-preset id in English", () => {
    const unknown = { name: "Experimental", description: "Not shipped" };
    expect(resolvePresetDisplayCopy("en", "system", "experimental", unknown))
      .toEqual(unknown);
  });

  it("leaves absent upstream name and description undefined on passthrough", () => {
    expect(resolvePresetDisplayCopy("en", "user", "mine", {})).toEqual({});
    expect(resolvePresetDisplayCopy("zh", "system", "standard", {})).toEqual({});
    expect(resolvePresetDisplayCopy("en", "system", "experimental", {})).toEqual({});
  });

  it("still returns English copy when a known system preset omits upstream fields", () => {
    expect(resolvePresetDisplayCopy("en", "system", "standard", {})).toEqual({
      name: "Standard Mode",
      description:
        "A full-featured coding agent with file editing, shell, file and web search, skills, plan, goals, subagents, and workflows.",
    });
  });
});
