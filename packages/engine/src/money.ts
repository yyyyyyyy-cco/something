/**
 * 资金流转与破产清算（规则规格 §12，M3 完整口径）
 * - creditor 为玩家：全部资产移交债主；抵押地移交时债主支付 10% 交易税
 * - creditor 为银行："银行清偿后其全部地产立即无底价拍卖"（auctionEnabled 时逐块进入队列）
 * - 建筑在清算时按银行回收处理（房屋/旅馆退回库存，不折算现金——本项目裁决）
 */
import { JAIL_CARD_IDS } from "@monopoly/shared";
import type { GameEvent, GameState, MoneyReason, PlayerState } from "@monopoly/shared";
import { alivePlayers, findPlayer, ownedTileIndexes, tileAt } from "./lookups.js";
import { chargeMortgageTransferTax } from "./mortgage.js";

export function canAfford(player: PlayerState, amount: number): boolean {
  return player.money >= amount;
}

/**
 * 资金转移（from/to 为玩家 id 或 "bank"）。
 * 前置：调用方已保证付款方资金充足（不足请走 declareBankruptcy）。
 */
export function transferMoney(
  state: GameState,
  events: GameEvent[],
  from: string | "bank",
  to: string | "bank",
  amount: number,
  reason: MoneyReason,
): void {
  if (amount <= 0) return;
  if (from !== "bank") findPlayer(state, from).money -= amount;
  if (to !== "bank") findPlayer(state, to).money += amount;
  events.push({ type: "MONEY_TRANSFERRED", from, to, amount, reason });
}

/** 尝试付款：足额则转移并返回 true；不足返回 false（无副作用） */
export function tryPay(
  state: GameState,
  events: GameEvent[],
  fromId: string,
  to: string | "bank",
  amount: number,
  reason: MoneyReason,
): boolean {
  const payer = findPlayer(state, fromId);
  if (!canAfford(payer, amount)) return false;
  transferMoney(state, events, fromId, to, amount, reason);
  return true;
}

/**
 * 宣告破产并完成清算：
 * - 建筑回收（房屋/旅馆退回银行库存）
 * - creditor 为玩家：现金 + 全部地产（含抵押，债主付 10% 交易税）+ 出狱卡移交
 * - creditor 为银行：无主地产在拍卖开启时逐块进入 auctionQueue（抵押状态清除，银行清洁拍卖）
 * 破产玩家的出狱许可证按其来源牌堆归还（置于牌堆底部）。
 * 清算后若仅剩 1 名存活玩家，则对局结束。
 */
export function declareBankruptcy(
  state: GameState,
  events: GameEvent[],
  playerId: string,
  creditor: string | "bank",
): void {
  const player = findPlayer(state, playerId);
  if (player.bankrupt) return;
  player.bankrupt = true;

  // 现金
  if (player.money > 0) {
    transferMoney(state, events, playerId, creditor, player.money, "bankruptcy");
  }

  // 建筑回收（简化裁决：不折算现金，直接退回银行库存）
  for (const i of ownedTileIndexes(state, playerId)) {
    const ts = state.tiles[i]!;
    if (ts.hotel) {
      ts.hotel = false;
      if (state.settings.housingLimited) state.bank.hotelsLeft += 1;
    }
    if (ts.houses > 0) {
      if (state.settings.housingLimited) state.bank.housesLeft += ts.houses;
      ts.houses = 0;
    }
  }

  // 地产
  const tiles = ownedTileIndexes(state, playerId);
  if (tiles.length > 0) {
    if (creditor === "bank") {
      if (state.settings.auctionEnabled) {
        // 银行清算：逐块无底价拍卖（抵押状态清除）
        for (const i of tiles) {
          state.tiles[i]!.mortgaged = false;
          state.tiles[i]!.ownerId = null;
          state.auctionQueue.push(i);
        }
        events.push({ type: "PROPERTY_TRANSFERRED", from: playerId, to: "bank", tiles });
      } else {
        for (const i of tiles) {
          state.tiles[i]!.mortgaged = false;
          state.tiles[i]!.ownerId = null;
        }
        events.push({ type: "PROPERTY_TRANSFERRED", from: playerId, to: "bank", tiles });
      }
    } else {
      for (const i of tiles) {
        state.tiles[i]!.ownerId = creditor;
      }
      events.push({ type: "PROPERTY_TRANSFERRED", from: playerId, to: creditor, tiles });
      // 抵押地移交：债主立即支付抵押值 10% 交易税（现金不足时部分支付）
      chargeMortgageTransferTax(state, events, creditor, tiles);
    }
  }

  // 出狱卡归还牌堆
  for (const deck of player.getOutOfJailCards) {
    state.decks[deck].push(JAIL_CARD_IDS[deck]);
  }
  player.getOutOfJailCards = [];

  // 清理破产者相关的交易与挂售（静默；破产事件已说明上下文）
  state.trades = state.trades.filter((o) => o.fromId !== playerId && o.toId !== playerId);
  state.listings = state.listings.filter((l) => l.sellerId !== playerId);

  events.push({ type: "PLAYER_BANKRUPT", playerId, creditor });

  // 胜负判定
  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    state.phase = "ENDED";
    const winner = alive[0];
    if (winner) {
      state.winnerId = winner.id;
      events.push({ type: "GAME_ENDED", winnerId: winner.id, reason: "last-standing" });
    }
  }
}

/** 银行清算的待拍卖地产数量（服务端/客户端提示用） */
export function pendingAuctionCount(state: GameState): number {
  return state.auctionQueue.length;
}

/** 地块名称（防御越界；日志用） */
export function tileName(tileIndex: number): string {
  return tileAt(tileIndex).name;
}
