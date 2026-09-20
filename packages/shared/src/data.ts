/**
 * 静态数据出口：棋盘 40 格、卡牌 32 张（JSON 为准，见 src/data/）
 * 说明：JSON 是唯一数据源（版本管理）；本模块做类型化导出与便捷查询。
 */
import boardJson from "./data/board.json" with { type: "json" };
import cardsJson from "./data/cards.json" with { type: "json" };
import type { BoardTile, CardDeck, GameCard } from "./types.js";

export const BOARD_TILES = boardJson as BoardTile[];
export const ALL_CARDS = cardsJson as GameCard[];

export const CHANCE_CARDS = ALL_CARDS.filter((c) => c.deck === "chance");
export const CHEST_CARDS = ALL_CARDS.filter((c) => c.deck === "chest");

export function cardById(id: string): GameCard | undefined {
  return ALL_CARDS.find((c) => c.id === id);
}

/** 返回某牌堆的卡牌 ID 顺序（未洗牌） */
export function defaultDeckIds(deck: CardDeck): string[] {
  return ALL_CARDS.filter((c) => c.deck === deck).map((c) => c.id);
}
