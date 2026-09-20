import { describe, expect, it } from "vitest";
import type { GameState } from "@monopoly/shared";
import { act, decline, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney, topCard } from "./test-utils.js";
import type { ActResult } from "./test-utils.js";
import type { DiceRoll } from "./rng.js";

/** 落到机会格（tile 7）：p1 置于 4，掷 [1,2] → 7 */
function drawChance(state: GameState, cardId: string, extraRolls: DiceRoll[] = []): ActResult {
  topCard(state, "chance", cardId);
  place(state, "p1", 4);
  return roll(state, "p1", scriptedRng([1, 2], ...extraRolls));
}

/** 落到命运格（tile 2）：p1 置于 39，掷 [1,2] → 环绕至 2（含工资 +200） */
function drawChest(state: GameState, cardId: string, extraRolls: DiceRoll[] = []): ActResult {
  topCard(state, "chest", cardId);
  place(state, "p1", 39);
  return roll(state, "p1", scriptedRng([1, 2], ...extraRolls));
}

describe("机会卡（16 张）", () => {
  it("chance-1 前往起点：工资只发一次", () => {
    const r = drawChance(makeGame(2), "chance-1");
    expect(player(r.state, "p1").position).toBe(0);
    expect(player(r.state, "p1").money).toBe(1700);
    expect(eventsOfType(r.events, "MONEY_TRANSFERRED").filter((e) => e.reason === "salary")).toHaveLength(1);
  });

  it("chance-2 前往伊利诺伊大道（未经过 GO，无工资；进入购买决策）", () => {
    const r = drawChance(makeGame(2), "chance-2");
    expect(player(r.state, "p1").position).toBe(24);
    expect(player(r.state, "p1").money).toBe(1500);
    expect(r.state.pendingPurchase?.tileIndex).toBe(24);
    decline(r.state, "p1");
  });

  it("chance-3 前往圣查尔斯广场", () => {
    const r = drawChance(makeGame(2), "chance-3");
    expect(player(r.state, "p1").position).toBe(11);
    expect(r.state.pendingPurchase?.tileIndex).toBe(11);
  });

  it("chance-4 前往最近公用事业：无主 → 可购买", () => {
    const r = drawChance(makeGame(2), "chance-4");
    expect(player(r.state, "p1").position).toBe(12);
    expect(r.state.pendingPurchase?.tileIndex).toBe(12);
  });

  it("chance-4 公用事业已被他人持有：重新掷骰并按点数 ×10 支付", () => {
    const state = makeGame(2);
    giveTile(state, 12, "p2");
    const r = drawChance(state, "chance-4", [[3, 4]]); // 卡牌额外掷骰 7

    const rent = eventsOfType(r.events, "RENT_PAID")[0]!;
    expect(rent).toMatchObject({ from: "p1", to: "p2", tile: 12, amount: 70 });
    expect(eventsOfType(r.events, "DICE_ROLLED").some((e) => e.reason === "utility-card")).toBe(true);
  });

  it("chance-5 最近车站：无主 → 可购买（落格统一规则）", () => {
    const r = drawChance(makeGame(2), "chance-5");
    expect(player(r.state, "p1").position).toBe(15);
    expect(r.state.pendingPurchase?.tileIndex).toBe(15);
  });

  it("chance-5 车站已被持有：支付双倍租金", () => {
    const state = makeGame(2);
    giveTile(state, 15, "p2"); // 持有 1 座 → 基础 25，双倍 50
    const r = drawChance(state, "chance-5");

    expect(eventsOfType(r.events, "RENT_PAID")[0]!.amount).toBe(50);
  });

  it("chance-6 与 chance-5 效果一致", () => {
    const state = makeGame(2);
    giveTile(state, 15, "p2");
    const r = drawChance(state, "chance-6");
    expect(eventsOfType(r.events, "RENT_PAID")[0]!.amount).toBe(50);
  });

  it("chance-7 银行股息 $50", () => {
    const r = drawChance(makeGame(2), "chance-7");
    expect(player(r.state, "p1").money).toBe(1550);
    expect(eventsOfType(r.events, "MONEY_TRANSFERRED")[0]).toMatchObject({ from: "bank", amount: 50, reason: "card-gain" });
  });

  it("chance-8 出狱许可证：由玩家保留（不进牌堆底）", () => {
    const r = drawChance(makeGame(2), "chance-8");
    expect(player(r.state, "p1").getOutOfJailCards).toEqual(["chance"]);
    expect(r.state.decks.chance).toHaveLength(15);
    expect(r.state.decks.chance).not.toContain("chance-8");
  });

  it("chance-9 后退三格（7 → 4 所得税）", () => {
    const r = drawChance(makeGame(2), "chance-9");
    expect(player(r.state, "p1").position).toBe(4);
    expect(player(r.state, "p1").money).toBe(1300); // 税金 $200
  });

  it("chance-10 立即入狱", () => {
    const r = drawChance(makeGame(2), "chance-10");
    expect(player(r.state, "p1").inJail).toBe(true);
    expect(player(r.state, "p1").position).toBe(10);
    expect(r.state.currentPlayerId).toBe("p2");
  });

  it("chance-11 房屋大修：P0 无建筑，金额为 0", () => {
    const r = drawChance(makeGame(2), "chance-11");
    expect(player(r.state, "p1").money).toBe(1500);
  });

  it("chance-12 超速罚款 $15（并回牌堆底）", () => {
    const r = drawChance(makeGame(2), "chance-12");
    expect(player(r.state, "p1").money).toBe(1485);
    expect(r.state.decks.chance[15]).toBe("chance-12"); // 放回牌堆底部
  });

  it("chance-13 前往雷丁铁路：环绕经过 GO 领 $200", () => {
    const r = drawChance(makeGame(2), "chance-13");
    expect(player(r.state, "p1").money).toBe(1700);
    expect(player(r.state, "p1").position).toBe(5);
    expect(r.state.pendingPurchase?.tileIndex).toBe(5);
  });

  it("chance-14 支付每位玩家 $50", () => {
    const r = drawChance(makeGame(2), "chance-14");
    expect(player(r.state, "p1").money).toBe(1450);
    expect(player(r.state, "p2").money).toBe(1550);
  });

  it("chance-15 建筑贷款到期收取 $150", () => {
    const r = drawChance(makeGame(2), "chance-15");
    expect(player(r.state, "p1").money).toBe(1650);
  });

  it("chance-16 前往木板路（未经过 GO，无工资）", () => {
    const r = drawChance(makeGame(2), "chance-16");
    expect(player(r.state, "p1").money).toBe(1500);
    expect(player(r.state, "p1").position).toBe(39);
    expect(r.state.pendingPurchase?.tileIndex).toBe(39);
  });
});

