/**
 * 集成测试（M2-8 自动化验收）：
 * - 完整流程：REST 建房 → 多人加入 → 开局 → 推进对局（广播/版本一致性）
 * - 断线重连：保留席位与令牌，恢复后状态一致（60s 验收的自动化等价）
 * - actionId 幂等（网络重试安全）
 * - 聊天限速与错误码
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { io as ioc } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BOARD_TILES, JAIL_BAIL } from "@monopoly/shared";
import type {
  Action,
  ChatMessage,
  ClientToServerEvents,
  GameState,
  JoinAck,
  OkAck,
  RoomInfo,
  RoomStatePayload,
  ServerToClientEvents,
} from "@monopoly/shared";
import { buildServer } from "./server.js";
import type { BuiltServer } from "./server.js";

type TestSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let server: BuiltServer;
let baseUrl: string;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "monopoly-it-"));
  server = buildServer({ dataDir: dir, clientDist: null });
  const port = await server.start(0);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.stop();
});

// ===== 工具 =====

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const socket: TestSocket = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(err));
  });
}

function createRoom(): Promise<string> {
  return fetch(`${baseUrl}/api/rooms`, { method: "POST" })
    .then((res) => res.json() as Promise<{ roomCode: string }>)
    .then((data) => data.roomCode);
}

function join(socket: TestSocket, roomCode: string, name?: string, token?: string): Promise<JoinAck> {
  return new Promise((resolve) => socket.emit("room:join", { roomCode, name, token }, resolve));
}

function start(socket: TestSocket): Promise<OkAck> {
  return new Promise((resolve) => socket.emit("room:start", resolve));
}

function act(socket: TestSocket, action: Action, actionId: string): Promise<OkAck> {
  return new Promise((resolve) => socket.emit("game:action", { action, actionId }, resolve));
}

function sendChat(socket: TestSocket, text: string): Promise<OkAck> {
  return new Promise((resolve) => socket.emit("chat:send", { text }, resolve));
}

function waitFor<T>(
  socket: TestSocket,
  event: keyof ServerToClientEvents,
  predicate?: (payload: T) => boolean,
): Promise<T> {
  return new Promise((resolve) => {
    const handler = (payload: T): void => {
      if (!predicate || predicate(payload)) {
        (socket as unknown as { off: (e: string, h: unknown) => void }).off(event, handler);
        resolve(payload);
      }
    };
    (socket as unknown as { on: (e: string, h: unknown) => void }).on(event, handler);
  });
}

/** 按引擎策略推进一步（当前玩家操作） */
async function playOne(
  sockets: Map<string, TestSocket>,
  state: GameState,
  tag: string,
): Promise<GameState> {
  const pid = state.currentPlayerId;
  const player = state.players.find((p) => p.id === pid)!;

  let action: Action;
  if (state.phase === "AWAITING_ACTION") {
    const tile = state.pendingPurchase!;
    const price = BOARD_TILES[tile.tileIndex]!.price ?? 0;
    action =
      player.money >= price
        ? { type: "BUY_PROPERTY", playerId: pid }
        : { type: "DECLINE_PURCHASE", playerId: pid };
  } else if (state.phase === "AUCTION" && state.auction) {
    // 拍卖：队首玩家直接放弃（测试追求快速推进；全部放弃即流拍）
    const waiting = state.auction.queue[0]!;
    const ack = await act(sockets.get(waiting)!, { type: "PASS_BID", playerId: waiting }, `${tag}-${state.version}`);
    expect(ack.ok, JSON.stringify(ack)).toBe(true);
    return state;
  } else if (state.phase === "CASH_WINDOW" && state.pendingDebt) {
    // 套现窗口：直接超时裁决（现金已足则引擎结算，否则破产清算）
    action = { type: "CASH_TIMEOUT", playerId: state.pendingDebt.payerId };
  } else if (player.inJail && player.money >= JAIL_BAIL) {
    action = { type: "PAY_BAIL", playerId: pid };
  } else {
    action = { type: "ROLL_DICE", playerId: pid };
  }

  const actorSocket = sockets.get(action.playerId)!;
  const ack = await act(actorSocket, action, `${tag}-${state.version}`);
  expect(ack.ok, JSON.stringify(ack)).toBe(true);
  return state; // 由调用方用 game:update 覆盖
}

