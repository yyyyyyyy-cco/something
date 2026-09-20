import { describe, expect, it } from "vitest";
import { act, actFail, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

describe("抵押与赎回（规则规格 §7）", () => {
  it("抵押：无建筑地产换取半价现金", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p1"); // 地中海大道 $60 → 抵押值 $30

    const r = act(state, { type: "MORTGAGE", playerId: "p1", tile: 1 });

    expect(player(r.state, "p1").money).toBe(1530);
    expect(r.state.tiles[1]!.mortgaged).toBe(true);
    expect(eventsOfType(r.events, "PROPERTY_MORTGAGED")[0]).toMatchObject({ tile: 1, amount: 30 });
  });

  it("有建筑 / 已抵押 / 挂售中的地产不可抵押", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p1");
    state.tiles[1]!.houses = 1;
    expect(actFail(state, { type: "MORTGAGE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");

    state.tiles[1]!.houses = 0;
    state.tiles[1]!.mortgaged = true;
    expect(actFail(state, { type: "MORTGAGE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");

    state.tiles[1]!.mortgaged = false;
    state.listings.push({ id: "l-x", sellerId: "p1", tile: 1, price: 100 });
    const err = actFail(state, { type: "MORTGAGE", playerId: "p1", tile: 1 });
    expect(err.code).toBe("INVALID_ACTION");
    expect(err.message).toContain("挂售");
  });

  it("赎回：支付抵押值 + 10% 利息（向上取整）", () => {
    const state = makeGame(2);
    giveTile(state, 5, "p1"); // 雷丁铁路 $200 → 抵押值 $100，利息 $10
    state.tiles[5]!.mortgaged = true;

    const r = act(state, { type: "UNMORTGAGE", playerId: "p1", tile: 5 });

    expect(player(r.state, "p1").money).toBe(1500 - 110);
    expect(r.state.tiles[5]!.mortgaged).toBe(false);
    expect(eventsOfType(r.events, "PROPERTY_UNMORTGAGED")[0]).toMatchObject({ tile: 5, cost: 110 });
  });

  it("利息不足 $1 向上取整（$30 抵押值 → 利息 $3）", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p1"); // 抵押值 $30 → 利息 ceil(3) = 3
    state.tiles[1]!.mortgaged = true;

    const r = act(state, { type: "UNMORTGAGE", playerId: "p1", tile: 1 });
    expect(player(r.state, "p1").money).toBe(1500 - 33);
  });

  it("现金不足以赎回 → 拒绝", () => {
    const state = makeGame(2);
    giveTile(state, 39, "p1"); // 抵押值 $200 → 赎回 $220
    state.tiles[39]!.mortgaged = true;
    setMoney(state, "p1", 100);
    expect(actFail(state, { type: "UNMORTGAGE", playerId: "p1", tile: 39 }).code).toBe("INSUFFICIENT_FUNDS");
  });

  it("抵押中的地产不收租", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    giveTile(state, 1, "p2");
    state.tiles[1]!.mortgaged = true;
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // → 1

    expect(eventsOfType(r.events, "RENT_PAID")).toHaveLength(0);
    expect(player(r.state, "p1").money).toBe(1700); // 只有 GO 工资
    expect(player(r.state, "p2").money).toBe(1500);
  });

  it("抵押破垄断加成（默认）：组内任一抵押即无双倍租金", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    giveTile(state, 1, "p2");
    giveTile(state, 3, "p2"); // 棕组齐全
    state.tiles[3]!.mortgaged = true; // 破垄断
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // → 1
    expect(eventsOfType(r.events, "RENT_PAID")[0]!.amount).toBe(2); // 基础租金（无 ×2）
  });

  it("mortgageBreaksMonopoly=false：抵押不影响双倍租金", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false, mortgageBreaksMonopoly: false } });
    giveTile(state, 1, "p2");
    giveTile(state, 3, "p2");
    state.tiles[3]!.mortgaged = true;
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // → 1
    expect(eventsOfType(r.events, "RENT_PAID")[0]!.amount).toBe(4); // 2 × 2
  });

  it("破产移交抵押地：债主支付抵押值 10% 交易税", () => {
    // 场景：p1 欠 p2 租金无力支付 → 超时破产，其抵押地移交 p2 并附带交易税
    const s2 = makeGame(2, { settings: { auctionEnabled: false } });
    giveTile(s2, 37, "p2");
    giveTile(s2, 39, "p2");
    giveTile(s2, 5, "p1"); // 雷丁铁路 抵押值 $100 → 税 $10
    s2.tiles[5]!.mortgaged = true;
    setMoney(s2, "p1", 10);
    place(s2, "p1", 36);

    const r = roll(s2, "p1", scriptedRng([1, 2])); // 36 + 3 = 39 → 租金 $100（双倍基础）无法支付
    expect(r.state.phase).toBe("CASH_WINDOW");

    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    expect(t.state.tiles[5]!.ownerId).toBe("p2");
    const tax = eventsOfType(t.events, "MONEY_TRANSFERRED").filter(
      (e) => e.reason === "trade-tax" && e.from === "p2" && e.to === "bank",
    );
    expect(tax[0]!.amount).toBe(10);
    // p2 资产：初始 1500 + 破产者现金 10 - 税 10
    expect(player(t.state, "p2").money).toBe(1500 + 10 - 10);
  });
});
