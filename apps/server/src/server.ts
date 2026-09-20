/**
 * 服务端构建（可测试）：Express（REST + 静态托管）+ Socket.IO 事件层 + 房间服务
 * 事件契约见 @monopoly/shared/src/protocol.ts
 */
import http from "node:http";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import type { DefaultEventsMap } from "socket.io";
import { ENGINE_VERSION } from "@monopoly/engine";
import { APP_NAME, HEALTH_PATH } from "@monopoly/shared";
import type {
  ClientToServerEvents,
  GameEvent,
  GameState,
  RoomError,
  RoomErrorCode,
  RoomStatePayload,
  ServerToClientEvents,
} from "@monopoly/shared";
import { resolveClientDist } from "./config.js";
import { openDatabase, pingDatabase } from "./db.js";
import type { Db } from "./db.js";
import { logger } from "./logger.js";
import { RoomStore } from "./persist.js";
import { DEFAULT_ROOM_TIMEOUTS, ROOM_IDLE_MS, Room, RoomManager } from "./room.js";
import type { RoomTimeouts } from "./room.js";

interface SocketData {
  roomCode: string | null;
  memberId: string | null;
}

export interface BuildServerOptions {
  dataDir: string;
  /** 客户端构建产物目录；不传则自动探测 */
  clientDist?: string | null;
  /** 空闲归档阈值（测试可调小） */
  maxIdleMs?: number;
  /** 超时参数（拍卖/套现/报价；测试可调小） */
  timeouts?: RoomTimeouts;
}

export interface BuiltServer {
  app: express.Express;
  httpServer: http.Server;
  io: Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
  manager: RoomManager;
  store: RoomStore;
  db: Db;
  /** 启动监听，resolve 实际端口（传入 0 获取随机端口，测试用） */
  start(port: number): Promise<number>;
  stop(): Promise<void>;
}

function roomStatePayload(room: Room): RoomStatePayload {
  return {
    room: room.info(),
    game: room.game,
    events: room.recentEvents(100),
    chat: room.chat.slice(-100),
    timers: room.timerInfo(),
  };
}

function fail(code: RoomErrorCode, message: string): { ok: false; error: RoomError } {
  return { ok: false, error: { code, message } };
}

