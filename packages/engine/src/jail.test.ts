import { describe, expect, it } from "vitest";
import { JAIL_BAIL } from "@monopoly/shared";
import type { GameState } from "@monopoly/shared";
import { act, actFail, decline, eventsOfType, makeGame, player, roll, scriptedRng, setDeck, setMoney } from "./test-utils.js";

function jailed(state: GameState, id = "p1", jailTurns = 0): GameState {
  const p = player(state, id);
  p.position = 10;
  p.inJail = true;
  p.jailTurns = jailTurns;
  return state;
}

describe("监狱循环", () => {
  it("保释：支付 $50 出狱，之后正常掷骰移动", () => {
    const state = jailed(makeGame(2));

    const b = act(state, { type: "PAY_BAIL", playerId: "p1" });
    expect(player(b.state, "p1").money).toBe(1500 - JAIL_BAIL);
    expect(player(b.state, "p1").inJail).toBe(false);
    expect(eventsOfType(b.events, "PLAYER_RELEASED")[0]!.method).toBe("bail");

    const r = roll(b.state, "p1", scriptedRng([1, 2])); // 10 + 3 = 13（州立大道，无主）
    expect(player(r.state, "p1").position).toBe(13);
    decline(r.state, "p1");
  });

  it("保释失败：现金不足", () => {
    const state = jailed(makeGame(2));
    setMoney(state, "p1", 40);

    const err = actFail(state, { type: "PAY_BAIL", playerId: "p1" });
    expect(err.code).toBe("INSUFFICIENT_FUNDS");
    expect(player(state, "p1").inJail).toBe(true); // 入参未被修改
  });

  it("未在狱中不可保释 / 不可用卡", () => {
    const state = makeGame(2);
    expect(actFail(state, { type: "PAY_BAIL", playerId: "p1" }).code).toBe("INVALID_ACTION");
    expect(actFail(state, { type: "USE_JAIL_CARD", playerId: "p1" }).code).toBe("INVALID_ACTION");
  });

  it("出狱许可证：使用后归还其来源牌堆底部", () => {
    const state = jailed(makeGame(2));
    // 合成场景：从命运牌堆取出 chest-5 交给玩家（模拟此前抽到该卡）
    setDeck(state, "chest", state.decks.chest.filter((id) => id !== "chest-5"));
    player(state, "p1").getOutOfJailCards.push("chest");

    const u = act(state, { type: "USE_JAIL_CARD", playerId: "p1" });
    expect(player(u.state, "p1").inJail).toBe(false);
    expect(player(u.state, "p1").getOutOfJailCards).toEqual([]);
    expect(u.state.decks.chest).toHaveLength(16);
    expect(u.state.decks.chest[15]).toBe("chest-5"); // 置于牌堆底部
    expect(eventsOfType(u.events, "PLAYER_RELEASED")[0]!.method).toBe("card");
  });

  it("狱中掷出双数：出狱并移动，但无额外回合", () => {
    const state = jailed(makeGame(2, { settings: { auctionEnabled: false } }));

    const r = roll(state, "p1", scriptedRng([2, 2])); // 10 + 4 = 14（弗吉尼亚大道，无主）

    expect(eventsOfType(r.events, "PLAYER_RELEASED")[0]!.method).toBe("doubles");
    expect(player(r.state, "p1").inJail).toBe(false);
    expect(player(r.state, "p1").position).toBe(14);
    const d = decline(r.state, "p1");
    expect(d.state.currentPlayerId).toBe("p2"); // 无额外回合
  });

  it("狱中未掷出双数：停留并换人（累计计数）", () => {
    const state = jailed(makeGame(2));

    const r = roll(state, "p1", scriptedRng([1, 2]));

    expect(eventsOfType(r.events, "JAIL_STAYED")[0]!.jailTurns).toBe(1);
    expect(player(r.state, "p1").inJail).toBe(true);
    expect(player(r.state, "p1").position).toBe(10);
    expect(player(r.state, "p1").jailTurns).toBe(1);
    expect(r.state.currentPlayerId).toBe("p2");
  });

  it("第三次失败：强制付 $50 出狱并按点数移动", () => {
    const state = jailed(makeGame(2), "p1", 2);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 10 + 3 = 13（州立大道，无主）

    expect(eventsOfType(r.events, "PLAYER_RELEASED")[0]!.method).toBe("forced");
    expect(player(r.state, "p1").money).toBe(1500 - JAIL_BAIL);
    expect(player(r.state, "p1").inJail).toBe(false);
    expect(player(r.state, "p1").position).toBe(13);
    decline(r.state, "p1");
  });

  it("第三次失败的强制保释款不足：进入套现窗口 → 超时破产（银行清算）", () => {
    const state = jailed(makeGame(2), "p1", 2);
    setMoney(state, "p1", 30);

    const r = roll(state, "p1", scriptedRng([1, 2]));

    // 规则规格 §13：支付义务不足 → 套现窗口（支付完成后按本点数出狱移动，resume = jailRoll）
    expect(r.state.phase).toBe("CASH_WINDOW");
    expect(r.state.pendingDebt).toMatchObject({ payerId: "p1", creditor: "bank", amount: JAIL_BAIL, resume: "jailRoll" });
    expect(player(r.state, "p1").inJail).toBe(true);

    const t = act(r.state, { type: "CASH_TIMEOUT", playerId: "p1" });

    const bankrupt = eventsOfType(t.events, "PLAYER_BANKRUPT")[0]!;
    expect(bankrupt).toMatchObject({ playerId: "p1", creditor: "bank" });
    expect(t.state.phase).toBe("ENDED"); // 2 人局 → 直接结束
    expect(t.state.winnerId).toBe("p2");
  });
});
