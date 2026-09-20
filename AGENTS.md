# AGENTS.md — 联机大富翁项目指引

> 面向新成员与 AI Agent 的项目入口文档：读这一篇即可建立全局认知。
> 版本：v1.4 ｜ 更新日期：2026-09-18 ｜ 当前状态：M0-M4 全部完成（完整规则 + 打磨上线级：房规面板/挂机托管/限时模式/战绩/动画音效，200 测试全绿、冒烟终局验证通过）；M2-8 浏览器实测待用户；M0-5 上线链路待域名确认
> 维护要求：项目结构、命令、工作流发生变化时，必须同步更新本文件。

## 1. 项目简介与定位

**一句话**：在浏览器里和朋友开房玩大富翁（2-6 人，凭房间码进组，打开即玩、无需注册）——「朋友的数字据点」的第一个游戏模块，工程代号 `monopoly`。

- **目标用户**：作者的朋友小圈子（邀请制、信任环境，非公开运营）
- **产品形态**：Web 应用（桌面 + 移动浏览器），单域名 HTTPS 访问
- **运行环境**：腾讯云轻量服务器（约 1.9G 内存），与服务器上其它服务共享统一的 nginx-proxy 入口
- **命名注意**：`monopoly` 仅为工程代号；对外产品名不得使用 "Monopoly / 大富翁" 商标（法律风险见 requirements §11）

## 2. 技术栈速览（已冻结）

> 以下选型于 2026-09-18 冻结（见 requirements §6），**禁止擅自引入与之冲突的依赖**；如需变更必须先修订 §6 并说明理由。

| 层 | 选型 |
|----|------|
| 语言 | TypeScript 全栈（strict） |
| 结构 | pnpm workspaces monorepo（apps/server、apps/client、packages/engine、packages/shared） |
| 服务端 | Node.js 24 LTS + Express + Socket.IO 4.x |
| 规则引擎 | 自研纯函数 reducer（零 IO，骰子随机由外部注入） |
| 客户端 | React 19 + Vite + Zustand；棋盘 CSS Grid + SVG |
| 数据 | SQLite（better-sqlite3，WAL 模式）+ 每回合快照 |
| 部署 | Docker Compose + 服务器既有 nginx-proxy（certbot 证书、proxy-net 网络、零宿主端口） |
| 测试 | Vitest（引擎单测，覆盖率 ≥80%）；Playwright（e2e，P1 起） |

## 3. 目录结构（pnpm monorepo）

```
something/
├── apps/
│   ├── server/          # 服务端：房间管理、Socket.IO 事件层、快照持久化、静态托管
│   └── client/          # 客户端：React 19 + Vite，棋盘渲染、交互、事件动画队列
├── packages/
│   ├── engine/          # 纯函数规则引擎（M3/M4 模块）：apply.ts 调度 / resolve.ts 核心循环 /
│   │                    #   buildings.ts 建筑 / mortgage.ts 抵押 / auction.ts 拍卖 /
│   │                    #   trades.ts 交易与市场 / debt.ts 套现窗口与罚金池 / money.ts 破产清算 /
│   │                    #   networth.ts 总资产与限时裁决
│   └── shared/          # 共享契约：Action/Event 类型、棋盘与卡牌数据 JSON、常量、Socket 协议
├── deploy/              # 部署物：Dockerfile、nginx conf（含 WebSocket 升级补丁）、DEPLOY.md 手册
├── docker-compose.yml   # 服务器部署编排（服务目录 = 仓库根；六条基线 + proxy-net）
├── .env.example         # 环境变量模板（复制为 .env）
├── .agent/
│   ├── docs/            # 调研、规则、需求文档（决策与冻结记录）
│   └── plans/           # 开发计划与进度追踪
└── AGENTS.md            # 本文件
```

**各包职责边界**
- `engine` **零依赖**：不 import Node API、不发网络请求；只接受 state + action，返回 nextState + events（保证可单测、可离线热座）
- `shared` 只放**类型与数据**，不放逻辑
- `server` 是唯一权威：校验所有动作、生成骰值、落库快照、广播事件
- `client` 只做展示与交互：本地镜像状态 + 事件播放队列，**永不裁决游戏逻辑**