describe("命运卡（16 张）", () => {
  // 注：drawChest 的移动本身环绕经过 GO，基线工资 +200（即 1700）
  it("chest-1 前往起点：工资只发一次", () => {
    const r = drawChest(makeGame(2), "chest-1");
    expect(player(r.state, "p1").position).toBe(0);
    expect(player(r.state, "p1").money).toBe(1900); // 移动工资 + 卡牌移动工资各一次
    expect(eventsOfType(r.events, "MONEY_TRANSFERRED").filter((e) => e.reason === "salary")).toHaveLength(2);
  });

  it("chest-2 银行结算有误 +$200", () => {
    const r = drawChest(makeGame(2), "chest-2");
    expect(player(r.state, "p1").money).toBe(1900);
  });

  it("chest-3 医疗费用 -$50", () => {
    const r = drawChest(makeGame(2), "chest-3");
    expect(player(r.state, "p1").money).toBe(1650);
  });

  it("chest-4 股票出售所得 +$50", () => {
    const r = drawChest(makeGame(2), "chest-4");
    expect(player(r.state, "p1").money).toBe(1750);
  });

  it("chest-5 出狱许可证：玩家保留", () => {
    const r = drawChest(makeGame(2), "chest-5");
    expect(player(r.state, "p1").getOutOfJailCards).toEqual(["chest"]);
    expect(r.state.decks.chest).toHaveLength(15);
  });

  it("chest-6 立即入狱", () => {
    const r = drawChest(makeGame(2), "chest-6");
    expect(player(r.state, "p1").inJail).toBe(true);
    expect(player(r.state, "p1").position).toBe(10);
  });

  it("chest-7 大歌剧之夜：每位玩家支付 $50", () => {
    const r = drawChest(makeGame(2), "chest-7");
    expect(player(r.state, "p1").money).toBe(1750);
    expect(player(r.state, "p2").money).toBe(1450);
  });

  it("chest-8 假日基金 +$100", () => {
    const r = drawChest(makeGame(2), "chest-8");
    expect(player(r.state, "p1").money).toBe(1800);
  });

  it("chest-9 所得税退税 +$20", () => {
    const r = drawChest(makeGame(2), "chest-9");
    expect(player(r.state, "p1").money).toBe(1720);
  });

  it("chest-10 生日：每位玩家支付 $10", () => {
    const r = drawChest(makeGame(2), "chest-10");
    expect(player(r.state, "p1").money).toBe(1710);
    expect(player(r.state, "p2").money).toBe(1490);
  });

  it("chest-11 人寿保险 +$100", () => {
    const r = drawChest(makeGame(2), "chest-11");
    expect(player(r.state, "p1").money).toBe(1800);
  });

  it("chest-12 住院费用 -$100", () => {
    const r = drawChest(makeGame(2), "chest-12");
    expect(player(r.state, "p1").money).toBe(1600);
  });

  it("chest-13 学费 -$50", () => {
    const r = drawChest(makeGame(2), "chest-13");
    expect(player(r.state, "p1").money).toBe(1650);
  });

  it("chest-14 咨询费 +$25", () => {
    const r = drawChest(makeGame(2), "chest-14");
    expect(player(r.state, "p1").money).toBe(1725);
  });

  it("chest-15 街道维修：P0 无建筑，金额为 0", () => {
    const r = drawChest(makeGame(2), "chest-15");
    expect(player(r.state, "p1").money).toBe(1700);
  });

  it("chest-16 选美二等奖 +$10", () => {
    const r = drawChest(makeGame(2), "chest-16");
    expect(player(r.state, "p1").money).toBe(1710);
  });
});

