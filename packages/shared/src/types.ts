/**
 * 共享契约类型（M1 冻结版）
 * 依据：.agent/docs/game-rules-spec.md v1.0（P0 口径）、requirements.md §8 数据模型草案（M1 实施细化见 §8 注记）
 */

// ===== 静态数据（棋盘 / 卡牌）=====

export type TileKind =
  | "go"
  | "property"
  | "railroad"
  | "utility"
  | "chance"
  | "chest"
  | "tax"
  | "jail"
  | "free-parking"
  | "go-to-jail";

export type ColorGroup =
  | "brown"
  | "light-blue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "dark-blue";

export type CardDeck = "chance" | "chest";

export interface BoardTile {
  index: number;
  /** 中文名（对外展示，避免商标名） */
  name: string;
  /** 英文原名（参考） */
  nameEn: string;
  kind: TileKind;
  /** 可购地价格（property / railroad / utility） */
  price?: number;
  /** 仅 property */
  colorGroup?: ColorGroup;
  /** 仅 property：[基础租金, 1房, 2房, 3房, 4房, 旅馆]（P0 仅用基础租金；完整表供 P1） */
  rentTable?: [number, number, number, number, number, number];
  /** 仅 property：每栋房屋造价（P1） */
  houseCost?: number;
  /** 抵押值 = 价格 ÷ 2（P1） */
  mortgageValue?: number;
  /** 仅 tax */
  taxAmount?: number;
}

/** 卡牌效果 DSL（规则规格 §9） */
export type CardEffect =
  | { type: "moveTo"; tile: number; collectGo?: boolean }
  | { type: "moveBy"; steps: number }
  | { type: "moveNearest"; target: "railroad" | "utility"; rentMultiplier?: number }
  | { type: "gain"; amount: number }
  | { type: "pay"; amount: number }
  | { type: "payEach"; amount: number }
  | { type: "collectEach"; amount: number }
  | { type: "goToJail" }
  | { type: "getOutOfJailFree" }
  | { type: "repairs"; perHouse: number; perHotel: number };

export interface GameCard {
  /** 形如 "chance-1" / "chest-16" */
  id: string;
  deck: CardDeck;
  text: string;
  effects: CardEffect[];
}

// ===== 对局运行时状态 =====

export type GamePhase =
  | "AWAITING_ROLL" // 等待当前玩家掷骰（含掷骰前可选操作：保释/用卡/资产管理）
  | "AWAITING_ACTION" // 等待购买决策（pendingPurchase）
  | "AUCTION" // 拍卖中（auction 非空；规则规格 §4）
  | "CASH_WINDOW" // 套现窗口（pendingDebt 非空；规则规格 §13）
  | "ENDED";
// 注：LOBBY 由服务端房间层管理，不属于引擎状态

export interface PlayerState {
  id: string;
  name: string;
  money: number;
  position: number;
  inJail: boolean;
  /** 已失败的在狱掷骰次数（0-3；第 3 次失败后强制保释） */
  jailTurns: number;
  /** 持有的出狱许可证（记录来源牌堆，便于归还）；数量 = length */
  getOutOfJailCards: CardDeck[];
  bankrupt: boolean;
}

export interface TileState {
  index: number;
  ownerId: string | null;
  /** 0-4（P1） */
  houses: number;
  /** P1 */
  hotel: boolean;
  /** P1 */
  mortgaged: boolean;
}

export interface TurnState {
  /** 本回合最近一次掷骰（换人时清空） */
  dice: [number, number] | null;
  /** 连续双数次数（第 3 次直接入狱） */
  doublesCount: number;
  /** 本次掷骰是否允许加掷（狱中掷双出狱/三次双数入狱时为 false） */
  lastRollGrantsExtra: boolean;
}

export interface PendingPurchase {
  playerId: string;
  tileIndex: number;
}

/** 房规开关（规则规格 §15；默认值见 constants.ts 的 DEFAULT_SETTINGS） */
export interface RoomSettings {
  startMoney: number;
  /** 拍卖开关：关闭后放弃购买即流拍、银行清算地产直接回流（默认开启） */
  auctionEnabled: boolean;
  /** 抵押破垄断加成：true = 组内任一抵押即不享受双倍基础租金（默认 true） */
  mortgageBreaksMonopoly: boolean;
  /** 免费停车场罚金池：开启后税金/罚款汇入池中，落上者全取（默认关闭） */
  potEnabled: boolean;
  /** 建筑库存限制：false = 无限（休闲模式）（默认 true：32 房屋 / 12 旅馆） */
  housingLimited: boolean;
  /** 限时模式（分钟，60/90；null = 关闭——最后存活者获胜，默认 null）（M4-6） */
  timeLimitMinutes: number | null;
}

