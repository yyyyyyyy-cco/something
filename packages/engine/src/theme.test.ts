import { describe, expect, it } from "vitest";
import {
  ALL_CARDS,
  BOARD_TILES,
  CHANCE_CARDS,
  CHEST_CARDS,
  JAIL_CARD_IDS,
  type BoardTile,
  type ColorGroup,
  type GameCard,
  type TileKind,
} from "@monopoly/shared";

/**
 * M4-5 主题替换链路验证（决策：保持经典美版译名）
 *
 * 目标：证明"一键换皮"能力——替换显示名与文案（board.json 的 name/nameEn、cards.json 的 text）
 * 不触碰任何数值结构，系统照常工作。替换流程：改 JSON → 本文件测试通过 → 构建。
 */
const NUMERIC_KEYS = ["index", "kind", "price", "colorGroup", "rentTable", "houseCost", "mortgageValue", "taxAmount"] as const;

/** 程序化生成改名变体（模拟一次完整换皮） */
function renamedBoard(): BoardTile[] {
  return BOARD_TILES.map((t) => ({ ...t, name: `主题地标${t.index}`, nameEn: `Theme Spot ${t.index}` }));
}
function renamedCards(): GameCard[] {
  return ALL_CARDS.map((c) => ({ ...c, text: `主题文案：${c.id}` }));
}

/** 结构校验（不依赖具体地名文案；等价于 data.test.ts 的核心约束） */
function validateStructure(tiles: BoardTile[], cards: GameCard[]): void {
  expect(tiles).toHaveLength(40);
  tiles.forEach((t, i) => {
    expect(t.index).toBe(i); // 索引连续
    expect(t.name.length).toBeGreaterThan(0); // 显示名必填
    expect(t.nameEn.length).toBeGreaterThan(0);
  });

  const kinds: TileKind[] = ["property", "railroad", "utility", "chance", "chest", "tax", "jail", "free-parking", "go-to-jail", "go"];
  for (const kind of kinds) {
    expect(tiles.some((t) => t.kind === kind), `缺少格子类型 ${kind}`).toBe(true);
  }
  expect(tiles.filter((t) => t.kind === "property")).toHaveLength(22);
  expect(tiles.filter((t) => t.kind === "railroad")).toHaveLength(4);
  expect(tiles.filter((t) => t.kind === "utility")).toHaveLength(2);
  expect(tiles.filter((t) => t.kind === "chance")).toHaveLength(3);
  expect(tiles.filter((t) => t.kind === "chest")).toHaveLength(3);

  const groups = new Set(tiles.filter((t) => t.kind === "property").map((t) => t.colorGroup as ColorGroup));
  expect(groups.size).toBe(8); // 8 个色组
  for (const t of tiles.filter((x) => x.kind === "property")) {
    expect(t.rentTable, `地产 ${t.index} 缺少租金表`).toHaveLength(6);
    expect(t.houseCost).toBeGreaterThan(0);
    expect(t.mortgageValue).toBeGreaterThan(0);
    // 租金表单调不减
    for (let i = 1; i < t.rentTable!.length; i++) {
      expect(t.rentTable![i]!).toBeGreaterThanOrEqual(t.rentTable![i - 1]!);
    }
  }

  expect(cards).toHaveLength(32);
  expect(CHANCE_CARDS.map((c) => c.id).length).toBe(16);
  expect(CHEST_CARDS.map((c) => c.id).length).toBe(16);
  for (const c of cards) {
    expect(c.text.length).toBeGreaterThan(0);
    expect(c.effects.length).toBeGreaterThan(0);
  }
  // 出狱卡 ID 合法性（引擎归还逻辑依赖）
  expect(cards.some((c) => c.id === JAIL_CARD_IDS.chance)).toBe(true);
  expect(cards.some((c) => c.id === JAIL_CARD_IDS.chest)).toBe(true);
}

describe("M4-5 主题替换链路（保持经典美版译名；验证一键换皮能力）", () => {
  it("当前数据（经典译名）通过结构校验", () => {
    validateStructure(BOARD_TILES, ALL_CARDS);
  });

  it("改名变体：显示字段可整体替换，数值字段逐项一致", () => {
    const variant = renamedBoard();
    variant.forEach((v, i) => {
      const orig = BOARD_TILES[i]!;
      expect(v.name).not.toBe(orig.name); // 显示名已替换
      for (const key of NUMERIC_KEYS) {
        expect(v[key], `格子 ${i} 的字段 ${key} 不应变化`).toEqual(orig[key]);
      }
    });
  });

  it("改名变体（棋盘 + 卡牌文案）通过完整结构校验", () => {
    validateStructure(renamedBoard(), renamedCards());
  });
});
