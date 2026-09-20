/**
 * 共享常量：应用标识 + 游戏核心数值（规则规格 v1.0）
 */

/** 应用标识（内部工程代号；对外产品名另行确定，避免使用商标名） */
export const APP_NAME = "monopoly";

/** 健康检查路径（与部署 nginx conf、容器 HEALTHCHECK 保持一致） */
export const HEALTH_PATH = "/healthz";

/** REST API 前缀（M2 起使用） */
export const API_PREFIX = "/api";

// ===== 游戏核心数值 =====

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const START_MONEY = 1500;
export const BOARD_SIZE = 40;
export const GO_TILE_INDEX = 0;
export const GO_SALARY = 200;
export const JAIL_TILE_INDEX = 10;
export const JAIL_BAIL = 50;
/** 第 3 次尝试失败后强制保释并移动 */
export const JAIL_MAX_TURNS = 3;

/** 建筑物库存（P1 使用） */
export const BANK_INITIAL_HOUSES = 32;
export const BANK_INITIAL_HOTELS = 12;

/** 车站租金（按持有数量 1-4） */
export const RAILROAD_RENTS = [25, 50, 100, 200] as const;

/** 公用事业倍数：持有 1 座 ×4；2 座 ×10 */
export const UTILITY_MULTIPLIERS = { one: 4, two: 10 } as const;

/** 出狱许可证卡牌 ID（按来源牌堆，便于归还） */
export const JAIL_CARD_IDS: Record<"chance" | "chest", string> = {
  chance: "chance-8",
  chest: "chest-5",
};

// ===== M3 超时参数（服务端计时驱动；引擎只处理超时动作） =====

/** 拍卖：单次出价窗口（30 秒无人加价即裁决，规则规格 §4） */
export const AUCTION_TIMEOUT_MS = 30_000;
/** 私有报价应答时限（60 秒超时视为拒绝，规则规格 §11） */
export const TRADE_TIMEOUT_MS = 60_000;
/** 套现窗口时长（60 秒，规则规格 §13） */
export const CASH_WINDOW_MS = 60_000;

/** 抵押赎回利息率（10%，向上取整到 $1，规则规格 §7） */
export const MORTGAGE_INTEREST_RATE = 0.1;

/** 房规默认值（规则规格 §15；开局时由房主配置，见 CreateGameOptions.settings） */
export const DEFAULT_SETTINGS = {
  startMoney: START_MONEY,
  auctionEnabled: true,
  mortgageBreaksMonopoly: true,
  potEnabled: false,
  housingLimited: true,
  timeLimitMinutes: null,
} as const;

/** 房规面板可配置项的范围（服务端校验，防越界（M4-3）） */
export const SETTINGS_LIMITS = {
  startMoneyMin: 500,
  startMoneyMax: 5000,
  /** 限时模式可选分钟数（null = 关闭） */
  timeLimitOptions: [60, 90] as const,
} as const;
