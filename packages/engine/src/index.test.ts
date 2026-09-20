import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index.js";

describe("engine 骨架", () => {
  it("导出语义化版本号的 ENGINE_VERSION", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
