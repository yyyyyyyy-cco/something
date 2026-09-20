import { describe, expect, it } from "vitest";
import { act, actFail, decline, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

/** 触发购买决策：p1 位于 0 掷 [1,2] → 3（波罗的海大道，无主） */
function declineOn3() {
  const state = makeGame(2);
  place(state, "p1", 0);
  const r = roll(state, "p1", scriptedRng([1, 2]));
  return decline(r.state, "p1");
}

describe("拍卖（规则规格 §4：公开递增 / 轮转询问 / 成交与流拍）", () => {
  it("放弃购买立即开启拍卖（队列从放弃者开始）", () => {
    const d = declineOn3();

    expect(d.state.phase).toBe("AUCTION");
    expect(d.state.auction).toMatchObject({ tileIndex: 3, cause: "decline", highBid: null, highBidderId: null });
    expect(d.state.auction!.queue).toEqual(["p1", "p2"]);
    expect(eventsOfType(d.events, "AUCTION_STARTED")[0]).toMatchObject({ tile: 3, cause: "decline" });
  });

  it("公开递增出价：出价者轮转至队尾，其余人继续被询问", () => {
    const d = declineOn3();

    const b1 = act(d.state, { type: "BID", playerId: "p1", amount: 10 });
    expect(b1.state.auction!.highBid).toBe(10);
    expect(b1.state.auction!.highBidderId).toBe("p1");
    expect(b1.state.auction!.queue).toEqual(["p2", "p1"]);

    const b2 = act(b1.state, { type: "BID", playerId: "p2", amount: 20 });
    expect(b2.state.auction!.highBid).toBe(20);
    expect(b2.state.auction!.queue).toEqual(["p1", "p2"]);
  });

  it("仅剩最高出价者 → 成交：付款、过户、回合收尾", () => {
    const d = declineOn3();
    const b1 = act(d.state, { type: "BID", playerId: "p1", amount: 10 });
    const b2 = act(b1.state, { type: "BID", playerId: "p2", amount: 20 });
    const pass = act(b2.state, { type: "PASS_BID", playerId: "p1" });

    expect(pass.state.auction).toBeNull();
    expect(pass.state.phase).toBe("AWAITING_ROLL");
    const ended = eventsOfType(pass.events, "AUCTION_ENDED")[0]!;
    expect(ended).toMatchObject({ tile: 3, winnerId: "p2", amount: 20 });
    expect(pass.state.tiles[3]!.ownerId).toBe("p2");
    expect(player(pass.state, "p2").money).toBe(1480);
    expect(pass.state.currentPlayerId).toBe("p2"); // p1 回合正常结束
  });

  it("全部放弃 → 流拍（地产保持无主）", () => {
    const d = declineOn3();
    const p1 = act(d.state, { type: "PASS_BID", playerId: "p1" });
    const p2 = act(p1.state, { type: "PASS_BID", playerId: "p2" });

    expect(p2.state.auction).toBeNull();
    expect(eventsOfType(p2.events, "AUCTION_ENDED")[0]).toMatchObject({ tile: 3, winnerId: null, amount: null });
    expect(p2.state.tiles[3]!.ownerId).toBeNull();
    expect(p2.state.currentPlayerId).toBe("p2");
  });

  it("队列仅剩未出价者 → 继续询问：其出价即成交", () => {
    const d = declineOn3();
    const p1 = act(d.state, { type: "PASS_BID", playerId: "p1" });
    expect(p1.state.auction!.queue).toEqual(["p2"]);

    const b = act(p1.state, { type: "BID", playerId: "p2", amount: 3 });
    expect(b.state.auction).toBeNull();
    expect(eventsOfType(b.events, "AUCTION_ENDED")[0]).toMatchObject({ winnerId: "p2", amount: 3 });
    expect(b.state.tiles[3]!.ownerId).toBe("p2");
  });

  it("超时放弃（服务端驱动）：以 PASS_BID(reason=timeout) 裁决成交", () => {
    const d = declineOn3();
    const b = act(d.state, { type: "BID", playerId: "p1", amount: 5 });
    expect(b.state.auction!.queue).toEqual(["p2", "p1"]);

    const t = act(b.state, { type: "PASS_BID", playerId: "p2", reason: "timeout" });
    expect(eventsOfType(t.events, "AUCTION_PASSED")[0]).toMatchObject({ playerId: "p2", reason: "timeout" });
    expect(eventsOfType(t.events, "AUCTION_ENDED")[0]).toMatchObject({ winnerId: "p1", amount: 5 });
    expect(t.state.tiles[3]!.ownerId).toBe("p1");
  });

  it("出价校验：未轮到 / 低于最低价 / 超过现金", () => {
    const d = declineOn3();

    // 队列首位是 p1，p2 尚未轮到
    expect(actFail(d.state, { type: "BID", playerId: "p2", amount: 5 }).code).toBe("INVALID_ACTION");
    // 最低出价 $1；0 与小数非法
    expect(actFail(d.state, { type: "BID", playerId: "p1", amount: 0 }).code).toBe("INVALID_ACTION");
    expect(actFail(d.state, { type: "BID", playerId: "p1", amount: 1.5 }).code).toBe("INVALID_ACTION");
    // 超过现金
    setMoney(d.state, "p1", 3);
    expect(actFail(d.state, { type: "BID", playerId: "p1", amount: 5 }).code).toBe("INSUFFICIENT_FUNDS");
  });

  it("拍卖期间其他动作被拒绝（掷骰 / 建造 / 交易）", () => {
    const d = declineOn3();

    expect(actFail(d.state, { type: "ROLL_DICE", playerId: "p1" }).code).toBe("INVALID_PHASE");
    expect(actFail(d.state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_PHASE");
    expect(
      actFail(d.state, {
        type: "PROPOSE_TRADE",
        playerId: "p2",
        toId: "p1",
        give: { money: 0, tiles: [], jailCards: 0 },
        want: { money: 0, tiles: [], jailCards: 0 },
      }).code,
    ).toBe("INVALID_PHASE");
  });

  it("银行清算连拍：第一块流拍后自动开拍第二块，全部结束恢复回合", () => {
    const state = makeGame(3);
    giveTile(state, 6, "p1");
    giveTile(state, 8, "p1"); // 两块地待拍卖
    setMoney(state, "p1", 150);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 3])); // → 4 所得税 $200
    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" }); // 破产 → 清算

    expect(eventsOfType(t.events, "AUCTION_STARTED")[0]).toMatchObject({ tile: 6, cause: "bankruptcy" });
    expect(t.state.auction!.queue).toEqual(["p2", "p3"]); // 破产者不在竞价队列

    const a1 = act(t.state, { type: "PASS_BID", playerId: "p2" });
    const a2 = act(a1.state, { type: "PASS_BID", playerId: "p3" });
    // 第一块流拍 → 自动开拍第二块（同一动作的连续事件）
    const started = eventsOfType(a2.events, "AUCTION_STARTED")[0]!;
    expect(started).toMatchObject({ tile: 8, cause: "bankruptcy" });
    expect(a2.state.auction!.tileIndex).toBe(8);

    const a3 = act(a2.state, { type: "PASS_BID", playerId: "p2" });
    const a4 = act(a3.state, { type: "PASS_BID", playerId: "p3" });

    expect(a4.state.auction).toBeNull();
    expect(a4.state.tiles[6]!.ownerId).toBeNull();
    expect(a4.state.tiles[8]!.ownerId).toBeNull();
    expect(a4.state.currentPlayerId).toBe("p2"); // 破产者回合跳过
    expect(a4.state.phase).toBe("AWAITING_ROLL");
  });
});
