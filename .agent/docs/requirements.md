# 联机大富翁游戏需求文档 v1.0

> 状态：草案（技术选型已于 2026-09-18 冻结，见 §6；规则与功能待评审冻结）
> 日期：2026-09-18
> 定位：「朋友的数字据点」的第一个游戏模块（内部代号：monopoly）
> 依据：[monopoly-research.md](./monopoly-research.md)（开源项目调研）、[game-rules-spec.md](./game-rules-spec.md)（规则规格）

---

## 1. 背景与定位

- 用户拥有云服务器与域名，目标是搭建一个面向**朋友小圈子**（2-6 人/局）的数字据点；联机大富翁是第一个游戏模块
- 服务器约束：**轻量 1-2 核 / ~2GB 内存**；国内节点需域名备案后方可启用 80/443
- 使用场景：朋友之间随时开一局，手机/桌面浏览器打开即玩，房间码分享进群
- 与据点其他模块的关系：账号体系首期独立（房间码即权限），P2 阶段可选接入据点统一账号

## 2. 目标与成功标准

**项目目标**：让朋友间能随时完整打完一局大富翁（从开局到分出胜负），无需安装、无需注册。

**MVP 成功标准（验收线）**
1. 3-6 人完整对局可打通（含破产清算与胜利结算），规则符合游戏规则规格 v1.0
2. 任意玩家刷新页面或掉线后 60 秒内重连，游戏状态完全一致、无错乱
3. 单房间服务器峰值内存 < 300MB，空闲内存 < 100MB（1-2 核主机目标）
4. 从创建房间到开局不超过 3 次点击；手机浏览器可完成全部核心操作

## 3. 用户角色

| 角色 | 说明 |
|------|------|
| 房主 | 创建房间、获得房间码、在 ≥2 人时点击开始、可开启房规开关 |
| 玩家 | 凭房间码加入，参与对局 |
| 旁观者 | 开局后加入、或破产后的玩家；可观战与聊天，不能操作游戏 |

## 4. 功能需求

### 4.1 P0 —— MVP 必须（首版可玩）

| 编号 | 功能 | 说明与验收要点 |
|------|------|----------------|
| F01 | 房间管理 | 创建房间（生成 6-8 位房间码）、凭码加入；房主在人数 ≥2 时可开始；房间上限 6 人 |
| F02 | 身份与会话 | 昵称 + 本地会话 token；断线重连凭 token 回到原座位；无需注册登录 |
| F03 | 回合制核心循环 | 掷骰（双骰动画）、逐格移动、落格结算、换人；支持双数加掷、三次双数入狱 |
| F04 | 地产购买 | 落无主地产可选择购买；P0 放弃即流拍（拍卖在 P1）；资金不足自动禁用购买 |
| F05 | 租金结算 | 地产/车站/公用事业租金计算（含色组双倍加成）；租客现金不足进入破产前置流程（P0 简化：直接判定破产并清算） |
| F06 | 特殊格子 | 起点工资（经过或停靠 +$200）、所得税 $200、奢侈税 $75、免费停车（无事发生）、去监狱/探监 |
| F07 | 监狱循环 | 入狱判定、掷双出狱、$50 保释、3 回合强制出狱 |
| F08 | 基础卡牌 | 机会/命运各 16 张完整效果（含移动、金额、入狱、出狱卡、维修费、多人结算） |
| F09 | 破产与胜负 | 破产清算（资产移交/回流）、出局转旁观、最后存活者胜利 + 结算画面 |
| F10 | 聊天与日志 | 房间聊天 + 系统事件日志（同一面板）；昵称与聊天内容清洗防 XSS；速率限制 |
| F11 | 断线重连与恢复 | 快照持久化（每回合落库 SQLite）；重连 = 全量快照或增量事件补发；服务器重启后房间可从快照恢复 |
| F12 | 服务端权威 | 所有动作服务端校验（轮次、阶段、资金、所有权）；非法动作拒绝并返回错误码 |

**P0 明确不做**（避免范围蔓延）：拍卖、抵押/赎回、建房/旅馆、玩家交易、旁观者聊天入口之外的旁观 UI 完善、动画精修、挂机托管。

### 4.2 P1 —— 完整规则

