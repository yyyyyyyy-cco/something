/**
 * 客户端状态与网络编排（M2-4 / M2-5）
 * - Zustand store：会话、房间、对局镜像、日志/聊天、动画队列与状态锁
 * - 事件播放队列：逐条播放动画后写入日志；播放期间锁输入
 * - 自动重连：连接建立时凭本地令牌归位（刷新 / 断网 60s 内均可恢复）
 */
import { create } from "zustand";
import { BOARD_TILES, cardById } from "@monopoly/shared";
import type {
  Action,
  ChatMessage,
  GameEvent,
  GameRecord,
  GameState,
  JoinAck,
  OkAck,
  RoomInfo,
  RoomSettings,
  RoomStatePayload,
  TimerInfo,
} from "@monopoly/shared";
import { describeEvent } from "./event-text.js";
import type { LogKind } from "./event-text.js";
import { getSocket, resetSocket } from "./socket.js";
import { sfx } from "./sound.js";

export interface Session {
  roomCode: string;
  memberId: string;
  token: string;
  name: string;
}

export interface LogEntry {
  id: string;
  seq: number;
  text: string;
  kind: LogKind;
}

interface QueuedEvent {
  seq: number;
  event: GameEvent;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** 本地动作（playerId 由 store 注入当前会话成员） */
export type LocalAction = DistributiveOmit<Action, "playerId">;

const SESSION_KEY = "monopoly.session.v1";
const MAX_LOGS = 200;

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function positionsOf(game: GameState | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (game) for (const p of game.players) out[p.id] = p.position;
  return out;
}

let logCounter = 0;
function makeLog(
  seq: number,
  event: GameEvent,
  nameOf: (id: string | "bank") => string,
): LogEntry | null {
  const desc = describeEvent(event, nameOf);
  if (!desc) return null;
  logCounter += 1;
  return { id: `log-${logCounter}`, seq, text: desc.text, kind: desc.kind };
}

function makeNameResolver(members: RoomInfo["members"]) {
  return (id: string | "bank"): string => {
    if (id === "bank") return "银行";
    return members.find((m) => m.id === id)?.name ?? id;
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 卡牌弹层（M4-1）：播放 CARD_DRAWN 时展示 */
export interface ActiveCard {
  deck: "chance" | "chest";
  text: string;
  key: number;
}

/** 中央速报（M4-1）：购买 / 拍卖成交 / 罚金池等瞬态提示 */
export interface Flash {
  title: string;
  sub?: string;
  tone: "ok" | "info" | "bad";
  key: number;
}

interface AppStore {
  connected: boolean;
  session: Session | null;
  room: RoomInfo | null;
  game: GameState | null;
  logs: LogEntry[];
  chat: ChatMessage[];
  dice: [number, number] | null;
  animPositions: Record<string, number>;
  eventQueue: QueuedEvent[];
  /** 事件播放中（播放期间锁定输入） */
  playing: boolean;
  activeTile: number | null;
  error: string | null;
  notice: string | null;
  /** 服务端计时（M3）：剩余毫秒快照 + 本地接收时刻（用于本地倒计时） */
  timers: TimerInfo | null;
  timersReceivedAt: number;
  /** 卡牌弹层与中央速报（M4-1） */
  activeCard: ActiveCard | null;
  flash: Flash | null;
  /** 最近战绩（M4-4；首页加载） */
  records: GameRecord[] | null;

  init: () => void;
  createAndJoin: (name: string) => Promise<void>;
  joinWithCode: (code: string, name: string) => Promise<void>;
  startGame: () => void;
  updateSettings: (settings: Partial<RoomSettings>) => void;
  setAutopilot: (memberId: string, enabled: boolean) => void;
  loadRecords: () => Promise<void>;
  sendChat: (text: string) => void;
  act: (action: LocalAction) => void;
  setActiveTile: (tile: number | null) => void;
  leave: () => void;
  dismissError: () => void;
}

let initialized = false;

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  session: loadSession(),
  room: null,
  game: null,
  logs: [],
  chat: [],
  dice: null,
  animPositions: {},
  eventQueue: [],
  playing: false,
  activeTile: null,
  error: null,
  notice: null,
  timers: null,
  timersReceivedAt: 0,
  activeCard: null,
  flash: null,
  records: null,

  init() {
    if (initialized) return;
    initialized = true;
    const socket = getSocket();

    const rejoin = (): void => {
      const session = get().session;
      if (!session) return;
      socket.emit("room:join", { roomCode: session.roomCode, token: session.token }, (ack: JoinAck) => {
        if (ack.ok) {
          const next: Session = {
            roomCode: session.roomCode,
            memberId: ack.you.memberId,
            token: ack.you.token,
            name: ack.you.name,
          };
          saveSession(next);
          set({ session: next });
        } else if (ack.error.code === "ROOM_NOT_FOUND") {
          saveSession(null);
          set({ session: null, room: null, game: null });
        } else {
          set({ error: ack.error.message });
        }
      });
    };

    socket.on("connect", () => {
      set({ connected: true });
      rejoin(); // 首次加入（带 token 时）与断线重连归位共用同一路径
    });
    socket.on("disconnect", () => set({ connected: false }));

    socket.on("room:state", (payload: RoomStatePayload) => {
      const nameOf = makeNameResolver(payload.room.members);
      const logs = payload.events
        .map((e) => makeLog(e.seq, e.event, nameOf))
        .filter((x): x is LogEntry => x !== null)
        .slice(-MAX_LOGS);
      set({
        room: payload.room,
        game: payload.game,
        logs,
        chat: payload.chat,
        dice: payload.game?.turn.dice ?? null,
        animPositions: positionsOf(payload.game),
        eventQueue: [],
        playing: false,
        activeTile: null,
        timers: payload.timers ?? null,
        timersReceivedAt: Date.now(),
      });
    });

    socket.on("room:members", ({ room }) => set({ room }));

    socket.on("game:update", ({ version, state, events, timers }) => {
      set((prev) => ({
        game: state,
        eventQueue: [...prev.eventQueue, ...events.map((event) => ({ seq: version, event }))],
        timers: timers ?? null,
        timersReceivedAt: Date.now(),
      }));
      void drain();
    });

    socket.on("chat:message", (msg: ChatMessage) =>
      set((prev) => ({ chat: [...prev.chat, msg].slice(-200) })),
    );

    socket.on("room:error", (err) => set({ error: err.message }));
  },

  async createAndJoin(name: string) {
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { roomCode: string };
      await get().joinWithCode(data.roomCode, name);
    } catch {
      set({ error: "创建房间失败，请稍后重试" });
    }
  },

  joinWithCode(code: string, name: string) {
    const clean = code.trim().toUpperCase();
    const nick = name.trim();
    if (!clean) {
      set({ error: "请输入房间码" });
      return Promise.resolve();
    }
    if (!nick) {
      set({ error: "请输入昵称" });
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      getSocket().emit("room:join", { roomCode: clean, name: nick }, (ack: JoinAck) => {
        if (ack.ok) {
          const session: Session = {
            roomCode: clean,
            memberId: ack.you.memberId,
            token: ack.you.token,
            name: ack.you.name,
          };
          saveSession(session);
          set({ session, error: null, notice: ack.resumed ? "已回到原座位" : null });
        } else {
          set({ error: ack.error.message });
        }
        resolve();
      });
    });
  },

