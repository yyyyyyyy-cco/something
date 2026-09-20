/**
 * 房间领域模型与房间管理器（M2-1 / M2-3，M3 扩展超时驱动）
 * - 成员与旁观者、令牌重连、容量控制（2-6 玩家 + 旁观者）
 * - 引擎对局托管（服务端权威）、事件环形缓冲（200 条）、聊天限速（≤5 条/秒）
 * - 空闲 30 分钟归档：从内存卸载，SQLite 记录保留；再次加入时懒加载恢复
 * - M3 超时驱动：拍卖 30s 无人加价成交 / 套现窗口 60s / 私有报价 60s
 */
import { randomBytes, randomUUID } from "node:crypto";
import {
  AUCTION_TIMEOUT_MS,
  BOARD_TILES,
  CASH_WINDOW_MS,
  DEFAULT_SETTINGS,
  JAIL_BAIL,
  MAX_PLAYERS,
  MIN_PLAYERS,
  SETTINGS_LIMITS,
  TRADE_TIMEOUT_MS,
} from "@monopoly/shared";
import type {
  Action,
  ChatMessage,
  EventLogEntry,
  GameEvent,
  GameRecord,
  GameRecordPlayer,
  GameState,
  RoomError,
  RoomErrorCode,
  RoomInfo,
  RoomPhase,
  RoomSettings,
  TimerInfo,
} from "@monopoly/shared";
import { applyAction, canSellHouse, computeNetWorth, createGame, mortgageValueOf, normalizeState, secureRng } from "@monopoly/engine";
import type { Rng } from "@monopoly/engine";
import type { PersistedMember, RoomRecord, RoomStore } from "./persist.js";

/** 空闲归档阈值（requirements §7.2） */
export const ROOM_IDLE_MS = 30 * 60 * 1000;
const EVENT_LOG_LIMIT = 200;
const CHAT_LIMIT = 100;
const CHAT_RATE_WINDOW_MS = 1000;
const CHAT_RATE_MAX = 5;
const NAME_MAX = 12;
const CHAT_TEXT_MAX = 200;
const ACTION_ID_BUFFER = 50;

/** 房间超时参数（默认取自共享常量；测试可注入短值） */
export interface RoomTimeouts {
  auctionMs: number;
  cashMs: number;
  tradeMs: number;
  /** 掉线自动代打：检测到需要离线玩家动作后的延迟（M4-2） */
  autopilotDisconnectedMs: number;
  /** 手动托管：房主开启后的动作延迟（M4-2） */
  autopilotManualMs: number;
  /** 托管轮询间隔（M4-2） */
  autopilotTickMs: number;
}

export const DEFAULT_ROOM_TIMEOUTS: RoomTimeouts = {
  auctionMs: AUCTION_TIMEOUT_MS,
  cashMs: CASH_WINDOW_MS,
  tradeMs: TRADE_TIMEOUT_MS,
  autopilotDisconnectedMs: 8000,
  autopilotManualMs: 1500,
  autopilotTickMs: 1500,
};

/** 房间码字母表：去除易混字符（0/O、1/I/L） */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