| 编号 | 功能 | 说明 |
|------|------|------|
| F20 | 拍卖 | 放弃购买触发公开递增拍卖；30 秒无人加价成交；所有玩家可出价；可房规关闭 |
| F21 | 建房与卖房 | 平均原则、32 房/12 旅馆库存、旅馆升降级、半价卖房 |
| F22 | 抵押与赎回 | 半价抵押、10% 利息赎回（向上取整）、抵押地交易 10% 交易税 |
| F23 | 玩家交易 | 私有报价（60 秒限时应答）+ 开放市场（挂售买断/撤回）双模式 |
| F24 | 套现窗口 | 现金不足时 60 秒操作窗口（卖房→抵押→协商交易），倒计时提示 |
| F25 | 旁观模式完善 | 专属观战视图、聊天、非参与者禁用游戏操作 |
| F26 | 响应式完善 | 手机横竖屏适配，棋盘缩放/平移手势 |

> **M3 实施状态（2026-09-18）**：F20-F25 已完成（拍卖、建房/卖房、抵押/赎回、玩家交易双模式、套现窗口、旁观完善；详见 [monopoly-progress.md](../plans/monopoly-progress.md) 的 M3 验证记录）。F26（响应式精细适配与手势）与 F30-F36 属 M4 范围，随内测反馈排期。

### 4.3 P2 —— 打磨与扩展

| 编号 | 功能 | 说明 |
|------|------|------|
| F30 | 动画打磨 | 3D 骰子、棋子逐格动画、卡牌翻转、地产卡片弹层、音效 |
| F31 | 挂机托管 | 掉线玩家自动代打（最简策略：自动掷骰 + 不买地/买最便宜）；房主可手动接管/踢出 |
| F32 | 房规开关面板 | 拍卖开关、免费停车罚金池、起始资金、限时模式、建筑库存无限等（见规则规格 §15） |
| F33 | 战绩统计 | 对局历史、胜负场次、资产曲线回放 |
| F34 | 主题地图 | 自定义城市地标主题替换（仅显示名与文案，数值结构不变） |
| F35 | 限时模式 | 60/90 分钟到时按总资产判胜负 |
| F36 | 棋盘旋转/缩放 | 参考 itaylayzer 的滚轮旋转、Shift+滚轮缩放（彩蛋级特性） |

> **M4 实施状态（2026-09-18）**：F30（动画：骰子翻滚/卡牌弹层/速报/合成音效）、F31（挂机托管：掉线自动代打 + 房主接管）、F32（房规面板：6 开关 + 服务端校验）、F33（战绩统计：SQLite 落库 + REST + 首页列表；资产曲线回放暂缓）、F35（限时模式 60/90 分钟 + 总资产裁决）、F36（棋盘滚轮缩放 + 旋转彩蛋）均已完成。F34 经决策保持经典美版译名，交付主题替换链路验证（一键换皮流程文档化，见 engine/theme.test.ts）。移动端适配（F26）与性能调优按上线标准完成。

## 5. 非功能需求

| 维度 | 要求 |
|------|------|
| 性能 | 单房间 ≤6 人；玩家消息限速（≤5 条/秒，超限丢弃并告警）；单局完整状态 JSON ≤ 200KB；1-2 核主机支持并发 3-5 个活跃房间 |
| 可靠性 | 每回合结束落库快照；进程重启后从快照恢复房间；空闲房间 30 分钟无活动自动归档并从内存卸载 |
| 安全 | 服务端权威（拒绝一切非法动作，永不信任客户端状态）；昵称/聊天输入清洗（防 XSS）；房间码随机不可枚举；全局限速；强制 HTTPS；房间码即权限（小圈子模型） |
| 可维护性 | 规则引擎为**零依赖纯函数模块**，可独立单测（目标覆盖率 ≥80%，关键路径 100%）；前后端共享事件契约集中定义；数值与文案全部外置 JSON |
| 兼容性 | 桌面 Chrome/Edge/Safari + 移动端主流浏览器；核心操作不依赖 hover |
| 可观测性 | 结构化日志（pino）；`/healthz` 健康检查；错误码统一定义 |
| 部署 | 单服务（静态资源 + WebSocket 同端口，容器内监听、零宿主端口）；Docker Compose 加入外部网络 `proxy-net`，由服务器既有 nginx-proxy 统一 HTTPS 反代；`deploy.resources.limits` 资源限额（建议 512m / 0.5）；bind mount `./data` 持久化 SQLite 并登记进服务器备份脚本 |