/** 拍卖状态（规则规格 §4：公开递增、轮转询问、30 秒无人加价成交） */
export interface AuctionState {
  tileIndex: number;
  /** 当前最高价（null = 尚无人出价） */
  highBid: number | null;
  highBidderId: string | null;
  /** 待询问队列（队首 = 当前等待出价者；出价后移到队尾，放弃则移出） */
  queue: string[];
  /** 触发来源：购买放弃 / 银行清算（破产） */
  cause: "decline" | "bankruptcy";
}

/** 交易清单（私有报价的给与/索取内容） */
export interface TradeBundle {
  money: number;
  /** 地产格索引（地上无建筑；抵押地可交易，接收方付 10% 交易税） */
  tiles: number[];
  /** 出狱许可证数量 */
  jailCards: number;
}

/** 私有报价（规则规格 §11：60 秒限时应答，超时视为拒绝） */
export interface TradeOffer {
  id: string;
  fromId: string;
  toId: string;
  /** 发起者给出 */
  give: TradeBundle;
  /** 发起者索取 */
  want: TradeBundle;
}

/** 开放市场挂售（可随时撤回；任何人可买断） */
export interface Listing {
  id: string;
  sellerId: string;
  tile: number;
  price: number;
}

/** 套现窗口（规则规格 §13）：支付义务触发但现金不足时的待决债务 */
export interface PendingDebt {
  payerId: string;
  creditor: string | "bank";
  amount: number;
  reason: MoneyReason;
  /** 支付完成后的恢复动作 */
  resume: "completeMove" | "jailRoll" | "payEach";
  /** resume = "payEach"：由银行代收后转付的债权人清单 */
  payees?: { id: string; amount: number }[];
}

export interface GameState {
  /** 每次成功动作 +1（服务端快照/重连使用） */
  version: number;
  phase: GamePhase;
  players: PlayerState[];
  currentPlayerId: string;
  /** 长度 40，索引即格位 */
  tiles: TileState[];
  turn: TurnState;
  pendingPurchase: PendingPurchase | null;
  /** 牌堆（卡牌 ID 顺序；顶部在数组头部，抽走后人牌堆底） */
  decks: Record<CardDeck, string[]>;
  /** 建筑物库存（32 房屋 / 12 旅馆；housingLimited=false 时忽略消耗） */
  bank: { housesLeft: number; hotelsLeft: number };
  /** 拍卖状态（phase = AUCTION 时非空） */
  auction: AuctionState | null;
  /** 银行清算触发的待拍卖地产队列（逐块自动拍卖） */
  auctionQueue: number[];
  /** 私有报价（可并发；接受时原子校验） */
  trades: TradeOffer[];
  /** 开放市场挂售 */
  listings: Listing[];
  /** 套现窗口的待决债务（phase = CASH_WINDOW 时非空） */
  pendingDebt: PendingDebt | null;
  /** 罚金池金额（potEnabled 房规；规则规格 §8 免费停车场） */
  pot: number;
  settings: RoomSettings;
  winnerId: string | null;
}

// ===== 动作（客户端 → 服务端 → 引擎）=====

export type Action =
  | { type: "ROLL_DICE"; playerId: string }
  | { type: "BUY_PROPERTY"; playerId: string }
  | { type: "DECLINE_PURCHASE"; playerId: string }
  | { type: "PAY_BAIL"; playerId: string }
  | { type: "USE_JAIL_CARD"; playerId: string }
  // ---- M3：建筑（规则规格 §6）----
  | { type: "BUILD_HOUSE"; playerId: string; tile: number }
  | { type: "SELL_HOUSE"; playerId: string; tile: number }
  // ---- M3：抵押（规则规格 §7）----
  | { type: "MORTGAGE"; playerId: string; tile: number }
  | { type: "UNMORTGAGE"; playerId: string; tile: number }
  // ---- M3：拍卖（规则规格 §4）----
  | { type: "BID"; playerId: string; amount: number }
  | { type: "PASS_BID"; playerId: string; reason?: "manual" | "timeout" }
  // ---- M3：交易（规则规格 §11）----
  | { type: "PROPOSE_TRADE"; playerId: string; toId: string; give: TradeBundle; want: TradeBundle }
  | { type: "ACCEPT_TRADE"; playerId: string; offerId: string }
  | { type: "REJECT_TRADE"; playerId: string; offerId: string; reason?: "manual" | "timeout" }
  | { type: "CANCEL_TRADE"; playerId: string; offerId: string }
  | { type: "LIST_PROPERTY"; playerId: string; tile: number; price: number }
  | { type: "CANCEL_LISTING"; playerId: string; listingId: string }
  | { type: "BUY_LISTING"; playerId: string; listingId: string }
  // ---- M3：套现窗口（规则规格 §13；CASH_TIMEOUT 由服务端计时触发）----
  | { type: "DECLARE_BANKRUPTCY"; playerId: string }
  | { type: "CASH_TIMEOUT"; playerId: string }
  // ---- M4：限时模式（服务端到点触发；按总资产判胜负，规则规格 §14）----
  | { type: "TIME_UP"; playerId: string };

