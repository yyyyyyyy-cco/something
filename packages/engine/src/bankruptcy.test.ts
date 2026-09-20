import { describe, expect, it } from "vitest";
import { act, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

describe("破产清算（M3：套现窗口 → 超时破产 → 银行清算拍卖）", () => {
  it("租金付不起 → 套现窗口 → 超时破产（资产移交债权人），2 人局结束", () => {
    const state = makeGame(2);
    giveTile(state, 37, "p2");
    giveTile(state, 39, "p2"); // 深蓝组齐全 → 木板路租金 50 × 2 = 100
    giveTile(state, 6, "p1"); // p1 的资产
    setMoney(state, "p1", 10);
    place(state, "p1", 36);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 36 + 3 = 39

    // 规则规格 §13：现金不足进入套现窗口（60 秒操作；此处直接超时）
    expect(r.state.phase).toBe("CASH_WINDOW");
    expect(r.state.pendingDebt).toMatchObject({ payerId: "p1", creditor: "p2", amount: 100, resume: "completeMove" });
    expect(eventsOfType(r.events, "DEBT_OPENED")).toHaveLength(1);

    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    const bankrupt = eventsOfType(t.events, "PLAYER_BANKRUPT")[0]!;
    expect(bankrupt).toMatchObject({ playerId: "p1", creditor: "p2" });
    expect(player(t.state, "p1").bankrupt).toBe(true);

    const transferred = eventsOfType(t.events, "PROPERTY_TRANSFERRED")[0]!;
    expect(transferred).toMatchObject({ from: "p1", to: "p2", tiles: [6] });
    expect(t.state.tiles[6]!.ownerId).toBe("p2");
    expect(player(t.state, "p2").money).toBe(1500 + 10); // 债权人不获得租金（无法支付），获得全部现金

    expect(t.state.phase).toBe("ENDED");
    expect(t.state.winnerId).toBe("p2");
    expect(eventsOfType(t.events, "GAME_ENDED")[0]!.winnerId).toBe("p2");
  });

  it("税金付不起 → 超时破产（3 人局：银行清算地产进入无底价拍卖队列）", () => {
    const state = makeGame(3); // ≥3 人：破产后对局继续，银行清算触发逐块拍卖
    giveTile(state, 6, "p1");
    setMoney(state, "p1", 150);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 3])); // → 4 所得税 $200

    expect(r.state.phase).toBe("CASH_WINDOW");
    expect(r.state.pendingDebt).toMatchObject({ payerId: "p1", creditor: "bank", amount: 200 });

    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    expect(eventsOfType(t.events, "PLAYER_BANKRUPT")[0]).toMatchObject({ playerId: "p1", creditor: "bank" });
    // 规则规格 §12：银行清偿后其全部地产立即无底价拍卖
    const started = eventsOfType(t.events, "AUCTION_STARTED")[0]!;
    expect(started).toMatchObject({ tile: 6, cause: "bankruptcy" });
    expect(t.state.phase).toBe("AUCTION");
    expect(t.state.tiles[6]!.ownerId).toBeNull();
    expect(t.state.auction?.tileIndex).toBe(6);
  });

  it("税金付不起且拍卖关闭房规：地产回流无主，2 人局结束", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    giveTile(state, 6, "p1");
    setMoney(state, "p1", 150);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 3]));
    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    expect(t.state.tiles[6]!.ownerId).toBeNull();
    expect(t.state.phase).toBe("ENDED");
    expect(t.state.winnerId).toBe("p2");
  });

  it("破产玩家的出狱许可证按其来源牌堆归还", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    state.decks.chest = state.decks.chest.filter((id) => id !== "chest-5"); // 牌堆中的该卡已由玩家持有
    player(state, "p1").getOutOfJailCards.push("chest");
    setMoney(state, "p1", 10);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 3])); // 所得税 $200 → 套现窗口
    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    expect(player(t.state, "p1").getOutOfJailCards).toEqual([]);
    expect(t.state.decks.chest).toHaveLength(16);
    expect(t.state.decks.chest[15]).toBe("chest-5");
  });

  it("破产清算回收建筑（房屋与旅馆退回银行库存）", () => {
    const state = makeGame(3, { settings: { auctionEnabled: false } });
    giveTile(state, 1, "p1");
    giveTile(state, 3, "p1");
    state.tiles[1]!.houses = 2;
    state.tiles[3]!.hotel = true;
    const housesBefore = state.bank.housesLeft;
    const hotelsBefore = state.bank.hotelsLeft;
    setMoney(state, "p1", 10);
    place(state, "p1", 0);

    const r = roll(state, "p1", scriptedRng([1, 3])); // 所得税 $200 → 套现窗口
    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    expect(player(t.state, "p1").bankrupt).toBe(true);
    expect(t.state.bank.housesLeft).toBe(housesBefore + 2);
    expect(t.state.bank.hotelsLeft).toBe(hotelsBefore + 1);
    expect(t.state.tiles[1]!.houses).toBe(0);
    expect(t.state.tiles[3]!.hotel).toBe(false);
  });

  it("3 人局破产后回合跳过破产玩家，对局继续", () => {
    const state = makeGame(3);
    player(state, "p2").bankrupt = true; // 布置：p2 已破产
    place(state, "p1", 15);

    const r = roll(state, "p1", scriptedRng([2, 3])); // → 20 免费停车

    expect(eventsOfType(r.events, "TURN_ENDED")[0]!.nextPlayerId).toBe("p3");
    expect(r.state.currentPlayerId).toBe("p3");
    expect(r.state.phase).toBe("AWAITING_ROLL");
  });
});