## 6. 技术选型（已确认冻结）

> 状态：**已确认冻结（2026-09-18）**，后续开发严格遵循本决策；如需变更，必须先修订本节并说明理由。
> 评估依据：[monopoly-research.md](./monopoly-research.md) §四/§五、[game-rules-spec.md](./game-rules-spec.md)、项目约束（1-2 核 / ~2GB 服务器、朋友小圈子、P0 MVP 范围）。

### 6.1 冻结方案（与首选参考 terragady 架构一致）

| 层 | 选型 | 结论 | 一句话理由 |
|----|------|------|-----------|
| 语言层 | TypeScript（全栈，strict） | 冻结 | 前后端共享类型契约，Socket.IO 事件端到端类型化，减少联调错误 |
| 架构层 | pnpm workspaces monorepo：`apps/server`、`apps/client`、`packages/engine`、`packages/shared` | 冻结 | 引擎独立可单测、契约集中管理，4 包规模无过度拆分 |
| 架构层 | 自研纯函数 reducer：`applyAction(state, action) → { nextState, events[] }`（骰子随机由外部注入） | 冻结 | 零 IO、可单测复现、可离线热座；terragady 已验证该范式可行 |
| 服务端层 | Node.js 24 LTS + Express + Socket.IO 4.x | 冻结（原 22 LTS 修订为 24，当前 Active LTS 且与参考项目一致） | 房间/自动重连/ack 正是 P0 需求，开箱即用；负载极低 Express 足够 |
| 客户端层 | React 19 + Vite + Zustand | 冻结（2026-09-18 用户确认） | 与首选参考 terragady 实现一致可直接对照；Zustand 轻量够用 |
| 客户端层 | CSS Grid + SVG（棋子/动画层） | 冻结 | 静态棋盘 + DOM 点击交互最直接，不引入 Canvas/3D |
| 数据层 | SQLite（better-sqlite3，WAL 模式）+ 每回合快照表 | 冻结 | 单文件零运维，1-2 核最友好；快照是重连与重启恢复的基石 |
| 部署层 | 接入服务器既有 nginx-proxy：app 容器加入 `proxy-net`、零宿主端口、按容器名内网反代；certbot 证书；`deploy.resources.limits`（建议 512m / 0.5）；bind mount `./data` + 备份脚本登记 | 冻结（2026-09-18 修订：接入既有 nginx-proxy，不引入 Caddy） | 免 CORS、证书走既有双保险续期、资源上限可控；与服务器既有服务同构共存 |
| 测试层 | Vitest（引擎单测优先，覆盖率 ≥80%）；Playwright（e2e，P1 起） | 冻结 | 引擎是质量核心必须单测先行；e2e 后置不阻塞 MVP |

> 部署遵循《新项目服务上线规范》（源文件 `e:\code\@Cjy\新项目服务上线规范.md`）：服务器统一 nginx-proxy 入口、容器六条基线、反代限流模板、SQLite 备份登记均按该规范执行；本项目特有点（Socket.IO WebSocket 升级、Vite 静态产物豁免、无登录接口）在该规范模板上补充。

### 6.2 明确不采用（及理由与重新评估边界）

| 不采用 | 理由 | 重新评估的触发条件（防技术债回头） |
|--------|------|-----------------------------------|
| boardgame.io | Monopoly 的自由交互（拍卖出价、交易应答、任意窗口建房）与其回合模型摩擦大，需绕过 activePlayers/stages 机制；自研 reducer 更直接（详见调研文档 §四） | 仅当据点扩展为多款桌游且需要统一匹配大厅/引擎时评估 |
| WebRTC / P2P（PeerJS + coturn） | 引入信令、NAT 穿透、主机迁移等复杂度；回合制游戏对延迟不敏感，服务端权威反而更简单可靠 | 仅当开发实时动作类（非回合制）游戏时评估 |
| MySQL / Redis | 1-2 核服务器上过重；SQLite + 内存态足以支撑小圈子规模 | 仅当规模远超单机（数十并发房间 / 多节点部署）时评估 |
| 可视化地图编辑器 | 首期不做；棋盘以 JSON 配置替换即可满足主题化需求 | 仅当第二款游戏复用同一编辑器时评估 |
| 前端 3D（Three.js） | 感知收益与渲染成本不匹配；P2 视情况作为彩蛋评估 | P2 动画打磨阶段按需评估（不承诺） |
| 原生 ws（替代 Socket.IO） | 自动重连/房间广播/ack 均需自研，而这些正是 P0 验收项；Socket.IO 全部开箱即用 | 无（Socket.IO 已覆盖全部需求） |

