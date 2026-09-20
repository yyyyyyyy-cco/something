import { describe, expect, it } from "vitest";
import { act, actFail, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

const EMPTY = { money: 0, tiles: [], jailCards: 0 };

/** 常规 2 人局布置：p1 持有 1/3（棕组），p2 持有 6/8（浅蓝组），p1 为当前玩家 */
function board() {
  const state = makeGame(2);
  giveTile(state, 1, "p1");
  giveTile(state, 3, "p1");
  giveTile(state, 6, "p2");
  giveTile(state, 8, "p2");
  return state;
}

describe("私有报价（规则规格 §11）", () => {
  it("发起 + 接受：现金 / 地契 / 出狱卡双向交换", () => {
    const state = board();
    player(state, "p1").getOutOfJailCards.push("chance");

    const p = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 100, tiles: [1], jailCards: 1 },
      want: { money: 50, tiles: [6], jailCards: 0 },
    });
    const offer = eventsOfType(p.events, "TRADE_PROPOSED")[0]!.offer;
    expect(p.state.trades).toHaveLength(1);

    const a = act(p.state, { type: "ACCEPT_TRADE", playerId: "p2", offerId: offer.id });

    expect(a.state.trades).toHaveLength(0);
    expect(a.state.tiles[1]!.ownerId).toBe("p2");
    expect(a.state.tiles[6]!.ownerId).toBe("p1");
    expect(player(a.state, "p1").money).toBe(1500 - 100 + 50);
    expect(player(a.state, "p2").money).toBe(1500 + 100 - 50);
    expect(player(a.state, "p1").getOutOfJailCards).toEqual([]);
    expect(player(a.state, "p2").getOutOfJailCards).toEqual(["chance"]);
    expect(eventsOfType(a.events, "TRADE_ACCEPTED")).toHaveLength(1);
  });

  it("发起校验：自己 / 破产对象 / 非本人地产 / 有建筑 / 现金或卡不足", () => {
    const state = board();

    expect(actFail(state, { type: "PROPOSE_TRADE", playerId: "p1", toId: "p1", give: EMPTY, want: EMPTY }).code).toBe("INVALID_ACTION");

    player(state, "p2").bankrupt = true;
    expect(actFail(state, { type: "PROPOSE_TRADE", playerId: "p1", toId: "p2", give: EMPTY, want: EMPTY }).code).toBe("INVALID_ACTION");
    player(state, "p2").bankrupt = false;

    // 给与清单包含不属于自己的地（6 是 p2 的）
    expect(
      actFail(state, { type: "PROPOSE_TRADE", playerId: "p1", toId: "p2", give: { money: 0, tiles: [6], jailCards: 0 }, want: EMPTY }).code,
    ).toBe("INVALID_ACTION");

    // 有建筑的地不可交易
    state.tiles[1]!.houses = 1;
    expect(
      actFail(state, { type: "PROPOSE_TRADE", playerId: "p1", toId: "p2", give: { money: 0, tiles: [1], jailCards: 0 }, want: EMPTY }).code,
    ).toBe("INVALID_ACTION");
    state.tiles[1]!.houses = 0;

    // 现金 / 出狱卡不足
    expect(
      actFail(state, { type: "PROPOSE_TRADE", playerId: "p1", toId: "p2", give: { money: 99999, tiles: [], jailCards: 0 }, want: EMPTY }).code,
    ).toBe("INVALID_ACTION");
    expect(
      actFail(state, { type: "PROPOSE_TRADE", playerId: "p1", toId: "p2", give: { money: 0, tiles: [], jailCards: 1 }, want: EMPTY }).code,
    ).toBe("INVALID_ACTION");
  });

  it("拒绝（被报价方）与撤回（发起方）", () => {
    const state = board();
    const p = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 10, tiles: [], jailCards: 0 },
      want: EMPTY,
    });
    const offerId = p.state.trades[0]!.id;

    // 发起方不能拒绝自己的报价
    expect(actFail(p.state, { type: "REJECT_TRADE", playerId: "p1", offerId }).code).toBe("INVALID_ACTION");

    const r = act(p.state, { type: "REJECT_TRADE", playerId: "p2", offerId });
    expect(r.state.trades).toHaveLength(0);
    expect(eventsOfType(r.events, "TRADE_REMOVED")[0]).toMatchObject({ offerId, reason: "rejected" });

    // 撤回路径
    const p2 = act(r.state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 10, tiles: [], jailCards: 0 },
      want: EMPTY,
    });
    const c = act(p2.state, { type: "CANCEL_TRADE", playerId: "p1", offerId: p2.state.trades[0]!.id });
    expect(c.state.trades).toHaveLength(0);
    expect(eventsOfType(c.events, "TRADE_REMOVED")[0]!.reason).toBe("cancelled");
  });

  it("超时视为拒绝（服务端以 REJECT_TRADE(reason=timeout) 驱动）", () => {
    const state = board();
    const p = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 10, tiles: [], jailCards: 0 },
      want: EMPTY,
    });
    const t = act(p.state, { type: "REJECT_TRADE", playerId: "p2", offerId: p.state.trades[0]!.id, reason: "timeout" });
    expect(eventsOfType(t.events, "TRADE_REMOVED")[0]!.reason).toBe("timeout");
  });

  it("竞态：报价期间资源被买断后，接受失败（原子二次校验）", () => {
    const state = board();
    // p1 报价：用 $200 换 p2 的地 6
    const p = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 200, tiles: [], jailCards: 0 },
      want: { money: 0, tiles: [6], jailCards: 0 },
    });
    const offerId = p.state.trades[0]!.id;

    // p2 先把地 6 挂售并被无人买断——模拟资源变化：直接改归属（等价于被其他窗口卖出）
    p.state.tiles[6]!.ownerId = "p1";

    const err = actFail(p.state, { type: "ACCEPT_TRADE", playerId: "p2", offerId });
    expect(err.code).toBe("INVALID_ACTION");
    expect(err.message).toContain("失效");
  });

  it("并发报价：接受其一后，另一个因资源变化而失效", () => {
    const state = board();
    // 两个报价都索取 p2 的地 6
    let s = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 100, tiles: [], jailCards: 0 },
      want: { money: 0, tiles: [6], jailCards: 0 },
    }).state;
    const p2 = act(s, {
      type: "PROPOSE_TRADE",
      playerId: "p2",
      toId: "p1",
      give: { money: 0, tiles: [6], jailCards: 0 },
      want: { money: 60, tiles: [], jailCards: 0 },
    });
    s = p2.state;
    expect(s.trades).toHaveLength(2);

    const first = s.trades[0]!.id;
    const second = s.trades[1]!.id;

    // p2 接受第一个（给 6 收 $100）
    s = act(s, { type: "ACCEPT_TRADE", playerId: "p2", offerId: first }).state;
    expect(s.tiles[6]!.ownerId).toBe("p1");
    expect(s.trades).toHaveLength(1);

    // 第二个：p2 已不再持有 6 → p1 接受失败
    const err = actFail(s, { type: "ACCEPT_TRADE", playerId: "p1", offerId: second });
    expect(err.code).toBe("INVALID_ACTION");
  });

  it("抵押地交易：接收方支付 10% 交易税", () => {
    const state = board();
    state.tiles[6]!.mortgaged = true; // 东方大道 $100 → 抵押值 $50 → 税 $5
    const p = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 0, tiles: [], jailCards: 0 },
      want: { money: 0, tiles: [6], jailCards: 0 },
    });
    const a = act(p.state, { type: "ACCEPT_TRADE", playerId: "p2", offerId: p.state.trades[0]!.id });

    expect(a.state.tiles[6]!.ownerId).toBe("p1");
    expect(a.state.tiles[6]!.mortgaged).toBe(true);
    expect(player(a.state, "p1").money).toBe(1500 - 5); // 交易税由接收方 p1 支付
    const tax = eventsOfType(a.events, "MONEY_TRANSFERRED").filter((e) => e.reason === "trade-tax");
    expect(tax[0]).toMatchObject({ from: "p1", to: "bank", amount: 5 });
  });

  it("破产清理：破产者的报价与挂售全部移除", () => {
    const state = makeGame(3);
    giveTile(state, 1, "p1");
    let s = act(state, {
      type: "PROPOSE_TRADE",
      playerId: "p1",
      toId: "p2",
      give: { money: 10, tiles: [], jailCards: 0 },
      want: EMPTY,
    }).state;
    s = act(s, { type: "LIST_PROPERTY", playerId: "p1", tile: 1, price: 100 }).state;
    s = act(s, {
      type: "PROPOSE_TRADE",
      playerId: "p2",
      toId: "p1",
      give: { money: 10, tiles: [], jailCards: 0 },
      want: EMPTY,
    }).state;
    expect(s.trades).toHaveLength(2);
    expect(s.listings).toHaveLength(1);

    // 置 p1 于无力支付的税金 → 超时破产
    setMoney(s, "p1", 10);
    place(s, "p1", 0);
    // 直接构造债务：用 CASH_TIMEOUT 需要先进入窗口——改用直接触发：所得税路径较长，
    // 这里通过掷骰落所得税进入窗口
    const r = roll(s, "p1", scriptedRng([1, 3]));
    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    expect(t.state.trades).toHaveLength(0);
    expect(t.state.listings).toHaveLength(0);
    expect(player(t.state, "p1").bankrupt).toBe(true);
  });
});

