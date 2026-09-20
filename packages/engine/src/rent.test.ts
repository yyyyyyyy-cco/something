import { describe, expect, it } from "vitest";
import { actFail, buy, decline, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

describe("租金结算与购买决策", () => {
  it("单一地产租金（无成套加成）", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p2"); // 地中海大道（基础租金 $2）
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 38 + 3 = 41 → 1（环绕 +200）

    const rent = eventsOfType(r.events, "RENT_PAID")[0]!;
    expect(rent).toMatchObject({ from: "p1", to: "p2", tile: 1, amount: 2 });
    expect(player(r.state, "p1").money).toBe(1500 + 200 - 2);
    expect(player(r.state, "p2").money).toBe(1500 + 2);
  });

  it("集齐色组后基础租金翻倍", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p2");
    giveTile(state, 3, "p2"); // 棕色组齐全
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // → 1

    expect(eventsOfType(r.events, "RENT_PAID")[0]!.amount).toBe(4); // 2 × 2
  });

  it("车站租金按持有数量阶梯 25/50/100/200", () => {
    const cases: Array<{ owned: number[]; expected: number }> = [
      { owned: [5], expected: 25 },
      { owned: [5, 15], expected: 50 },
      { owned: [5, 15, 25], expected: 100 },
      { owned: [5, 15, 25, 35], expected: 200 },
    ];
    for (const c of cases) {
      const state = makeGame(2);
      for (const t of c.owned) giveTile(state, t, "p2");
      place(state, "p1", 2);

      const r = roll(state, "p1", scriptedRng([1, 2])); // 2 + 3 = 5
      expect(eventsOfType(r.events, "RENT_PAID")[0]!.amount).toBe(c.expected);
    }
  });

  it("公用事业：持有 1 座 ×4；2 座 ×10（按移动点数）", () => {
    const s1 = makeGame(2);
    giveTile(s1, 12, "p2");
    place(s1, "p1", 9);
    const r1 = roll(s1, "p1", scriptedRng([1, 2])); // 9 + 3 = 12；点数 3 ×4
    expect(eventsOfType(r1.events, "RENT_PAID")[0]!.amount).toBe(12);

    const s2 = makeGame(2);
    giveTile(s2, 12, "p2");
    giveTile(s2, 28, "p2");
    place(s2, "p1", 9);
    const r2 = roll(s2, "p1", scriptedRng([1, 2])); // 点数 3 ×10
    expect(eventsOfType(r2.events, "RENT_PAID")[0]!.amount).toBe(30);
  });

  it("落在自己地产不付租", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p1");
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // → 1

    expect(eventsOfType(r.events, "RENT_PAID")).toHaveLength(0);
    expect(player(r.state, "p1").money).toBe(1700); // 仅工资
  });

  it("购买：扣款、过户、事件记录", () => {
    const state = makeGame(2);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([2, 3])); // → 5 雷丁铁路（$200）
    expect(r.state.pendingPurchase?.tileIndex).toBe(5);

    const b = buy(r.state, "p1");
    expect(eventsOfType(b.events, "PROPERTY_BOUGHT")[0]).toMatchObject({ playerId: "p1", tile: 5, price: 200 });
    expect(player(b.state, "p1").money).toBe(1300);
    expect(b.state.tiles[5]!.ownerId).toBe("p1");
    expect(b.state.pendingPurchase).toBeNull();
    expect(b.state.currentPlayerId).toBe("p2");
  });

  it("购买失败：现金不足（状态不变，可继续决策）", () => {
    const state = makeGame(2);
    setMoney(state, "p1", 150);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([2, 3])); // → 5（$200 无法负担）
    const failure = actFail(r.state, { type: "BUY_PROPERTY", playerId: "p1" });
    expect(failure.code).toBe("INSUFFICIENT_FUNDS");
    expect(r.state.pendingPurchase?.tileIndex).toBe(5);

    const d = decline(r.state, "p1");
    expect(d.state.tiles[5]!.ownerId).toBeNull();
  });
});