> 上述结构已于 M0（2026-09-18）落地；剩余上线链路（M0-5）见进度表。

## 4. 快速启动指南

**环境要求**：Node.js 24 LTS、pnpm（`corepack enable`）、Docker（部署用）

```bash
# 1. 安装依赖
pnpm install

# 2. 本地开发（并行启动）
pnpm dev            # server: http://localhost:3000（/healthz 健康检查）
                    # client: http://localhost:5173（Vite 代理 /socket.io 到 server）

# 3. 常用校验
pnpm test           # 引擎单测（Vitest；覆盖率报告：pnpm -F @monopoly/engine test:cov）
pnpm typecheck      # 全 workspace 类型检查

# 4. 本地热座对局（规则引擎直跑，无需网络）
pnpm play           # 交互式热座；自动对局：
                    # pnpm -F @monopoly/engine run play -- --auto --seed 5 --max-steps 3000

# 5. 在线冒烟（对运行中的服务端打一场真实多人对局；含建房策略，可跑到终局并落库战绩）
# pnpm -F @monopoly/server exec tsx scripts/smoke-game.ts http://127.0.0.1:3000 2 3000
# 战绩查询：curl http://127.0.0.1:3000/api/records

# 6. 本地生产模式（server 同源托管构建产物）
pnpm build && pnpm start
```

**部署（服务器侧，遵循《新项目服务上线规范》）**

```bash
# 服务器目录：~/<service-name>/（compose + .env + data/）
docker compose up -d --build
docker exec nginx-proxy nginx -t          # 配置校验
docker exec nginx-proxy nginx -s reload   # 容器重建后必须 reload（IP 缓存问题）
curl -sk https://<域名>/healthz           # 验证
```

> 完整部署步骤（证书申请、备份登记、上线验证清单）见 [deploy/DEPLOY.md](deploy/DEPLOY.md)。

## 5. 核心概念

### 5.1 纯函数规则引擎
全部游戏逻辑在 `packages/engine`：`applyAction(state, action, rng) → { nextState, events[] }`。零 IO，随机性完全由注入的 `rng` 提供（服务端用 `secureRng()`，CLI/测试可用 `seededRng(seed)` 复现）——同一输入与同一 rng 序列必然复现同一结果，单测与 bug 复现极其简单。本地热座 CLI（`pnpm play`）直接调用引擎，无需网络。

### 5.2 事件驱动架构
服务端权威流程：收 action → 校验（轮次/阶段/资金/所有权）→ 引擎计算 → 广播 `{ events, stateVersion }` → 客户端将事件放入**播放队列**逐条播动画（骰子 → 移动 → 结算弹窗），播放期间锁输入；服务端用 phase 门控兜底，拒绝动画期间的非法请求。`events` 同时是游戏日志与动画的唯一数据源。

### 5.3 房间生命周期
创建（生成房间码）→ LOBBY → 对局（内存运行，每次动作写穿 SQLite）→ 结算 / 空闲 30 分钟归档回收。服务器重启后按需从快照懒加载恢复（旧快照经 `normalizeState` 自动补齐 M3 字段）；玩家重连 = 凭 token 回座位 + 服务端下发全量状态与事件历史（环形缓冲 200 条，用于日志面板重建）。

### 5.4 超时驱动（M3）与自动化（M4）
引擎保持纯函数——**所有时间概念在服务端**：拍卖 30 秒无人加价、套现窗口 60 秒、私有报价 60 秒、限时模式（60/90 分钟），到期由服务端以系统动作（`PASS_BID(timeout)` / `CASH_TIMEOUT` / `REJECT_TRADE(timeout)` / `TIME_UP`）驱动引擎裁决；剩余毫秒随 `game:update` 的 `timers` 下发，客户端只做本地倒计时展示。与玩家动作竞态时由引擎兜底（超时动作若已不适用则被忽略）。
**挂机托管**（M4-2）：房间层每 1.5s 轮询——"需要动作的玩家"离线超 8s（或房主手动托管超 1.5s）即自动代打（保守策略：半数现金内购地、拍卖弃权、套现卖房→抵押），走 `applySystemAction` 与超时动作同一通路。