### 6.3 其他备选方案（已评估，当前不选，不构成技术债）

| 备选 | 说明与不选理由 |
|------|----------------|
| Fastify / Hono（替代 Express） | 性能优势在当前负载（≤6 人/房间、数个房间）下无意义；Socket.IO + Express 集成示例最成熟。若未来接入更多 API 服务可平替 |
| Go（替代 Node.js 后端） | 内存占用略优，但失去全栈类型共享与 Socket.IO 成熟生态，开发效率下降；当前负载下 Node 内存完全可控，收益为负，已明确不选 |
| npm workspaces（替代 pnpm） | pnpm 安装不便时可无缝平替，架构与包结构不受影响 |
| Drizzle ORM（数据层增强） | 当前仅快照表 + 少量元数据，直接用 better-sqlite3 更直白；数据模型扩展时可增量引入，非重构 |
| node:sqlite（观察项） | Node 内置 SQLite 仍在演进；待其稳定后迁移成本仅为替换一个 db 封装文件 |
| Framer Motion / GSAP（动画，P2） | 动画打磨阶段再选型，不影响架构 |

## 7. 系统架构设计

### 7.1 架构图

```
┌──────────────────────── 玩家浏览器（React 19 + Vite） ────────────────────────┐
│  UI 层（棋盘 / 面板 / 弹窗 / 聊天）                                           │
│  Store（Zustand）：本地镜像状态 + 事件播放队列                                │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ HTTPS / WSS（仅经域名 443）
┌──────────────────────────────▼────────────────────────────────────────────────┐
│  nginx-proxy（服务器既有统一入口：占用宿主 80/443，按容器名内网反代）          │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │ proxy-net（Docker 内网）
┌──────────────────────────────▼────────────────────────────────────────────────┐
│  app 容器（Node.js + Express + Socket.IO，同源托管静态资源，零宿主端口）        │
│  ┌────────────┐   ┌───────────────────┐   ┌─────────────────────────────┐    │
│  │ 房间管理器  │ → │ 规则引擎（纯函数） │ → │ 事件广播器（房间内推送）     │    │
│  │ 生命周期/回收│   │ applyAction(...)  │   │ events + stateVersion       │    │
│  └─────┬──────┘   └───────────────────┘   └─────────────────────────────┘    │
│        │ 快照（每回合落库）                                                    │
└────────▼──────────────────────────────────────────────────────────────────────┘
         │
   ┌─────▼─────┐
   │  SQLite   │
   │ ./data    │
   └───────────┘
```

### 7.2 核心机制设计

1. **纯函数规则引擎**：`applyAction(state, action) → { nextState, events[] }`，零 IO、无随机副作用（骰子结果由服务端生成后作为 action 输入传入，便于测试复现）。引擎同时被服务端与单测直接引用。
2. **服务端权威流程**：接收 action → 校验（轮次/阶段/资金/所有权）→ 引擎计算 → 广播 `{ events, stateVersion }` → 客户端事件队列逐条播动画。校验失败返回统一错误码，客户端回滚乐观 UI（P0 可先不做乐观更新）。
3. **事件驱动动画与状态锁**：客户端收到事件入队顺序播放（骰子 → 移动 → 结算弹窗）；播放期间锁定输入；服务端用 phase 门控兜底（动画期间的非法请求会被拒绝）。
4. **快照与重连**：每回合结束 upsert 快照（含 version）；重连时携带本地 version，服务端保留事件环形缓冲（最近 N=200 条），缺口小则增量补发、缺口大则全量快照。
5. **房间生命周期**：内存态运行 + 落库；空闲 30 分钟归档卸载；服务器重启后按需从快照懒加载恢复。

## 8. 数据模型（草案）