// ===== 用例 =====

describe("M2 联机集成", () => {
  it("完整流程：创建 → 3 人加入 → 开局 → 推进对局（广播与版本一致）", async () => {
    const roomCode = await createRoom();
    expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

    const c1 = await connect();
    const c2 = await connect();
    const c3 = await connect();

    const firstState = waitFor<RoomStatePayload>(c1, "room:state");
    const j1 = await join(c1, roomCode, "阿明");
    expect(j1.ok).toBe(true);
    if (!j1.ok) return;
    const s1 = await firstState;
    expect(s1.room.hostId).toBe(j1.you.memberId); // 首位加入者 = 房主
    expect(s1.game).toBeNull();

    const j2 = await join(c2, roomCode, "小红");
    const j3 = await join(c3, roomCode, "小刚");
    expect(j2.ok && j3.ok).toBe(true);
    if (!j2.ok || !j3.ok) return;

    // 房主开局
    const startedState = waitFor<RoomStatePayload>(c2, "room:state", (p) => p.game !== null);
    const startAck = await start(c1);
    expect(startAck.ok).toBe(true);
    const started = await startedState;
    expect(started.room.phase).toBe("playing");

    const sockets = new Map<string, TestSocket>([
      [j1.you.memberId, c1],
      [j2.you.memberId, c2],
      [j3.you.memberId, c3],
    ]);
    expect(started.game!.players.map((p) => p.id).sort()).toEqual([...sockets.keys()].sort());

    // 推进对局（最多 60 步，验证广播、版本单调、状态一致）
    let latest = started.game!;
    let received = 0;
    c1.on("game:update", (payload) => {
      received++;
      expect(payload.version).toBe(payload.state.version);
    });

    for (let i = 0; i < 60 && latest.phase !== "ENDED"; i++) {
      const pid = latest.currentPlayerId;
      const update = waitFor<{ version: number; state: GameState }>(c1, "game:update");
      await playOne(sockets, latest, `it1-${i}`);
      const u = await update;
      expect(u.version).toBeGreaterThan(latest.version); // 版本单调递增
      latest = u.state;
      // 状态不变量
      for (const p of latest.players) expect(p.money).toBeGreaterThanOrEqual(0);
    }
    expect(received).toBeGreaterThan(0);

    c1.close();
    c2.close();
    c3.close();
  });

  it("actionId 幂等：同一动作重发不产生重复更新", async () => {
    const roomCode = await createRoom();
    const c1 = await connect();
    const c2 = await connect();
    const j1 = await join(c1, roomCode, "甲");
    await join(c2, roomCode, "乙");
    if (!j1.ok) throw new Error("join failed");

    const started = waitFor<RoomStatePayload>(c1, "room:state", (p) => p.game !== null);
    await start(c1);
    const game = (await started).game!;

    let updates = 0;
    c1.on("game:update", () => updates++);

    // 当前玩家（房主）连续两次相同 actionId
    const action: Action = { type: "ROLL_DICE", playerId: game.currentPlayerId };
    const ack1 = await act(c1, action, "dup-1");
    expect(ack1.ok).toBe(true);
    const ack2 = await act(c1, action, "dup-1");
    expect(ack2.ok).toBe(true);
    if (ack2.ok) expect(ack2.duplicate).toBe(true);

    await new Promise((r) => setTimeout(r, 150));
    expect(updates).toBe(1); // 仅一次广播

    c1.close();
    c2.close();
  });

  it("断线重连：席位与令牌保留，恢复后游戏状态一致", async () => {
    const roomCode = await createRoom();
    const c1 = await connect();
    const c2 = await connect();
    const j1 = await join(c1, roomCode, "甲");
    const j2 = await join(c2, roomCode, "乙");
    if (!j1.ok || !j2.ok) throw new Error("join failed");

    const started = waitFor<RoomStatePayload>(c1, "room:state", (p) => p.game !== null);
    await start(c1);
    let latest = (await started).game!;

    // 推进 3 步
    const sockets = new Map<string, TestSocket>([
      [j1.you.memberId, c1],
      [j2.you.memberId, c2],
    ]);
    for (let i = 0; i < 3 && latest.phase !== "ENDED"; i++) {
      const update = waitFor<{ version: number; state: GameState }>(c1, "game:update");
      await playOne(sockets, latest, `it3-${i}`);
      latest = (await update).state;
    }
    const versionBefore = latest.version;

    // c2 掉线 → c1 收到成员状态更新
    const membersUpdate = waitFor<{ room: RoomInfo }>(
      c1,
      "room:members",
      (p) => p.room.members.some((m) => m.id === j2.you.memberId && !m.connected),
    );
    c2.disconnect();
    const mu = await membersUpdate;
    const c2info = mu.room.members.find((m) => m.id === j2.you.memberId)!;
    expect(c2info.connected).toBe(false); // 席位保留（仅标记离线）

    // 重新连接并凭令牌归位
    const c2b = await connect();
    const restoredState = waitFor<RoomStatePayload>(c2b, "room:state");
    const rejoined = await join(c2b, roomCode, undefined, j2.you.token);
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.resumed).toBe(true);
    expect(rejoined.you.memberId).toBe(j2.you.memberId);

    const restored = await restoredState;
    expect(restored.game!.version).toBe(versionBefore); // 状态与掉线前一致

    c1.close();
    c2b.close();
  });

  it("聊天：广播与 ≤5 条/秒限速", async () => {
    const roomCode = await createRoom();
    const c1 = await connect();
    const c2 = await connect();
    const j1 = await join(c1, roomCode, "甲");
    await join(c2, roomCode, "乙");
    if (!j1.ok) throw new Error();

    const msgPromise = waitFor<ChatMessage>(c2, "chat:message");
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => sendChat(c1, `消息${i}`)));
    const okCount = burst.filter((a) => a.ok).length;
    const limited = burst.filter((a) => !a.ok && a.error.code === "RATE_LIMITED").length;
    expect(okCount).toBeLessThanOrEqual(5);
    expect(okCount).toBeGreaterThanOrEqual(1);
    expect(limited).toBeGreaterThanOrEqual(1);
    expect((await msgPromise).from).toBe(j1.you.memberId);

    c1.close();
    c2.close();
  });

  it("错误码：未知房间 / 未加入即开局 / 非房主开局", async () => {
    const c = await connect();
    const bad = await join(c, "ZZZZZZ", "路人");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ROOM_NOT_FOUND");

    const notInRoom = await start(c);
    expect(notInRoom.ok).toBe(false);
    if (!notInRoom.ok) expect(notInRoom.error.code).toBe("NOT_IN_ROOM");

    const roomCode = await createRoom();
    const c1 = await connect();
    const c2 = await connect();
    await join(c1, roomCode, "房主");
    await join(c2, roomCode, "群众");
    const notHost = await start(c2);
    expect(notHost.ok).toBe(false);
    if (!notHost.ok) expect(notHost.error.code).toBe("NOT_HOST");

    c.close();
    c1.close();
    c2.close();
  });

  it("开局后加入 → 旁观者（不能执行动作）", async () => {
    const roomCode = await createRoom();
    const c1 = await connect();
    const c2 = await connect();
    const j1 = await join(c1, roomCode, "甲");
    await join(c2, roomCode, "乙");
    if (!j1.ok) throw new Error();

    const started = waitFor<RoomStatePayload>(c1, "room:state", (p) => p.game !== null);
    await start(c1);
    const game = (await started).game!;

    const c3 = await connect();
    const j3 = await join(c3, roomCode, "观众");
    expect(j3.ok).toBe(true);
    if (!j3.ok) return;
    expect(j3.you.kind).toBe("spectator");

    const r = await act(c3, { type: "ROLL_DICE", playerId: game.currentPlayerId }, "spec-1");
    expect(r.ok).toBe(false);

    c1.close();
    c2.close();
    c3.close();
  });
});
