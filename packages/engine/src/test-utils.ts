/**
 * 测试工具：确定性 rng、对局构造、动作辅助（不参与构建产物）
 */
import type { Action, CardDeck, GameEvent, GameState, PlayerState } from "@monopoly/shared";
import { applyAction } from "./apply.js";
import { createGame } from "./setup.js";
import type { CreateGameOptions, NewPlayer } from "./setup.js";
import type { DiceRoll, Rng } from "./rng.js";

/** 恒等洗牌：保持牌堆与 cards.json 顺序一致，便于卡片测试 */
export const identityShuffle = <T>(arr: T[]): T[] => [...arr];

/** 不应被调用的 rng（用于不掷骰的动作） */
export const deadRng: Rng = () => {
  throw new Error("该动作不应消耗随机数");
};

/** 脚本化 rng：按序返回预设骰值；耗尽即抛错（防止测试漏配） */
export function scriptedRng(...rolls: DiceRoll[]): Rng {
  const queue = [...rolls];
  return () => {
    const next = queue.shift();
    if (!next) throw new Error("scriptedRng 队列已耗尽（测试缺少预设骰值）");
    return next;
  };
}

/** 创建确定性测试对局（恒等洗牌；可用 options 覆盖） */
export function makeGame(playerCount = 2, options: CreateGameOptions = {}): GameState {
  const players: NewPlayer[] = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `玩家${i + 1}`,
  }));
  const { state } = createGame(players, { shuffle: identityShuffle, ...options });
  return state;
}

export interface ActResult {
  state: GameState;
  events: GameEvent[];
}

/** 应用动作（期望成功），返回新状态与事件 */
export function act(prev: GameState, action: Action, rng: Rng = deadRng): ActResult {
  const result = applyAction(prev, action, rng);
  if (!result.ok) {
    throw new Error(`动作应成功但失败: ${result.error.code} - ${result.error.message}`);
  }
  return { state: result.state, events: result.events };
}

/** 应用动作（期望失败），返回错误 */
export function actFail(prev: GameState, action: Action, rng: Rng = deadRng) {
  const result = applyAction(prev, action, rng);
  if (result.ok) throw new Error("动作应失败但成功了");
  return result.error;
}

export function roll(prev: GameState, playerId: string, rng: Rng): ActResult {
  return act(prev, { type: "ROLL_DICE", playerId }, rng);
}

export function buy(prev: GameState, playerId: string): ActResult {
  return act(prev, { type: "BUY_PROPERTY", playerId });
}

export function decline(prev: GameState, playerId: string): ActResult {
  return act(prev, { type: "DECLINE_PURCHASE", playerId });
}

// ===== 状态查询 / 布置（直接修改测试自有状态，applyAction 内部会克隆，不受影响）=====

export function player(state: GameState, id: string): PlayerState {
  const found = state.players.find((p) => p.id === id);
  if (!found) throw new Error(`玩家不存在: ${id}`);
  return found;
}

export function place(state: GameState, playerId: string, tileIndex: number): void {
  player(state, playerId).position = tileIndex;
}

export function setMoney(state: GameState, playerId: string, money: number): void {
  player(state, playerId).money = money;
}

export function giveTile(state: GameState, tileIndex: number, ownerId: string | null): void {
  state.tiles[tileIndex]!.ownerId = ownerId;
}

export function setDeck(state: GameState, deck: CardDeck, ids: string[]): void {
  state.decks[deck] = ids;
}

/** 把指定卡牌移到某牌堆顶部（其余保持原顺序） */
export function topCard(state: GameState, deck: CardDeck, cardId: string): void {
  setDeck(state, deck, [cardId, ...state.decks[deck].filter((id) => id !== cardId)]);
}

export function eventsOfType<T extends GameEvent["type"]>(
  events: GameEvent[],
  type: T,
): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