### 5.5 屋顶：房规、战绩与主题
- **房规**（M4-3）：大厅内房主配置（`room:settings`），服务端白名单+范围校验，开局冻结进 `GameState.settings`；生效开关见 FAQ Q3
- **战绩**（M4-4）：终局时落库 `game_records`（含每方资产与破产标记），`GET /api/records` 读取，首页展示
- **主题替换**（M4-5）：board.json / cards.json 的显示字段可整体替换（数值结构不动）；守护测试 `engine/theme.test.ts`；当前采用经典美版译名（requirements §13 决策点 1 已关闭）

### 5.6 服务端权威与防作弊
客户端永不裁决：骰值、租金、买卖、破产全部由服务端计算。所有非法动作（非当前回合、余额不足、不是地产所有者、阶段不符）统一拒绝并返回错误码。

## 6. 开发工作流

**分支策略**
- `main` 始终保持可运行（随时可部署）
- 功能/修复使用短分支：`feat/m2-room-manager`、`fix/engine-jail-edge`，完成后合回 `main`
- 避免长分支，单个分支生命周期建议 ≤ 2 天

**提交规范**
- 使用 Conventional Commits：`feat: / fix: / docs: / test: / refactor: / chore:`
- **Git 提交与删除操作必须经用户明确指示**（默认助手不代为 commit）
- 提交拆分与进度任务卡片（M-x-y）对齐，便于追踪

**文档同步约束（强制）**
- 任何代码改动必须同步更新对应文档：进度变化 → 更新 `monopoly-progress.md`；规则变化 → 先修订 `game-rules-spec.md`；选型/需求变化 → 先修订 `requirements.md` 并说明理由
- 禁止"仅代码改动而无文档记录"

**代码审查**
- 合并前检查：① 引擎单测通过；② requirements §12 验收标准不受损；③ 契约（shared 类型）变更已同步双方；④ 文档已更新
- 可发起 CodeReview Agent 审查改动；高风险改动（引擎规则、并发/时序）必须人工过目

**测试职责**
- 引擎单测（Vitest）由助手开发并执行；前端测试仅提供运行命令，由用户自行执行
- 规则分支必须"先写用例、后实现"，覆盖率 ≥80%

## 7. 相关文档索引

| 文档 | 内容 | 定位 |
|------|------|------|
| [.agent/docs/requirements.md](.agent/docs/requirements.md) | 需求、P0-P2 功能清单、**技术选型冻结（§6）**、里程碑、验收标准 | 最高权威（需求与选型） |
| [.agent/docs/game-rules-spec.md](.agent/docs/game-rules-spec.md) | 规则规格 v1.0：棋盘结构、回合流程、租金表、卡牌、房规开关 | 规则唯一依据 |
| [.agent/docs/monopoly-research.md](.agent/docs/monopoly-research.md) | 开源项目调研、架构参考、boardgame.io 评估、选型依据 | 背景与决策依据 |
| [.agent/plans/monopoly-development-plan.md](.agent/plans/monopoly-development-plan.md) | 开发计划：M0-M4 拆解、依赖、工时、关键路径、风险 | 执行基线 |
| [.agent/plans/monopoly-progress.md](.agent/plans/monopoly-progress.md) | **唯一进度记录源**：32 个任务卡片与状态 | 持续更新 |
| 《新项目服务上线规范》（项目外：`e:\code\@Cjy\新项目服务上线规范.md`） | 服务器部署基线：nginx-proxy、备份、限流、检查清单 | 部署必读 |

**文档优先级（出现冲突时）**：requirements > game-rules-spec > monopoly-research；计划与进度文档从属于 requirements §10。

## 8. 常见问题 FAQ

