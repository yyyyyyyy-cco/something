/**
 * 核心循环与落格结算：掷骰、移动、GO 工资、监狱、换人
 * 依据：规则规格 §3（回合流程）/ §5（租金）/ §8（特殊格）/ §10（入狱）
 * M3：租金/税金/强制保释对接套现窗口（§13）；免费停车对接罚金池（§8）
 */
import { BOARD_SIZE, GO_SALARY, GO_TILE_INDEX, JAIL_BAIL, JAIL_MAX_TURNS, JAIL_TILE_INDEX } from "@monopoly/shared";
import type { GameEvent, GameState, PlayerState } from "@monopoly/shared";
import { drawCard } from "./cards.js";
import { requirePayment } from "./debt.js";
import { backwardPath, countOwnedKind, findPlayer, forwardPath, groupHasMortgage, ownsFullColorGroup, propertyLevel, railroadRent, tileAt, utilityMultiplier, alivePlayers } from "./lookups.js";
import { canAfford, transferMoney } from "./money.js";
import { diceSum, isDoubles, type DiceRoll, type Rng } from "./rng.js";

// ===== 对外流程入口 =====

/** ROLL_DICE 动作处理（由 applyAction 调度） */
export function handleRoll(state: GameState, events: GameEvent[], rng: Rng): void {
  const player = findPlayer(state, state.currentPlayerId);
  const dice = rng();
  validateDice(dice);

  state.turn.dice = dice;
  state.turn.lastRollGrantsExtra = false;
  events.push({ type: "DICE_ROLLED", playerId: player.id, dice, reason: "turn" });

  if (player.inJail) {
    handleJailRoll(state, events, player, dice, rng);
  } else {
    handleNormalRoll(state, events, player, dice, rng);
  }

  // 未产生待决事项（购买决策/套现窗口）时收尾：换人或加掷
  finishMoveIfIdle(state, events);
}

/**
 * 移动流程收尾：存在待决事项（购买决策 / 套现窗口）时不推进，等待对应动作。
 * 掷骰、卡牌及套现窗口结算后的统一出口。
 */
export function finishMoveIfIdle(state: GameState, events: GameEvent[]): void {
  if (state.phase === "ENDED") return;
  if (state.pendingPurchase !== null || state.pendingDebt !== null) return;
  completeMove(state, events);
}

/**
 * 回合收尾判定：
 * - 破产 / 在狱中 → 换人
 * - 本回合掷出双数（正常掷骰）→ 同玩家继续掷（AWAITING_ROLL）
 * - 否则 → 换人
 */
export function completeMove(state: GameState, events: GameEvent[]): void {
  if (state.phase === "ENDED") return;
  const player = findPlayer(state, state.currentPlayerId);
  if (player.bankrupt || player.inJail) {
    advanceTurn(state, events);
    return;
  }
  if (state.turn.lastRollGrantsExtra) {
    state.turn.lastRollGrantsExtra = false;
    state.phase = "AWAITING_ROLL";
    return;
  }
  advanceTurn(state, events);
}

/** 交给下一位未破产玩家（按玩家数组顺序环形） */
export function advanceTurn(state: GameState, events: GameEvent[]): void {
  if (state.phase === "ENDED") return;
  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    const winner = alive[0];
    if (winner) {
      state.phase = "ENDED";
      state.winnerId = winner.id;
      events.push({ type: "GAME_ENDED", winnerId: winner.id, reason: "last-standing" });
    }
    return;
  }

  const order = state.players;
  let next = order.findIndex((p) => p.id === state.currentPlayerId);
  do {
    next = (next + 1) % order.length;
  } while (order[next]!.bankrupt);

  state.currentPlayerId = order[next]!.id;
  state.turn = { dice: null, doublesCount: 0, lastRollGrantsExtra: false };
  state.pendingPurchase = null;
  state.phase = "AWAITING_ROLL";
  events.push({ type: "TURN_ENDED", nextPlayerId: order[next]!.id });
}

/** 入狱（直接传送，不经过 GO 不领工资） */
export function teleportToJail(state: GameState, events: GameEvent[], playerId: string, cause: "tile" | "card" | "doubles"): void {
  const player = findPlayer(state, playerId);
  player.position = JAIL_TILE_INDEX;
  player.inJail = true;
  player.jailTurns = 0;
  events.push({ type: "PLAYER_JAILED", playerId, cause });
}