> **M1 实施注记（2026-09-18）**：实际契约以 `packages/shared` 的 `types.ts` 为准，相对本草案的差异：
> - 动作均携带 `playerId`（引擎校验操作者；服务端据此拒绝非当前玩家的动作）
> - 骰子随机由 `applyAction(state, action, rng)` 注入的 rng 提供（含卡牌触发的额外掷骰），动作本身不携带骰值
> - 回合结束为自动推进（无待决事项时自动换人/加掷），未采用 `END_TURN` 动作
> - 引擎状态不含 `log`（事件流即日志，由服务端持有）；出狱许可证以「来源牌堆」数组表示
> - 事件集以 `GameEvent` 为准（新增 `TOKEN_MOVED` / `PURCHASE_DECLINED` / `JAIL_STAYED` / `PROPERTY_TRANSFERRED`；破产债权人取值为玩家 id 或 "bank"）
>
> **M3 实施注记（2026-09-18）**：完整规则契约扩展（以 `packages/shared/src/types.ts` 为准）：
> - 新增 phase：`AUCTION`（拍卖中）、`CASH_WINDOW`（套现窗口）；GameState 新增字段：`auction` / `auctionQueue` / `trades` / `listings` / `pendingDebt` / `pot`
> - 动作扩展：`BUILD_HOUSE`/`SELL_HOUSE`/`MORTGAGE`/`UNMORTGAGE`/`BID`/`PASS_BID`/`PROPOSE_TRADE`/`ACCEPT_TRADE`/`REJECT_TRADE`/`CANCEL_TRADE`/`LIST_PROPERTY`/`CANCEL_LISTING`/`BUY_LISTING`/`DECLARE_BANKRUPTCY`/`CASH_TIMEOUT`
> - 时间语义：引擎保持纯函数——超时由服务端计时后以 `PASS_BID(timeout)` / `CASH_TIMEOUT` / `REJECT_TRADE(timeout)` 动作驱动，引擎只做裁决
> - 套现窗口（§13）：`pendingDebt.resume` 记录支付完成后的恢复路径（`completeMove` 移动收尾 / `jailRoll` 强制出狱移动 / `payEach` 银行代收转付）；凑足自动结算
> - 破产清算（§12）：合同债权人直接移交（抵押地收 10% 交易税）；银行清算在拍卖开启时逐块进入无底价拍卖队列；建筑回收至银行库存
> - 房规开关（§15）：`auctionEnabled` / `mortgageBreaksMonopoly` / `potEnabled` / `housingLimited` / `startMoney` 全部生效

```ts
// ---- 服务端持久化与内存共用 ----
interface GameState {
  roomCode: string;
  version: number;                    // 单调递增，每次动作 +1
  phase: GamePhase;
  players: Player[];
  currentPlayerId: string;
  tiles: TileState[];                 // 长度 40，索引即格位
  turn: { dice: [number, number] | null; doublesCount: number };
  bank: { housesLeft: number; hotelsLeft: number };
  auction?: AuctionState;             // P1
  pendingTrade?: TradeOffer;          // P1
  log: LogEntry[];                    // 截断保留最近 100 条
  settings: RoomSettings;             // 房规开关
}

type GamePhase =
  | 'LOBBY' | 'AWAITING_ROLL' | 'RESOLVING' | 'AWAITING_ACTION'
  | 'AUCTION' | 'TRADE_PENDING' | 'CASH_WINDOW' | 'ENDED';   // 部分为 P1

interface Player {
  id: string; name: string; token: string;       // token 用于重连
  money: number; position: number;
  inJail: boolean; jailTurns: number; getOutOfJailCards: number;
  bankrupt: boolean; connected: boolean;
  properties: number[];                          // 地产格索引
  isHost: boolean; isSpectator: boolean;
}

interface TileState {
  index: number;
  ownerId: string | null;
  houses: 0 | 1 | 2 | 3 | 4;
  hotel: boolean;
  mortgaged: boolean;                            // P1
}

// ---- 动作（客户端 → 服务端）----
type Action =
  | { type: 'ROLL_DICE' }                                     // 骰值由服务端生成注入
  | { type: 'BUY_PROPERTY' }
  | { type: 'DECLINE_PURCHASE' }                              // P1 时触发拍卖
  | { type: 'PAY_BAIL' } | { type: 'USE_JAIL_CARD' }
  | { type: 'BUILD_HOUSE'; tile: number }                     // P1
  | { type: 'SELL_HOUSE'; tile: number }                      // P1
  | { type: 'MORTGAGE' | 'UNMORTGAGE'; tile: number }         // P1
  | { type: 'BID' | 'PASS_BID'; amount?: number }             // P1
  | { type: 'PROPOSE_TRADE' | 'ACCEPT_TRADE' | 'REJECT_TRADE' | 'LIST_PROPERTY' | 'BUY_LISTING'; payload?: unknown }  // P1
  | { type: 'END_TURN' };

// ---- 事件（服务端 → 全房间广播，驱动动画与日志）----
type GameEvent =
  | { type: 'DICE_ROLLED'; playerId: string; dice: [number, number] }
  | { type: 'TOKEN_MOVED'; playerId: string; from: number; to: number; path: number[] }
  | { type: 'MONEY_TRANSFERRED'; from: string | 'bank'; to: string | 'bank'; amount: number; reason: string }
  | { type: 'PROPERTY_BOUGHT'; playerId: string; tile: number; price: number }
  | { type: 'RENT_PAID'; from: string; to: string; tile: number; amount: number }
  | { type: 'CARD_DRAWN'; playerId: string; deck: 'chance' | 'chest'; cardId: string }
  | { type: 'PLAYER_JAILED' | 'PLAYER_RELEASED'; playerId: string }
  | { type: 'PLAYER_BANKRUPT'; playerId: string; creditor: string | 'bank' | 'multiple' }
  | { type: 'TURN_ENDED'; nextPlayerId: string }
  | { type: 'GAME_ENDED'; winnerId: string };
```

