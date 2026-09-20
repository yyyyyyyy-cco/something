import { describe, expect, it } from "vitest";
import type { GameState } from "@monopoly/shared";
import { act, actFail, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

/** 场景：p1 欠 p2 深蓝双地租金 $100 但只有 $10 → 进入套现窗口 */
function inDebt(): GameState {
  const state = makeGame(2, { settings: { auctionEnabled: false } });
  giveTile(state, 37, "p2");
  giveTile(state, 39, "p2");
  setMoney(state, "p1", 10);
  place(state, "p1", 36);
  const r = roll(state, "p1", scriptedRng([1, 2])); // 36 + 3 = 39
  if (r.state.phase !== "CASH_WINDOW") throw new Error("场景构造失败：未进入套现窗口");
  return r.state;
}

describe("套现窗口（规则规格 §13：卖房 → 抵押 → 协商）", () => {
  it("开启：DEBT_OPENED 事件与 pendingDebt 记录（能付多少付多少，付款后自动结算）", () => {
    const s = inDebt();
    expect(s.phase).toBe("CASH_WINDOW");
    expect(s.pendingDebt).toMatchObject({ payerId: "p1", creditor: "p2", amount: 100, reason: "rent", resume: "completeMove" });
  });

  it("卖房套现：凑足后自动结算、债务清偿、回合收尾", () => {
    const s = inDebt();
    // 给 p1 加一组可卖资产：浅蓝组 2 栋房（6 号，卖 1 栋 +$25）
    giveTile(s, 6, "p1");
    giveTile(s, 8, "p1");
    s.tiles[6]!.houses = 2;
    s.tiles[8]!.houses = 2;
    setMoney(s, "p1", 80); // 卖 1 栋 25 → 105 ≥ 100

    const r = act(s, { type: "SELL_HOUSE", playerId: "p1", tile: 6 });

    expect(r.state.phase).not.toBe("CASH_WINDOW");
    expect(r.state.pendingDebt).toBeNull();
    expect(eventsOfType(r.events, "DEBT_SETTLED")).toHaveLength(1);
    expect(player(r.state, "p1").money).toBe(80 + 25 - 100);
    expect(player(r.state, "p2").money).toBe(1500 + 100);
    expect(eventsOfType(r.events, "TURN_ENDED")[0]!.nextPlayerId).toBe("p2"); // 恢复移动收尾
  });

  it("抵押套现：凑足后自动结算", () => {
    const s = inDebt();
    giveTile(s, 39, "p1"); // 木板路 抵押值 $200
    setMoney(s, "p1", 10);

    const r = act(s, { type: "MORTGAGE", playerId: "p1", tile: 39 });

    expect(r.state.pendingDebt).toBeNull();
    expect(r.state.tiles[39]!.mortgaged).toBe(true);
    expect(player(r.state, "p1").money).toBe(10 + 200 - 100);
    expect(player(r.state, "p2").money).toBe(1600);
  });

  it("交易收款套现：接受报价后自动结算", () => {
    const s = inDebt();
    giveTile(s, 1, "p1"); // p1 用地产换现金
    setMoney(s, "p1", 10);

    // p2 发起报价（任意玩家可在套现窗口发起）
    const p = act(s, {
      type: "PROPOSE_TRADE",
      playerId: "p2",
      toId: "p1",
      give: { money: 150, tiles: [], jailCards: 0 },
      want: { money: 0, tiles: [1], jailCards: 0 },
    });
    const a = act(p.state, { type: "ACCEPT_TRADE", playerId: "p1", offerId: p.state.trades[0]!.id });

    expect(a.state.pendingDebt).toBeNull();
    expect(a.state.tiles[1]!.ownerId).toBe("p2");
    expect(player(a.state, "p1").money).toBe(10 + 150 - 100);
  });

  it("超时未凑足 → 破产；主动认输（DECLARE_BANKRUPTCY）立即破产", () => {
    const s = inDebt();
    const t = act(s, { type: "CASH_TIMEOUT", playerId: "p1" });
    expect(eventsOfType(t.events, "PLAYER_BANKRUPT")[0]).toMatchObject({ playerId: "p1", creditor: "p2" });

    const s2 = inDebt();
    const d = act(s2, { type: "DECLARE_BANKRUPTCY", playerId: "p1" });
    expect(eventsOfType(d.events, "PLAYER_BANKRUPT")[0]).toMatchObject({ playerId: "p1", creditor: "p2" });
  });

  it("窗口内禁用非变现类动作（建造 / 赎回）；非欠款人不可超时", () => {
    const s = inDebt();
    giveTile(s, 1, "p1");
    giveTile(s, 3, "p1");
    expect(actFail(s, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_PHASE");
    expect(actFail(s, { type: "UNMORTGAGE", playerId: "p1", tile: 1 }).code).toBe("INVALID_PHASE");
    expect(actFail(s, { type: "CASH_TIMEOUT", playerId: "p2" }).code).toBe("NOT_YOUR_TURN");
  });

  it("强制保释套现（resume = jailRoll）：付清后出狱并按点数移动", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    const p = player(state, "p1");
    p.position = 10;
    p.inJail = true;
    p.jailTurns = 2;
    setMoney(state, "p1", 30);
    giveTile(state, 39, "p1"); // 抵押值 $200

    const r1 = roll(state, "p1", scriptedRng([1, 2])); // 第三次失败 → 强制保释 $50，不足 → 窗口
    expect(r1.state.phase).toBe("CASH_WINDOW");
    expect(r1.state.pendingDebt!.resume).toBe("jailRoll");

    const r2 = act(r1.state, { type: "MORTGAGE", playerId: "p1", tile: 39 }); // +200 → 可付

    expect(r2.state.pendingDebt).toBeNull();
    const released = eventsOfType(r2.events, "PLAYER_RELEASED")[0]!;
    expect(released.method).toBe("forced");
    expect(player(r2.state, "p1").inJail).toBe(false);
    expect(player(r2.state, "p1").position).toBe(13); // 10 + [1,2]
    expect(player(r2.state, "p1").money).toBe(30 + 200 - 50);
  });

  it("多人清偿套现（resume = payEach）：付清后由银行转付各债权人", () => {
    const state = makeGame(3, { settings: { auctionEnabled: false } });
    giveTile(state, 39, "p1"); // 抵押值 $200
    player(state, "p1").position = 4; // 4 + [1,2] → 7 机会

    // 将 chance-14（支付每位玩家 $50）置于牌堆顶
    state.decks.chance = ["chance-14", ...state.decks.chance.filter((id) => id !== "chance-14")];
    setMoney(state, "p1", 60); // 需付 100，不足

    const r1 = roll(state, "p1", scriptedRng([1, 2]));
    expect(r1.state.phase).toBe("CASH_WINDOW");
    expect(r1.state.pendingDebt).toMatchObject({ amount: 100, resume: "payEach" });

    const r2 = act(r1.state, { type: "MORTGAGE", playerId: "p1", tile: 39 }); // 60 + 200 = 260 ≥ 100

    expect(r2.state.pendingDebt).toBeNull();
    expect(player(r2.state, "p1").money).toBe(60 + 200 - 100);
    expect(player(r2.state, "p2").money).toBe(1550);
    expect(player(r2.state, "p3").money).toBe(1550);
  });

  it("罚金池房规（potEnabled）：税金入池，落免费停车全取", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false, potEnabled: true } });
    place(state, "p1", 0);

    // p1 落所得税 $200 → 入池
    const r1 = roll(state, "p1", scriptedRng([1, 3])); // → 4
    expect(r1.state.pot).toBe(200);
    expect(player(r1.state, "p1").money).toBe(1300);

    // p2 位置 15 掷 [2,3] → 20 免费停车 → 全取
    place(r1.state, "p2", 15);
    const r2 = roll(r1.state, "p2", scriptedRng([2, 3]));

    expect(r2.state.pot).toBe(0);
    expect(player(r2.state, "p2").money).toBe(1700);
    expect(eventsOfType(r2.events, "POT_COLLECTED")[0]).toMatchObject({ playerId: "p2", amount: 200 });
  });
});
