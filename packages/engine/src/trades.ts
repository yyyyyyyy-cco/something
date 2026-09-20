/**
 * 玩家交易（规则规格 §11）
 * - 私有报价：给与/索取清单（现金 + 无建筑地产 + 出狱许可证），60 秒限时应答（服务端驱动超时）
 * - 开放市场：挂售（可撤回）+ 任意玩家买断
 * - 抵押地交易：接收方支付抵押值 10% 交易税（向上取整）
 * - 并发报价：接受时原子二次校验（资源已变化则失败），先到先处理
 */
import type { EngineError, GameEvent, GameState, TradeBundle, TradeOffer } from "@monopoly/shared";
import { findPlayer, mortgageInterestOf, tileAt, tileTradable } from "./lookups.js";
import { transferMoney } from "./money.js";
import { chargeMortgageTransferTax } from "./mortgage.js";

function err(message: string): EngineError {
  return { code: "INVALID_ACTION", message };
}

/** 校验一方清单的资源归属与形态（现金/地契/出狱卡） */
function validateBundle(state: GameState, ownerId: string, bundle: TradeBundle, label: string): EngineError | null {
  if (!Number.isInteger(bundle.money) || bundle.money < 0) return err(`${label}金额非法`);
  if (!Number.isInteger(bundle.jailCards) || bundle.jailCards < 0) return err(`${label}出狱卡数量非法`);
  const player = findPlayer(state, ownerId);
  if (bundle.money > player.money) return err(`${label}现金不足`);
  if (bundle.jailCards > player.getOutOfJailCards.length) return err(`${label}出狱许可证数量不足`);
  if (new Set(bundle.tiles).size !== bundle.tiles.length) return err(`${label}地产重复`);
  for (const i of bundle.tiles) {
    const ts = state.tiles[i];
    if (!ts || ts.ownerId !== ownerId) return err(`${label}包含不属于该方的地产`);
    if (!tileTradable(state, i)) return err(`${label}包含有建筑的地产（请先卖房）`);
  }
  return null;
}

/** 内部：计算清单内抵押地的交易税总额 */
function taxTotal(state: GameState, tiles: number[]): number {
  return tiles.reduce((sum, i) => (state.tiles[i]!.mortgaged ? sum + mortgageInterestOf(tileAt(i)) : sum), 0);
}

// ===== 私有报价 =====

export function proposeTrade(
  state: GameState,
  events: GameEvent[],
  playerId: string,
  toId: string,
  give: TradeBundle,
  want: TradeBundle,
): EngineError | null {
  if (toId === playerId) return err("不能与自己交易");
  const target = state.players.find((p) => p.id === toId);
  if (!target || target.bankrupt) return err("交易对象不存在或已破产");

  const e1 = validateBundle(state, playerId, give, "给与清单");
  if (e1) return e1;
  const e2 = validateBundle(state, toId, want, "索取清单");
  if (e2) return e2;

  const offer: TradeOffer = { id: `o-${state.version}`, fromId: playerId, toId, give, want };
  state.trades.push(offer);
  events.push({ type: "TRADE_PROPOSED", offer });
  return null;
}

/** 接受报价（仅被报价方；原子校验并执行） */
export function acceptTrade(state: GameState, events: GameEvent[], playerId: string, offerId: string): EngineError | null {
  const offer = state.trades.find((o) => o.id === offerId);
  if (!offer) return err("报价不存在或已失效");
  if (offer.toId !== playerId) return err("只有被报价方可以接受该报价");

  // 二次校验（并发竞态：资源可能在报价期间变化）
  const e1 = validateBundle(state, offer.fromId, offer.give, "对方给与清单");
  if (e1) return err(`交易已失效：${e1.message}`);
  const e2 = validateBundle(state, offer.toId, offer.want, "己方给与清单");
  if (e2) return err(`交易已失效：${e2.message}`);

  // 抵押交易税预检（转移后现金须足以支付各自接收抵押地的税）
  const giverTax = taxTotal(state, offer.give.tiles); // 接收方 = toId
  const takerTax = taxTotal(state, offer.want.tiles); // 接收方 = fromId
  const to = findPlayer(state, offer.toId);
  const from = findPlayer(state, offer.fromId);
  if (to.money - offer.want.money + offer.give.money < giverTax) return err("现金不足以支付抵押地交易税");
  if (from.money - offer.give.money + offer.want.money < takerTax) return err("对方现金不足以支付抵押地交易税");

  executeTransfer(state, events, offer.fromId, offer.toId, offer.give);
  executeTransfer(state, events, offer.toId, offer.fromId, offer.want);

  state.trades = state.trades.filter((o) => o.id !== offerId);
  events.push({ type: "TRADE_ACCEPTED", offer });
  return null;
}

