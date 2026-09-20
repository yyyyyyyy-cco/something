/**
 * 抵押与赎回（规则规格 §7）
 * - 抵押：无建筑地产向银行换取半价现金；抵押期间不收租
 * - 赎回：支付 抵押值 + 10% 利息（向上取整）
 * - 抵押地交易：接收方支付抵押值 10% 交易税（向上取整）
 */
import type { EngineError, GameEvent, GameState } from "@monopoly/shared";
import { findPlayer, mortgageInterestOf, mortgageValueOf, tileAt } from "./lookups.js";
import { transferMoney } from "./money.js";

function err(message: string): EngineError {
  return { code: "INVALID_ACTION", message };
}

/** 抵押前置：本人持有、无建筑、未抵押、无挂售（挂售中的地需先撤回） */
export function mortgageTile(state: GameState, events: GameEvent[], playerId: string, tileIndex: number): EngineError | null {
  const tile = tileAt(tileIndex);
  const ts = state.tiles[tileIndex]!;
  if (tile.kind !== "property" && tile.kind !== "railroad" && tile.kind !== "utility") {
    return err("该地块不可抵押");
  }
  if (ts.ownerId !== playerId) return err("不是你的地产");
  if (ts.mortgaged) return err("该地产已处于抵押状态");
  if (ts.houses > 0 || ts.hotel) return err("有建筑的地产不可抵押（请先卖房）");
  if (state.listings.some((l) => l.tile === tileIndex)) return err("挂售中的地产不可抵押（请先撤回挂售）");

  const amount = mortgageValueOf(tile);
  transferMoney(state, events, "bank", playerId, amount, "mortgage");
  ts.mortgaged = true;
  events.push({ type: "PROPERTY_MORTGAGED", playerId, tile: tileIndex, amount });
  return null;
}

/** 赎回：支付抵押值 + 10% 利息（向上取整到 $1） */
export function unmortgageTile(state: GameState, events: GameEvent[], playerId: string, tileIndex: number): EngineError | null {
  const tile = tileAt(tileIndex);
  const ts = state.tiles[tileIndex]!;
  if (ts.ownerId !== playerId) return err("不是你的地产");
  if (!ts.mortgaged) return err("该地产未处于抵押状态");

  const cost = mortgageValueOf(tile) + mortgageInterestOf(tile);
  const player = findPlayer(state, playerId);
  if (player.money < cost) return { code: "INSUFFICIENT_FUNDS", message: "现金不足，无法赎回" };

  transferMoney(state, events, playerId, "bank", cost, "unmortgage");
  ts.mortgaged = false;
  events.push({ type: "PROPERTY_UNMORTGAGED", playerId, tile: tileIndex, cost });
  return null;
}

/**
 * 抵押地产过户税：接收方为每块抵押地支付抵押值 10%（向上取整）。
 * 用于交易接受 / 挂售买断 / 破产移交；返回总税额并完成扣款（不足则按现有现金部分支付）。
 */
export function chargeMortgageTransferTax(
  state: GameState,
  events: GameEvent[],
  receiverId: string,
  tiles: number[],
): number {
  const mortgaged = tiles.filter((i) => state.tiles[i]!.mortgaged);
  if (mortgaged.length === 0) return 0;
  const tax = mortgaged.reduce((sum, i) => sum + mortgageInterestOf(tileAt(i)), 0);
  const receiver = findPlayer(state, receiverId);
  const paid = Math.min(receiver.money, tax);
  if (paid > 0) {
    transferMoney(state, events, receiverId, "bank", paid, "trade-tax");
  }
  return paid;
}
