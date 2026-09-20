/**
 * M3 超时驱动测试（Room 层）：
 * - 拍卖：30 秒无人加价 → 服务端自动 PASS_BID(timeout) 裁决（此处以短超时注入验证）
 * - 套现窗口：60 秒超时 → CASH_TIMEOUT → 破产清算
 * - 私有报价：60 秒超时 → REJECT_TRADE(timeout)
 * - timerInfo：随广播下发的剩余毫秒
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, createGame } from "@monopoly/engine";
import type { Action, GameEvent, GameState } from "@monopoly/shared";
import { openDatabase } from "./db.js";
import { RoomStore } from "./persist.js";
import { ROOM_IDLE_MS, RoomManager } from "./room.js";
import type { Room } from "./room.js";

const TEST_TIMEOUTS = { auctionMs: 60, cashMs: 60, tradeMs: 60 };
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function makeManager() {
  const dir = mkdtempSync(path.join(tmpdir(), "monopoly-m3-"));
  const db = openDatabase(path.join(dir, "test.db"));
  const store = new RoomStore(db);
  const manager = new RoomManager(store, ROOM_IDLE_MS, TEST_TIMEOUTS);
  return { db, manager };
}

function rngOf(...rolls: [number, number][]): () => [number, number] {
  const q = [...rolls];
  return () => q.shift() ?? [1, 1];
}

/** 建房 + 3 名成员加入（返回玩家 id 与房间） */
function setupRoom(manager: RoomManager, players = 3) {
  const room = manager.createRoom();
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    const r = room.join({ name: `玩家${i + 1}` });
    if (!r.ok) throw new Error("加入失败");
    ids.push(r.member.id);
  }
  return { room, ids };
}

function drive(prev: GameState, action: Action, rng: () => [number, number]): GameState {
  const r = applyAction(prev, action, rng);
  if (!r.ok) throw new Error(`动作失败: ${r.error.code} ${r.error.message}`);
  return r.state;
}

describe("M3 超时驱动（Room 层）", () => {
  it("拍卖：无人出价时逐位自动超时放弃 → 流拍并恢复回合", async () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 3);

    const { state } = createGame(ids.map((id, i) => ({ id, name: `玩家${i + 1}` })));
    // p1 掷 [1,2] → 3 无主 → 放弃 → 拍卖
    let s = drive(state, { type: "ROLL_DICE", playerId: ids[0]! }, rngOf([1, 2]));
    s = drive(s, { type: "DECLINE_PURCHASE", playerId: ids[0]! }, rngOf());
    expect(s.phase).toBe("AUCTION");
    room.game = s;
    room.version = s.version;
    room.phase = "playing";

    const updates: GameEvent[] = [];
    room.wireSystemUpdates((_st, events) => updates.push(...events));
    expect(room.timerInfo().auction).toBeGreaterThan(0);
    expect(room.timerInfo().auction).toBeLessThanOrEqual(TEST_TIMEOUTS.auctionMs);

    // 三位玩家依次超时（每位 60ms）→ 全部放弃 → 流拍
    await sleep(420);

    expect(room.game!.auction).toBeNull();
    expect(room.game!.tiles[3]!.ownerId).toBeNull(); // 流拍保持无主
    expect(room.game!.phase).toBe("AWAITING_ROLL");
    const ended = updates.filter((e) => e.type === "AUCTION_ENDED");
    expect(ended).toHaveLength(1);
    room.dispose();
    db.close();
  });

  it("拍卖：有人出价后仅等最后一人超时 → 成交", async () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);

    const { state } = createGame(ids.map((id, i) => ({ id, name: `玩家${i + 1}` })));
    let s = drive(state, { type: "ROLL_DICE", playerId: ids[0]! }, rngOf([1, 2]));
    s = drive(s, { type: "DECLINE_PURCHASE", playerId: ids[0]! }, rngOf());
    s = drive(s, { type: "BID", playerId: ids[0]!, amount: 7 }, rngOf()); // p1 出价（queue → [p2, p1]）
    room.game = s;
    room.version = s.version;
    room.phase = "playing";

    const updates: GameEvent[] = [];
    room.wireSystemUpdates((_st, events) => updates.push(...events));

    // p2 超时（60ms）→ 队列仅剩最高出价者 p1 → 成交
    await sleep(200);

    expect(room.game!.auction).toBeNull();
    expect(room.game!.tiles[3]!.ownerId).toBe(ids[0]!);
    const ended = updates.find((e) => e.type === "AUCTION_ENDED");
    expect(ended).toBeDefined();
    room.dispose();
    db.close();
  });

  it("套现窗口：超时未凑足 → CASH_TIMEOUT → 破产清算", async () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);

    const { state } = createGame(
      ids.map((id, i) => ({ id, name: `玩家${i + 1}` })),
      { settings: { auctionEnabled: false } },
    );
    // p2 持有深蓝双地；p1 现金 $10 位于 36 → 掷 [1,2] 落 39（租金 $100 无力支付）
    state.tiles[37]!.ownerId = ids[1]!;
    state.tiles[39]!.ownerId = ids[1]!;
    state.players[0]!.money = 10;
    state.players[0]!.position = 36;

    const s = drive(state, { type: "ROLL_DICE", playerId: ids[0]! }, rngOf([1, 2]));
    expect(s.phase).toBe("CASH_WINDOW");
    room.game = s;
    room.version = s.version;
    room.phase = "playing";

    const updates: GameEvent[] = [];
    room.wireSystemUpdates((_st, events) => updates.push(...events));
    expect(room.timerInfo().cash).toBeGreaterThan(0);

    await sleep(220);

    expect(room.game!.players[0]!.bankrupt).toBe(true);
    expect(room.game!.phase).toBe("ENDED");
    expect(updates.some((e) => e.type === "PLAYER_BANKRUPT")).toBe(true);
    room.dispose();
    db.close();
  });

  it("私有报价：超时视为拒绝（REJECT_TRADE timeout），房内状态同步移除", async () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);

    const { state } = createGame(ids.map((id, i) => ({ id, name: `玩家${i + 1}` })));
    const s = drive(
      state,
      {
        type: "PROPOSE_TRADE",
        playerId: ids[0]!,
        toId: ids[1]!,
        give: { money: 10, tiles: [], jailCards: 0 },
        want: { money: 0, tiles: [], jailCards: 0 },
      },
      rngOf(),
    );
    expect(s.trades).toHaveLength(1);
    room.game = s;
    room.version = s.version;
    room.phase = "playing";

    const updates: GameEvent[] = [];
    room.wireSystemUpdates((_st, events) => updates.push(...events));
    expect(room.timerInfo().trades?.[s.trades[0]!.id]).toBeGreaterThan(0);

    await sleep(220);

    expect(room.game!.trades).toHaveLength(0);
    const removed = updates.find((e) => e.type === "TRADE_REMOVED");
    expect(removed).toMatchObject({ reason: "timeout" });
    room.dispose();
    db.close();
  });
});
