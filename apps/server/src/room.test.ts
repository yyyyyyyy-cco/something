import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { RoomStore } from "./persist.js";
import { ROOM_IDLE_MS, Room, RoomManager, generateRoomCode, sanitizeText } from "./room.js";

function makeManager(idleMs = ROOM_IDLE_MS) {
  const dir = mkdtempSync(path.join(tmpdir(), "monopoly-room-"));
  const db = openDatabase(path.join(dir, "test.db"));
  const store = new RoomStore(db);
  const manager = new RoomManager(store, idleMs);
  return { db, store, manager };
}

function mustJoin(room: Room, name: string) {
  const r = room.join({ name });
  if (!r.ok) throw new Error(`加入失败: ${r.error.code}`);
  return r.member;
}

describe("房间基础工具", () => {
  it("房间码：6 位且不含易混字符", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(code).not.toMatch(/[0O1IL]/);
    }
  });

  it("sanitizeText：控制字符 / 空白压缩 / 长度截断", () => {
    expect(sanitizeText("  a\u0000b\n c  ", 10)).toBe("a b c");
    expect(sanitizeText("超长名字abcdefgh", 6)).toBe("超长名字ab");
    expect(sanitizeText("   ", 10)).toBe("");
  });
});

describe("加入与成员管理", () => {
  it("首位加入者为房主；大厅内新成员是玩家", () => {
    const room = new Room("TEST01");
    const m1 = mustJoin(room, "阿明");
    expect(m1.kind).toBe("player");
    expect(room.hostId).toBe(m1.id);

    const m2 = mustJoin(room, "小红");
    expect(m2.kind).toBe("player");
    expect(room.hostId).toBe(m1.id); // 房主不变
    expect(room.info().members).toHaveLength(2);
    expect(room.info().members.find((x) => x.isHost)!.id).toBe(m1.id);
  });

  it("缺少昵称 → NAME_REQUIRED", () => {
    const room = new Room("TEST02");
    const r = room.join({ name: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NAME_REQUIRED");
  });

  it("大厅满 6 人 → ROOM_FULL；开局后加入 → 旁观者", () => {
    const room = new Room("TEST03");
    for (let i = 0; i < 6; i++) mustJoin(room, `玩家${i}`);

    const full = room.join({ name: "第7人" });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.error.code).toBe("ROOM_FULL");

    const started = room.startGame(room.hostId!);
    expect(started.ok).toBe(true);

    const spec = mustJoin(room, "观众");
    expect(spec.kind).toBe("spectator");
  });

  it("令牌重连：恢复原成员、身份与连接状态", () => {
    const room = new Room("TEST04");
    const m1 = mustJoin(room, "阿明");
    room.attachSocket(m1.id, "sock-1");
    room.detachSocket("sock-1");
    expect(room.getMember(m1.id)!.connected).toBe(false);

    const rejoin = room.join({ token: m1.token });
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.resumed).toBe(true);
    expect(rejoin.member.id).toBe(m1.id);
    expect(rejoin.member.connected).toBe(true);
    expect(room.hostId).toBe(m1.id);
  });

  it("开局校验：非房主 / 人数不足", () => {
    const room = new Room("TEST05");
    mustJoin(room, "甲");
    const b = mustJoin(room, "乙");

    const notHost = room.startGame(b.id);
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe("NOT_HOST");

    const solo = new Room("TEST06");
    const host = mustJoin(solo, "独狼");
    const tooFew = solo.startGame(host.id);
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.error.code).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("开局成功：引擎初始化、版本为 0、事件入日志", () => {
    const room = new Room("TEST07");
    const m1 = mustJoin(room, "甲");
    mustJoin(room, "乙");

    const result = room.startGame(m1.id);
    expect(result.ok).toBe(true);
    expect(room.phase).toBe("playing");
    expect(room.game!.players).toHaveLength(2);
    expect(room.version).toBe(0);
    expect(room.recentEvents(10).some((e) => e.event.type === "GAME_STARTED")).toBe(true);
  });
});

describe("对局动作（幂等 / 旁观者限制）", () => {
  it("actionId 幂等：重复动作不重复生效", () => {
    const room = new Room("TEST08");
    const m1 = mustJoin(room, "甲");
    mustJoin(room, "乙");
    room.startGame(m1.id);

    const first = room.applyGameAction(m1.id, { type: "ROLL_DICE", playerId: m1.id }, "act-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.duplicate).toBe(false);
    expect(first.events.length).toBeGreaterThan(0);
    const versionAfterFirst = room.version;

    const dup = room.applyGameAction(m1.id, { type: "ROLL_DICE", playerId: m1.id }, "act-1");
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    expect(dup.duplicate).toBe(true);
    expect(dup.events).toHaveLength(0);
    expect(room.version).toBe(versionAfterFirst); // 未重复推进
  });

  it("旁观者不可执行游戏动作", () => {
    const room = new Room("TEST09");
    const host = mustJoin(room, "甲");
    mustJoin(room, "乙");
    room.startGame(host.id);
    const spec = mustJoin(room, "观众");

    const r = room.applyGameAction(spec.id, { type: "ROLL_DICE", playerId: spec.id }, "spec-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_IN_ROOM");
  });

  it("动作玩家与成员不一致 → INVALID_ACTION", () => {
    const room = new Room("TEST10");
    const m1 = mustJoin(room, "甲");
    const m2 = mustJoin(room, "乙");
    room.startGame(m1.id);

    const r = room.applyGameAction(m1.id, { type: "ROLL_DICE", playerId: m2.id }, "act-x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_ACTION");
  });
});

describe("聊天限速与归档", () => {
  it("聊天：≤5 条/秒，超限 RATE_LIMITED", () => {
    const room = new Room("TEST11");
    const m1 = mustJoin(room, "甲");
    for (let i = 0; i < 5; i++) {
      expect(room.addChat(m1.id, `消息${i}`).ok).toBe(true);
    }
    const sixth = room.addChat(m1.id, "第六条");
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe("RATE_LIMITED");
  });

  it("空消息被拒", () => {
    const room = new Room("TEST12");
    const m1 = mustJoin(room, "甲");
    const r = room.addChat(m1.id, "   \u0000 ");
    expect(r.ok).toBe(false);
  });

  it("空闲归档：在线房间不回收；离线超时回收且可懒加载恢复", () => {
    const { manager, store, db } = makeManager(1000);
    const room = manager.createRoom();
    const m1 = room.join({ name: "甲" });
    if (!m1.ok) throw new Error();
    room.attachSocket(m1.member.id, "s1");

    // 在线 + 超时 → 不回收
    room.lastActivityAt = Date.now() - 5000;
    expect(manager.sweep()).toHaveLength(0);

    // 离线 + 超时 → 回收
    room.detachSocket("s1");
    room.lastActivityAt = Date.now() - 5000;
    manager.save(room); // 归档前落库
    const archived = manager.sweep();
    expect(archived).toContain(room.code);
    expect(manager.getRoom(room.code)).toBeUndefined();

    // 懒加载恢复：令牌仍有效
    const restored = manager.getOrRestore(room.code);
    expect(restored).not.toBeNull();
    const rejoin = restored!.join({ token: m1.member.token });
    expect(rejoin.ok).toBe(true);
    if (rejoin.ok) expect(rejoin.resumed).toBe(true);

    db.close();
  });

  it("持久化往返：成员、对局状态与版本一致", () => {
    const { manager, store, db } = makeManager();
    const room = manager.createRoom();
    const m1 = room.join({ name: "甲" });
    if (!m1.ok) throw new Error();
    room.join({ name: "乙" });
    room.startGame(m1.member.id);
    room.applyGameAction(m1.member.id, { type: "ROLL_DICE", playerId: m1.member.id }, "a1");
    manager.save(room);

    const record = store.load(room.code)!;
    expect(record.phase).toBe("playing");
    expect(record.meta.members).toHaveLength(2);
    expect(record.meta.members[0]!.token).toBe(m1.member.token);
    expect(record.state!.players).toHaveLength(2);
    expect(record.version).toBe(room.version);
    expect(record.meta.hostId).toBe(room.hostId);

    db.close();
  });
});
