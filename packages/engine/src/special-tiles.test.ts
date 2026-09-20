import { describe, expect, it } from "vitest";
import { decline, eventsOfType, makeGame, place, player, roll, scriptedRng } from "./test-utils.js";

describe("特殊格：税金 / 免费停车 / 入狱格 / 探监", () => {
  it("所得税 $200", () => {
    const state = makeGame(2);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 3])); // 0 + 4 = 4

    const tax = eventsOfType(r.events, "MONEY_TRANSFERRED").filter((e) => e.reason === "tax");
    expect(tax[0]).toMatchObject({ from: "p1", to: "bank", amount: 200 });
    expect(player(r.state, "p1").money).toBe(1300);
  });

  it("奢侈税 $75（双数时回合继续）", () => {
    const state = makeGame(2);
    place(state, "p1", 36);

    const r = roll(state, "p1", scriptedRng([1, 1])); // 36 + 2 = 38（双数）

    expect(player(r.state, "p1").money).toBe(1425);
    expect(r.state.currentPlayerId).toBe("p1"); // 双数 → 继续掷
    expect(r.state.phase).toBe("AWAITING_ROLL");
  });

  it("免费停车场：无事发生", () => {
    const state = makeGame(2);
    place(state, "p1", 15);

    const r = roll(state, "p1", scriptedRng([2, 3])); // 15 + 5 = 20

    expect(player(r.state, "p1").money).toBe(1500);
    expect(eventsOfType(r.events, "MONEY_TRANSFERRED")).toHaveLength(0);
    expect(player(r.state, "p1").position).toBe(20);
  });

  it('"入狱"格：传送到监狱且回合结束', () => {
    const state = makeGame(2);
    place(state, "p1", 27);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 27 + 3 = 30

    const jailed = eventsOfType(r.events, "PLAYER_JAILED")[0]!;
    expect(jailed).toMatchObject({ playerId: "p1", cause: "tile" });
    expect(player(r.state, "p1").inJail).toBe(true);
    expect(player(r.state, "p1").position).toBe(10);
    expect(r.state.currentPlayerId).toBe("p2");
  });

  it("探监（走到监狱格但未被关押）：无事发生", () => {
    const state = makeGame(2);
    place(state, "p1", 7);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 7 + 3 = 10

    expect(player(r.state, "p1").inJail).toBe(false);
    expect(player(r.state, "p1").position).toBe(10);
    expect(eventsOfType(r.events, "PLAYER_JAILED")).toHaveLength(0);
    expect(r.state.currentPlayerId).toBe("p2");
  });

  it("在监狱格原地不动（已在探监位）", () => {
    const state = makeGame(2);
    place(state, "p1", 10);
    // 从探监位出发的移动不受影响；此处仅验证探监状态不误判入狱
    const r = roll(state, "p1", scriptedRng([2, 3])); // 10 + 5 = 15

    expect(player(r.state, "p1").inJail).toBe(false);
    decline(r.state, "p1");
  });
});
