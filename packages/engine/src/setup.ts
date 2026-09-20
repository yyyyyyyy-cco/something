/**
 * 开局构造：createGame + 状态归一化（旧快照兼容）
 */
import {
  BANK_INITIAL_HOTELS,
  BANK_INITIAL_HOUSES,
  BOARD_SIZE,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  defaultDeckIds,
} from "@monopoly/shared";
import type { CardDeck, GameEvent, GameState, PlayerState, RoomSettings } from "@monopoly/shared";
import { shuffleArray } from "./rng.js";

export interface NewPlayer {
  id: string;
  name: string;
}

export interface CreateGameOptions {
  /** 起始资金（默认 $1500，规则规格 §2） */
  startMoney?: number;
  /** 房规开关覆盖（规则规格 §15；默认见 DEFAULT_SETTINGS） */
  settings?: Partial<RoomSettings>;
  /** 洗牌函数（默认 crypto Fisher-Yates；测试可传恒等/自定义） */
  shuffle?: <T>(arr: T[]) => T[];
  /** 直接指定牌堆顺序（测试用，优先级高于 shuffle） */
  decks?: Record<CardDeck, string[]>;
}

/**
 * 创建对局初始状态。
 * 先手 = players[0]（房主），之后按数组顺序轮转（规则规格 §2）。
 */
export function createGame(
  players: NewPlayer[],
  options: CreateGameOptions = {},
): { state: GameState; events: GameEvent[] } {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`玩家人数必须在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间`);
  }
  if (new Set(players.map((p) => p.id)).size !== players.length) {
    throw new Error("玩家 ID 不能重复");
  }

  const shuffle = options.shuffle ?? shuffleArray;
  const decks: Record<CardDeck, string[]> = options.decks ?? {
    chance: shuffle(defaultDeckIds("chance")),
    chest: shuffle(defaultDeckIds("chest")),
  };
  const settings: RoomSettings = {
    ...DEFAULT_SETTINGS,
    ...(options.startMoney !== undefined ? { startMoney: options.startMoney } : {}),
    ...options.settings,
  };

  const playerStates: PlayerState[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    money: settings.startMoney,
    position: 0,
    inJail: false,
    jailTurns: 0,
    getOutOfJailCards: [],
    bankrupt: false,
  }));

  const state: GameState = {
    version: 0,
    phase: "AWAITING_ROLL",
    players: playerStates,
    currentPlayerId: players[0]!.id,
    tiles: Array.from({ length: BOARD_SIZE }, (_, index) => ({
      index,
      ownerId: null,
      houses: 0,
      hotel: false,
      mortgaged: false,
    })),
    turn: { dice: null, doublesCount: 0, lastRollGrantsExtra: false },
    pendingPurchase: null,
    decks,
    bank: { housesLeft: BANK_INITIAL_HOUSES, hotelsLeft: BANK_INITIAL_HOTELS },
    auction: null,
    auctionQueue: [],
    trades: [],
    listings: [],
    pendingDebt: null,
    pot: 0,
    settings,
    winnerId: null,
  };

  const events: GameEvent[] = [{ type: "GAME_STARTED", playerOrder: players.map((p) => p.id) }];
  return { state, events };
}

/**
 * 归一化从持久化恢复的对局状态（旧快照可能缺少 M3 新增字段）。
 * 就地补默认值，保证后续引擎逻辑安全。
 */
export function normalizeState(state: GameState): GameState {
  state.auction ??= null;
  state.auctionQueue ??= [];
  state.trades ??= [];
  state.listings ??= [];
  state.pendingDebt ??= null;
  state.pot ??= 0;
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  for (const ts of state.tiles) {
    ts.houses ??= 0;
    ts.hotel ??= false;
    ts.mortgaged ??= false;
  }
  // 旧快照（M2 时期）若停在无主地购买决策而拍卖未实现，保持现状即可
  return state;
}
