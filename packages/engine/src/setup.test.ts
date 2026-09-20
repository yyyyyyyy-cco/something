import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, START_MONEY } from "@monopoly/shared";
import { createGame, normalizeState } from "./setup.js";
import { identityShuffle, makeGame } from "./test-utils.js";

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));

describe("createGame 开局构造", () => {
  it("初始状态符合规则规格 §2", () => {
    const { state, events } = createGame(players(3), { shuffle: identityShuffle });

    expect(state.phase).toBe("AWAITING_ROLL");
    expect(state.version).toBe(0);
    expect(state.currentPlayerId).toBe("p1"); // 先手 = 房主（players[0]）
    expect(state.pendingPurchase).toBeNull();
    expect(state.winnerId).toBeNull();

    for (const p of state.players) {
      expect(p.money).toBe(START_MONEY);
      expect(p.position).toBe(0);
      expect(p.inJail).toBe(false);
      expect(p.bankrupt).toBe(false);
      expect(p.getOutOfJailCards).toEqual([]);
    }

    expect(state.tiles).toHaveLength(40);
    expect(state.tiles.every((t) => t.ownerId === null && !t.mortgaged)).toBe(true);
    expect(state.decks.chance).toHaveLength(16);
    expect(state.decks.chest).toHaveLength(16);
    expect(state.bank).toEqual({ housesLeft: 32, hotelsLeft: 12 });

    expect(events).toEqual([{ type: "GAME_STARTED", playerOrder: ["p1", "p2", "p3"] }]);
  });

  it("支持自定义起始资金（房规）", () => {
    const { state } = createGame(players(2), { shuffle: identityShuffle, startMoney: 2500 });
    expect(state.players[0]!.money).toBe(2500);
    expect(state.settings.startMoney).toBe(2500);
  });

  it("支持直接指定牌堆顺序（测试注入）", () => {
    const { state } = createGame(players(2), {
      decks: { chance: ["chance-1"], chest: ["chest-1"] },
    });
    expect(state.decks.chance).toEqual(["chance-1"]);
  });

  it("人数边界：2-6 合法，越界或重复 ID 抛错", () => {
    expect(() => createGame(players(2), { shuffle: identityShuffle })).not.toThrow();
    expect(() => createGame(players(6), { shuffle: identityShuffle })).not.toThrow();
    expect(() => createGame(players(1), { shuffle: identityShuffle })).toThrow(/2-6/);
    expect(() => createGame(players(7), { shuffle: identityShuffle })).toThrow(/2-6/);
    expect(() =>
      createGame(
        [
          { id: "p1", name: "A" },
          { id: "p1", name: "B" },
        ],
        { shuffle: identityShuffle },
      ),
    ).toThrow(/重复/);
  });

  it("房规设置：默认值来自 DEFAULT_SETTINGS，可局部覆盖", () => {
    const { state } = createGame(players(2), { shuffle: identityShuffle, settings: { potEnabled: true } });
    expect(state.settings.potEnabled).toBe(true);
    expect(state.settings.auctionEnabled).toBe(DEFAULT_SETTINGS.auctionEnabled);
  });
});

describe("normalizeState 旧快照兼容（M2 → M3）", () => {
  it("缺失的 M3 字段补默认值，旧 settings 合并新开关", () => {
    const state = makeGame(2);
    // 模拟 M2 时期的持久化快照：删除 M3 新增字段、settings 仅含 startMoney
    const legacy = state as unknown as Record<string, unknown>;
    delete legacy["auction"];
    delete legacy["auctionQueue"];
    delete legacy["trades"];
    delete legacy["listings"];
    delete legacy["pendingDebt"];
    delete legacy["pot"];
    state.settings = { startMoney: 800 } as never;

    normalizeState(state);

    expect(state.auction).toBeNull();
    expect(state.auctionQueue).toEqual([]);
    expect(state.trades).toEqual([]);
    expect(state.listings).toEqual([]);
    expect(state.pendingDebt).toBeNull();
    expect(state.pot).toBe(0);
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, startMoney: 800 });
  });
});
