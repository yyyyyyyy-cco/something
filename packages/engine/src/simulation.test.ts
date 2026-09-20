import { describe, expect, it } from "vitest";
import { BOARD_TILES, JAIL_BAIL } from "@monopoly/shared";
import type { Action, GameState, TileState } from "@monopoly/shared";
import { applyAction, canBuildHouse, seededRng } from "./index.js";
import type { Rng } from "./index.js";
import { makeGame } from "./test-utils.js";

/**
 * 自动对局模拟（M3 完整规则）。
 *
 * 策略：能买就买；现金充裕时建房（提升租金压力）；狱中优先用卡，其次保释；
 * 拍卖按地产价 80% 为上限保守出价；套现窗口先卖房后抵押，无资产可变现则超时破产。
 *
 * 历史备忘：P0 规则（无建筑、无拍卖）下对局可能长时间不收敛（每圈 $200 工资 > 租金支出）。
 * M3 引入建筑/拍卖/套现后，本测试验证对局能够在有限步数内分出胜负。
 */
function actSim(prev: GameState, action: Action, rng: Rng): GameState {
  const r = applyAction(prev, action, rng);
  if (!r.ok) throw new Error(`模拟动作失败: ${r.error.code} ${r.error.message}`);
  return r.state;
}

const level = (ts: TileState): number => (ts.hotel ? 5 : ts.houses);

/** 套现动作选择：先卖组内最多的房，再抵押担保值最高的未抵押地 */
function chooseCashRaise(state: GameState, playerId: string): Action | null {
  const owned = state.tiles.filter((t) => t.ownerId === playerId);

  for (const ts of owned) {
    if (ts.hotel || ts.houses > 0) {
      const group = BOARD_TILES[ts.index]!.colorGroup!;
      const levels = BOARD_TILES.filter((t) => t.colorGroup === group).map((t) => level(state.tiles[t.index]!));
      if (level(ts) === Math.max(...levels)) {
        return { type: "SELL_HOUSE", playerId, tile: ts.index };
      }
    }
  }

  const mortgagable = owned
    .filter((t) => !t.mortgaged && t.houses === 0 && !t.hotel && !state.listings.some((l) => l.tile === t.index))
    .sort((a, b) => (BOARD_TILES[b.index]!.mortgageValue ?? 0) - (BOARD_TILES[a.index]!.mortgageValue ?? 0));
  const pick = mortgagable[0];
  return pick ? { type: "MORTGAGE", playerId, tile: pick.index } : null;
}

/** 掷骰前建房（保留 $400 现金缓冲，优先建最便宜的可用地） */
function chooseBuild(state: GameState, playerId: string): Action | null {
  const p = state.players.find((x) => x.id === playerId)!;
  if (p.money < 400) return null;
  const options = state.tiles
    .filter((t) => t.ownerId === playerId && BOARD_TILES[t.index]!.kind === "property")
    .filter((t) => canBuildHouse(state, playerId, t.index) === null)
    .sort((a, b) => (BOARD_TILES[a.index]!.houseCost ?? 0) - (BOARD_TILES[b.index]!.houseCost ?? 0));
  const pick = options[0];
  if (!pick) return null;
  const cost = BOARD_TILES[pick.index]!.houseCost ?? 0;
  return p.money >= cost + 200 ? { type: "BUILD_HOUSE", playerId, tile: pick.index } : null;
}

function stepOnce(prev: GameState, rng: Rng): GameState {
  const pid = prev.currentPlayerId;
  const p = prev.players.find((x) => x.id === pid)!;

  if (prev.phase === "AWAITING_ACTION") {
    const tile = prev.pendingPurchase!;
    const price = BOARD_TILES[tile.tileIndex]!.price ?? 0;
    return p.money >= price
      ? actSim(prev, { type: "BUY_PROPERTY", playerId: pid }, rng)
      : actSim(prev, { type: "DECLINE_PURCHASE", playerId: pid }, rng);
  }

  if (prev.phase === "AUCTION") {
    const waiting = prev.auction!.queue[0]!;
    const wp = prev.players.find((x) => x.id === waiting)!;
    const price = BOARD_TILES[prev.auction!.tileIndex]!.price ?? 0;
    const cap = Math.min(wp.money, Math.floor(price * 0.8));
    const minBid = (prev.auction!.highBid ?? 0) + 1;
    if (minBid <= cap) {
      const bid = Math.min(cap, Math.max(minBid, Math.round(price * 0.5)));
      return actSim(prev, { type: "BID", playerId: waiting, amount: bid }, rng);
    }
    return actSim(prev, { type: "PASS_BID", playerId: waiting }, rng);
  }

  if (prev.phase === "CASH_WINDOW") {
    const debt = prev.pendingDebt!;
    const payer = prev.players.find((x) => x.id === debt.payerId)!;
    if (payer.money >= debt.amount) {
      return actSim(prev, { type: "CASH_TIMEOUT", playerId: payer.id }, rng); // 竞态兜底：结算
    }
    const raise = chooseCashRaise(prev, payer.id);
    if (raise) return actSim(prev, raise, rng);
    return actSim(prev, { type: "CASH_TIMEOUT", playerId: payer.id }, rng);
  }

  const build = chooseBuild(prev, pid);
  if (build) return actSim(prev, build, rng);

  if (p.inJail && p.getOutOfJailCards.length > 0) {
    return actSim(prev, { type: "USE_JAIL_CARD", playerId: pid }, rng);
  }
  if (p.inJail && p.money >= JAIL_BAIL) {
    return actSim(prev, { type: "PAY_BAIL", playerId: pid }, rng);
  }
  return actSim(prev, { type: "ROLL_DICE", playerId: pid }, rng);
}