// ===== 掷骰分支 =====

function handleNormalRoll(state: GameState, events: GameEvent[], player: PlayerState, dice: DiceRoll, rng: Rng): void {
  if (isDoubles(dice)) {
    state.turn.doublesCount += 1;
  } else {
    state.turn.doublesCount = 0;
  }

  if (state.turn.doublesCount >= 3) {
    // 连续三次双数：直接入狱，不移动
    teleportToJail(state, events, player.id, "doubles");
    return;
  }

  if (isDoubles(dice)) {
    state.turn.lastRollGrantsExtra = true;
  }
  movePlayerForward(state, events, player, diceSum(dice), true, rng, { diceSum: diceSum(dice) });
}

function handleJailRoll(state: GameState, events: GameEvent[], player: PlayerState, dice: DiceRoll, rng: Rng): void {
  if (isDoubles(dice)) {
    // 掷双出狱并移动（不获得额外回合）
    player.inJail = false;
    player.jailTurns = 0;
    events.push({ type: "PLAYER_RELEASED", playerId: player.id, method: "doubles" });
    movePlayerForward(state, events, player, diceSum(dice), true, rng, { diceSum: diceSum(dice) });
    return;
  }

  player.jailTurns += 1;
  if (player.jailTurns >= JAIL_MAX_TURNS) {
    // 第三次失败：强制付 $50 出狱并按本点数移动；现金不足 → 套现窗口（resume = jailRoll）
    const canPayNow = canAfford(player, JAIL_BAIL);
    requirePayment(state, events, player.id, "bank", JAIL_BAIL, "bail", "jailRoll");
    if (canPayNow) releaseFromJailForced(state, events, player.id, rng);
    return;
  }

  // 继续留在狱中
  events.push({ type: "JAIL_STAYED", playerId: player.id, jailTurns: player.jailTurns });
}

/** 强制出狱并按本回合点数移动（支付完成后执行；套现窗口 resume = jailRoll 亦复用） */
export function releaseFromJailForced(state: GameState, events: GameEvent[], playerId: string, rng: Rng): void {
  const player = findPlayer(state, playerId);
  player.inJail = false;
  player.jailTurns = 0;
  events.push({ type: "PLAYER_RELEASED", playerId, method: "forced" });
  const dice = state.turn.dice ?? ([1, 1] as DiceRoll);
  movePlayerForward(state, events, player, diceSum(dice), true, rng, { diceSum: diceSum(dice) });
}

// ===== 移动 =====

export interface LandingCtx {
  /** 本次移动相关的骰子点数和（公用事业计价用） */
  diceSum?: number;
  /** 租金倍数（机会卡"车站双倍"） */
  rentMultiplier?: number;
  /** 卡牌特例：公用事业固定 ×10（新掷骰） */
  utilityCard?: boolean;
}

/**
 * 向前移动到目标格（骰子移动 / 卡牌 moveTo / moveNearest 共用）。
 * GO 工资规则：环绕经过 GO 且允许收租时领取；停在 GO 上按"经过"计（仅一次）。
 */
export function movePlayerForward(
  state: GameState,
  events: GameEvent[],
  player: PlayerState,
  steps: number,
  collectGo: boolean,
  rng: Rng,
  ctx: LandingCtx = {},
): void {
  const from = player.position;
  const to = (from + steps) % BOARD_SIZE;
  const wrapped = from + steps >= BOARD_SIZE;
  const path = forwardPath(from, steps);

  player.position = to;
  events.push({ type: "TOKEN_MOVED", playerId: player.id, from, to, path });

  if (steps > 0 && ((collectGo && wrapped) || to === GO_TILE_INDEX)) {
    transferMoney(state, events, "bank", player.id, GO_SALARY, "salary");
  }
  resolveLanding(state, events, player, to, rng, ctx);
}

/** 后退移动（"后退三格"）：不领路过工资；停在 GO 上仍领取 $200 */
export function movePlayerBackward(state: GameState, events: GameEvent[], player: PlayerState, steps: number, rng: Rng): void {
  const from = player.position;
  const to = ((from - steps) % BOARD_SIZE + BOARD_SIZE) % BOARD_SIZE;
  const path = backwardPath(from, steps);

  player.position = to;
  events.push({ type: "TOKEN_MOVED", playerId: player.id, from, to, path });

  if (to === GO_TILE_INDEX) {
    transferMoney(state, events, "bank", player.id, GO_SALARY, "salary");
  }
  resolveLanding(state, events, player, to, rng, {});
}