describe("卡牌边界：批量支付与无力支付", () => {
  it("chance-14 总支付不足：进入套现窗口（银行代收代付）→ 超时破产", () => {
    const state = makeGame(3);
    setMoney(state, "p1", 60); // 应付 50 × 2 = 100，不足
    const r = drawChance(state, "chance-14");

    // 规则规格 §13：现金不足进入套现窗口；多人清偿由银行经手（resume = payEach）
    expect(r.state.phase).toBe("CASH_WINDOW");
    expect(r.state.pendingDebt).toMatchObject({ payerId: "p1", creditor: "bank", amount: 100, resume: "payEach" });
    expect(r.state.pendingDebt?.payees).toEqual([
      { id: "p2", amount: 50 },
      { id: "p3", amount: 50 },
    ]);

    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    const bankrupt = eventsOfType(t.events, "PLAYER_BANKRUPT")[0]!;
    expect(bankrupt).toMatchObject({ playerId: "p1", creditor: "bank" });
    expect(t.state.phase).not.toBe("ENDED");
    expect(t.state.currentPlayerId).toBe("p2");
  });

  it("chest-7 其他玩家无力支付：破产并移交资产给收租者", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p2");
    setMoney(state, "p2", 30);
    const r = drawChest(state, "chest-7");

    const bankrupt = eventsOfType(r.events, "PLAYER_BANKRUPT")[0]!;
    expect(bankrupt).toMatchObject({ playerId: "p2", creditor: "p1" });
    expect(player(r.state, "p1").money).toBe(1700 + 30); // 工资 + 破产移交现金（地产亦移交）
    expect(r.state.tiles[1]!.ownerId).toBe("p1");
    expect(r.state.phase).toBe("ENDED");
    expect(r.state.winnerId).toBe("p1");
  });
});
