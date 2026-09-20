/**
 * 游戏事件 → 展示文案（日志面板 / 中央提示）
 * M3：补齐建筑 / 抵押 / 拍卖 / 交易 / 套现窗口 / 罚金池文案
 */
import { BOARD_TILES, cardById } from "@monopoly/shared";
import type { GameEvent } from "@monopoly/shared";

export type LogKind =
  | "info"
  | "roll"
  | "move"
  | "money"
  | "property"
  | "card"
  | "jail"
  | "end"
  | "auction"
  | "trade"
  | "debt";

export const MONEY_LABEL: Record<string, string> = {
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

const RELEASE_METHOD: Record<string, string> = {
  doubles: "掷出双数",
  bail: "保释",
  card: "使用出狱许可证",
  forced: "强制保释",
};

export interface EventDesc {
  text: string;
  kind: LogKind;
}

export function describeEvent(e: GameEvent, nameOf: (id: string | "bank") => string): EventDesc | null {
  const tile = (i: number): string => BOARD_TILES[i]?.name ?? `格 ${i}`;

  switch (e.type) {
    case "GAME_STARTED":
      return { text: "对局开始！", kind: "info" };
    case "DICE_ROLLED":
      return {
        text: `${nameOf(e.playerId)} 掷出 ${e.dice[0]} + ${e.dice[1]}${
          e.reason === "utility-card" ? "（公用事业卡）" : ""
        }`,
        kind: "roll",
      };
    case "TOKEN_MOVED":
      return { text: `${nameOf(e.playerId)} 移动 ${e.from} → ${e.to}`, kind: "move" };
    case "MONEY_TRANSFERRED":
      return {
        text: `${nameOf(e.from)} → ${nameOf(e.to)} $${e.amount}（${MONEY_LABEL[e.reason] ?? e.reason}）`,
        kind: "money",
      };
    case "PROPERTY_BOUGHT":
      return { text: `${nameOf(e.playerId)} 买下 ${tile(e.tile)}（$${e.price}）`, kind: "property" };
    case "PURCHASE_DECLINED":
      return { text: `${nameOf(e.playerId)} 放弃 ${tile(e.tile)}`, kind: "property" };
    case "RENT_PAID":
      return {
        text: `${nameOf(e.from)} 向 ${nameOf(e.to)} 支付 ${tile(e.tile)} 租金 $${e.amount}`,
        kind: "money",
      };
    case "CARD_DRAWN":
      return {
        text: `${nameOf(e.playerId)} 抽到${e.deck === "chance" ? "机会" : "命运"}卡：「${
          cardById(e.cardId)?.text ?? e.cardId
        }」`,
        kind: "card",
      };
    case "PLAYER_JAILED":
      return {
        text: `${nameOf(e.playerId)} 入狱（${
          e.cause === "doubles" ? "三次双数" : e.cause === "tile" ? "入狱格" : "卡牌"
        }）`,
        kind: "jail",
      };
    case "PLAYER_RELEASED":
      return { text: `${nameOf(e.playerId)} 出狱（${RELEASE_METHOD[e.method] ?? e.method}）`, kind: "jail" };
    case "JAIL_STAYED":
      return { text: `${nameOf(e.playerId)} 留在监狱（第 ${e.jailTurns} 次尝试失败）`, kind: "jail" };
    case "PROPERTY_TRANSFERRED":
      return {
        text: `${nameOf(e.from)} 的 ${e.tiles.length} 处地产移交 → ${nameOf(e.to)}`,
        kind: "property",
      };
    case "PLAYER_BANKRUPT":
      return { text: `${nameOf(e.playerId)} 破产（债权人：${nameOf(e.creditor)}）`, kind: "end" };
    case "TURN_ENDED":
      return { text: `轮到 ${nameOf(e.nextPlayerId)}`, kind: "info" };
    case "GAME_ENDED":
      return { text: `对局结束，${nameOf(e.winnerId)} 获胜！`, kind: "end" };
    // ---- M3：建筑 ----
    case "HOUSE_BUILT":
      return { text: `${nameOf(e.playerId)} 在 ${tile(e.tile)} 建造 1 栋房屋`, kind: "property" };
    case "HOTEL_BUILT":
      return { text: `${nameOf(e.playerId)} 在 ${tile(e.tile)} 升级旅馆`, kind: "property" };
    case "HOUSE_SOLD":
      return {
        text:
          e.amount > 0
            ? `${nameOf(e.playerId)} 出售 ${tile(e.tile)} 房屋（+$${e.amount}）`
            : `${nameOf(e.playerId)} 将 ${tile(e.tile)} 旅馆换回 4 栋房屋`,
        kind: "property",
      };
    case "HOTEL_SOLD":
      return { text: `${nameOf(e.playerId)} 售出 ${tile(e.tile)} 旅馆（+$${e.amount}）`, kind: "property" };
    // ---- M3：抵押 ----
    case "PROPERTY_MORTGAGED":
      return { text: `${nameOf(e.playerId)} 抵押 ${tile(e.tile)}（+$${e.amount}）`, kind: "property" };
    case "PROPERTY_UNMORTGAGED":
      return { text: `${nameOf(e.playerId)} 赎回 ${tile(e.tile)}（-$${e.cost}）`, kind: "property" };
    // ---- M3：拍卖 ----
    case "AUCTION_STARTED":
      return {
        text: `🔨 ${tile(e.tile)} 开始拍卖（${e.cause === "decline" ? "放弃购买" : "破产清算"}）`,
        kind: "auction",
      };
    case "AUCTION_BID":
      return { text: `🔨 ${nameOf(e.playerId)} 出价 $${e.amount}`, kind: "auction" };
    case "AUCTION_PASSED":
      return { text: `🔨 ${nameOf(e.playerId)} ${e.reason === "timeout" ? "超时放弃" : "放弃出价"}`, kind: "auction" };
    case "AUCTION_ENDED":
      return e.winnerId
        ? { text: `🔨 ${tile(e.tile)} 由 ${nameOf(e.winnerId)} 以 $${e.amount} 竞得`, kind: "auction" }
        : { text: `🔨 ${tile(e.tile)} 流拍`, kind: "auction" };
    // ---- M3：交易与市场 ----
    case "TRADE_PROPOSED":
      return {
        text: `🤝 ${nameOf(e.offer.fromId)} 向 ${nameOf(e.offer.toId)} 发起交易报价`,
        kind: "trade",
      };
    case "TRADE_ACCEPTED":
      return {
        text: `🤝 ${nameOf(e.offer.fromId)} 与 ${nameOf(e.offer.toId)} 达成交易`,
        kind: "trade",
      };
    case "TRADE_REMOVED":
      return {
        text: `🤝 ${nameOf(e.fromId)} ⇄ ${nameOf(e.toId)} 的报价${
          e.reason === "timeout" ? "超时失效" : e.reason === "cancelled" ? "被撤回" : "被拒绝"
        }`,
        kind: "trade",
      };
    case "PROPERTY_LISTED":
      return { text: `🏷 ${nameOf(e.listing.sellerId)} 挂售 ${tile(e.listing.tile)}（$${e.listing.price}）`, kind: "trade" };
    case "LISTING_REMOVED":
      return { text: `🏷 ${tile(e.tile)} 的挂售${e.reason === "sold" ? "已成交" : "已撤回"}`, kind: "trade" };
    // ---- M3：套现窗口与罚金池 ----
    case "DEBT_OPENED":
      return {
        text: `⏳ ${nameOf(e.playerId)} 需支付 $${e.amount}（${MONEY_LABEL[e.reason] ?? e.reason} → ${nameOf(e.creditor)}），现金不足，进入套现窗口`,
        kind: "debt",
      };
    case "DEBT_SETTLED":
      return { text: `✅ ${nameOf(e.playerId)} 已凑足 $${e.amount} 完成支付`, kind: "debt" };
    case "POT_COLLECTED":
      return { text: `${nameOf(e.playerId)} 拾取罚金池 $${e.amount}`, kind: "money" };
    default:
      return null;
  }
}