/** 清洗输入：控制字符替换为空格（保留词间分隔）、压缩空白、截断长度（前端展示由 React 转义防 XSS） */
export function sanitizeText(input: string, maxLen: number): string {
  return input
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export interface Member {
  id: string;
  name: string;
  token: string;
  kind: "player" | "spectator";
  socketId: string | null;
  connected: boolean;
}

type Err = { ok: false; error: RoomError };

function err(code: RoomErrorCode, message: string): Err {
  return { ok: false, error: { code, message } };
}

export type JoinResult =
  | { ok: true; member: Member; resumed: boolean }
  | Err;

export class Room {
  readonly code: string;
  readonly createdAt: number;
  phase: RoomPhase = "lobby";
  hostId: string | null = null;
  game: GameState | null = null;
  version = 0;
  chat: ChatMessage[] = [];
  lastActivityAt = Date.now();

  private readonly log: EventLogEntry[] = [];
  private readonly members = new Map<string, Member>();
  private readonly actionIds = new Map<string, string[]>();
  private readonly chatStamps = new Map<string, number[]>();
  private readonly rng: Rng = secureRng();

  // ===== M3：超时计时（拍卖 30s / 套现 60s / 报价 60s）=====
  private auctionTimer: NodeJS.Timeout | null = null;
  private cashTimer: NodeJS.Timeout | null = null;
  private readonly tradeTimers = new Map<string, NodeJS.Timeout>();
  private auctionDeadlineAt: number | null = null;
  private cashDeadlineAt: number | null = null;
  private cashPayerId: string | null = null;
  private readonly tradeDeadlineAt = new Map<string, number>();
  /** 系统超时动作执行后的广播回调（由 server 层注入） */
  private systemUpdateHandler: ((state: GameState, events: GameEvent[]) => void) | null = null;
  /** 超时参数（默认 30s/60s/60s；测试可注入短值） */
  private readonly timeouts: RoomTimeouts;

  // ===== M4：房规 / 托管 / 限时 / 战绩 =====
  /** 大厅待生效房规（开局时冻结进 GameState.settings） */
  pendingSettings: RoomSettings = { ...DEFAULT_SETTINGS };
  /** 托管中的玩家（手动开启或掉线自动） */
  private readonly autopilot = new Set<string>();
  /** 检测到"需要某玩家动作但不可用"的起始时间（延迟后自动代打） */
  private readonly autopilotPendingSince = new Map<string, number>();
  private autopilotTimer: NodeJS.Timeout | null = null;
  private timeLimitDeadlineAt: number | null = null;
  private timeLimitTimer: NodeJS.Timeout | null = null;
  /** 战绩是否已落库（防重复） */
  private recordSaved = false;

  constructor(
    code: string,
    private readonly store: RoomStore,
    record?: RoomRecord,
    timeouts: RoomTimeouts = DEFAULT_ROOM_TIMEOUTS,
  ) {
    this.code = code;
    this.createdAt = Date.now();
    this.timeouts = timeouts;
    if (record) {
      this.phase = record.phase;
      this.hostId = record.meta.hostId;
      for (const m of record.meta.members) {
        this.members.set(m.id, { ...m, socketId: null, connected: false });
      }
      this.chat = record.meta.chat;
      this.game = record.state ? normalizeState(record.state) : null; // 兼容 M2 旧快照
      this.version = record.version;
      if (this.game) this.pendingSettings = { ...this.game.settings };
      this.recordSaved = this.phase === "ended"; // 已结束的房间不再重复记录
      // 注：事件环形缓冲不持久化（客户端重连时以全量 state 为准，日志面板从恢复时刻起重新累积）
    }
  }

  /** 注入系统更新回调并启动超时计时（server 层在创建/加入/开局后调用） */
  wireSystemUpdates(handler: (state: GameState, events: GameEvent[]) => void): void {
    this.systemUpdateHandler = handler;
    this.scheduleTimers();
    this.startAutopilotTicker();
  }

  // ===== M4-2：托管（掉线自动代打 / 手动托管）=====

  /** 启动托管轮询（幂等） */
  private startAutopilotTicker(): void {
    if (this.autopilotTimer) return;
    this.autopilotTimer = setInterval(() => this.tickAutopilot(), this.timeouts.autopilotTickMs);
    this.autopilotTimer.unref?.();
  }

  /** 当前需要动作的玩家（无则 null；与引擎 phase 对应） */
  private needsActorId(): string | null {
    const g = this.game;
    if (!g || g.phase === "ENDED") return null;
    if (g.phase === "AUCTION") return g.auction?.queue[0] ?? null;
    if (g.phase === "CASH_WINDOW") return g.pendingDebt?.payerId ?? null;
    return g.currentPlayerId;
  }

  /**
   * 托管轮询：需要动作的玩家不可用（离线或手动托管）且超过延迟 → 自动代打。
   * 延迟：掉线 8 秒 / 手动 1.5 秒（测试可注入短值）。
   */
  tickAutopilot(now = Date.now()): void {
    const actorId = this.needsActorId();
    if (!actorId) {
      this.autopilotPendingSince.clear();
      return;
    }
    const member = this.members.get(actorId);
    if (!member || member.kind !== "player") return;

    const manual = this.autopilot.has(actorId);
    if (member.connected && !manual) {
      this.autopilotPendingSince.delete(actorId);
      return; // 在线且未托管：等待玩家操作
    }

    const since = this.autopilotPendingSince.get(actorId) ?? now;
    if (!this.autopilotPendingSince.has(actorId)) this.autopilotPendingSince.set(actorId, since);
    const delay = manual ? this.timeouts.autopilotManualMs : this.timeouts.autopilotDisconnectedMs;
    if (now - since < delay) return;

    const action = this.autoActionFor(actorId);
    this.autopilotPendingSince.delete(actorId);
    if (!action) return;
    this.applySystemAction(action); // 竞态失败时下轮重新评估
  }

  /** 托管自动动作（保守策略，参考 HumanSean 最简 AI） */
  private autoActionFor(playerId: string): Action | null {
    const g = this.game;
    if (!g) return null;
    const p = g.players.find((x) => x.id === playerId);
    if (!p || p.bankrupt) return null;

    if (g.phase === "AWAITING_ACTION") {
      const pending = g.pendingPurchase;
      if (!pending) return null;
      const price = BOARD_TILES[pending.tileIndex]!.price ?? 0;
      // 保守购买：买得起且花费不超过现有现金一半
      return p.money >= price && price * 2 <= p.money
        ? { type: "BUY_PROPERTY", playerId }
        : { type: "DECLINE_PURCHASE", playerId };
    }
    if (g.phase === "AUCTION") {
      return { type: "PASS_BID", playerId, reason: "timeout" }; // 托管不参与竞拍
    }
    if (g.phase === "CASH_WINDOW") {
      const raise = this.chooseAutoCashRaise(playerId);
      return raise ?? { type: "CASH_TIMEOUT", playerId };
    }
    // AWAITING_ROLL
    if (p.inJail && p.getOutOfJailCards.length > 0) return { type: "USE_JAIL_CARD", playerId };
    if (p.inJail && p.money >= JAIL_BAIL) return { type: "PAY_BAIL", playerId };
    return { type: "ROLL_DICE", playerId };
  }

  /** 托管套现：先卖房（平均原则由引擎校验），再抵押（担保值高者优先） */
  private chooseAutoCashRaise(playerId: string): Action | null {
    const g = this.game!;
    for (const ts of g.tiles) {
      if (ts.ownerId !== playerId || (ts.houses === 0 && !ts.hotel)) continue;
      if (canSellHouse(g, playerId, ts.index) === null) {
        return { type: "SELL_HOUSE", playerId, tile: ts.index };
      }
    }
    const candidates = g.tiles
      .filter(
        (t) =>
          t.ownerId === playerId &&
          !t.mortgaged &&
          t.houses === 0 &&
          !t.hotel &&
          !g.listings.some((l) => l.tile === t.index),
      )
      .sort((a, b) => mortgageValueOf(BOARD_TILES[b.index]!) - mortgageValueOf(BOARD_TILES[a.index]!));
    const pick = candidates[0];
    return pick ? { type: "MORTGAGE", playerId, tile: pick.index } : null;
  }

  // ===== M4-4：战绩落库 =====

  private saveGameRecord(events: GameEvent[]): void {
    const g = this.game;
    if (this.recordSaved || !g || g.winnerId === null) return;
    this.recordSaved = true;

    const players: GameRecordPlayer[] = g.players.map((p) => ({
      id: p.id,
      name: this.members.get(p.id)?.name ?? p.name,
      money: p.money,
      assets: computeNetWorth(g, p.id),
      bankrupt: p.bankrupt,
    }));
    const winnerName = this.members.get(g.winnerId)?.name ?? "";
    const endedEvent = events.find((e) => e.type === "GAME_ENDED");
    const reason: GameRecord["reason"] =
      endedEvent && endedEvent.type === "GAME_ENDED" && endedEvent.reason ? endedEvent.reason : "last-standing";

    try {
      this.store.saveGameRecord({
        roomCode: this.code,
        endedAt: Date.now(),
        winnerId: g.winnerId,
        winnerName,
        reason,
        players,
      });
    } catch {
      // 战绩写入失败不影响对局（下局继续）
    }
  }

  touch(): void {
    this.lastActivityAt = Date.now();
  }

  memberList(): Member[] {
    return [...this.members.values()];
  }

  getMember(memberId: string): Member | undefined {
    return this.members.get(memberId);
  }

  playerCount(): number {
    return this.memberList().filter((m) => m.kind === "player").length;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      members: this.memberList().map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        connected: m.connected,
        isHost: m.id === this.hostId,
        autopilot: this.autopilot.has(m.id),
      })),
      settings: this.phase === "lobby" || !this.game ? { ...this.pendingSettings } : { ...this.game.settings },
    };
  }

  /** 加入或令牌重连 */
  join(options: { name?: string; token?: string }): JoinResult {
    // 1) 令牌重连：恢复原成员（分数、房主身份等保持）
    if (options.token) {
      const existed = this.memberList().find((m) => m.token === options.token);
      if (existed) {
        existed.connected = true;
        this.touch();
        return { ok: true, member: existed, resumed: true };
      }
      // 令牌无效（如房间记录被清理）→ 降级为新加入（需昵称）
    }

    const name = sanitizeText(options.name ?? "", NAME_MAX);
    if (!name) return err("NAME_REQUIRED", "请提供昵称");

    // 2) 新成员：大厅内为玩家（≤6），开局后为旁观者
    let kind: Member["kind"];
    if (this.phase === "lobby") {
      if (this.playerCount() >= MAX_PLAYERS) return err("ROOM_FULL", `房间已满（${MAX_PLAYERS} 名玩家）`);
      kind = "player";
    } else {
      kind = "spectator";
    }

    const member: Member = {
      id: `m${randomBytes(6).toString("hex")}`,
      name,
      token: randomBytes(16).toString("hex"),
      kind,
      socketId: null,
      connected: true,
    };
    this.members.set(member.id, member);
    if (!this.hostId) this.hostId = member.id; // 首位加入者成为房主
    this.touch();
    return { ok: true, member, resumed: false };
  }

  attachSocket(memberId: string, socketId: string): void {
    const member = this.members.get(memberId);
    if (!member) return;
    member.socketId = socketId;
    member.connected = true;
  }

  detachSocket(socketId: string): Member | null {
    const member = this.memberList().find((m) => m.socketId === socketId);
    if (!member) return null;
    member.socketId = null;
    member.connected = false;
    this.touch();
    return member;
  }

  /** 房主开局（引擎 createGame；冻结房规并启动限时计时） */
  startGame(byMemberId: string): { ok: true; events: GameEvent[] } | Err {
    if (byMemberId !== this.hostId) return err("NOT_HOST", "只有房主可以开始游戏");
    if (this.phase !== "lobby") return err("ALREADY_STARTED", "对局已经开始");
    const players = this.memberList().filter((m) => m.kind === "player");
    if (players.length < MIN_PLAYERS) return err("NOT_ENOUGH_PLAYERS", `至少需要 ${MIN_PLAYERS} 名玩家`);

    const { state, events } = createGame(players.map((p) => ({ id: p.id, name: p.name })), {
      settings: this.pendingSettings,
    });
    this.game = state;
    this.version = state.version;
    this.phase = "playing";
    for (const event of events) this.appendLog(0, event);
    this.touch();
    if (state.settings.timeLimitMinutes !== null) {
      this.timeLimitDeadlineAt = Date.now() + state.settings.timeLimitMinutes * 60_000;
    }
    return { ok: true, events };
  }

  /** 房主更新房规（仅大厅；字段白名单 + 范围校验——M4-3） */
  updateSettings(byMemberId: string, patch: Partial<RoomSettings>): { ok: true } | Err {
    if (byMemberId !== this.hostId) return err("NOT_HOST", "只有房主可以修改房规");
    if (this.phase !== "lobby") return err("ALREADY_STARTED", "对局开始后不可修改房规");

    const next: RoomSettings = { ...this.pendingSettings };
    if (patch.startMoney !== undefined) {
      if (!Number.isInteger(patch.startMoney) || patch.startMoney < SETTINGS_LIMITS.startMoneyMin || patch.startMoney > SETTINGS_LIMITS.startMoneyMax) {
        return err("BAD_REQUEST", `起始资金须为 ${SETTINGS_LIMITS.startMoneyMin}-${SETTINGS_LIMITS.startMoneyMax} 的整数`);
      }
      next.startMoney = patch.startMoney;
    }
    if (patch.timeLimitMinutes !== undefined) {
      if (patch.timeLimitMinutes !== null && !SETTINGS_LIMITS.timeLimitOptions.includes(patch.timeLimitMinutes as 60 | 90)) {
        return err("BAD_REQUEST", "限时模式仅支持 60 / 90 分钟或关闭");
      }
      next.timeLimitMinutes = patch.timeLimitMinutes;
    }
    for (const key of ["auctionEnabled", "mortgageBreaksMonopoly", "potEnabled", "housingLimited"] as const) {
      if (patch[key] !== undefined) next[key] = Boolean(patch[key]);
    }
    this.pendingSettings = next;
    this.touch();
    return { ok: true };
  }

  /** 托管开关：房主可开关任何人；成员可开关自己（M4-2） */
  setAutopilot(byMemberId: string, targetId: string, enabled: boolean): { ok: true } | Err {
    const actor = this.members.get(byMemberId);
    const target = this.members.get(targetId);
    if (!actor || !target) return err("NOT_IN_ROOM", "成员不存在");
    if (target.kind !== "player") return err("BAD_REQUEST", "旁观者无需托管");
    if (byMemberId !== this.hostId && byMemberId !== targetId) return err("NOT_HOST", "只有房主可以管理他人托管");
    if (enabled) this.autopilot.add(targetId);
    else this.autopilot.delete(targetId);
    this.autopilotPendingSince.delete(targetId);
    this.touch();
    return { ok: true };
  }

  /** 是否处于托管（含手动开关） */
  isAutopilot(memberId: string): boolean {
    return this.autopilot.has(memberId);
  }

  /** 应用游戏动作（注意：actionId 幂等；成员归属由调用方传入） */
  applyGameAction(
    memberId: string,
    action: Action,
    actionId: string,
  ): { ok: true; duplicate: boolean; state: GameState; events: GameEvent[] } | Err {
    if (!this.game || this.phase === "lobby") return err("GAME_NOT_STARTED", "对局尚未开始");

    // actionId 幂等（网络重试/重复点击）
    const seen = this.actionIds.get(memberId) ?? [];
    if (seen.includes(actionId)) {
      return { ok: true, duplicate: true, state: this.game, events: [] };
    }
    seen.push(actionId);
    if (seen.length > ACTION_ID_BUFFER) seen.shift();
    this.actionIds.set(memberId, seen);

    const member = this.members.get(memberId);
    if (!member || member.kind !== "player") return err("NOT_IN_ROOM", "旁观者不能执行游戏动作");
    if (action.playerId !== memberId) return err("INVALID_ACTION", "动作玩家与操作成员不一致");

    const result = applyAction(this.game, action, this.rng);
    if (!result.ok) return { ok: false, error: result.error };

    this.game = result.state;
    this.version = result.state.version;
    for (const event of result.events) this.appendLog(this.version, event);
    if (result.state.phase === "ENDED") {
      this.phase = "ended";
      this.saveGameRecord(result.events);
    }
    this.touch();
    this.scheduleTimers();
    return { ok: true, duplicate: false, state: result.state, events: result.events };
  }

  /**
   * 执行系统动作（超时驱动：PASS_BID / CASH_TIMEOUT / REJECT_TRADE）。
   * 绕过成员校验与幂等；若与玩家动作竞态且已不再适用（引擎拒绝），静默忽略。
   * 成功后经 systemUpdateHandler 广播（server 层注入）。
   */
  applySystemAction(action: Action): boolean {
    // 以引擎状态为准（房间层 phase 由 applyGameAction/applySystemAction 同步维护）
    if (!this.game || this.game.phase === "ENDED") return false;

    const result = applyAction(this.game, action, this.rng);
    if (!result.ok) return false; // 竞态：状态已被玩家动作推进，本次超时无需执行

    this.game = result.state;
    this.version = result.state.version;
    for (const event of result.events) this.appendLog(this.version, event);
    if (result.state.phase === "ENDED") {
      this.phase = "ended";
      this.saveGameRecord(result.events);
    }
    this.touch();
    this.scheduleTimers();
    this.systemUpdateHandler?.(result.state, result.events);
    return true;
  }

  /** 计时信息（剩余毫秒；随广播下发，客户端本地倒计时） */
  timerInfo(): TimerInfo {
    const info: TimerInfo = {};
    const now = Date.now();
    if (this.auctionDeadlineAt !== null && this.game?.auction) {
      info.auction = Math.max(0, this.auctionDeadlineAt - now);
    }
    if (this.cashDeadlineAt !== null && this.game?.pendingDebt) {
      info.cash = Math.max(0, this.cashDeadlineAt - now);
    }
    if (this.tradeDeadlineAt.size > 0) {
      const trades: Record<string, number> = {};
      for (const [id, at] of this.tradeDeadlineAt) trades[id] = Math.max(0, at - now);
      info.trades = trades;
    }
    if (this.timeLimitDeadlineAt !== null && this.game && this.game.phase !== "ENDED") {
      info.timeLeft = Math.max(0, this.timeLimitDeadlineAt - now);
    }
    return info;
  }

  /** 依据当前对局状态重建全部超时计时（每次状态变化后调用） */
  scheduleTimers(): void {
    this.clearTimers();
    const g = this.game;
    if (!g || g.phase === "ENDED") {
      this.auctionDeadlineAt = null;
      this.cashDeadlineAt = null;
      this.cashPayerId = null;
      this.tradeDeadlineAt.clear();
      return;
    }

    // 拍卖：每次状态变化重置为完整窗口（“30 秒无人加价”语义）
    if (g.auction) {
      this.auctionDeadlineAt = Date.now() + this.timeouts.auctionMs;
      const waiting = g.auction.queue[0];
      if (waiting) {
        this.auctionTimer = setTimeout(() => {
          this.applySystemAction({ type: "PASS_BID", playerId: waiting, reason: "timeout" });
        }, this.timeouts.auctionMs);
        this.auctionTimer.unref?.();
      }
    } else {
      this.auctionDeadlineAt = null;
    }

    // 套现窗口：从开启起 60s（同一欠款人不随动作重置）
    if (g.pendingDebt) {
      if (this.cashPayerId !== g.pendingDebt.payerId) {
        this.cashPayerId = g.pendingDebt.payerId;
        this.cashDeadlineAt = Date.now() + this.timeouts.cashMs;
      }
      const payer = g.pendingDebt.payerId;
      const remain = Math.max(0, (this.cashDeadlineAt ?? Date.now()) - Date.now());
      this.cashTimer = setTimeout(() => {
        this.applySystemAction({ type: "CASH_TIMEOUT", playerId: payer });
      }, remain);
      this.cashTimer.unref?.();
    } else {
      this.cashPayerId = null;
      this.cashDeadlineAt = null;
    }

    // 私有报价：每个报价 60s 独立计时（超时以 REJECT_TRADE(reason=timeout) 驱动）
    const liveIds = new Set(g.trades.map((o) => o.id));
    for (const [id, timer] of this.tradeTimers) {
      if (!liveIds.has(id)) {
        clearTimeout(timer);
        this.tradeTimers.delete(id);
        this.tradeDeadlineAt.delete(id);
      }
    }
    for (const offer of g.trades) {
      if (this.tradeTimers.has(offer.id)) continue;
      this.tradeDeadlineAt.set(offer.id, Date.now() + this.timeouts.tradeMs);
      const timer = setTimeout(() => {
        this.applySystemAction({ type: "REJECT_TRADE", playerId: offer.toId, offerId: offer.id, reason: "timeout" });
      }, this.timeouts.tradeMs);
      timer.unref?.();
      this.tradeTimers.set(offer.id, timer);
    }

    // 限时模式：从开局起的固定截止时间（M4-6；到点按总资产裁决）
    if (this.timeLimitDeadlineAt !== null) {
      const remain = Math.max(0, this.timeLimitDeadlineAt - Date.now());
      this.timeLimitTimer = setTimeout(() => {
        this.applySystemAction({ type: "TIME_UP", playerId: this.game?.currentPlayerId ?? "" });
      }, remain);
      this.timeLimitTimer.unref?.();
    }
  }

  private clearTimers(): void {
    if (this.auctionTimer) {
      clearTimeout(this.auctionTimer);
      this.auctionTimer = null;
    }
    if (this.cashTimer) {
      clearTimeout(this.cashTimer);
      this.cashTimer = null;
    }
    if (this.timeLimitTimer) {
      clearTimeout(this.timeLimitTimer);
      this.timeLimitTimer = null;
    }
    for (const timer of this.tradeTimers.values()) clearTimeout(timer);
    this.tradeTimers.clear();
  }

  /** 归档/销毁前释放定时器（sweep 时调用） */
  dispose(): void {
    this.clearTimers();
    if (this.autopilotTimer) {
      clearInterval(this.autopilotTimer);
      this.autopilotTimer = null;
    }
    this.tradeDeadlineAt.clear();
    this.autopilotPendingSince.clear();
    this.auctionDeadlineAt = null;
    this.cashDeadlineAt = null;
    this.cashPayerId = null;
    this.timeLimitDeadlineAt = null;
    this.systemUpdateHandler = null;
  }

  /** 聊天（限速 ≤5 条/秒） */
  addChat(memberId: string, rawText: string): { ok: true; message: ChatMessage } | Err {
    const member = this.members.get(memberId);
    if (!member) return err("NOT_IN_ROOM", "成员不存在");

    const now = Date.now();
    const stamps = (this.chatStamps.get(memberId) ?? []).filter((t) => now - t < CHAT_RATE_WINDOW_MS);
    if (stamps.length >= CHAT_RATE_MAX) return err("RATE_LIMITED", "发言太快，请稍后再试");
    stamps.push(now);
    this.chatStamps.set(memberId, stamps);

    const text = sanitizeText(rawText, CHAT_TEXT_MAX);
    if (!text) return err("BAD_REQUEST", "消息为空");

    const message: ChatMessage = {
      id: randomUUID(),
      from: memberId,
      name: member.name,
      text,
      at: now,
    };
    this.chat.push(message);
    if (this.chat.length > CHAT_LIMIT) this.chat.shift();
    this.touch();
    return { ok: true, message };
  }

  recentEvents(limit = 100): EventLogEntry[] {
    return this.log.slice(-limit);
  }

  private appendLog(seq: number, event: GameEvent): void {
    this.log.push({ seq, event });
    if (this.log.length > EVENT_LOG_LIMIT) this.log.shift();
  }

  toRecord(): RoomRecord {
    const members: PersistedMember[] = this.memberList().map((m) => ({
      id: m.id,
      name: m.name,
      token: m.token,
      kind: m.kind,
    }));
    return {
      roomCode: this.code,
      phase: this.phase,
      meta: { hostId: this.hostId, members, chat: this.chat },
      state: this.game,
      version: this.version,
      updatedAt: Date.now(),
    };
  }
}

