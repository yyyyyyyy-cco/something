/**
 * 本地热座 CLI（M1-6，M3 完整规则）：pnpm play
 *
 * 用法：
 *   pnpm play                       # 4 人交互热座（默认）
 *   pnpm play -- --players 3        # 指定人数（2-6）
 *   pnpm play -- --auto             # 自动对局（能买就买；建房；拍卖保守出价；套现自救）
 *   pnpm play -- --auto --seed 42   # 可复现自动对局
 *
 * 交互模式支持完整 M3 规则操作：拍卖出价/放弃、套现窗口卖房/抵押/认输、掷骰前建房/卖房/抵押/赎回。
 */
import * as readline from "node:readline/promises";
import { BOARD_TILES, JAIL_BAIL, cardById } from "@monopoly/shared";
import type { Action, GameEvent, GameState, TileState } from "@monopoly/shared";
import { applyAction, canBuildHouse, createGame, secureRng, seededRng } from "../src/index.js";
import type { Rng } from "../src/index.js";

// ===== 参数 =====
const args = process.argv.slice(2);
const auto = args.includes("--auto");
const seedIdx = args.indexOf("--seed");
const seed = seedIdx >= 0 ? Number(args[seedIdx + 1]) : null;
const playersIdx = args.indexOf("--players");
const playerCount = playersIdx >= 0 ? Number(args[playersIdx + 1]) : 4;

if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
  console.error("玩家人数须为 2-6");
  process.exit(1);
}

const rng: Rng = seed !== null ? seededRng(seed) : secureRng();

const { state: initial } = createGame(
  Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` })),
);

let state: GameState = initial;

// ===== 文案工具 =====
const tileName = (i: number): string => `${i}.${BOARD_TILES[i]?.name ?? "?"}`;
const playerName = (id: string | "bank"): string =>
  id === "bank" ? "银行" : (state.players.find((p) => p.id === id)?.name ?? id);
const level = (ts: TileState): number => (ts.hotel ? 5 : ts.houses);
const levelLabel = (ts: TileState): string => (ts.hotel ? "旅馆" : `${ts.houses} 房`);

const REASON_LABEL: Record<string, string> = {
  salary: "工资",
  buy: "购地",
  tax: "税金",
  rent: "租金",
  "card-pay": "卡牌支出",
  "card-gain": "卡牌收入",
  bail: "保释金",
  bankruptcy: "破产清算",
  auction: "拍卖成交",
  "sell-house": "卖房回款",
  mortgage: "抵押贷款",
  unmortgage: "赎回付款",
  trade: "交易",
  "trade-tax": "抵押交易税",
  pot: "罚金池",
};

function describeEvent(e: GameEvent): string | null {
  switch (e.type) {
    case "GAME_STARTED":
      return `对局开始！行动顺序：${e.playerOrder.map((id) => playerName(id)).join(" → ")}`;
    case "DICE_ROLLED":
      return `${playerName(e.playerId)} 掷出 ${e.dice[0]} + ${e.dice[1]} = ${e.dice[0] + e.dice[1]}${e.reason === "utility-card" ? "（公用事业卡）" : ""}`;
    case "TOKEN_MOVED":
      return `${playerName(e.playerId)} 移动：${e.from} → ${e.to}`;
    case "MONEY_TRANSFERRED":
      return `${playerName(e.from)} → ${playerName(e.to)} $${e.amount}（${REASON_LABEL[e.reason] ?? e.reason}）`;
    case "PROPERTY_BOUGHT":
      return `${playerName(e.playerId)} 购买 ${tileName(e.tile)}（$${e.price}）`;
    case "PURCHASE_DECLINED":
      return `${playerName(e.playerId)} 放弃购买 ${tileName(e.tile)}${state.settings.auctionEnabled ? "（触发拍卖）" : "（流拍）"}`;
    case "RENT_PAID":
      return `${playerName(e.from)} 向 ${playerName(e.to)} 支付租金 $${e.amount}（${tileName(e.tile)}）`;
    case "CARD_DRAWN":
      return `${playerName(e.playerId)} 抽到${e.deck === "chance" ? "机会" : "命运"}卡：「${cardById(e.cardId)?.text ?? e.cardId}」`;
    case "PLAYER_JAILED":
      return `${playerName(e.playerId)} 入狱（${e.cause === "doubles" ? "三次双数" : e.cause === "tile" ? "入狱格" : "卡牌"}）`;
    case "PLAYER_RELEASED":
      return `${playerName(e.playerId)} 出狱（${e.method === "doubles" ? "掷出双数" : e.method === "bail" ? "保释" : e.method === "card" ? "使用出狱许可证" : "强制保释"}）`;
    case "JAIL_STAYED":
      return `${playerName(e.playerId)} 留在监狱（第 ${e.jailTurns} 次尝试失败）`;
    case "PROPERTY_TRANSFERRED":
      return `${playerName(e.from)} 的地产移交 → ${playerName(e.to)}：${e.tiles.map((t) => tileName(t)).join("、")}`;
    case "PLAYER_BANKRUPT":
      return `${playerName(e.playerId)} 破产！债权人：${playerName(e.creditor)}`;
    case "TURN_ENDED":
      return `—— 轮到 ${playerName(e.nextPlayerId)} ——`;
    case "GAME_ENDED":
      return `对局结束！胜者：${playerName(e.winnerId)}`;
    // ---- M3 ----
    case "HOUSE_BUILT":
      return `${playerName(e.playerId)} 在 ${tileName(e.tile)} 建造 1 栋房屋`;
    case "HOTEL_BUILT":
      return `${playerName(e.playerId)} 在 ${tileName(e.tile)} 升级旅馆`;
    case "HOUSE_SOLD":
      return e.amount > 0
        ? `${playerName(e.playerId)} 出售 ${tileName(e.tile)} 的房屋（+$${e.amount}）`
        : `${playerName(e.playerId)} 将 ${tileName(e.tile)} 的旅馆换回 4 栋房屋`;
    case "HOTEL_SOLD":
      return `${playerName(e.playerId)} 售出 ${tileName(e.tile)} 的旅馆（+$${e.amount}）`;
    case "PROPERTY_MORTGAGED":
      return `${playerName(e.playerId)} 抵押 ${tileName(e.tile)}（+$${e.amount}）`;
    case "PROPERTY_UNMORTGAGED":
      return `${playerName(e.playerId)} 赎回 ${tileName(e.tile)}（-$${e.cost}）`;
    case "AUCTION_STARTED":
      return `【拍卖】${tileName(e.tile)} 开始拍卖（${e.cause === "decline" ? "放弃购买" : "破产清算"}）`;
    case "AUCTION_BID":
      return `【拍卖】${playerName(e.playerId)} 出价 $${e.amount}`;
    case "AUCTION_PASSED":
      return `【拍卖】${playerName(e.playerId)} ${e.reason === "timeout" ? "超时放弃" : "放弃出价"}`;
    case "AUCTION_ENDED":
      return e.winnerId
        ? `【拍卖】${tileName(e.tile)} 由 ${playerName(e.winnerId)} 以 $${e.amount} 竞得`
        : `【拍卖】${tileName(e.tile)} 流拍`;
    case "TRADE_PROPOSED":
      return `【交易】${playerName(e.offer.fromId)} 向 ${playerName(e.offer.toId)} 发起报价（给：${bundleText(e.offer.give)}；索：${bundleText(e.offer.want)}）`;
    case "TRADE_ACCEPTED":
      return `【交易】${playerName(e.offer.fromId)} 与 ${playerName(e.offer.toId)} 达成交易`;
    case "TRADE_REMOVED":
      return `【交易】${playerName(e.fromId)} ⇄ ${playerName(e.toId)} 的报价${e.reason === "timeout" ? "超时失效" : e.reason === "cancelled" ? "被撤回" : "被拒绝"}`;
    case "PROPERTY_LISTED":
      return `【市场】${playerName(e.listing.sellerId)} 挂售 ${tileName(e.listing.tile)}（$${e.listing.price}）`;
    case "LISTING_REMOVED":
      return `【市场】${tileName(e.tile)} 的挂售${e.reason === "sold" ? "已成交" : "已撤回"}`;
    case "DEBT_OPENED":
      return `【套现窗口】${playerName(e.playerId)} 需支付 $${e.amount}（${REASON_LABEL[e.reason] ?? e.reason} → ${playerName(e.creditor)}），现金不足，请卖房 / 抵押 / 协商交易`;
    case "DEBT_SETTLED":
      return `【套现窗口】${playerName(e.playerId)} 已凑足 $${e.amount} 完成支付`;
    case "POT_COLLECTED":
      return `${playerName(e.playerId)} 拾取罚金池 $${e.amount}`;
  }
}

function bundleText(b: { money: number; tiles: number[]; jailCards: number }): string {
  const parts: string[] = [];
  if (b.money > 0) parts.push(`$${b.money}`);
  if (b.tiles.length > 0) parts.push(b.tiles.map((t) => tileName(t)).join("、"));
  if (b.jailCards > 0) parts.push(`${b.jailCards} 张出狱卡`);
  return parts.length > 0 ? parts.join(" + ") : "无";
}

function printEvents(events: GameEvent[]): void {
  for (const e of events) {
    const line = describeEvent(e);
    if (line) console.log(`  ${line}`);
  }
}

function showStatus(): void {
  console.log("\n当前状态：");
  for (const p of state.players) {
    const mark = p.bankrupt ? "（已破产）" : p.inJail ? "（狱中）" : "";
    const props = state.tiles.filter((t) => t.ownerId === p.id).length;
    console.log(`  ${p.name}${mark}  现金 $${p.money}  位置 ${tileName(p.position)}  地产 ${props} 处`);
  }
}

function showBoard(): void {
  console.log("\n棋盘：");
  for (const t of BOARD_TILES) {
    const ts = state.tiles[t.index]!;
    const extras: string[] = [];
    if (ts.houses > 0) extras.push(`${ts.houses} 房`);
    if (ts.hotel) extras.push("旅馆");
    if (ts.mortgaged) extras.push("抵押中");
    const owner = ts.ownerId ? playerName(ts.ownerId) : t.price ? `无主（$${t.price}）` : "—";
    console.log(`  ${String(t.index).padStart(2)} ${t.name.padEnd(12, "　")} ${owner}${extras.length > 0 ? ` [${extras.join("/")}]` : ""}`);
  }
}

function currentPlayer(): GameState["players"][number] {
  return state.players.find((p) => p.id === state.currentPlayerId)!;
}

/** 自动模式精简输出：仅关键事件 */
const KEY_EVENTS = new Set<GameEvent["type"]>([
  "PLAYER_BANKRUPT",
  "PROPERTY_TRANSFERRED",
  "GAME_ENDED",
  "AUCTION_ENDED",
  "DEBT_OPENED",
  "POT_COLLECTED",
]);

function doAction(action: Action): boolean {
  const result = applyAction(state, action, rng);
  if (!result.ok) {
    console.log(`  ✖ 动作无效：${result.error.code}（${result.error.message}）`);
    return false;
  }
  state = result.state;
  if (!auto) {
    printEvents(result.events);
  } else {
    for (const e of result.events) {
      if (KEY_EVENTS.has(e.type)) {
        const line = describeEvent(e);
        if (line) console.log(`  ${line}`);
      }
    }
  }
  return true;
}

// ===== 自动模式（策略同 simulation.test.ts） =====
function chooseCashRaise(playerId: string): Action | null {
  const owned = state.tiles.filter((t) => t.ownerId === playerId);
  for (const ts of owned) {
    if (ts.hotel || ts.houses > 0) {
      const group = BOARD_TILES[ts.index]!.colorGroup!;
      const levels = BOARD_TILES.filter((t) => t.colorGroup === group).map((t) => level(state.tiles[t.index]!));
      if (level(ts) === Math.max(...levels)) return { type: "SELL_HOUSE", playerId, tile: ts.index };
    }
  }
  const mortgagable = owned
    .filter((t) => !t.mortgaged && t.houses === 0 && !t.hotel)
    .sort((a, b) => (BOARD_TILES[b.index]!.mortgageValue ?? 0) - (BOARD_TILES[a.index]!.mortgageValue ?? 0));
  const pick = mortgagable[0];
  return pick ? { type: "MORTGAGE", playerId, tile: pick.index } : null;
}

function chooseBuild(playerId: string): Action | null {
  const p = state.players.find((x) => x.id === playerId)!;
  if (p.money < 400) return null;
  const options = state.tiles
    .filter((t) => t.ownerId === playerId && BOARD_TILES[t.index]!.kind === "property")
    .filter((t) => canBuildHouse(state, playerId, t.index) === null)
    .sort((a, b) => (BOARD_TILES[a.index]!.houseCost ?? 0) - (BOARD_TILES[b.index]!.houseCost ?? 0));
  const pick = options[0];
  if (!pick) return null;
  return p.money >= (BOARD_TILES[pick.index]!.houseCost ?? 0) + 200 ? { type: "BUILD_HOUSE", playerId, tile: pick.index } : null;
}

function autoStep(): boolean {
  if (state.phase === "AWAITING_ACTION") {
    const p = currentPlayer();
    const tile = state.pendingPurchase!;
    const price = BOARD_TILES[tile.tileIndex]!.price ?? 0;
    return doAction(p.money >= price ? { type: "BUY_PROPERTY", playerId: p.id } : { type: "DECLINE_PURCHASE", playerId: p.id });
  }

  if (state.phase === "AUCTION") {
    const waiting = state.auction!.queue[0]!;
    const wp = state.players.find((x) => x.id === waiting)!;
    const price = BOARD_TILES[state.auction!.tileIndex]!.price ?? 0;
    const cap = Math.min(wp.money, Math.floor(price * 0.8));
    const minBid = (state.auction!.highBid ?? 0) + 1;
    if (minBid <= cap) {
      return doAction({ type: "BID", playerId: waiting, amount: cap }); // 直接出到上限，加快裁决
    }
    return doAction({ type: "PASS_BID", playerId: waiting });
  }

  if (state.phase === "CASH_WINDOW") {
    const debt = state.pendingDebt!;
    const payer = state.players.find((x) => x.id === debt.payerId)!;
    if (payer.money >= debt.amount) return doAction({ type: "CASH_TIMEOUT", playerId: payer.id });
    const raise = chooseCashRaise(payer.id);
    if (raise) return doAction(raise);
    return doAction({ type: "CASH_TIMEOUT", playerId: payer.id });
  }

  const p = currentPlayer();
  const build = chooseBuild(p.id);
  if (build) return doAction(build);
  if (p.inJail && p.getOutOfJailCards.length > 0) return doAction({ type: "USE_JAIL_CARD", playerId: p.id });
  if (p.inJail && p.money >= JAIL_BAIL) return doAction({ type: "PAY_BAIL", playerId: p.id });
  return doAction({ type: "ROLL_DICE", playerId: p.id });
}

// ===== 主流程 =====
async function main(): Promise<void> {
  if (auto) {
    const maxStepsIdx = args.indexOf("--max-steps");
    const maxSteps = maxStepsIdx >= 0 ? Number(args[maxStepsIdx + 1]) : 20000;
    console.log(`自动对局（${playerCount} 人${seed !== null ? `，seed=${seed}` : ""}，上限 ${maxSteps} 步）开始……\n`);
    let steps = 0;
    while (state.phase !== "ENDED" && steps < maxSteps) {
      autoStep();
      steps++;
      if (steps % 500 === 0) {
        const money = state.players.map((p) => p.money).join("/");
        console.log(`  [${steps}] 现金=${money} 当前=${state.currentPlayerId}`);
      }
    }
    if (state.phase !== "ENDED") {
      console.log("\n【提示】对局未在上限内收敛——可增大 --max-steps 或更换 seed。");
    }
    console.log(`\n共执行 ${steps} 步。`);
    showStatus();
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`热座对局（${playerCount} 人）开始！输入 q 随时退出。`);

  try {
    printEvents([{ type: "GAME_STARTED", playerOrder: state.players.map((p) => p.id) }]);

    while (state.phase !== "ENDED") {
      // ---- 拍卖：等待队首玩家操作 ----
      if (state.phase === "AUCTION") {
        const a = state.auction!;
        const waiting = a.queue[0]!;
        const wp = state.players.find((x) => x.id === waiting)!;
        console.log(
          `\n【拍卖】${tileName(a.tileIndex)} ｜ 最高价 ${a.highBid === null ? "无" : `$${a.highBid}（${playerName(a.highBidderId!)}）`} ｜ 等待 ${wp.name}（${wp.money >= 0 ? `现金 $${wp.money}` : ""}）`,
        );
        const answer = (await rl.question(`【${wp.name}】出价金额（>${a.highBid ?? 0}，现金上限 $${wp.money}）/ [v] 放弃 / [s] 状态 / [q] 退出 > `)).trim().toLowerCase();
        if (answer === "q") break;
        if (answer === "s") { showStatus(); continue; }
        if (answer === "v") { doAction({ type: "PASS_BID", playerId: wp.id }); continue; }
        const amount = Number(answer);
        if (Number.isInteger(amount) && amount > 0) { doAction({ type: "BID", playerId: wp.id, amount }); continue; }
        console.log("  无效输入（金额 / v / s / q）");
        continue;
      }

      // ---- 套现窗口：欠款玩家变现自救 ----
      if (state.phase === "CASH_WINDOW") {
        const debt = state.pendingDebt!;
        const payer = state.players.find((x) => x.id === debt.payerId)!;
        console.log(
          `\n【套现窗口】${payer.name} 需支付 $${debt.amount}（${REASON_LABEL[debt.reason] ?? debt.reason} → ${playerName(debt.creditor)}）｜ 现金 $${payer.money}`,
        );
        const answer = (await rl.question(`【${payer.name}】[l 格子] 卖房 / [mg 格子] 抵押 / [h] 宣告破产 / [s] 状态 / [m] 棋盘 / [q] 退出 > `)).trim().toLowerCase();
        if (answer === "q") break;
        if (answer === "s") { showStatus(); continue; }
        if (answer === "m") { showBoard(); continue; }
        if (answer === "h") { doAction({ type: "DECLARE_BANKRUPTCY", playerId: payer.id }); continue; }
        const sellMatch = /^l\s+(\d+)$/.exec(answer);
        if (sellMatch) { doAction({ type: "SELL_HOUSE", playerId: payer.id, tile: Number(sellMatch[1]) }); continue; }
        const mortgageMatch = /^mg\s+(\d+)$/.exec(answer);
        if (mortgageMatch) { doAction({ type: "MORTGAGE", playerId: payer.id, tile: Number(mortgageMatch[1]) }); continue; }
        console.log("  无效输入（l 格子 / mg 格子 / h / s / m / q）");
        continue;
      }

      const p = currentPlayer();
      console.log(
        `\n【${p.name}】现金 $${p.money} ｜ 位置 ${tileName(p.position)}${p.inJail ? ` ｜ 狱中（已失败 ${p.jailTurns} 次${p.getOutOfJailCards.length > 0 ? "，持出狱卡" : ""}）` : ""}`,
      );

      if (state.phase === "AWAITING_ACTION") {
        const t = state.pendingPurchase!;
        const tile = BOARD_TILES[t.tileIndex]!;
        const answer = (await rl.question(
          `购买 ${tileName(t.tileIndex)}（$${tile.price}）？[b] 购买 / [d] 放弃${state.settings.auctionEnabled ? "（触发拍卖）" : ""} / [s] 状态 / [m] 棋盘 / [q] 退出 > `,
        )).trim().toLowerCase();

        if (answer === "q") break;
        if (answer === "s") { showStatus(); continue; }
        if (answer === "m") { showBoard(); continue; }
        if (answer === "b") { doAction({ type: "BUY_PROPERTY", playerId: p.id }); continue; }
        if (answer === "d") { doAction({ type: "DECLINE_PURCHASE", playerId: p.id }); continue; }
        console.log("  无效输入（b / d / s / m / q）");
        continue;
      }

      // AWAITING_ROLL（含资产管理：建房 / 卖房 / 抵押 / 赎回）
      const base = p.inJail ? "[r] 掷骰 / [p] 付 $50 保释 / [u] 用出狱卡" : "[r] 掷骰";
      const answer = (await rl.question(
        `${base} / [bd 格子] 建房 / [l 格子] 卖房 / [mg 格子] 抵押 / [um 格子] 赎回 / [s] 状态 / [m] 棋盘 / [q] 退出 > `,
      )).trim().toLowerCase();

      const command = (type: "BUILD_HOUSE" | "SELL_HOUSE" | "MORTGAGE" | "UNMORTGAGE", tile: number): void => {
        doAction({ type, playerId: p.id, tile });
      };

      if (answer === "q") break;
      if (answer === "s") { showStatus(); continue; }
      if (answer === "m") { showBoard(); continue; }
      if (answer === "r") { doAction({ type: "ROLL_DICE", playerId: p.id }); continue; }
      if (p.inJail && answer === "p") { doAction({ type: "PAY_BAIL", playerId: p.id }); continue; }
      if (p.inJail && answer === "u") { doAction({ type: "USE_JAIL_CARD", playerId: p.id }); continue; }
      const buildMatch = /^bd\s+(\d+)$/.exec(answer);
      if (buildMatch) { command("BUILD_HOUSE", Number(buildMatch[1])); continue; }
      const sellMatch = /^l\s+(\d+)$/.exec(answer);
      if (sellMatch) { command("SELL_HOUSE", Number(sellMatch[1])); continue; }
      const mortgageMatch = /^mg\s+(\d+)$/.exec(answer);
      if (mortgageMatch) { command("MORTGAGE", Number(mortgageMatch[1])); continue; }
      const unmortgageMatch = /^um\s+(\d+)$/.exec(answer);
      if (unmortgageMatch) { command("UNMORTGAGE", Number(unmortgageMatch[1])); continue; }
      console.log("  无效输入");
    }
  } finally {
    rl.close();
  }

  console.log("\n最终结算：");
  showStatus();
}

void main();