// ===== 事件（引擎 → 全房间广播，驱动动画与日志）=====

export type MoneyReason =
  | "salary"
  | "buy"
  | "tax"
  | "rent"
  | "card-pay"
  | "card-gain"
  | "bail"
  | "bankruptcy"
  | "auction"
  | "sell-house"
  | "mortgage"
  | "unmortgage"
  | "trade"
  | "trade-tax"
  | "pot";

export type GameEvent =
  | { type: "GAME_STARTED"; playerOrder: string[] }
  | { type: "DICE_ROLLED"; playerId: string; dice: [number, number]; reason: "turn" | "utility-card" }
  | { type: "TOKEN_MOVED"; playerId: string; from: number; to: number; path: number[] }
  | { type: "PROPERTY_BOUGHT"; playerId: string; tile: number; price: number }
  | { type: "PURCHASE_DECLINED"; playerId: string; tile: number }
  | { type: "RENT_PAID"; from: string; to: string; tile: number; amount: number }
  | { type: "MONEY_TRANSFERRED"; from: string | "bank"; to: string | "bank"; amount: number; reason: MoneyReason }
  | { type: "CARD_DRAWN"; playerId: string; deck: CardDeck; cardId: string }
  | { type: "PLAYER_JAILED"; playerId: string; cause: "tile" | "card" | "doubles" }
  | { type: "PLAYER_RELEASED"; playerId: string; method: "bail" | "card" | "doubles" | "forced" }
  | { type: "JAIL_STAYED"; playerId: string; jailTurns: number }
  | { type: "PROPERTY_TRANSFERRED"; from: string; to: string | "bank"; tiles: number[] }
  | { type: "PLAYER_BANKRUPT"; playerId: string; creditor: string | "bank" }
  | { type: "TURN_ENDED"; nextPlayerId: string }
  | { type: "GAME_ENDED"; winnerId: string; reason?: "last-standing" | "time-up" }
  // ---- M3：建筑 ----
  | { type: "HOUSE_BUILT"; playerId: string; tile: number }
  | { type: "HOTEL_BUILT"; playerId: string; tile: number }
  | { type: "HOUSE_SOLD"; playerId: string; tile: number; amount: number }
  | { type: "HOTEL_SOLD"; playerId: string; tile: number; amount: number }
  // ---- M3：抵押 ----
  | { type: "PROPERTY_MORTGAGED"; playerId: string; tile: number; amount: number }
  | { type: "PROPERTY_UNMORTGAGED"; playerId: string; tile: number; cost: number }
  // ---- M3：拍卖 ----
  | { type: "AUCTION_STARTED"; tile: number; cause: "decline" | "bankruptcy" }
  | { type: "AUCTION_BID"; playerId: string; amount: number }
  | { type: "AUCTION_PASSED"; playerId: string; reason: "manual" | "timeout" }
  | { type: "AUCTION_ENDED"; tile: number; winnerId: string | null; amount: number | null }
  // ---- M3：交易与市场 ----
  | { type: "TRADE_PROPOSED"; offer: TradeOffer }
  | { type: "TRADE_ACCEPTED"; offer: TradeOffer }
  | { type: "TRADE_REMOVED"; offerId: string; fromId: string; toId: string; reason: "rejected" | "cancelled" | "timeout" }
  | { type: "PROPERTY_LISTED"; listing: Listing }
  | { type: "LISTING_REMOVED"; listingId: string; sellerId: string; tile: number; reason: "cancelled" | "sold" }
  // ---- M3：套现窗口与罚金池 ----
  | { type: "DEBT_OPENED"; playerId: string; creditor: string | "bank"; amount: number; reason: MoneyReason }
  | { type: "DEBT_SETTLED"; playerId: string; creditor: string | "bank"; amount: number }
  | { type: "POT_COLLECTED"; playerId: string; amount: number };

// ===== 引擎返回值 =====

export type EngineErrorCode =
  | "NOT_YOUR_TURN"
  | "INVALID_PHASE"
  | "INVALID_ACTION"
  | "INSUFFICIENT_FUNDS"
  | "GAME_ENDED";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError };
