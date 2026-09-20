/**
 * 拍卖（规则规格 §4）
 * - 触发：放弃购买（decline）/ 银行清算（bankruptcy 逐块拍卖队列）
 * - 形式：公开递增出价（queue 轮转询问；出价后回到队尾）
 * - 结束：仅剩最高出价者 → 成交；全部放弃 → 流拍
 * - 超时：服务端 30 秒无人加价时以 PASS_BID(reason=timeout) 驱动裁决
 */
import type { EngineError, GameEvent, GameState } from "@monopoly/shared";
import { findPlayer, tileAt } from "./lookups.js";
import { transferMoney } from "./money.js";
import { finishMoveIfIdle } from "./resolve.js";

function err(message: string): EngineError {
  return { code: "INVALID_ACTION", message };
}

/** 从玩家 id 列表构造轮转队列（从 startId 开始；找不到则按原顺序） */
function rotateFrom(ids: string[], startId: string): string[] {
  const idx = ids.indexOf(startId);
  if (idx <= 0) return [...ids];
  return [...ids.slice(idx), ...ids.slice(0, idx)];
}

/** 开启一场拍卖（decline：从放弃者开始；bankruptcy：从当前存活玩家顺序开始） */
export function startAuction(state: GameState, events: GameEvent[], tileIndex: number, cause: "decline" | "bankruptcy"): void {
  const bidders = state.players.filter((p) => !p.bankrupt).map((p) => p.id);
  const queue = rotateFrom(bidders, state.currentPlayerId);
  state.auction = {
    tileIndex,
    highBid: null,
    highBidderId: null,
    queue,
    cause,
  };
  state.phase = "AUCTION";
  events.push({ type: "AUCTION_STARTED", tile: tileIndex, cause });
  advanceAuction(state, events);
}

/** 出价（仅限轮到的玩家；金额须高于当前最高价且不超过现金） */
export function bidOnAuction(state: GameState, events: GameEvent[], playerId: string, amount: number): EngineError | null {
  const auction = state.auction;
  if (state.phase !== "AUCTION" || !auction) return err("当前没有进行中的拍卖");
  if (auction.queue[0] !== playerId) return err("尚未轮到你出价");

  const min = (auction.highBid ?? 0) + 1;
  if (!Number.isInteger(amount) || amount < min) return err(`出价须为整数且不低于 $${min}`);
  const player = findPlayer(state, playerId);
  if (amount > player.money) return { code: "INSUFFICIENT_FUNDS", message: "出价不能超过现有现金" };

  auction.highBid = amount;
  auction.highBidderId = playerId;
  // 出价者移到队尾，其余玩家继续被询问（新一轮加价）
  auction.queue = [...auction.queue.slice(1), playerId];
  events.push({ type: "AUCTION_BID", playerId, amount });
  advanceAuction(state, events);
  return null;
}

/** 放弃出价（manual / timeout） */
export function passAuction(state: GameState, events: GameEvent[], playerId: string, reason: "manual" | "timeout"): EngineError | null {
  const auction = state.auction;
  if (state.phase !== "AUCTION" || !auction) return err("当前没有进行中的拍卖");
  if (auction.queue[0] !== playerId) return err("尚未轮到该玩家");

  auction.queue = auction.queue.slice(1);
  events.push({ type: "AUCTION_PASSED", playerId, reason });
  advanceAuction(state, events);
  return null;
}

/** 结束判定：仅剩最高出价者成交 / 队列清空流拍（无人出价时出价者不在队列里，故队列空必为流拍） */
function advanceAuction(state: GameState, events: GameEvent[]): void {
  const auction = state.auction;
  if (!auction) return;

  if (auction.queue.length === 1 && auction.queue[0] === auction.highBidderId) {
    endAuction(state, events, auction.highBidderId);
    return;
  }
  if (auction.queue.length === 0) {
    endAuction(state, events, null);
  }
  // 其余情况：等待 queue[0] 出价或放弃（服务端超时驱动）
}

function endAuction(state: GameState, events: GameEvent[], winnerId: string | null): void {
  const auction = state.auction;
  if (!auction) return;
  const { tileIndex, highBid } = auction;

  if (winnerId !== null) {
    // 出价时已校验现金额度（拍卖期间该玩家无法执行其他消费），此处必然可付
    transferMoney(state, events, winnerId, "bank", highBid ?? 0, "auction");
    state.tiles[tileIndex]!.ownerId = winnerId;
  }
  events.push({ type: "AUCTION_ENDED", tile: tileIndex, winnerId, amount: winnerId !== null ? highBid : null });
  state.auction = null;

  // 银行清算队列：逐块连续拍卖
  const next = state.auctionQueue.shift();
  if (next !== undefined) {
    startAuction(state, events, next, "bankruptcy");
    return;
  }

  finishMoveIfIdle(state, events);
}

/** 当前等待出价的玩家（无拍卖时为 null；服务端计时用） */
export function auctionWaitingOn(state: GameState): string | null {
  return state.auction?.queue[0] ?? null;
}

/** 拍卖标的名称（日志/提示用；越界防御） */
export function auctionTileName(state: GameState): string {
  const idx = state.auction?.tileIndex;
  return idx === undefined ? "" : tileAt(idx).name;
}