/** 拒绝（被报价方）或撤回（发起方）；超时由服务端以 REJECT_TRADE(reason=timeout) 驱动 */
export function removeTrade(
  state: GameState,
  events: GameEvent[],
  playerId: string,
  offerId: string,
  reason: "rejected" | "cancelled" | "timeout",
): EngineError | null {
  const offer = state.trades.find((o) => o.id === offerId);
  if (!offer) return err("报价不存在或已失效");

  if (reason === "cancelled") {
    if (offer.fromId !== playerId) return err("只有发起方可以撤回报价");
  } else {
    if (offer.toId !== playerId) return err("只有被报价方可以拒绝该报价");
  }

  state.trades = state.trades.filter((o) => o.id !== offerId);
  events.push({ type: "TRADE_REMOVED", offerId, fromId: offer.fromId, toId: offer.toId, reason });
  return null;
}

/** 执行一方给与（现金 + 地契 + 出狱卡）；抵押地接收方支付交易税 */
function executeTransfer(state: GameState, events: GameEvent[], fromId: string, toId: string, bundle: TradeBundle): void {
  if (bundle.money > 0) transferMoney(state, events, fromId, toId, bundle.money, "trade");
  if (bundle.tiles.length > 0) {
    for (const i of bundle.tiles) state.tiles[i]!.ownerId = toId;
    events.push({ type: "PROPERTY_TRANSFERRED", from: fromId, to: toId, tiles: bundle.tiles });
    chargeMortgageTransferTax(state, events, toId, bundle.tiles);
  }
  if (bundle.jailCards > 0) {
    const giver = findPlayer(state, fromId);
    const taker = findPlayer(state, toId);
    for (let n = 0; n < bundle.jailCards; n++) {
      const deck = giver.getOutOfJailCards.shift();
      if (deck) taker.getOutOfJailCards.push(deck);
    }
  }
}

// ===== 开放市场 =====

export function listProperty(state: GameState, events: GameEvent[], playerId: string, tileIndex: number, price: number): EngineError | null {
  if (!Number.isInteger(price) || price < 1) return err("挂售价格须为不低于 $1 的整数");
  const ts = state.tiles[tileIndex];
  if (!ts || ts.ownerId !== playerId) return err("不是你的地产");
  if (!tileTradable(state, tileIndex)) return err("有建筑的地产不可挂售（请先卖房）");
  if (state.listings.some((l) => l.tile === tileIndex)) return err("该地产已在挂售中");

  const listing = { id: `l-${state.version}`, sellerId: playerId, tile: tileIndex, price };
  state.listings.push(listing);
  events.push({ type: "PROPERTY_LISTED", listing });
  return null;
}

export function cancelListing(state: GameState, events: GameEvent[], playerId: string, listingId: string): EngineError | null {
  const listing = state.listings.find((l) => l.id === listingId);
  if (!listing) return err("挂售不存在或已结束");
  if (listing.sellerId !== playerId) return err("只有卖方可以撤回挂售");

  state.listings = state.listings.filter((l) => l.id !== listingId);
  events.push({ type: "LISTING_REMOVED", listingId, sellerId: listing.sellerId, tile: listing.tile, reason: "cancelled" });
  return null;
}

/** 买断挂售（房内任何人；带押地买家支付 10% 交易税） */
export function buyListing(state: GameState, events: GameEvent[], playerId: string, listingId: string): EngineError | null {
  const listing = state.listings.find((l) => l.id === listingId);
  if (!listing) return err("挂售不存在或已结束");
  if (listing.sellerId === playerId) return err("不能买断自己的挂售");

  const ts = state.tiles[listing.tile]!;
  if (ts.ownerId !== listing.sellerId) return err("该地产已易主，挂售失效");
  if (!tileTradable(state, listing.tile)) return err("该地产已有建筑，无法买断");

  const tax = ts.mortgaged ? mortgageInterestOf(tileAt(listing.tile)) : 0;
  const buyer = findPlayer(state, playerId);
  if (buyer.money < listing.price + tax) return { code: "INSUFFICIENT_FUNDS", message: "现金不足（含抵押地交易税）" };

  transferMoney(state, events, playerId, listing.sellerId, listing.price, "trade");
  ts.ownerId = playerId;
  events.push({ type: "PROPERTY_TRANSFERRED", from: listing.sellerId, to: playerId, tiles: [listing.tile] });
  if (tax > 0) transferMoney(state, events, playerId, "bank", tax, "trade-tax");

  state.listings = state.listings.filter((l) => l.id !== listingId);
  events.push({ type: "LISTING_REMOVED", listingId, sellerId: listing.sellerId, tile: listing.tile, reason: "sold" });
  return null;
}

/** 破产清理：移除该玩家相关的报价与挂售（静默；破产事件已说明上下文） */
export function clearPlayerDeals(state: GameState, playerId: string): void {
  state.trades = state.trades.filter((o) => o.fromId !== playerId && o.toId !== playerId);
  state.listings = state.listings.filter((l) => l.sellerId !== playerId);
}