**Q1：断线重连是如何实现的？**
玩家凭本地 token 归位（Socket.IO 自动重连 + 连接建立时自动携带 token 重进房间）；服务端保留下发全量状态快照（含单调递增版本号）与事件历史（环形缓冲 200 条，用于日志面板重建）。**对局中掉线不会被移出座位**，刷新页面或断网恢复后自动回到原座；60 秒内重连且状态一致为 P0 验收标准（集成测试已自动化覆盖）。

**Q2：服务器重启会丢局吗？**
不会丢已确认进度：每次动作将完整状态写穿 SQLite（WAL 模式，bind mount 到 `./data`），重启后房间按需从快照懒加载恢复。备份走服务器 `~/backup-databases.sh`（SQLite `.backup` 一致性快照，每日 03:30，保留 7 天）——**注意：WAL 模式严禁直接 cp 数据库文件做备份**。

**Q3：房规怎么配置？**
大厅内由房主在房规面板直接配置（M4-3；`room:settings` 事件）。**全部生效开关**：`auctionEnabled`（拍卖，关闭后放弃购买即流拍、银行清算地产直接回流）、`potEnabled`（免费停车罚金池）、`mortgageBreaksMonopoly`（抵押破垄断加成）、`housingLimited`（建筑库存，false = 无限）、`startMoney`（500-5000）、`timeLimitMinutes`（限时 60/90 分钟，到点按总资产决胜）。服务端白名单+范围校验，开局冻结进 `GameState.settings`；**默认值以规则规格 §15 的 [本项目裁决] 为准**（`DEFAULT_SETTINGS`），修改默认需先修订规则规格。

**Q4：为什么不用 Caddy / boardgame.io / WebRTC？**
- Caddy：服务器已有统一 nginx-proxy 入口（部署规范强制接入），见 requirements §6.1
- boardgame.io：与 Monopoly 自由交互模型摩擦大，评估见 monopoly-research §四
- WebRTC/P2P：复杂度高、收益低，见 requirements §6.2（含重新评估边界条件）

**Q5：骰子公平性与防作弊怎么保证？**
骰值由服务端生成后注入引擎（作为 action 参数），客户端只负责播动画。任何"客户端计算结果"的改动都不可接受。

**Q6：想加卡牌 / 换地图怎么做？**
改 `packages/shared` 中的数据 JSON（cards.json / board.json），引擎代码不动；新增卡牌效果类型需先扩展 CardEffect DSL（规则规格 §9）并补齐单测。

**Q7：为什么引擎里没有网络/存储代码？**
刻意的设计：引擎零依赖是"可单测、可复现、可离线"的前提。IO 只存在于 `apps/server`（持久化/广播）与 `apps/client`（展示）两侧。

**Q8：单局大概打多久？会长到打不完吗？**
M3 起规则完整（建筑抬高租金、拍卖/套现加速资产流转），对局会正常收敛：仿真测试中 2 人局多种子均能在 15000 步内分出胜负；CLI 自动样例（3 人）约 800 步终局；在线冒烟（2 人、含建房策略）203 步终局。M1 时期观察到的"P0 不收敛"现象已随建筑/拍卖上线解决（详见 requirements §13 决策点 6 的关闭记录）。**注意**：自动对局若不含建房策略（只买卖地），租金压力不足会显著拖长对局甚至不收敛——编写新策略脚本时请复用 `scripts/smoke-game.ts` 的建房策略。

**Q9：拍卖 / 套现 / 交易的倒计时是谁在计时？**
全部由服务端计时（30s / 60s / 60s；限时模式另计），到期自动下发系统动作完成裁决；客户端仅根据 `timers` 载荷做视觉倒计时。**不要**在引擎里引入任何时间概念（纯函数约束），也**不要**信任客户端上报的超时——这正是服务端权威的体现。

**Q10：朋友掉线了怎么办？战绩在哪里看？**
掉线自动托管：轮到该玩家操作且离线超过 8 秒，服务端自动代打（保守策略），**重连后自动交还手动控制**；房主可在玩家面板随时开/关任何人的托管，成员也可托管自己（如临时接电话）——手动托管会持续生效，需显式关闭。每局结束后战绩自动落库（含各方总资产与破产标记），首页"最近对局"列表展示，也可 `GET /api/records` 查询。
