/**
 * applyAction 入口：校验 + 调度 + 版本递增（纯函数，不修改入参）
 * M3：拍卖 / 建筑 / 抵押 / 交易 / 套现窗口调度与权限模型
 *
 * 权限模型（规则规格 §3/§4/§11）：
 * - 回合内动作（掷骰/购买/保释/建筑/抵押/套现收尾）仅当前玩家可执行
 * - 交互动作（拍卖出价、交易发起与应答、挂售）任意玩家可执行，但仅限开放窗口
 *   （AWAITING_ROLL / CASH_WINDOW；拍卖与购买决策期间不接受交易类动作）
 */
import { JAIL_BAIL, JAIL_CARD_IDS } from "@monopoly/shared";
import type { Action, ApplyResult, EngineError, EngineErrorCode, GameEvent, GameState, PendingDebt } from "@monopoly/shared";
import { bidOnAuction, passAuction, startAuction } from "./auction.js";
import { buildOnTile, sellHouse } from "./buildings.js";
import { isCashWindowPayer, settleDebtIfPossible } from "./debt.js";
import { findPlayer, tileAt } from "./lookups.js";
import { canAfford, declareBankruptcy, transferMoney } from "./money.js";
import { mortgageTile, unmortgageTile } from "./mortgage.js";
import { rankByNetWorth } from "./networth.js";
import { finishMoveIfIdle, handleRoll, releaseFromJailForced } from "./resolve.js";
import type { Rng } from "./rng.js";
import { acceptTrade, buyListing, cancelListing, listProperty, proposeTrade, removeTrade } from "./trades.js";

/** 仅当前玩家可执行的动作（回合内动作） */
const TURN_ACTIONS = new Set<Action["type"]>([
  "ROLL_DICE",
  "BUY_PROPERTY",
  "DECLINE_PURCHASE",
  "PAY_BAIL",
  "USE_JAIL_CARD",
  "BUILD_HOUSE",
  "SELL_HOUSE",
  "MORTGAGE",
  "UNMORTGAGE",
  "DECLARE_BANKRUPTCY",
  "CASH_TIMEOUT",
]);

/** 任意玩家可执行的交互动作（仅限开放窗口） */
const OPEN_WINDOW_ACTIONS = new Set<Action["type"]>([
  "PROPOSE_TRADE",
  "ACCEPT_TRADE",
  "REJECT_TRADE",
  "CANCEL_TRADE",
  "LIST_PROPERTY",
  "CANCEL_LISTING",
  "BUY_LISTING",
]);

function errE(code: EngineErrorCode, message: string): EngineError {
  return { code, message };
}

/**
 * 应用一个动作，返回新状态与产生的事件序列。
 * 纯函数：入参 state 不会被修改；随机性由注入的 rng 提供（骰子等）。
 */
export function applyAction(state: GameState, action: Action, rng: Rng): ApplyResult {
  if (state.phase === "ENDED") return fail("GAME_ENDED", "对局已结束");

  if (TURN_ACTIONS.has(action.type) && action.playerId !== state.currentPlayerId) {
    return fail("NOT_YOUR_TURN", `当前行动玩家为 ${state.currentPlayerId}`);
  }
  if (OPEN_WINDOW_ACTIONS.has(action.type) && state.phase !== "AWAITING_ROLL" && state.phase !== "CASH_WINDOW") {
    return fail("INVALID_PHASE", "当前阶段不可发起或响应交易");
  }

  const next = structuredClone(state);
  const events: GameEvent[] = [];

  const error = dispatch(next, action, events, rng);
  if (error) return { ok: false, error };

  next.version = state.version + 1;
  return { ok: true, state: next, events };
}

