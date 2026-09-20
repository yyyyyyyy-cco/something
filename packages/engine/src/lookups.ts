/**
 * 棋盘/玩家查询工具（纯查询，无副作用）
 */
import {
  BOARD_SIZE,
  BOARD_TILES,
  MORTGAGE_INTEREST_RATE,
  RAILROAD_RENTS,
  UTILITY_MULTIPLIERS,
} from "@monopoly/shared";
import type { BoardTile, ColorGroup, GameState, PlayerState, TileKind, TileState } from "@monopoly/shared";

export function tileAt(index: number): BoardTile {
  const tile = BOARD_TILES[index];
  if (!tile) throw new Error(`非法棋盘索引: ${index}`);
  return tile;
}

export function findPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`玩家不存在: ${playerId}`);
  return player;
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.bankrupt);
}

export function ownedTileIndexes(state: GameState, playerId: string): number[] {
  return state.tiles.filter((t) => t.ownerId === playerId).map((t) => t.index);
}

export function countOwnedKind(state: GameState, playerId: string, kind: TileKind): number {
  return ownedTileIndexes(state, playerId).filter((i) => tileAt(i).kind === kind).length;
}

/** 是否集齐某色组全部地产（不含抵押/建筑口径；抵押检查见 groupHasMortgage） */
export function ownsFullColorGroup(state: GameState, playerId: string, group: ColorGroup): boolean {
  const members = BOARD_TILES.filter((t) => t.colorGroup === group);
  return members.length > 0 && members.every((m) => state.tiles[m.index]?.ownerId === playerId);
}

/** 色组成员格索引（按棋盘顺序） */
export function groupTileIndexes(group: ColorGroup): number[] {
  return BOARD_TILES.filter((t) => t.colorGroup === group).map((t) => t.index);
}

/** 色组内是否存在抵押地产（抵押破垄断加成口径，规则规格 §5） */
export function groupHasMortgage(state: GameState, group: ColorGroup): boolean {
  return groupTileIndexes(group).some((i) => state.tiles[i]!.mortgaged);
}

/** 地产级别：0 = 空地；1-4 = 房屋数；5 = 旅馆（规则规格 §6） */
export function propertyLevel(ts: TileState): number {
  return ts.hotel ? 5 : ts.houses;
}

/** 抵押担保价值（价格 ÷ 2） */
export function mortgageValueOf(tile: BoardTile): number {
  return tile.mortgageValue ?? Math.floor((tile.price ?? 0) / 2);
}

/** 抵押交易税 / 赎回利息：抵押值的 10%，向上取整到 $1（规则规格 §7） */
export function mortgageInterestOf(tile: BoardTile): number {
  return Math.max(1, Math.ceil(mortgageValueOf(tile) * MORTGAGE_INTEREST_RATE));
}

/** 地块是否可进入交易/挂售（地上无建筑；抵押与否不限） */
export function tileTradable(state: GameState, tileIndex: number): boolean {
  const ts = state.tiles[tileIndex]!;
  return ts.houses === 0 && !ts.hotel;
}

/** 车站租金：按持有数量 1-4 阶梯 25/50/100/200 */
export function railroadRent(ownedCount: number): number {
  const idx = Math.min(Math.max(ownedCount, 1), 4) - 1;
  return RAILROAD_RENTS[idx]!;
}

/** 公用事业倍数：持有 1 座 ×4；2 座 ×10 */
export function utilityMultiplier(ownedCount: number): number {
  return ownedCount >= 2 ? UTILITY_MULTIPLIERS.two : UTILITY_MULTIPLIERS.one;
}

/** 前进路径（逐格索引，含环绕；供前端逐格移动动画） */
export function forwardPath(from: number, steps: number): number[] {
  const path: number[] = [];
  for (let s = 1; s <= steps; s++) path.push((from + s) % BOARD_SIZE);
  return path;
}

/** 后退路径（逐格索引） */
export function backwardPath(from: number, steps: number): number[] {
  const path: number[] = [];
  for (let s = 1; s <= steps; s++) path.push(((from - s) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE);
  return path;
}