// ===== 落格结算 =====

export function resolveLanding(state: GameState, events: GameEvent[], player: PlayerState, tileIndex: number, rng: Rng, ctx: LandingCtx): void {
  if (state.phase === "ENDED" || player.bankrupt) return;
  const tile = tileAt(tileIndex);

  switch (tile.kind) {
    case "go":
    case "jail": // 探监
      return; // 无事发生（GO 工资在移动阶段已处理）

    case "free-parking": {
      // 罚金池房规：落上者全取（规则规格 §8）
      if (state.settings.potEnabled && state.pot > 0) {
        const amount = state.pot;
        state.pot = 0;
        transferMoney(state, events, "bank", player.id, amount, "pot");
        events.push({ type: "POT_COLLECTED", playerId: player.id, amount });
      }
      return;
    }

    case "property":
    case "railroad":
    case "utility": {
      const ts = state.tiles[tileIndex]!;
      if (ts.ownerId === null) {
        // 无主地：进入购买决策（放弃时由 apply 层触发拍卖 / 流拍）
        state.phase = "AWAITING_ACTION";
        state.pendingPurchase = { playerId: player.id, tileIndex };
        return;
      }
      if (ts.ownerId !== player.id) {
        payRent(state, events, player, tileIndex, rng, ctx);
      }
      return;
    }

    case "chance":
    case "chest":
      drawCard(state, events, player.id, tile.kind, rng);
      return;

    case "tax": {
      // 现金不足 → 套现窗口（规则规格 §13）；足额即付并计罚金池
      const amount = tile.taxAmount ?? 0;
      requirePayment(state, events, player.id, "bank", amount, "tax", "completeMove");
      return;
    }

    case "go-to-jail":
      teleportToJail(state, events, player.id, "tile");
      return;
  }
}

// ===== 租金 =====

function payRent(state: GameState, events: GameEvent[], payer: PlayerState, tileIndex: number, rng: Rng, ctx: LandingCtx): void {
  const tile = tileAt(tileIndex);
  const ts = state.tiles[tileIndex]!;
  const ownerId = ts.ownerId!;
  if (ts.mortgaged) return; // 抵押中的地产不收租（规则规格 §5）
  let rent = 0;

  if (tile.kind === "property") {
    const level = propertyLevel(ts);
    if (level === 0) {
      const base = tile.rentTable![0];
      // 垄断加成 ×2；抵押破垄断口径：组内任一抵押即不享受加成（可配置）
      const monopolized =
        ownsFullColorGroup(state, ownerId, tile.colorGroup!) &&
        !(state.settings.mortgageBreaksMonopoly && groupHasMortgage(state, tile.colorGroup!));
      rent = monopolized ? base * 2 : base;
    } else {
      rent = tile.rentTable![level]!; // 1-4 房 / 5 旅馆
    }
  } else if (tile.kind === "railroad") {
    rent = railroadRent(countOwnedKind(state, ownerId, "railroad")) * (ctx.rentMultiplier ?? 1);
  } else if (tile.kind === "utility") {
    if (ctx.utilityCard && ownerId !== payer.id) {
      // 卡牌特例：重新掷骰，按点数 ×10 支付
      const roll = rng();
      validateDice(roll);
      events.push({ type: "DICE_ROLLED", playerId: payer.id, dice: roll, reason: "utility-card" });
      rent = diceSum(roll) * 10;
    } else {
      rent = (ctx.diceSum ?? 0) * utilityMultiplier(countOwnedKind(state, ownerId, "utility"));
    }
  }

  events.push({ type: "RENT_PAID", from: payer.id, to: ownerId, tile: tileIndex, amount: rent });
  // 现金不足 → 套现窗口（规则规格 §13，卖房 → 抵押 → 协商）；支付完成后回到移动收尾
  requirePayment(state, events, payer.id, ownerId, rent, "rent", "completeMove");
}

function validateDice(dice: DiceRoll): void {
  for (const d of dice) {
    if (!Number.isInteger(d) || d < 1 || d > 6) {
      throw new Error(`非法骰值: ${String(d)}（rng 必须返回 1-6 的整数）`);
    }
  }
}