describe("开放市场（挂售 / 买断 / 撤回）", () => {
  it("挂售与买断：付款、过户、挂售结束", () => {
    const state = board();
    const l = act(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 150 });
    const listing = eventsOfType(l.events, "PROPERTY_LISTED")[0]!.listing;
    expect(l.state.listings).toHaveLength(1);

    const b = act(l.state, { type: "BUY_LISTING", playerId: "p1", listingId: listing.id });

    expect(b.state.listings).toHaveLength(0);
    expect(b.state.tiles[6]!.ownerId).toBe("p1");
    expect(player(b.state, "p1").money).toBe(1350);
    expect(player(b.state, "p2").money).toBe(1650);
    expect(eventsOfType(b.events, "LISTING_REMOVED")[0]!.reason).toBe("sold");
  });

  it("挂售校验：非本人 / 有建筑 / 重复挂售 / 价格非法；卖方不能自购", () => {
    const state = board();
    expect(actFail(state, { type: "LIST_PROPERTY", playerId: "p1", tile: 6, price: 100 }).code).toBe("INVALID_ACTION");
    expect(actFail(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 0 }).code).toBe("INVALID_ACTION");

    state.tiles[6]!.houses = 1;
    expect(actFail(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 100 }).code).toBe("INVALID_ACTION");
    state.tiles[6]!.houses = 0;

    const l = act(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 100 });
    expect(actFail(l.state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 120 }).code).toBe("INVALID_ACTION");

    const listingId = l.state.listings[0]!.id;
    expect(actFail(l.state, { type: "BUY_LISTING", playerId: "p2", listingId }).code).toBe("INVALID_ACTION");
  });

  it("撤回挂售", () => {
    const state = board();
    const l = act(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 100 });
    const c = act(l.state, { type: "CANCEL_LISTING", playerId: "p2", listingId: l.state.listings[0]!.id });
    expect(c.state.listings).toHaveLength(0);
    expect(eventsOfType(c.events, "LISTING_REMOVED")[0]!.reason).toBe("cancelled");
  });

  it("带押地买断：买家支付 10% 交易税；现金不足（含税）拒绝", () => {
    const state = board();
    state.tiles[6]!.mortgaged = true; // 东方大道 抵押值 $50 → 税 $5
    const l = act(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 100 });
    const listingId = l.state.listings[0]!.id;

    setMoney(l.state, "p1", 104); // 100 + 5 = 105 > 104 → 拒绝
    expect(actFail(l.state, { type: "BUY_LISTING", playerId: "p1", listingId }).code).toBe("INSUFFICIENT_FUNDS");

    setMoney(l.state, "p1", 105);
    const b = act(l.state, { type: "BUY_LISTING", playerId: "p1", listingId });
    expect(b.state.tiles[6]!.ownerId).toBe("p1");
    expect(b.state.tiles[6]!.mortgaged).toBe(true);
    expect(player(b.state, "p1").money).toBe(0);
    expect(player(b.state, "p2").money).toBe(1600);
  });

  it("挂售的地主易主后买断失败（挂售失效）", () => {
    const state = board();
    const l = act(state, { type: "LIST_PROPERTY", playerId: "p2", tile: 6, price: 100 });
    l.state.tiles[6]!.ownerId = "p1"; // 模拟被其他途径出售
    const err = actFail(l.state, { type: "BUY_LISTING", playerId: "p1", listingId: l.state.listings[0]!.id });
    expect(err.code).toBe("INVALID_ACTION");
  });
});
