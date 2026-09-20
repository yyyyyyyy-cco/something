/**
 * 服务端 ↔ 客户端 Socket.IO 事件契约（M2，M4 扩展房规/托管/限时）
 * 两端共同引用，保证类型安全（配合 socket.io 的泛型 Server/Socket）。
 */
import type { Action, EngineErrorCode, GameEvent, GameState, RoomSettings } from "./types.js";

export type RoomPhase = "lobby" | "playing" | "ended";
export type MemberKind = "player" | "spectator";

export interface RoomMemberInfo {
  id: string;
  name: string;
  kind: MemberKind;
  connected: boolean;
  isHost: boolean;
  /** 托管中（掉线自动代打 / 房主手动开启）（M4-2） */
  autopilot: boolean;
}

export interface RoomInfo {
  code: string;
  phase: RoomPhase;
  hostId: string | null;
  members: RoomMemberInfo[];
  /** 房规：大厅中为房主待生效配置；对局中为实际生效配置（M4-3） */
  settings: RoomSettings;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  at: number;
}

export interface EventLogEntry {
  /** 事件对应的游戏版本（同一次动作产生的事件共享同一版本；开局为 0） */
  seq: number;
  event: GameEvent;
}

/** 服务端计时信息（剩余毫秒；由服务端计算，避免客户端时钟偏差） */
export interface TimerInfo {
  /** 拍卖出价窗口剩余（state.auction 存在时） */
  auction?: number;
  /** 套现窗口剩余（state.pendingDebt 存在时） */
  cash?: number;
  /** 各私有报价剩余（offerId → 剩余毫秒） */
  trades?: Record<string, number>;
  /** 限时模式剩余（timeLimitMinutes 开启时）（M4-6） */
  timeLeft?: number;
}

/** room:state —— 加入 / 重连时的全量同步（含日志与聊天历史，用于面板重建） */
export interface RoomStatePayload {
  room: RoomInfo;
  game: GameState | null;
  events: EventLogEntry[];
  chat: ChatMessage[];
  timers?: TimerInfo;
}

export interface JoinAckYou {
  memberId: string;
  token: string;
  kind: MemberKind;
  name: string;
}

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

/** 房间层错误码 + 引擎错误码透传（NOT_YOUR_TURN / INVALID_PHASE / ...） */
export type RoomErrorCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NAME_REQUIRED"
  | "INVALID_CODE"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  | "ALREADY_STARTED"
  | "GAME_NOT_STARTED"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "INTERNAL"
  | EngineErrorCode;

export type JoinAck =
  | { ok: true; you: JoinAckYou; resumed: boolean }
  | { ok: false; error: RoomError };

export type OkAck = { ok: true; duplicate?: boolean } | { ok: false; error: RoomError };

export interface ClientToServerEvents {
  "room:join": (
    payload: { roomCode: string; name?: string; token?: string },
    ack: (res: JoinAck) => void,
  ) => void;
  "room:start": (ack: (res: OkAck) => void) => void;
  /** 房主配置房规（仅大厅阶段；M4-3） */
  "room:settings": (payload: { settings: Partial<RoomSettings> }, ack: (res: OkAck) => void) => void;
  /** 托管开关：房主可开关任何人；成员可开关自己（M4-2） */
  "room:autopilot": (payload: { memberId: string; enabled: boolean }, ack: (res: OkAck) => void) => void;
  "game:action": (payload: { action: Action; actionId: string }, ack: (res: OkAck) => void) => void;
  "chat:send": (payload: { text: string }, ack: (res: OkAck) => void) => void;
}

export interface ServerToClientEvents {
  "room:state": (payload: RoomStatePayload) => void;
  "room:members": (payload: { room: RoomInfo }) => void;
  "game:update": (payload: { version: number; state: GameState; events: GameEvent[]; timers?: TimerInfo }) => void;
  "chat:message": (msg: ChatMessage) => void;
  "room:error": (err: RoomError) => void;
}

// ===== M4-4：战绩统计（REST 载荷） =====

export interface GameRecordPlayer {
  id: string;
  name: string;
  money: number;
  /** 总资产（现金 + 地产牌面价（抵押半价）+ 建筑建造成本） */
  assets: number;
  bankrupt: boolean;
}

export interface GameRecord {
  id: number;
  roomCode: string;
  endedAt: number;
  winnerId: string;
  winnerName: string;
  reason: "last-standing" | "time-up";
  players: GameRecordPlayer[];
}
