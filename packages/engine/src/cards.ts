/**
 * 卡牌抽取与效果执行（规则规格 §9）
 * 抽牌：从牌堆顶部取，执行后放回牌堆底部（出狱许可证除外，由玩家保留）
 */
import { BOARD_SIZE, JAIL_CARD_IDS, cardById } from "@monopoly/shared";
import type { CardDeck, CardEffect, GameEvent, GameState, PlayerState } from "@monopoly/shared";
import { requirePayment } from "./debt.js";
import { findPlayer, ownedTileIndexes, tileAt } from "./lookups.js";
import { canAfford, declareBankruptcy, transferMoney } from "./money.js";
import type { Rng } from "./rng.js";
import { movePlayerBackward, movePlayerForward, teleportToJail } from "./resolve.js";

export function drawCard(state: GameState, events: GameEvent[], playerId: string, deck: CardDeck, rng: Rng): void {
  const pile = state.decks[deck];
  const cardId = pile.shift();
  if (!cardId) throw new Error(`牌堆为空: ${deck}`);
  const card = cardById(cardId);
  if (!card) throw new Error(`未知卡牌: ${cardId}`);

  events.push({ type: "CARD_DRAWN", playerId, deck, cardId });

  const player = findPlayer(state, playerId);
  const keepCard = card.effects.some((e) => e.type === "getOutOfJailFree");

  for (const effect of card.effects) {
    const stop = applyEffect(state, events, player, effect, deck, rng);
    if (stop) break;
    if (state.pendingPurchase) break; // 卡牌引发的购买决策（数据保证该效果为其唯一效果）
    if (state.pendingDebt) break; // 卡牌引发的套现窗口（M3）：暂停后续效果
    if (player.bankrupt || state.phase === "ENDED") break;
  }

  if (!keepCard) {
    pile.push(cardId); // 回到牌堆底部
  }
}

/** 执行单个效果；返回 true 表示需立即终止后续效果（入狱） */
function applyEffect(
  state: GameState,
  events: GameEvent[],
  player: PlayerState,
  effect: CardEffect,
  deck: CardDeck,
  rng: Rng,
): boolean {
  switch (effect.type) {
    case "moveTo": {
      const from = player.position;
      const steps = (effect.tile - from + BOARD_SIZE) % BOARD_SIZE;
      if (steps === 0) {
        // 理论不可达（卡牌格与目标格不重合）；保持稳健：原地结算
        movePlayerForward(state, events, player, 0, false, rng, {});
      } else {
        movePlayerForward(state, events, player, steps, effect.collectGo ?? false, rng, {});
      }
      return false;
    }

    case "moveBy": {
      if (effect.steps >= 0) {
        movePlayerForward(state, events, player, effect.steps, false, rng, {});
      } else {
        movePlayerBackward(state, events, player, -effect.steps, rng);
      }
      return false;
    }

    case "moveNearest": {
      let target = -1;
      for (let s = 1; s <= BOARD_SIZE; s++) {
        const idx = (player.position + s) % BOARD_SIZE;
        if (tileAt(idx).kind === effect.target) {
          target = idx;
          break;
        }
      }
      movePlayerForward(state, events, player, (target - player.position + BOARD_SIZE) % BOARD_SIZE, true, rng, {
        rentMultiplier: effect.rentMultiplier,
        utilityCard: effect.target === "utility",
      });
      return false;
    }

    case "gain": {
      transferMoney(state, events, "bank", player.id, effect.amount, "card-gain");
      return false;
    }

    case "pay": {
      // 现金不足 → 套现窗口（规则规格 §13）；足额即付并计罚金池
      requirePayment(state, events, player.id, "bank", effect.amount, "card-pay", "completeMove");
      return false;
    }

    case "payEach": {
      // 支付每位玩家固定金额；现金不足 → 套现窗口，银行代收后转付各债权人（resume = payEach）
      const others = state.players.filter((p) => p.id !== player.id && !p.bankrupt);
      const total = effect.amount * others.length;
      const payees = others.map((o) => ({ id: o.id, amount: effect.amount }));
      requirePayment(state, events, player.id, "bank", total, "card-pay", "payEach", payees);
      return false;
    }

    case "collectEach": {
      const others = state.players.filter((p) => p.id !== player.id && !p.bankrupt);
      for (const other of others) {
        if (state.phase === "ENDED") break;
        if (canAfford(other, effect.amount)) {
          transferMoney(state, events, other.id, player.id, effect.amount, "card-pay");
        } else {
          // 无力支付者破产，资产全部移交收租者
          declareBankruptcy(state, events, other.id, player.id);
        }
      }
      return false;
    }

    case "goToJail": {
      teleportToJail(state, events, player.id, "card");
      return true;
    }

    case "getOutOfJailFree": {
      player.getOutOfJailCards.push(deck);
      return false;
    }

    case "repairs": {
      let houses = 0;
      let hotels = 0;
      for (const i of ownedTileIndexes(state, player.id)) {
        const ts = state.tiles[i]!;
        houses += ts.houses;
        if (ts.hotel) hotels += 1;
      }
      const amount = houses * effect.perHouse + hotels * effect.perHotel;
      if (amount > 0) {
        // 维修费为给银行的罚款：现金不足 → 套现窗口；足额即付并计罚金池
        requirePayment(state, events, player.id, "bank", amount, "card-pay", "completeMove");
      }
      return false;
    }
  }
}