## 9. 接口设计（草案）

**REST**
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/rooms` | 创建房间 → `{ roomCode }` |
| GET | `/healthz` | 健康检查（进程/内存/房间数） |

**Socket.IO 事件**
| 方向 | 事件 | 载荷 | 说明 |
|------|------|------|------|
| C→S | `room:join` | `{ roomCode, name?, token?, lastVersion? }` | 加入/重连；返回座位或旁观身份 |
| C→S | `game:action` | `{ action, actionId }` | 所有游戏动作入口；actionId 幂等去重 |
| C→S | `chat:send` | `{ text }` | 聊天（清洗 + 限速） |
| S→C | `room:state` | `{ state }` | 全量状态（加入/重连快照） |
| S→C | `game:events` | `{ version, events[] }` | 增量事件广播 |
| S→C | `room:error` | `{ code, message }` | 统一错误（如 `NOT_YOUR_TURN`、`INSUFFICIENT_FUNDS`、`INVALID_PHASE`） |

> **M2 实施注记（2026-09-18）**：完整事件契约以 `packages/shared/src/protocol.ts` 为准，相对本草案的补充：
> - 新增 `room:start`（房主开局）与 `room:members`（成员/在线状态变更）事件；房间创建仍走 `POST /api/rooms`
> - `game:update` 同时携带**全量 `state`**（对局状态 <10KB，简化客户端一致性，版本号单调递增）；`room:state` 附带事件历史与聊天记录用于面板重建
> - 重连策略：客户端凭本地令牌自动归位（Socket.IO 自动重连 + 连接建立即归位）；服务端下发全量快照；事件环形缓冲 200 条仅供日志重建
> - 限速与幂等：聊天 ≤5 条/秒（超限 `RATE_LIMITED`）；`actionId` 幂等缓冲 50 条/成员；空闲 30 分钟且全员离线时归档（内存卸载，SQLite 保留，加入时懒加载恢复）
>
> **M3 实施注记（2026-09-18）**：超时驱动与计时信息：
> - `game:update` / `room:state` 载荷新增 `timers`（剩余毫秒：`auction` / `cash` / `trades[offerId]`），客户端本地倒计时展示；真实超时以服务端系统动作为准
> - 服务端超时：拍卖每次出价重置 30s（无人加价即裁决）；套现窗口自开启起 60s；私有报价每个独立 60s
> - 超时动作绕过成员校验（`applySystemAction`），与玩家动作竞态时由引擎裁决（已被推进的动作使超时失效并被静默忽略）
> - 服务器重启/懒加载恢复后计时以恢复时刻重新起算（deadline 不持久化）；M2 旧快照经 `normalizeState` 自动补齐 M3 字段

## 10. 里程碑与开发优先级

| 里程碑 | 内容 | 预估 | 出口标准 |
|--------|------|------|---------|
| M0 脚手架与部署 | monorepo、Docker Compose（六条基线 + proxy-net）、nginx conf（含 /socket.io/ WebSocket 升级与静态豁免）、certbot 证书、healthz、SQLite 接入与备份登记 | 1 天 | 空服务可经域名 HTTPS（nginx-proxy 反代）访问；备份登记验证 OK |
| M1 规则引擎 | P0 规则纯函数实现 + 单测（本地热座可打完整局） | 2-3 天 | 单测覆盖率 ≥80%；命令行可完成一局 |
| M2 联机 MVP | 房间/加入/重连、F03-F12 上线 | 2-3 天 | 3-6 人联机打通 P0 全部验收标准 |
| M3 完整规则 | P1：拍卖、建房、抵押、交易、套现窗口、旁观完善 | 3-5 天 | 完整规则对局无阻断性 bug |
| M4 打磨与扩展 | P2：动画、托管、房规面板、战绩、主题地图 | 持续 | 按优先级逐个交付 |

**建议开发顺序的内部逻辑**：M1 先行使引擎可离线验证（不依赖网络），M2 打通最小闭环后即可邀请朋友内测，M3 补齐策略深度，M4 按反馈打磨。

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 规则蔓延（细节越加越多） | 工期失控 | 规则规格 v1.0 评审冻结；数值与文案外置；新玩法一律走"房规开关"，不改默认规则 |
| 拍卖/交易复杂度高 | 高 bug 区 | 独立里程碑（M3）；状态机为独立 phase + 超时兜底（拍卖 30s、交易 60s）；边界用例全部进单测 |
| 动画与操作时序冲突 | 状态错乱/重复操作 | 客户端事件队列 + 播放期锁输入；服务端 phase 门控拒绝非法请求；actionId 幂等 |
| 断线重连不完善 | 体验崩塌（参考项目通病） | 列为 P0；快照 + 事件环形缓冲 + 版本号；内测阶段专项测试弱网/刷新 |
| 轻量服务器资源不足 | 卡顿/宕机 | 单服务同源；SQLite；房间空闲回收；Docker `mem_limit`；发隐私前压测 5 个并发房间 |
| 法律与商标 | 潜在下架风险 | 产品名不使用 "Monopoly / 大富翁" 商标；不复制官方美术与文案；仅圈子内非商业使用；玩法规则本身不受版权保护 |
| 国内服务器备案 | 无法启用 443 | 提前提交备案；备案期先用高位端口 + 非 80 端口体验 |
| 内测反馈集中于规则理解 | 上手成本高 | 首版做规则提示（落格解释、按钮禁用原因）；README 图文新手引导 |

## 12. 验收标准（MVP 摘要）

1. 6 人房间完整打完一局（含破产与胜利结算），无阻断性 bug；最低验收人数 3 人
2. 任意时刻刷新页面 / 断网 60 秒内重连成功，状态与服务端一致
3. 空闲服务器内存 < 100MB；单房间峰值 < 300MB
4. 规则引擎单测通过率 100%，覆盖率 ≥ 80%
5. 手机浏览器（Chrome/Safari 移动版）完成一局核心操作无障碍

## 13. 开放决策点（需用户确认）

> 技术选型已于 2026-09-18 全部冻结（见 §6）。决策点 1/4 已于 M4 关闭；以下剩余项均不阻塞上线。

1. **地名主题**：**已决策（2026-09-18，M4 期间）：保持经典美版译名**。替换能力保留（board.json/cards.json 仅显示字段可整体替换，主题链路测试守护）；未来如需换皮：改 JSON → `pnpm -F @monopoly/engine test`（含主题校验）→ 构建。
2. **拍卖形式**：公开递增（默认，已实现）
3. **抵押破色组加成**：默认"破"，可改（房规面板已可切换，M4-3）
4. **是否需要挂机托管（F31）**：**已实现（2026-09-18）**——掉线自动代打 + 房主手动开关，无需再决策。
5. **账号体系**：首期纯房间码（推荐）vs 直接做据点统一账号
6. **P0 超长对局处置**：~~自动模拟显示，无建筑/无拍卖的 P0 规则下对局可能长时间不收敛~~ **已由 M3 解决（2026-09-18）**：建筑（租金压力）与拍卖/套现（资产流转）上线后，多种子仿真均在 15000 步内分出胜负；CLI 3 人局样例 818 步终局。该决策点关闭。
    - 遗留可选项（P2 房规）：起始资金/租金倍率开关用于缩短单局时长，仍可作为 M4-3 面板的候选开关