export function buildServer(options: BuildServerOptions): BuiltServer {
  const db = openDatabase(path.join(options.dataDir, "monopoly.db"));
  const store = new RoomStore(db);
  const manager = new RoomManager(store, options.maxIdleMs ?? ROOM_IDLE_MS, options.timeouts ?? DEFAULT_ROOM_TIMEOUTS);

  const app = express();
  app.use(express.json());
  const httpServer = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(httpServer);

  /** 广播对局更新（含计时信息） */
  const broadcastGameUpdate = (room: Room, state: GameState, events: GameEvent[]): void => {
    manager.save(room);
    io.to(room.code).emit("game:update", { version: room.version, state, events, timers: room.timerInfo() });
  };

  /** 注册房间的系统超时回调并启动计时（创建 / 加入 / 开局后调用） */
  const wireRoom = (room: Room): void => {
    room.wireSystemUpdates((state, events) => {
      broadcastGameUpdate(room, state, events);
      logger.info({ code: room.code, phase: state.phase }, "系统超时动作已执行");
    });
  };

  // ---- REST ----
  app.post("/api/rooms", (_req, res) => {
    const room = manager.createRoom();
    wireRoom(room);
    logger.info({ roomCode: room.code }, "房间已创建");
    res.json({ roomCode: room.code });
  });

  // 最近战绩（M4-4）
  app.get("/api/records", (req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json({ records: store.listGameRecords(Number.isFinite(limit) ? limit : 20) });
  });

  app.get(HEALTH_PATH, (_req, res) => {
    res.json({
      ok: true,
      app: APP_NAME,
      engineVersion: ENGINE_VERSION,
      uptime: Math.round(process.uptime()),
      db: pingDatabase(db) ? "ok" : "error",
      sockets: io.engine.clientsCount,
      rooms: manager.size,
      memMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    });
  });

  // ---- 客户端静态资源（生产同源托管） ----
  const clientDist = options.clientDist === undefined ? resolveClientDist() : options.clientDist;
  if (clientDist) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/socket.io") || req.path === HEALTH_PATH) {
        return next();
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
    logger.info({ clientDist }, "已启用客户端静态托管");
  } else {
    logger.warn("未找到客户端构建产物（apps/client/dist），仅提供 API 与 Socket 服务");
  }

  // ---- Socket.IO 事件层 ----
  const context = (socket: { data: SocketData }) => {
    const { roomCode, memberId } = socket.data;
    if (!roomCode || !memberId) return null;
    const room = manager.getRoom(roomCode);
    if (!room) return null;
    const member = room.getMember(memberId);
    if (!member) return null;
    return { room, member };
  };

  io.on("connection", (socket) => {
    socket.data.roomCode = null;
    socket.data.memberId = null;
    logger.debug({ id: socket.id }, "socket 已连接");

    socket.on("room:join", (payload, ack) => {
      try {
        const code = String(payload?.roomCode ?? "").trim().toUpperCase();
        if (!/^[A-Z2-9]{4,8}$/.test(code)) return ack(fail("INVALID_CODE", "房间码格式不正确"));

        const room = manager.getOrRestore(code);
        if (!room) return ack(fail("ROOM_NOT_FOUND", "房间不存在或已过期"));

        const result = room.join({ name: payload?.name, token: payload?.token });
        if (!result.ok) return ack(result);
        const member = result.member;

        // 同成员旧连接下线（重连场景）
        if (member.socketId && member.socketId !== socket.id) {
          const old = io.sockets.sockets.get(member.socketId);
          old?.disconnect(true);
        }
        room.attachSocket(member.id, socket.id);
        socket.data.roomCode = code;
        socket.data.memberId = member.id;
        void socket.join(code);
        manager.save(room);
        wireRoom(room); // 懒加载恢复的房间在此注册系统超时回调

        ack({
          ok: true,
          you: { memberId: member.id, token: member.token, kind: member.kind, name: member.name },
          resumed: result.resumed,
        });
        socket.emit("room:state", roomStatePayload(room));
        io.to(code).emit("room:members", { room: room.info() });
        logger.info({ code, memberId: member.id, kind: member.kind, resumed: result.resumed }, "成员加入/重连");
      } catch (e) {
        logger.error(e, "room:join 处理失败");
        ack(fail("INTERNAL", "服务器内部错误"));
      }
    });

    socket.on("room:start", (ack) => {
      try {
        const ctx = context(socket);
        if (!ctx) return ack(fail("NOT_IN_ROOM", "尚未加入房间"));
        const result = ctx.room.startGame(ctx.member.id);
        if (!result.ok) return ack(result);
        manager.save(ctx.room);
        ctx.room.scheduleTimers();
        io.to(ctx.room.code).emit("room:state", roomStatePayload(ctx.room));
        ack({ ok: true });
        logger.info({ code: ctx.room.code }, "对局已开始");
      } catch (e) {
        logger.error(e, "room:start 处理失败");
        ack(fail("INTERNAL", "服务器内部错误"));
      }
    });

    socket.on("room:settings", (payload, ack) => {
      try {
        const ctx = context(socket);
        if (!ctx) return ack(fail("NOT_IN_ROOM", "尚未加入房间"));
        const result = ctx.room.updateSettings(ctx.member.id, payload?.settings ?? {});
        if (!result.ok) return ack(result);
        manager.save(ctx.room);
        io.to(ctx.room.code).emit("room:members", { room: ctx.room.info() });
        ack({ ok: true });
      } catch (e) {
        logger.error(e, "room:settings 处理失败");
        ack(fail("INTERNAL", "服务器内部错误"));
      }
    });

    socket.on("room:autopilot", (payload, ack) => {
      try {
        const ctx = context(socket);
        if (!ctx) return ack(fail("NOT_IN_ROOM", "尚未加入房间"));
        const memberId = String(payload?.memberId ?? "");
        if (!memberId) return ack(fail("BAD_REQUEST", "缺少成员 ID"));
        const result = ctx.room.setAutopilot(ctx.member.id, memberId, Boolean(payload?.enabled));
        if (!result.ok) return ack(result);
        manager.save(ctx.room);
        io.to(ctx.room.code).emit("room:members", { room: ctx.room.info() });
        ack({ ok: true });
      } catch (e) {
        logger.error(e, "room:autopilot 处理失败");
        ack(fail("INTERNAL", "服务器内部错误"));
      }
    });

    socket.on("game:action", (payload, ack) => {
      try {
        const ctx = context(socket);
        if (!ctx) return ack(fail("NOT_IN_ROOM", "尚未加入房间"));
        const actionId = String(payload?.actionId ?? "");
        if (!actionId || !payload?.action) return ack(fail("BAD_REQUEST", "非法动作请求"));

        const result = ctx.room.applyGameAction(ctx.member.id, payload.action, actionId);
        if (!result.ok) return ack(result);
        if (result.duplicate) return ack({ ok: true, duplicate: true });

        broadcastGameUpdate(ctx.room, result.state, result.events);
        ack({ ok: true });
      } catch (e) {
        logger.error(e, "game:action 处理失败");
        ack(fail("INTERNAL", "服务器内部错误"));
      }
    });

    socket.on("chat:send", (payload, ack) => {
      try {
        const ctx = context(socket);
        if (!ctx) return ack(fail("NOT_IN_ROOM", "尚未加入房间"));
        const result = ctx.room.addChat(ctx.member.id, String(payload?.text ?? ""));
        if (!result.ok) return ack(result);
        manager.save(ctx.room);
        io.to(ctx.room.code).emit("chat:message", result.message);
        ack({ ok: true });
      } catch (e) {
        logger.error(e, "chat:send 处理失败");
        ack(fail("INTERNAL", "服务器内部错误"));
      }
    });

    socket.on("disconnect", (reason) => {
      const code = socket.data.roomCode;
      logger.debug({ id: socket.id, reason }, "socket 已断开");
      if (!code) return;
      const room = manager.getRoom(code);
      if (!room) return;
      const member = room.detachSocket(socket.id);
      if (member) {
        io.to(code).emit("room:members", { room: room.info() });
        logger.info({ code, memberId: member.id }, "成员断线（保留席位）");
      }
    });
  });

  manager.startSweeper();

  return {
    app,
    httpServer,
    io,
    manager,
    store,
    db,
    start(port: number) {
      return new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, () => {
          const addr = httpServer.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    },
    async stop() {
      manager.stopSweeper();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
      db.close();
    },
  };
}
