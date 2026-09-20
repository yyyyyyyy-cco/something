/**
 * 诊断脚本：自动对局观察（不参与构建）
 * 用法：pnpm -F @monopoly/engine exec tsx scripts/debug-sim.ts <seed> <玩家数> [最大步数]
 */
import { BOARD_TILES, JAIL_BAIL } from "@monopoly/shared";
import type { GameState } from "@monopoly/shared";
import { applyAction, createGame, seededRng } from "../src/index.js";

const seed = Number(process.argv[2] ?? 1);
const playerCount = Number(process.argv[3] ?? 3);
const maxSteps = Number(process.argv[4] ?? 100000);

const rng = seededRng(seed);
const players = Array.from({ length: playerCount }, (_, i) => ({
  id: `p${i + 1}`,
  name: `玩家${i + 1}`,
}));
let { state } = createGame(players);

function step(stateNow: GameState) {
  const pid = stateNow.currentPlayerId;
  const p = stateNow.players.find((x) => x.id === pid)!;

  if (stateNow.phase === "AWAITING_ACTION") {
    const t = stateNow.pendingPurchase!;
    const price = BOARD_TILES[t.tileIndex]!.price ?? 0;
    const type = p.money >= price ? "BUY_PROPERTY" : "DECLINE_PURCHASE";
    return applyAction(stateNow, { type, playerId: pid }, rng);
  }
  if (p.inJail && p.getOutOfJailCards.length > 0) {
    return applyAction(stateNow, { type: "USE_JAIL_CARD", playerId: pid }, rng);
  }
  if (p.inJail && p.money >= JAIL_BAIL) {
    return applyAction(stateNow, { type: "PAY_BAIL", playerId: pid }, rng);
  }
  return applyAction(stateNow, { type: "ROLL_DICE", playerId: pid }, rng);
}

let steps = 0;
while (state.phase !== "ENDED" && steps < maxSteps) {
  steps++;
  const r = step(state);
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`);
  state = r.state;

  if (steps % 10000 === 0) {
    const owned = state.tiles.filter((t) => t.ownerId).length;
    console.log(
      `step=${steps} next=${state.currentPlayerId} money=${state.players.map((x) => x.money).join("/")} owned=${owned} pos=${state.players.map((x) => x.position).join("/")}`,
    );
  }
}

const owned = state.tiles.filter((t) => t.ownerId).length;
console.log(`FINAL seed=${seed} players=${playerCount} steps=${steps} phase=${state.phase} winner=${state.winnerId}`);
console.log(
  `money=${state.players.map((x) => x.money).join("/")} owned=${owned} bankrupt=${state.players.map((x) => x.bankrupt).join("/")}`,
);
console.log(`propsPerPlayer=${state.players.map((x) => state.tiles.filter((t) => t.ownerId === x.id).length).join("/")}`);
