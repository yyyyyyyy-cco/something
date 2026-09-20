import { describe, expect, it } from "vitest";
import { ALL_CARDS, BOARD_TILES, CHANCE_CARDS, CHEST_CARDS, JAIL_CARD_IDS, cardById, defaultDeckIds } from "@monopoly/shared";
import type { ColorGroup, TileKind } from "@monopoly/shared";

function countKind(kind: TileKind): number {
  return BOARD_TILES.filter((t) => t.kind === kind).length;
}

describe("静态数据校验（M1-2：与规则规格附表 A 一致）", () => {
  it("棋盘共 40 格，索引连续且名称齐全", () => {
    expect(BOARD_TILES).toHaveLength(40);
    BOARD_TILES.forEach((t, i) => {
      expect(t.index).toBe(i);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.nameEn.length).toBeGreaterThan(0);
    });
  });

  it("格子类型数量与规则规格 §1 一致", () => {
    expect(countKind("property")).toBe(22);
    expect(countKind("railroad")).toBe(4);
    expect(countKind("utility")).toBe(2);
    expect(countKind("chance")).toBe(3);
    expect(countKind("chest")).toBe(3);
    expect(countKind("tax")).toBe(2);
    expect(countKind("go")).toBe(1);
    expect(countKind("jail")).toBe(1);
    expect(countKind("free-parking")).toBe(1);
    expect(countKind("go-to-jail")).toBe(1);
  });

  it("色组分布正确且地产字段完整（租金表 6 档、建房价、抵押值 = 价格/2）", () => {
    const expectedGroups: Record<ColorGroup, number> = {
      brown: 2,
      "light-blue": 3,
      pink: 3,
      orange: 3,
      red: 3,
      yellow: 3,
      green: 3,
      "dark-blue": 2,
    };
    for (const [group, count] of Object.entries(expectedGroups)) {
      const members = BOARD_TILES.filter((t) => t.colorGroup === group);
      expect(members, group).toHaveLength(count);
    }

    for (const t of BOARD_TILES.filter((x) => x.kind === "property")) {
      expect(t.price, t.name).toBeGreaterThan(0);
      expect(t.colorGroup, t.name).toBeTruthy();
      expect(t.rentTable, t.name).toHaveLength(6);
      expect(t.houseCost, t.name).toBeGreaterThan(0);
      expect(t.mortgageValue, t.name).toBe(t.price! / 2);
      // 租金单调递增
      const rents = t.rentTable!;
      for (let i = 1; i < rents.length; i++) {
        expect(rents[i]!, `${t.name} 第 ${i} 档`).toBeGreaterThan(rents[i - 1]!);
      }
    }
  });

  it("租金表抽查（规则规格附表 A）", () => {
    const byName = (name: string) => BOARD_TILES.find((t) => t.name === name)!;
    expect(byName("地中海大道").rentTable).toEqual([2, 10, 30, 90, 160, 250]);
    expect(byName("波罗的海大道").rentTable).toEqual([4, 20, 60, 180, 320, 450]);
    expect(byName("木板路").rentTable).toEqual([50, 200, 600, 1400, 1700, 2000]);
    expect(byName("公园广场").rentTable).toEqual([35, 175, 500, 1100, 1300, 1500]);
    expect(byName("东方大道").houseCost).toBe(50);
    expect(byName("太平洋大道").houseCost).toBe(200);
  });

  it("车站与公用事业价格/抵押值正确", () => {
    for (const t of BOARD_TILES.filter((x) => x.kind === "railroad")) {
      expect(t.price).toBe(200);
      expect(t.mortgageValue).toBe(100);
    }
    for (const t of BOARD_TILES.filter((x) => x.kind === "utility")) {
      expect(t.price).toBe(150);
      expect(t.mortgageValue).toBe(75);
    }
  });

  it("税金金额正确（所得税 200 / 奢侈税 75）", () => {
    const taxes = BOARD_TILES.filter((t) => t.kind === "tax");
    expect(taxes.map((t) => t.taxAmount).sort((a, b) => a! - b!)).toEqual([75, 200]);
  });

  it("卡牌共 32 张（16 + 16），ID 唯一且文本非空", () => {
    expect(ALL_CARDS).toHaveLength(32);
    expect(CHANCE_CARDS).toHaveLength(16);
    expect(CHEST_CARDS).toHaveLength(16);
    expect(new Set(ALL_CARDS.map((c) => c.id)).size).toBe(32);
    for (const c of ALL_CARDS) {
      expect(c.text.length, c.id).toBeGreaterThan(0);
      expect(c.effects.length, c.id).toBeGreaterThan(0);
    }
  });

  it("moveTo 目标格合法；moveNearest 为唯一效果（引擎续跑依赖该不变量）", () => {
    for (const c of ALL_CARDS) {
      for (const e of c.effects) {
        if (e.type === "moveTo") {
          expect(e.tile, c.id).toBeGreaterThanOrEqual(0);
          expect(e.tile, c.id).toBeLessThan(BOARD_TILES.length);
        }
        if (e.type === "moveNearest") {
          expect(c.effects, c.id).toHaveLength(1);
        }
      }
    }
  });

  it("出狱许可证每副牌堆各一张，JAIL_CARD_IDS 指向有效卡牌", () => {
    for (const deck of ["chance", "chest"] as const) {
      const jailCards = ALL_CARDS.filter((c) => c.deck === deck && c.effects.some((e) => e.type === "getOutOfJailFree"));
      expect(jailCards, deck).toHaveLength(1);
      expect(jailCards[0]!.id).toBe(JAIL_CARD_IDS[deck]);
      expect(cardById(JAIL_CARD_IDS[deck])).toBeDefined();
    }
  });

  it("defaultDeckIds 返回完整牌堆顺序", () => {
    expect(defaultDeckIds("chance")).toHaveLength(16);
    expect(defaultDeckIds("chest")).toHaveLength(16);
    expect(defaultDeckIds("chance")[0]).toBe("chance-1");
  });
});
