import { describe, expect, it } from "vitest";
import { act, decline, eventsOfType, makeGame, place, player, roll, scriptedRng } from "./test-utils.js";

describe("核心循环：掷骰 / 移动 / GO 工资 / 换人", () => {
  // 注：以下用例关闭拍卖房规（auctionEnabled: false）以验证 P0 基础流；
  //     拍卖开启时的「放弃即拍卖」流程见 auction.test.ts
  it("掷骰移动并逐格生成路径（落无主地进入购买决策）", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 2]));

    const moved = eventsOfType(r.events, "TOKEN_MOVED")[0]!;
    expect(moved.from).toBe(0);
    expect(moved.to).toBe(3);
    expect(moved.path).toEqual([1, 2, 3]);
    expect(player(r.state, "p1").position).toBe(3);
    expect(player(r.state, "p1").money).toBe(1500); // 未环绕，无工资

    // 落在无主地（波罗的海大道）→ 购买决策
    expect(r.state.phase).toBe("AWAITING_ACTION");
    expect(r.state.pendingPurchase).toEqual({ playerId: "p1", tileIndex: 3 });

    const d = decline(r.state, "p1");
    expect(eventsOfType(d.events, "PURCHASE_DECLINED")[0]!.tile).toBe(3);
    expect(d.state.tiles[3]!.ownerId).toBeNull(); // 拍卖关闭：拒绝即流拍
    expect(d.state.currentPlayerId).toBe("p2");
    expect(eventsOfType(d.events, "TURN_ENDED")[0]!.nextPlayerId).toBe("p2");
  });

  it("停在起点（环绕经过 GO）领取 $200，且不重复发放", () => {
    const state = makeGame(2);
    place(state, "p1", 35);

    const r = roll(state, "p1", scriptedRng([1, 4])); // 35 + 5 = 40 → 0

    const salary = eventsOfType(r.events, "MONEY_TRANSFERRED").filter((e) => e.reason === "salary");
    expect(salary).toHaveLength(1);
    expect(salary[0]).toMatchObject({ from: "bank", to: "p1", amount: 200 });
    expect(player(r.state, "p1").money).toBe(1700);
    expect(player(r.state, "p1").position).toBe(0);
    // 非双数 → 换人
    expect(r.state.currentPlayerId).toBe("p2");
  });

  it("环绕经过 GO（未停在起点）领取 $200", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    place(state, "p1", 35);

    const r = roll(state, "p1", scriptedRng([2, 4])); // 35 + 6 = 41 → 1

    expect(player(r.state, "p1").money).toBe(1700);
    expect(player(r.state, "p1").position).toBe(1);
    expect(r.state.pendingPurchase?.tileIndex).toBe(1);
    const d = decline(r.state, "p1");
    expect(d.state.currentPlayerId).toBe("p2");
  });

  it("未环绕不发放工资", () => {
    const state = makeGame(2);
    place(state, "p1", 10);

    const r = roll(state, "p1", scriptedRng([2, 3])); // 10 + 5 = 15（车站，无主）

    expect(player(r.state, "p1").money).toBe(1500);
    expect(eventsOfType(r.events, "MONEY_TRANSFERRED")).toHaveLength(0);
    decline(r.state, "p1");
  });

  it("双数加掷：同一玩家继续掷骰", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    place(state, "p1", 0);

    const r1 = roll(state, "p1", scriptedRng([3, 3])); // 到 6（东方大道，无主）
    expect(eventsOfType(r1.events, "TURN_ENDED")).toHaveLength(0);
    const d1 = decline(r1.state, "p1");
    expect(d1.state.currentPlayerId).toBe("p1");
    expect(d1.state.phase).toBe("AWAITING_ROLL");

    const r2 = roll(d1.state, "p1", scriptedRng([1, 2])); // 到 9（康涅狄格大道，无主）
    const d2 = decline(r2.state, "p1");
    expect(d2.state.currentPlayerId).toBe("p2"); // 非双数 → 换人
  });

  it("连续三次双数直接入狱（不移动、不加掷）", () => {
    let state = makeGame(2, { settings: { auctionEnabled: false } });
    place(state, "p1", 0);

    const r1 = roll(state, "p1", scriptedRng([3, 3]));
    state = decline(r1.state, "p1").state;

    const r2 = roll(state, "p1", scriptedRng([4, 4]));
    state = decline(r2.state, "p1").state;

    const r3 = roll(state, "p1", scriptedRng([6, 6]));

    expect(eventsOfType(r3.events, "TOKEN_MOVED")).toHaveLength(0); // 第三次双数不移动
    const jailed = eventsOfType(r3.events, "PLAYER_JAILED")[0]!;
    expect(jailed).toMatchObject({ playerId: "p1", cause: "doubles" });
    expect(player(r3.state, "p1").inJail).toBe(true);
    expect(player(r3.state, "p1").position).toBe(10);
    expect(r3.state.currentPlayerId).toBe("p2");
  });

  it("落「入狱」格后回合立即结束（加掷被取消）", () => {
    const state = makeGame(2);
    place(state, "p1", 27);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 27 + 3 = 30 入狱

    expect(player(r.state, "p1").inJail).toBe(true);
    expect(player(r.state, "p1").position).toBe(10);
    expect(r.state.currentPlayerId).toBe("p2"); // 直接换人
  });
});