function assertInvariants(state: GameState): void {
  expect(["AWAITING_ROLL", "AWAITING_ACTION", "AUCTION", "CASH_WINDOW", "ENDED"]).toContain(state.phase);
  for (const p of state.players) {
    expect(p.money).toBeGreaterThanOrEqual(0);
    expect(p.position).toBeGreaterThanOrEqual(0);
    expect(p.position).toBeLessThan(BOARD_TILES.length);
  }
  if (state.phase !== "ENDED") {
    const current = state.players.find((x) => x.id === state.currentPlayerId)!;
    expect(current.bankrupt).toBe(false); // 破产玩家不会被分配行动
  }
  if (state.phase === "AWAITING_ACTION" && state.pendingPurchase) {
    expect(state.pendingPurchase.playerId).toBe(state.currentPlayerId);
    expect(state.tiles[state.pendingPurchase.tileIndex]!.ownerId).toBeNull();
  }
  if (state.phase === "AUCTION" && state.auction) {
    expect(state.auction.queue.length).toBeGreaterThan(0);
    for (const id of state.auction.queue) {
      expect(state.players.find((x) => x.id === id)!.bankrupt).toBe(false);
    }
    if (state.auction.highBidderId) {
      const bidder = state.players.find((x) => x.id === state.auction!.highBidderId)!;
      expect(bidder.money).toBeGreaterThanOrEqual(state.auction.highBid!);
    }
  }
  if (state.phase === "CASH_WINDOW" && state.pendingDebt) {
    expect(state.pendingDebt.payerId).toBe(state.currentPlayerId); // 套现窗口的欠款人恒为当前玩家
  }
  // 交易/挂售无重复 ID；挂售地产必须无建筑
  expect(new Set(state.trades.map((o) => o.id)).size).toBe(state.trades.length);
  expect(new Set(state.listings.map((l) => l.id)).size).toBe(state.listings.length);
  for (const l of state.listings) {
    const ts = state.tiles[l.tile]!;
    expect(ts.ownerId).toBe(l.sellerId);
    expect(ts.houses + (ts.hotel ? 1 : 0)).toBe(0);
  }
  // 出狱许可证可能被玩家持有（从牌堆抽出），因此牌堆长度 15-16 均为合法
  expect(state.decks.chance.length).toBeGreaterThanOrEqual(15);
  expect(state.decks.chest.length).toBeGreaterThanOrEqual(15);
  expect(state.tiles.filter((t) => t.ownerId !== null).length).toBeLessThanOrEqual(28);
  expect(state.bank.housesLeft).toBeGreaterThanOrEqual(0);
  expect(state.bank.hotelsLeft).toBeGreaterThanOrEqual(0);
}

describe("自动对局模拟（M3 完整规则）", () => {
  it("多种子 × 2-6 人：推进不崩溃，状态不变量始终成立", () => {
    const cases: Array<{ seed: number; players: number }> = [
      { seed: 1, players: 2 },
      { seed: 2, players: 3 },
      { seed: 3, players: 4 },
      { seed: 101, players: 5 },
      { seed: 102, players: 6 },
    ];

    for (const c of cases) {
      const rng = seededRng(c.seed);
      let state = makeGame(c.players);
      const baseVersion = state.version;
      let steps = 0;

      while (steps < 3000 && state.phase !== "ENDED") {
        state = stepOnce(state, rng);
        steps++;
        assertInvariants(state);
      }

      expect(state.version, `seed=${c.seed}`).toBe(baseVersion + steps);
      if (state.phase === "ENDED") {
        expect(state.winnerId).toBeTruthy();
        expect(state.players.filter((p) => !p.bankrupt)).toHaveLength(1);
      }
    }
  });

  it("M3 收敛性：2 人局多种子均能在 15000 步内分出胜负（建筑/拍卖解决 P0 不收敛）", () => {
    for (const seed of [1, 5, 106]) {
      const rng = seededRng(seed);
      let state = makeGame(2);
      let steps = 0;
      while (steps < 15000 && state.phase !== "ENDED") {
        state = stepOnce(state, rng);
        steps++;
      }
      expect(state.phase, `seed=${seed}（${steps} 步未收敛）`).toBe("ENDED");
      expect(state.winnerId).toBeTruthy();
    }
  });

  it("可复现性：同一 seed 推进 800 步，状态逐字节一致", () => {
    const run = (seed: number): GameState => {
      const rng = seededRng(seed);
      let state = makeGame(3);
      for (let i = 0; i < 800 && state.phase !== "ENDED"; i++) {
        state = stepOnce(state, rng);
      }
      return state;
    };

    const a = run(999);
    const b = run(999);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