  startGame() {
    getSocket().emit("room:start", (ack: OkAck) => {
      if (!ack.ok) set({ error: ack.error.message });
    });
  },

  updateSettings(settings: Partial<RoomSettings>) {
    getSocket().emit("room:settings", { settings }, (ack: OkAck) => {
      if (!ack.ok) set({ error: ack.error.message });
    });
  },

  setAutopilot(memberId: string, enabled: boolean) {
    getSocket().emit("room:autopilot", { memberId, enabled }, (ack: OkAck) => {
      if (!ack.ok) set({ error: ack.error.message });
    });
  },

  async loadRecords() {
    try {
      const res = await fetch("/api/records?limit=10");
      if (!res.ok) return;
      const data = (await res.json()) as { records: GameRecord[] };
      set({ records: data.records });
    } catch {
      /* 战绩加载失败静默（非关键路径） */
    }
  },

  sendChat(text: string) {
    const t = text.trim();
    if (!t) return;
    getSocket().emit("chat:send", { text: t }, (ack: OkAck) => {
      if (!ack.ok) {
        set({ notice: ack.error.code === "RATE_LIMITED" ? "发言太快，请稍后再试" : ack.error.message });
        setTimeout(() => set({ notice: null }), 2500);
      }
    });
  },

  act(action: LocalAction) {
    const { game, playing, session } = get();
    if (!game || !session || playing || game.phase === "ENDED") return;
    getSocket().emit(
      "game:action",
      { action: { ...action, playerId: session.memberId } as Action, actionId: uuid() },
      (ack: OkAck) => {
        if (!ack.ok) set({ error: ack.error.message });
      },
    );
  },

  setActiveTile(tile: number | null) {
    set({ activeTile: tile });
  },