function dispatch(next: GameState, action: Action, events: GameEvent[], rng: Rng): EngineError | null {
  switch (action.type) {
    // ===== 回合核心 =====
    case "ROLL_DICE": {
      if (next.phase !== "AWAITING_ROLL") return errE("INVALID_PHASE", "当前阶段不可掷骰");
      handleRoll(next, events, rng);
      return null;
    }

    case "BUY_PROPERTY": {
      if (next.phase !== "AWAITING_ACTION" || !next.pendingPurchase) {
        return errE("INVALID_ACTION", "当前没有待决的购买");
      }
      const { tileIndex } = next.pendingPurchase;
      const ts = next.tiles[tileIndex]!;
      if (ts.ownerId !== null) return errE("INVALID_ACTION", "该地产已有归属");
      const price = tileAt(tileIndex).price ?? 0;
      const player = findPlayer(next, action.playerId);
      if (!canAfford(player, price)) return errE("INSUFFICIENT_FUNDS", "现金不足，无法购买");

      transferMoney(next, events, player.id, "bank", price, "buy");
      ts.ownerId = player.id;
      events.push({ type: "PROPERTY_BOUGHT", playerId: player.id, tile: tileIndex, price });

      next.pendingPurchase = null;
      finishMoveIfIdle(next, events);
      return null;
    }

    case "DECLINE_PURCHASE": {
      if (next.phase !== "AWAITING_ACTION" || !next.pendingPurchase) {
        return errE("INVALID_ACTION", "当前没有待决的购买");
      }
      const { tileIndex } = next.pendingPurchase;
      next.pendingPurchase = null;
      events.push({ type: "PURCHASE_DECLINED", playerId: action.playerId, tile: tileIndex });

      if (next.settings.auctionEnabled) {
        startAuction(next, events, tileIndex, "decline"); // 规则规格 §4：放弃即拍卖
      } else {
        finishMoveIfIdle(next, events); // 房规关闭拍卖：放弃即流拍
      }
      return null;
    }

    case "PAY_BAIL": {
      const player = findPlayer(next, action.playerId);
      if (next.phase !== "AWAITING_ROLL" || !player.inJail) return errE("INVALID_ACTION", "当前不可保释");
      if (!canAfford(player, JAIL_BAIL)) return errE("INSUFFICIENT_FUNDS", "现金不足，无法保释");
      transferMoney(next, events, player.id, "bank", JAIL_BAIL, "bail");
      player.inJail = false;
      player.jailTurns = 0;
      events.push({ type: "PLAYER_RELEASED", playerId: player.id, method: "bail" });
      return null;
    }

    case "USE_JAIL_CARD": {
      const player = findPlayer(next, action.playerId);
      if (next.phase !== "AWAITING_ROLL" || !player.inJail) return errE("INVALID_ACTION", "当前不可使用出狱许可证");
      if (player.getOutOfJailCards.length === 0) return errE("INVALID_ACTION", "没有出狱许可证");
      const deck = player.getOutOfJailCards.shift()!;
      next.decks[deck].push(JAIL_CARD_IDS[deck]); // 使用后归还牌堆底部
      player.inJail = false;
      player.jailTurns = 0;
      events.push({ type: "PLAYER_RELEASED", playerId: player.id, method: "card" });
      return null;
    }

    // ===== M3：建筑与抵押（规则规格 §6/§7）=====
    case "BUILD_HOUSE": {
      if (next.phase !== "AWAITING_ROLL") return errE("INVALID_PHASE", "仅可在自己回合掷骰前建造");
      return buildOnTile(next, events, action.playerId, action.tile);
    }

    case "SELL_HOUSE": {
      if (next.phase !== "AWAITING_ROLL" && next.phase !== "CASH_WINDOW") {
        return errE("INVALID_PHASE", "当前阶段不可卖房");
      }
      const e = sellHouse(next, events, action.playerId, action.tile);
      if (e) return e;
      maybeSettleAndResume(next, events, rng); // 套现窗口内可能已凑足
      return null;
    }

    case "MORTGAGE": {
      if (next.phase !== "AWAITING_ROLL" && next.phase !== "CASH_WINDOW") {
        return errE("INVALID_PHASE", "当前阶段不可抵押");
      }
      const e = mortgageTile(next, events, action.playerId, action.tile);
      if (e) return e;
      maybeSettleAndResume(next, events, rng);
      return null;
    }

    case "UNMORTGAGE": {
      if (next.phase !== "AWAITING_ROLL") return errE("INVALID_PHASE", "仅可在自己回合掷骰前赎回");
      return unmortgageTile(next, events, action.playerId, action.tile);
    }

    // ===== M3：拍卖（规则规格 §4）=====
    case "BID": {
      if (next.phase !== "AUCTION") return errE("INVALID_PHASE", "当前没有进行中的拍卖");
      return bidOnAuction(next, events, action.playerId, action.amount);
    }

    case "PASS_BID": {
      if (next.phase !== "AUCTION") return errE("INVALID_PHASE", "当前没有进行中的拍卖");
      return passAuction(next, events, action.playerId, action.reason ?? "manual");
    }

    // ===== M3：交易与市场（规则规格 §11）=====
    case "PROPOSE_TRADE":
      return proposeTrade(next, events, action.playerId, action.toId, action.give, action.want);

    case "ACCEPT_TRADE": {
      const e = acceptTrade(next, events, action.playerId, action.offerId);
      if (e) return e;
      maybeSettleAndResume(next, events, rng); // 收款可能结清待决债务
      return null;
    }

    case "REJECT_TRADE": {
      const reason = action.reason === "timeout" ? ("timeout" as const) : ("rejected" as const);
      return removeTrade(next, events, action.playerId, action.offerId, reason);
    }

    case "CANCEL_TRADE":
      return removeTrade(next, events, action.playerId, action.offerId, "cancelled");

    case "LIST_PROPERTY":
      return listProperty(next, events, action.playerId, action.tile, action.price);

    case "CANCEL_LISTING":
      return cancelListing(next, events, action.playerId, action.listingId);

    case "BUY_LISTING": {
      const e = buyListing(next, events, action.playerId, action.listingId);
      if (e) return e;
      maybeSettleAndResume(next, events, rng);
      return null;
    }

    // ===== M3：套现窗口收尾（规则规格 §13）=====
    case "DECLARE_BANKRUPTCY": {
      if (!isCashWindowPayer(next, action.playerId)) return errE("INVALID_ACTION", "当前没有待处理的债务");
      const debt = next.pendingDebt!;
      next.pendingDebt = null;
      declareBankruptcy(next, events, debt.payerId, debt.creditor);
      afterBankruptcy(next, events);
      return null;
    }

    case "CASH_TIMEOUT": {
      if (!isCashWindowPayer(next, action.playerId)) return errE("INVALID_ACTION", "当前不在套现窗口");
      const debt = next.pendingDebt!;
      const settled = settleDebtIfPossible(next, events); // 竞态兜底：已凑足则正常结算
      if (settled) {
        resumeAfterDebt(next, events, settled, rng);
        return null;
      }
      next.pendingDebt = null;
      declareBankruptcy(next, events, debt.payerId, debt.creditor);
      afterBankruptcy(next, events);
      return null;
    }

    // ===== M4：限时模式到点裁决（服务端计时触发；规则规格 §14）=====
    case "TIME_UP": {
      if (next.settings.timeLimitMinutes === null) return errE("INVALID_ACTION", "本局未开启限时模式");
      const ranked = rankByNetWorth(next);
      const winner = ranked[0];
      if (!winner) return errE("INVALID_ACTION", "没有可裁决的玩家");
      next.phase = "ENDED";
      next.winnerId = winner.id;
      events.push({ type: "GAME_ENDED", winnerId: winner.id, reason: "time-up" });
      return null;
    }
  }
}

