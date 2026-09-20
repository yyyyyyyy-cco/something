/**
 * M4 服务端测试：房规配置（M4-3）/ 托管（M4-2）/ 限时与战绩（M4-6、M4-4）
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@monopoly/shared";
import { openDatabase } from "./db.js";
import { RoomStore } from "./persist.js";
import { ROOM_IDLE_MS, RoomManager } from "./room.js";

const TEST_TIMEOUTS = {
  auctionMs: 60,
  cashMs: 60,
  tradeMs: 60,
  autopilotDisconnectedMs: 100,
  autopilotManualMs: 40,
  autopilotTickMs: 30,
};

function makeManager() {
  const dir = mkdtempSync(path.join(tmpdir(), "monopoly-m4-"));
  const db = openDatabase(path.join(dir, "test.db"));
  const store = new RoomStore(db);
  const manager = new RoomManager(store, ROOM_IDLE_MS, TEST_TIMEOUTS);
  return { db, store, manager };
}

function setupRoom(manager: RoomManager, players = 2) {
  const room = manager.createRoom();
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    const r = room.join({ name: `玩家${i + 1}` });
    if (!r.ok) throw new Error("加入失败");
    ids.push(r.member.id);
  }
  return { room, ids };
}

describe("M4-3 房规配置", () => {
  it("房主可配置并冻结进对局；非房主与对局中被拒绝", () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);
    const host = ids[0]!;
    const guest = ids[1]!;

    expect(room.updateSettings(guest, { potEnabled: true }).ok).toBe(false);
    expect(room.updateSettings(host, { startMoney: 2000, potEnabled: true }).ok).toBe(true);
    expect(room.info().settings.startMoney).toBe(2000);

    // 范围 / 白名单校验
    expect(room.updateSettings(host, { startMoney: 100 }).ok).toBe(false);
    expect(room.updateSettings(host, { timeLimitMinutes: 45 }).ok).toBe(false);
    expect(room.updateSettings(host, { timeLimitMinutes: null }).ok).toBe(true);

    const started = room.startGame(host);
    expect(started.ok).toBe(true);
    expect(room.game!.settings.startMoney).toBe(2000); // 冻结生效
    expect(room.game!.settings.potEnabled).toBe(true);
    expect(room.updateSettings(host, { potEnabled: false }).ok).toBe(false); // 开局后锁定

    room.dispose();
    db.close();
  });

  it("默认房规来自 DEFAULT_SETTINGS", () => {
    const { db, manager } = makeManager();
    const { room } = setupRoom(manager, 2);
    expect(room.info().settings).toEqual(DEFAULT_SETTINGS);
    room.dispose();
    db.close();
  });
});

describe("M4-2 托管", () => {
  it("手动托管：延迟后自动代打（掷骰推进版本）", () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);
    const host = ids[0]!;
    room.startGame(host);
    const before = room.game!.version;
    const current = room.game!.currentPlayerId;

    // 房主为自己开启托管
    expect(room.setAutopilot(host, current, true).ok).toBe(true);
    expect(room.info().members.find((m) => m.id === current)!.autopilot).toBe(true);

    const t0 = Date.now();
    room.tickAutopilot(t0); // 记录起始，未到延迟
    expect(room.game!.version).toBe(before);
    room.tickAutopilot(t0 + TEST_TIMEOUTS.autopilotManualMs + 10); // 到点 → 代打
    expect(room.game!.version).toBeGreaterThan(before);

    room.dispose();
    db.close();
  });

  it("掉线自动托管：离线超过延迟后自动代打", () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);
    const host = ids[0]!;
    room.startGame(host);
    const before = room.game!.version;

    // 模拟当前玩家断线
    const current = room.game!.currentPlayerId;
    room.attachSocket(current, "socket-x");
    room.detachSocket("socket-x");
    expect(room.info().members.find((m) => m.id === current)!.connected).toBe(false);

    const t0 = Date.now();
    room.tickAutopilot(t0); // 记录起始
    expect(room.game!.version).toBe(before);
    room.tickAutopilot(t0 + TEST_TIMEOUTS.autopilotDisconnectedMs + 10); // 到点 → 代打
    expect(room.game!.version).toBeGreaterThan(before);

    room.dispose();
    db.close();
  });

  it("托管权限：非房主仅能管理自己", () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);
    const host = ids[0]!;
    const guest = ids[1]!;

    expect(room.setAutopilot(guest, host, true).ok).toBe(false); // 非房主不能管他人
    expect(room.setAutopilot(guest, guest, true).ok).toBe(true); // 可管自己
    expect(room.setAutopilot(host, guest, false).ok).toBe(true); // 房主可管任何人
    expect(room.info().members.find((m) => m.id === guest)!.autopilot).toBe(false);
    expect(room.isAutopilot(guest)).toBe(false);

    room.dispose();
    db.close();
  });
});

describe("M4-6 限时模式 + M4-4 战绩", () => {
  it("开启限时：timeLeft 下发；TIME_UP 到点按资产裁决并落库战绩（防重复）", () => {
    const { db, store, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);
    const host = ids[0]!;
    expect(room.updateSettings(host, { timeLimitMinutes: 60 }).ok).toBe(true);
    room.startGame(host);

    expect(room.game!.settings.timeLimitMinutes).toBe(60);
    const timeLeft = room.timerInfo().timeLeft;
    expect(timeLeft).toBeGreaterThan(0);
    expect(timeLeft).toBeLessThanOrEqual(60 * 60_000);

    // 手动构造资产差：p1 现金更高（真到点由服务端计时器驱动同一动作）
    room.game!.players[0]!.money = 2000;
    room.game!.players[1]!.money = 100;

    const performed = room.applySystemAction({ type: "TIME_UP", playerId: room.game!.currentPlayerId });
    expect(performed).toBe(true);
    expect(room.game!.phase).toBe("ENDED");
    expect(room.game!.winnerId).toBe(ids[0]!);
    expect(room.phase).toBe("ended");

    const records = store.listGameRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ roomCode: room.code, winnerId: ids[0]!, reason: "time-up" });
    expect(records[0]!.players).toHaveLength(2);
    expect(records[0]!.players[0]!.assets).toBeGreaterThanOrEqual(2000);

    // 防重复：结束后系统动作被忽略，不产生第二条记录
    expect(room.applySystemAction({ type: "TIME_UP", playerId: ids[0]! })).toBe(false);
    expect(store.listGameRecords()).toHaveLength(1);

    room.dispose();
    db.close();
  });

  it("未开限时：TIME_UP 被引擎拒绝（房间状态不变）", () => {
    const { db, manager } = makeManager();
    const { room, ids } = setupRoom(manager, 2);
    room.startGame(ids[0]!);
    expect(room.applySystemAction({ type: "TIME_UP", playerId: ids[0]! })).toBe(false);
    expect(room.game!.phase).not.toBe("ENDED");
    room.dispose();
    db.close();
  });
});