  leave() {
    saveSession(null);
    resetSocket();
    set({
      session: null,
      room: null,
      game: null,
      logs: [],
      chat: [],
      eventQueue: [],
      playing: false,
      activeTile: null,
      notice: null,
      timers: null,
      timersReceivedAt: 0,
      activeCard: null,
      flash: null,
    });
    getSocket(); // 立即重建干净连接（不再自动归位）
  },

  dismissError() {
    set({ error: null });
  },
}));

// ===== 事件播放队列 =====

let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  useStore.setState({ playing: true });
  try {
    for (;;) {
      const queue = useStore.getState().eventQueue;
      if (queue.length === 0) break;
      const head = queue[0]!;
      useStore.setState({ eventQueue: queue.slice(1) });

      await playEvent(head.event);

      const { room } = useStore.getState();
      if (room) {
        const log = makeLog(head.seq, head.event, makeNameResolver(room.members));
        if (log) useStore.setState((prev) => ({ logs: [...prev.logs, log].slice(-MAX_LOGS) }));
      }
    }
  } finally {
    draining = false;
    const { game } = useStore.getState();
    useStore.setState({ playing: false, animPositions: positionsOf(game) });
  }
  // 竞态兜底：播放退出瞬间又入队的事件
  if (useStore.getState().eventQueue.length > 0) void drain();
}

async function playEvent(event: GameEvent): Promise<void> {
  switch (event.type) {
    case "DICE_ROLLED":
      useStore.setState({ dice: event.dice });
      sfx.dice();
      await sleep(550);
      return;
    case "TOKEN_MOVED": {
      const path = event.path;
      if (path.length === 0) {
        await sleep(180);
        return;
      }
      for (let i = 0; i < path.length; i++) {
        const pos = path[i]!;
        useStore.setState((prev) => ({
          animPositions: { ...prev.animPositions, [event.playerId]: pos },
        }));
        if (i % 2 === 0) sfx.step(); // 隔步发声，避免过密
        await sleep(95);
      }
      return;
    }
    case "GAME_STARTED":
      await sleep(120);
      return;
    case "MONEY_TRANSFERRED": {
      // 收入类轻快音（支出类留白，避免嘈杂）
      if (event.reason === "salary" || event.reason === "card-gain" || event.reason === "trade" || event.reason === "pot") {
        sfx.coin();
      }
      await sleep(140);
      return;
    }
    case "PROPERTY_BOUGHT": {
      const tile = BOARD_TILES[event.tile];
      sfx.coin();
      showFlash(`购得 ${tile?.name ?? ""}`, `$${event.price}`, "ok", 800);
      await sleep(520);
      return;
    }
    case "CARD_DRAWN": {
      const text = cardById(event.cardId)?.text ?? event.cardId;
      useStore.setState({ activeCard: { deck: event.deck, text, key: Date.now() } });
      sfx.card();
      await sleep(750);
      useStore.setState({ activeCard: null });
      return;
    }
    case "PLAYER_JAILED":
      sfx.bad();
      await sleep(300);
      return;
    case "PLAYER_RELEASED":
      sfx.good();
      await sleep(220);
      return;
    case "PLAYER_BANKRUPT":
      sfx.bankrupt();
      showFlash("破产出局", undefined, "bad", 1100);
      await sleep(700);
      return;
    case "AUCTION_BID":
      sfx.bid();
      await sleep(160);
      return;
    case "AUCTION_STARTED":
      sfx.bid();
      await sleep(300);
      return;
    case "AUCTION_ENDED":
      if (event.winnerId && event.amount !== null) {
        sfx.coin();
        showFlash(`拍卖成交 $${event.amount}`, BOARD_TILES[event.tile]?.name, "info", 900);
        await sleep(560);
      } else {
        await sleep(220);
      }
      return;
    case "DEBT_OPENED":
      sfx.bad();
      await sleep(320);
      return;
    case "DEBT_SETTLED":
      sfx.good();
      await sleep(260);
      return;
    case "POT_COLLECTED":
      sfx.coin();
      showFlash(`罚金池 +$${event.amount}`, undefined, "ok", 900);
      await sleep(520);
      return;
    case "GAME_ENDED":
      sfx.win();
      await sleep(400);
      return;
    default:
      await sleep(170);
  }
}

/** 中央速报（自动消隐；播放队列串行执行，不会重叠） */
function showFlash(title: string, sub: string | undefined, tone: Flash["tone"], ms: number): void {
  const key = Date.now();
  useStore.setState({ flash: { title, ...(sub ? { sub } : {}), tone, key } });
  void sleep(ms).then(() => {
    if (useStore.getState().flash?.key === key) useStore.setState({ flash: null });
  });
}
