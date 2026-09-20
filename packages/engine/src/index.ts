/**
 * @monopoly/engine —— 纯函数规则引擎（M3 完整规则口径）
 *
 * 约束：零 IO、无随机副作用；骰子随机由注入的 rng 提供。
 * 用法：
 *   const { state } = createGame([{ id: "p1", name: "玩家1" }, ...]);
 *   const result = applyAction(state, { type: "ROLL_DICE", playerId: "p1" }, secureRng());
 */
export { createGame, normalizeState } from "./setup.js";
export type { NewPlayer, CreateGameOptions } from "./setup.js";
export { applyAction } from "./apply.js";
export { secureRng, seededRng, shuffleArray, isDoubles, diceSum } from "./rng.js";
export type { Rng, DiceRoll } from "./rng.js";
export { auctionWaitingOn } from "./auction.js";
export { canBuildHouse, canBuildHotel, canSellHouse } from "./buildings.js";
export { canAfford } from "./money.js";
export { computeNetWorth, rankByNetWorth } from "./networth.js";
export { isCashWindowPayer } from "./debt.js";
export {
  groupTileIndexes,
  mortgageInterestOf,
  mortgageValueOf,
  propertyLevel,
  tileTradable,
} from "./lookups.js";

/** 引擎版本（M1 起实现规则，见 .agent/docs/game-rules-spec.md） */
export const ENGINE_VERSION = "0.4.0";
