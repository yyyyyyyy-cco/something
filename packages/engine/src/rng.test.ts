import { describe, expect, it } from "vitest";
import { diceSum, isDoubles, secureRng, seededRng, shuffleArray } from "./index.js";

describe("rng 工具", () => {
  it("secureRng 返回 1-6 的整数骰值", () => {
    const rng = secureRng();
    for (let i = 0; i < 50; i++) {
      const [a, b] = rng();
      expect(Number.isInteger(a)).toBe(true);
      expect(Number.isInteger(b)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
    }
  });

  it("seededRng：同种子序列一致", () => {
    const a = seededRng(7);
    const b = seededRng(7);
    for (let i = 0; i < 20; i++) {
      expect(a()).toEqual(b());
    }
  });

  it("shuffleArray 保留全部元素且不修改入参", () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffleArray(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(src);
  });

  it("isDoubles / diceSum", () => {
    expect(isDoubles([3, 3])).toBe(true);
    expect(isDoubles([3, 4])).toBe(false);
    expect(diceSum([2, 5])).toBe(7);
  });
});
