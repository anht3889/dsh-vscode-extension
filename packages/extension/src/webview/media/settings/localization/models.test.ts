import { describe, expect, it } from "vitest";
import { en } from "./en.js";
import { zh } from "./zh.js";

describe("Models localization", () => {
  it("keeps English and Chinese dictionary keys identical", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it("owns a dedicated invalid-route fault and no obsolete display-name key", () => {
    expect(en).toHaveProperty("modelsCustomRouteInvalid");
    expect(zh).toHaveProperty("modelsCustomRouteInvalid");
    expect(en).not.toHaveProperty("modelsDisplayName");
    expect(zh).not.toHaveProperty("modelsDisplayName");
  });
});