/**
 * 房间管理器：内存注册表 + SQLite 懒加载恢复 + 空闲归档
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: RoomStore,
    private readonly idleMs: number = ROOM_IDLE_MS,
    private readonly timeouts: RoomTimeouts = DEFAULT_ROOM_TIMEOUTS,
  ) {}

  createRoom(): Room {
    let code = generateRoomCode();
    let guard = 0;
    while ((this.rooms.has(code) || this.store.load(code)) && guard++ < 100) {
      code = generateRoomCode();
    }
    const room = new Room(code, this.store, undefined, this.timeouts);
    this.rooms.set(code, room);
    this.store.save(room.toRecord());
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /** 内存优先；未命中从 SQLite 懒加载恢复（服务器重启/归档后） */
  getOrRestore(code: string): Room | null {
    const inMemory = this.rooms.get(code);
    if (inMemory) return inMemory;
    const record = this.store.load(code);
    if (!record) return null;
    const room = new Room(code, this.store, record, this.timeouts);
    this.rooms.set(code, room);
    return room;
  }

  save(room: Room): void {
    this.store.save(room.toRecord());
  }

  /** 归档空闲房间（无在线成员且超过空闲阈值）：从内存卸载，DB 记录保留 */
  sweep(now = Date.now()): string[] {
    const archived: string[] = [];
    for (const [code, room] of this.rooms) {
      const anyConnected = room.memberList().some((m) => m.connected);
      if (!anyConnected && now - room.lastActivityAt > this.idleMs) {
        room.dispose(); // 释放超时计时器
        this.rooms.delete(code);
        archived.push(code);
      }
    }
    return archived;
  }

  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref?.();
  }

  stopSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
