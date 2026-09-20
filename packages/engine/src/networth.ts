/**
 * 总资产计算（规则规格 §14：限时模式判胜负口径）
 * 资产 = 现金 + 地产牌面价（抵押地产按半价计）+ 建筑物建造成本
 * 建筑成本口径：房屋数 × 建房价；旅馆视为 5 × 建房价（4 房 + 升级）
 */
import { BOARD_TILES } from "@monopoly/shared";
import type { GameState } from "@monopoly/shared";
import { findPlayer } from "./lookups.js";

export function computeNetWorth(state: GameState, playerId: string): number {
  const player = findPlayer(state, playerId);
  let total = player.money;

  for (const ts of state.tiles) {
    if (ts.ownerId !== playerId) continue;
    const tile = BOARD_TILES[ts.index]!;
    const faceValue = tile.price ?? 0;

    // 地产牌面价：抵押中按半价计（§14）
    total += ts.mortgaged ? Math.floor(faceValue / 2) : faceValue;

    // 建筑物建造成本（抵押地无建筑）
    const houseCost = tile.houseCost ?? 0;
    if (houseCost > 0) {
      total += ts.houses * houseCost;
      if (ts.hotel) total += houseCost * 5;
    }
  }

  return total;
}

/** 存活玩家的资产排名（降序；同资产按现金多者优先，再按玩家顺序稳定排序） */
export function rankByNetWorth(state: GameState): { id: string; assets: number }[] {
  const alive = state.players.filter((p) => !p.bankrupt);
  return alive
    .map((p, index) => ({ id: p.id, assets: computeNetWorth(state, p.id), money: p.money, index }))
    .sort((a, b) => b.assets - a.assets || b.money - a.money || a.index - b.index)
    .map(({ id, assets }) => ({ id, assets }));
}