// ===== 套现窗口的结算与恢复 =====

/** 套现动作后检查：现金已足够则自动结算并恢复原流程 */
function maybeSettleAndResume(state: GameState, events: GameEvent[], rng: Rng): void {
  const settled = settleDebtIfPossible(state, events);
  if (settled) resumeAfterDebt(state, events, settled, rng);
}

/** 解除 CASH_WINDOW 锁定并恢复支付前流程（completeMove / 强制出狱移动 / payEach 后收尾） */
function resumeAfterDebt(state: GameState, events: GameEvent[], debt: PendingDebt, rng: Rng): void {
  if (state.phase === "ENDED") return;
  state.phase = "AWAITING_ROLL";
  if (debt.resume === "jailRoll") {
    releaseFromJailForced(state, events, debt.payerId, rng);
  }
  finishMoveIfIdle(state, events);
}

/** 破产清算后的流程恢复：银行清算地产进入拍卖队列则开拍，否则回合收尾 */
function afterBankruptcy(state: GameState, events: GameEvent[]): void {
  if (state.phase === "ENDED") return;
  const next = state.auctionQueue.shift();
  if (next !== undefined && state.settings.auctionEnabled) {
    startAuction(state, events, next, "bankruptcy");
    return;
  }
  finishMoveIfIdle(state, events);
}

function fail(code: EngineErrorCode, message: string): ApplyResult {
  return { ok: false, error: errE(code, message) };
}
