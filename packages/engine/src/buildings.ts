/**
 * 建房与卖房（规则规格 §6）
 * - 前置：拥整组、组内无抵押、平均原则、银行库存
 * - 旅馆：4 房 + 1 次升级（房屋退回库存）；拆除时优先换回 4 房（库存不足则按 5 房半价售出）
 * - 卖房半价；只能卖出组内房屋数量最多的地产（平均原则对称）
 */
import type { EngineError, GameEvent, GameState, TileState } from "@monopoly/shared";
import { findPlayer, groupTileIndexes, propertyLevel, tileAt } from "./lookups.js";
import { transferMoney } from "./money.js";

function err(message: string): EngineError {
  return { code: "INVALID_ACTION", message };
}

/** 房屋半价（建房价 ÷ 2） */
function halfHouseCost(tileIndex: number): number {
  return Math.floor((tileAt(tileIndex).houseCost ?? 0) / 2);
}

/** 该地产所属色组是否满足"拥整组 + 无抵押"（建房前置 1/2，规则规格 §6） */
function groupBuildable(state: GameState, playerId: string, ts: TileState): boolean {
  const tile = tileAt(ts.index);
  const members = groupTileIndexes(tile.colorGroup!);
  return (
    members.every((i) => state.tiles[i]!.ownerId === playerId) &&
    members.every((i) => !state.tiles[i]!.mortgaged)
  );
}

/** 建房：仅可建在组内房屋数量最少的地产上（平均原则，规则规格 §6） */
export function canBuildHouse(state: GameState, playerId: string, tileIndex: number): EngineError | null {
  const tile = tileAt(tileIndex);
  const ts = state.tiles[tileIndex]!;
  if (tile.kind !== "property") return err("只有地产可以建房");
  if (ts.ownerId !== playerId) return err("不是你的地产");
  if (ts.mortgaged || ts.hotel || ts.houses >= 4) return err("该地产当前不可建房");
  if (!groupBuildable(state, playerId, ts)) return err("需拥有整组且组内无抵押");
  if (state.settings.housingLimited && state.bank.housesLeft <= 0) return err("银行房屋库存不足");

  const levels = groupTileIndexes(tile.colorGroup!).map((i) => propertyLevel(state.tiles[i]!));
  if (propertyLevel(ts) !== Math.min(...levels)) return err("必须建在组内房屋最少的地产上（平均原则）");
  return null;
}

/** 旅馆升级：需 4 房且全组同级（平均原则），银行有旅馆库存 */
export function canBuildHotel(state: GameState, playerId: string, tileIndex: number): EngineError | null {
  const tile = tileAt(tileIndex);
  const ts = state.tiles[tileIndex]!;
  if (tile.kind !== "property") return err("只有地产可以建房");
  if (ts.ownerId !== playerId) return err("不是你的地产");
  if (ts.mortgaged || ts.hotel || ts.houses !== 4) return err("需已建满 4 栋房屋方可升级旅馆");
  if (!groupBuildable(state, playerId, ts)) return err("需拥有整组且组内无抵押");

  const levels = groupTileIndexes(tile.colorGroup!).map((i) => propertyLevel(state.tiles[i]!));
  if (levels.some((l) => l < 4)) return err("全组达到 4 房后方可升级旅馆（平均原则）");
  if (state.settings.housingLimited) {
    if (state.bank.hotelsLeft <= 0) return err("银行旅馆库存不足");
    if (state.bank.housesLeft < 4) return err("银行房屋库存不足（升级需 4 栋退库）");
  }
  return null;
}

export function buildOnTile(state: GameState, events: GameEvent[], playerId: string, tileIndex: number): EngineError | null {
  const ts = state.tiles[tileIndex]!;
  const player = findPlayer(state, playerId);
  const cost = tileAt(tileIndex).houseCost ?? 0;

  if (ts.houses === 4) {
    const e = canBuildHotel(state, playerId, tileIndex);
    if (e) return e;
    if (player.money < cost) return { code: "INSUFFICIENT_FUNDS", message: "现金不足，无法建造" };
    transferMoney(state, events, playerId, "bank", cost, "buy");
    ts.hotel = true;
    ts.houses = 0;
    if (state.settings.housingLimited) {
      state.bank.housesLeft += 4;
      state.bank.hotelsLeft -= 1;
    }
    events.push({ type: "HOTEL_BUILT", playerId, tile: tileIndex });
    return null;
  }

  const e = canBuildHouse(state, playerId, tileIndex);
  if (e) return e;
  if (player.money < cost) return { code: "INSUFFICIENT_FUNDS", message: "现金不足，无法建造" };
  transferMoney(state, events, playerId, "bank", cost, "buy");
  ts.houses += 1;
  if (state.settings.housingLimited) state.bank.housesLeft -= 1;
  events.push({ type: "HOUSE_BUILT", playerId, tile: tileIndex });
  return null;
}

/** 卖房：只能卖组内房屋最多的地产（平均原则）；半价回款 */
export function canSellHouse(state: GameState, playerId: string, tileIndex: number): EngineError | null {
  const tile = tileAt(tileIndex);
  const ts = state.tiles[tileIndex]!;
  if (tile.kind !== "property") return err("只有地产可以卖房");
  if (ts.ownerId !== playerId) return err("不是你的地产");
  if (ts.hotel) return null; // 旅馆拆除见 sellHouse（库存不足时自动按 5 房售出）
  if (ts.houses <= 0) return err("该地产没有可卖的房屋");

  const levels = groupTileIndexes(tile.colorGroup!).map((i) => propertyLevel(state.tiles[i]!));
  if (propertyLevel(ts) !== Math.max(...levels)) return err("只能卖出组内房屋最多的地产（平均原则）");
  return null;
}

export function sellHouse(state: GameState, events: GameEvent[], playerId: string, tileIndex: number): EngineError | null {
  const ts = state.tiles[tileIndex]!;
  const hotelMode = ts.hotel;
  const e = canSellHouse(state, playerId, tileIndex);
  if (e) return e;

  if (hotelMode) {
    const bankHouses = state.settings.housingLimited ? state.bank.housesLeft : Number.MAX_SAFE_INTEGER;
    if (bankHouses >= 4) {
      // 拆回 4 栋房屋（无现金回款，规则规格 §6）
      ts.hotel = false;
      ts.houses = 4;
      if (state.settings.housingLimited) {
        state.bank.housesLeft -= 4;
        state.bank.hotelsLeft += 1;
      }
      events.push({ type: "HOUSE_SOLD", playerId, tile: tileIndex, amount: 0 });
    } else {
      // 银行房屋库存不足：按 5 栋房价值（半价）售出
      const amount = halfHouseCost(tileIndex) * 5;
      transferMoney(state, events, "bank", playerId, amount, "sell-house");
      ts.hotel = false;
      ts.houses = 0;
      if (state.settings.housingLimited) state.bank.hotelsLeft += 1;
      events.push({ type: "HOTEL_SOLD", playerId, tile: tileIndex, amount });
    }
    return null;
  }

  const amount = halfHouseCost(tileIndex);
  transferMoney(state, events, "bank", playerId, amount, "sell-house");
  ts.houses -= 1;
  if (state.settings.housingLimited) state.bank.housesLeft += 1;
  events.push({ type: "HOUSE_SOLD", playerId, tile: tileIndex, amount });
  return null;
}
