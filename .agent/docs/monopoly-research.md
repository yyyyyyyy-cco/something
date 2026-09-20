# 大富翁（Monopoly-style）开源项目调研分析

> 调研日期：2026-09-18
> 用途：为「朋友的数字据点」联机大富翁模块（内部代号 monopoly）提供选型与架构设计依据
> 约束条件：轻量云服务器（1-2 核 / ~2GB 内存）、2-6 人小圈子好友对局、服务端权威、需断线重连
> 相关文档：[game-rules-spec.md](./game-rules-spec.md)、[requirements.md](./requirements.md)

## 一、总览对比

| # | 项目 | 技术栈 | 联机方式 | 规则完整度 | 活跃状态 | 许可 | 参考价值 |
|---|------|--------|----------|-----------|---------|------|---------|
| 1 | terragady/monopoly-websockets | TS + Socket.IO + React 19 + Vite，pnpm monorepo | 服务端权威 WebSocket，房间码 | 高（拍卖/交易/抵押齐全） | 活跃（近年彻底重写） | 未标注 | 首选架构参考 |
| 2 | FatPaper-1874/mine-monopoly | Vue3 + TS + Three.js + Electron + Express + MySQL + PeerJS | 混合 P2P（WebRTC + coturn） | 极高（含地图编辑器） | 活跃 | GPL-3.0 | 编辑器与表现层参考 |
| 3 | itaylayzer/Monopoly | React + Express + TS + PeerJS | P2P（WebRTC） | 中 | 暂停维护 | 未标注 | UI 信息架构参考 |
| 4 | HumanSean/javascript-monopoly | 原生 JS | 单机 + 电脑玩家 | 中（无交易/拍卖/抵押） | 已完成存档 | 未标注 | 游戏主循环与数据设计参考 |
| 5 | gamescomputersplay/monopoly | Python | 无（批量模拟器） | 中高 | 低活跃 | 未标注 | 规则判定顺序 / 数值验证参考 |
| ? | boardgame.io（框架，非完整游戏） | JS/TS 桌游引擎 | 内置（Socket.IO 等） | - | 活跃（npm v0.50.2，2026-07 更新） | MIT | 备选框架，评估见第五节 |

## 二、逐项目详细分析

### 1. terragady/monopoly-websockets —— 首选参考

**一句话总结**：一个 2020 年的业余项目被彻底重写为「服务端权威 + 房间隔离 + 端到端类型化」的现代架构，是目前规则覆盖度与工程质量平衡得最好的开源联机实现。

**技术栈**
- pnpm monorepo：`apps/server`、`apps/client`、`packages/shared`
- 服务端：Express + Socket.IO（TypeScript，tsx 直跑）；游戏状态存内存，每房间一个独立对局
- 客户端：React 19 + Vite（TypeScript）
- 共享包 `@monopoly/shared`：棋盘数据、卡牌牌堆、**端到端类型化的 Socket.IO 事件契约**（前后端共同引用）
- 部署：Node 服务同源托管构建后的客户端（无 CORS 配置）、多阶段 Dockerfile、Render / Cloud Run 蓝图、`/healthz` 健康检查；生产环境单实例控制成本

**架构与关键实现细节**
- **服务端权威**：骰子点数、移动、租金计算、回合顺序全部由服务器计算；服务器校验并拒绝非法动作（非当前回合、余额不足、不是地产所有者）
- **房间隔离**：凭房间码加入，每次加入进入独立对局；开局后加入者自动成为**旁观者**（仍可聊天）
- **重写时修复的旧版问题**（对本项目是很好的"反面教材清单"）：
  - 旧版客户端自己算骰子/移动 → 可作弊（本版全部服务端裁决）
  - 聊天裸渲染 HTML → XSS（本版对昵称与聊天做清洗）
  - 机会卡错误地从命运卡堆抽取（本版两堆独立）
- **交易系统（双模式，经过实践验证的设计）**：
  - 私有报价：点击他人地产提交报价，房主 20 秒内接受/拒绝，双方收到结果通知
  - 开放市场：点击自己的地产挂价出售，房内任何玩家可买断，可随时撤回
- **破产处理**：出局玩家的地产回流开放市场；玩家保留旁观与聊天能力
- **表现层**：3D 骰子动画、棋子逐格移动、卡牌翻转、模态交互提示
- **胜负**：最后一位未破产者获胜（含专门胜利结算画面）

**优点**
- 架构与本项目约束几乎完全吻合：轻量、单服务同源、房间制、好友小圈子
- 完整的规则实现（建房/旅馆、色组加倍、抵押、拍卖、出狱卡、交易、胜利结算）可作为规则引擎的对照实现
- 共享类型契约 + monorepo 的组织方式可直接借鉴

**缺点**
- 游戏状态仅存内存：服务器重启即丢局（README 列为待办）
- **断线即被移出座位，重连恢复未实现**（README 明示短板）——本项目必须自己补上
- 未标注开源许可证，直接复制代码前需联系作者确认（仅参考设计则无此顾虑）

**可借鉴点**
1. monorepo + 共享类型契约的组织方式
2. 服务端权威 + 动作校验拒绝
3. 房间码 + 旁观者模型
4. 交易双模式（私有报价 20s 应答 + 开放市场）
5. 同源单服务部署与健康检查

**需要本项目补强的差距**：SQLite 快照持久化、断线重连、空闲房间回收（详见 requirements.md）。

---

### 2. FatPaper-1874/mine-monopoly（含前身 fatpaper-monopoly）

**一句话总结**：中文社区的高自由度大富翁，内置可视化地图编辑器与可编程内容系统，采用混合 P2P 架构，工程规模远超本项目所需。

**技术栈**
- 客户端：Vue3 + TS + Vite + Pinia；Three.js + GSAP 渲染；Electron（Windows 端）
- 服务端：Express + TypeORM + MySQL 8（认证、房间路由、地图存储）
- 通信：Socket.IO（信令）+ PeerJS（WebRTC 数据通道）+ coturn（STUN/TURN 中继）；Protocol Buffers 序列化
- 工程：pnpm workspaces + Changesets；GPL-3.0

**架构与关键实现细节**
- **混合 P2P**：中央服务器只做认证与房间匹配；游戏逻辑运行在"主机客户端"的 Web Worker 中；玩家之间 WebRTC 直连，coturn 解决跨 NAT 连通性
- **地图编辑器**（核心资产）：
  - 可视化拖拽画棋盘、配置地块
  - 用 TypeScript / JavaScript 编写可编程内容：角色技能、机会卡效果（effectCode）、地图事件触发器、游戏阶段规则、UI Schema
  - 编辑器内置 MCP 服务：用自然语言描述，AI 生成对应内容代码，通过类型校验后写入地图
- 官方地图源文件通过爱发电获取；作者明确"不建议自行部署"

**优点**
- 内容自由度天花板级：地图、角色、卡牌、事件全可编程，证明了"事件系统 + 内容数据化"的可行路径
- 中文文档完善（开发指南、API 参考、AGENTS.md 等）
- 游戏表现力强（3D + 动画）

**缺点**
- 复杂度远超本项目需要：MySQL + coturn + Protobuf + Electron 多端，1-2 核服务器跑全套偏吃力
- GPL-3.0 传染性：不能借鉴代码，只能参考设计思路
- 依赖付费资源（地图源文件、爱发电）与 MCP 等重型工具链

**可借鉴点**
1. 内容数据化思路（棋盘/卡牌/事件 JSON 化）——本项目以简化形式采纳
2. 事件系统设计（触发条件 → 效果列表）可作为机会卡的长期扩展方向
3. 明确不借鉴：P2P 架构与重型工程复杂度

---

### 3. itaylayzer/Monopoly

**一句话总结**：React + Express + TypeScript 的多人 Monopoly，PeerJS 直连，UI 信息架构有想法，但规则完成度一般且项目暂停维护。

**技术栈**
- React.js + Express.js + TypeScript + PeerJS（WebRTC）
- 仅支持多人模式（无单机）；棋盘数据来自 danielstern/science 的 `monopoly.json`（经作者修改）

**关键实现细节**
- **三面板信息架构**：玩家导航面板（查看各家进度状态）、地产导航（管理自己的地产、查询他人地产）、对话框/通知系统
- 点击棋盘上的街道 → 弹出该地产的地契详情卡
- 掷骰 UI、买地 UI 流程完整
- 交互彩蛋：鼠标滚轮旋转棋盘、Shift + 滚轮缩放、数字键 1-9 切换导航页
- 音效系统（掷骰、买地、破产、胜利等十余种）

**优点**
- UI 信息架构值得参考（玩家面板 / 地产面板 / 日志三件套在本项目中可直接沿用）
- JSON 数据驱动棋盘的做法简单有效

**缺点**
- 作者"Taking a Break"，Firebase 相关功能（账号、排行榜）已停用，项目处于半成品状态
- P2P 依赖自建 Peer 服务器配置；机器人、经济系统、排行榜均为未完成 TODO（还在探索 TensorFlow.js）
- 规则严谨性一般（无拍卖、交易等进阶规则）

**可借鉴点**
1. 三面板 UI 信息架构
2. 旋转/缩放棋盘属低成本高感知特性（可列为 P2 彩蛋）

---

### 4. HumanSean/javascript-monopoly

**一句话总结**：原生 JS 单机大富翁（含电脑玩家），约 600-2000 行、中文注释，架构极简清晰，是理解"游戏主循环 + 数据设计"的极佳读物。

**代码结构**
- `initializing.js`：选人数 / 选角色 / 开局
- `monopoly.js`：主循环——掷骰 → `setInterval` 逐格移动 → `setTimeout` 停下 → 触发棋格事件 → 切换下一个玩家；另含买地/升级、玩家顺序（跳过停止与破产）、破产判定、结束判定
- `data.js`：角色 / 棋格 / 机会命运卡数据
- `dom-binding.js`：所有界面显示绑定

**数据模型（简）**
- 角色：`{名字, 金钱, 状态(活跃/破产), 停止天数, 是否电脑, DOM 节点, 当前位置}`
- 棋格：`{地名, 地价, 状态(等级/特殊区域), DOM 节点}`
- 卡片：`{说明文字, 金钱数值, 是否停止}`

**优点**
- 单体文件级可读懂；"数据 / 逻辑 / 渲染"三层分离，作者从 1500 行重构到 600 行说明了这种分层的收益
- 移动动画的节拍控制（逐格移动 → 停下后触发事件）思路直观，本项目将升级为"服务端事件队列驱动"
- 含电脑玩家（AI）逻辑，可作为后续"挂机托管"的最小参考

**缺点**
- 无联机（本地轮流操作）；直接操作 DOM 不可扩展；无交易 / 拍卖 / 抵押 / 成套加倍等进阶规则

**可借鉴点**
1. 数据/逻辑/UI 分层
2. 移动动画完成后才触发格事件的时序控制
3. 破产与玩家顺序判定的边界处理
4. 最简 AI（电脑玩家）的决策逻辑

---

### 5. gamescomputersplay/monopoly

**一句话总结**：Python 实现的 Monopoly 批量模拟器（非交互游戏），用于统计与规则研究。

**定位与用途**
- 蒙特卡洛式批量对局模拟，输出格子停留频率、破产概率等统计
- 作者对 Monopoly 规则变体做过系统的对比研究

**优点**
- 纯逻辑实现，便于阅读"规则判定顺序"（先付租还是先判定破产等边界问题的处理顺序）
- 适合作为本项目规则引擎单测期望值的交叉参考；后续调整地图数值时也可用它做平衡性模拟

**缺点**
- Python、无 UI / 无网络层，不能作为游戏实现参考；最后更新 2025-05，活跃度低

**可借鉴点**
- 规则判定的严谨顺序；数值平衡验证思路

---

## 三、横向经验总结（对架构的启示）

1. **架构收敛**：所有正经实现（terragady、mine-monopoly 主机端、itaylayzer）都是「逻辑与渲染分离 + 权威状态 + 事件驱动 UI」，本项目直接采用该范式。
2. **数据驱动是共识**：棋盘与卡牌必须是数据（terragady 的 shared 包、itaylayzer 的 monopoly.json、HumanSean 的 data.js 皆如此），绝不能硬编码在逻辑里。
3. **交互时序是共性难点**：所有实现都要处理"动画播放期间禁止操作"，通用解法是**事件队列 + 状态锁**（本项目用服务端 phase 门控 + 客户端事件队列）。
4. **交易是分水岭**：完整实现都在交易/拍卖上投入大量代码；terragady 的"私有报价（限时应答）+ 开放市场（挂售买断）"是经过实践的设计，可直接采纳。
5. **持久化与重连是最常见短板**：terragady 内存态丢局、itaylayzer 依赖外部云服务——本项目将断线重连列为 P0，用 SQLite 快照补齐。
6. **端到端类型化收益明显**：terragady 用共享包定义 Socket.IO 事件契约，是本项目 monorepo 组织的直接模板。

## 四、boardgame.io 框架评估（备选方案）

**概况**：12.4k stars，MIT，npm v0.50.2（2026-07 仍有发布），面向回合制桌游的 JS/TS 引擎。

**能力清单**：状态管理（G + ctx）、moves/phases/turn 顺序、多人同步（local/socket 传输）、lobby 匹配、自动 AI 机器人、游戏日志与时间旅行、React 绑定。

**不选作首发方案的理由**
1. **交互模型摩擦**：Monopoly 的核心交互（任意时刻建房、拍卖出价、交易应答）不是"轮到谁谁动"的简单 move 模型，需借助 activePlayers/stages 等进阶特性绕过，复杂度已接近自研。
2. **调试成本**：引擎把状态广播/存储封装在内部，出问题排查路径长；本项目不需要 lobby / 时间旅行等重型能力。
3. **先例验证**：terragady 用"自研 reducer + Socket.IO 广播"已证明完全可行，且更贴合 1-2 核轻量部署。

**结论**：列为备选。若未来"数字据点"要承载多款桌游、需要统一引擎与匹配大厅，可回头评估。

## 五、综合结论与选型建议

1. **架构基线**：参考 terragady 的「服务端权威 + 房间制 + 共享事件契约」，自研纯函数规则引擎（reducer）+ Socket.IO 广播。
2. **必须自行补强**（超出参考项目之处）：SQLite 快照持久化、断线重连、空闲房间回收。
3. **明确规避**：P2P / WebRTC（复杂度高、收益低）、可视化地图编辑器（首期不做，内容 JSON 化即可）、重型依赖（MySQL / Redis / coturn）。
4. **表现层优先级**：先保证状态正确与可用，动画打磨放 P2（可参考 terragady 的动画清单：3D 骰子、逐格移动、卡牌翻转、模态提示）。
5. **规则引擎目标**：以 HumanSean 的极简模型起步，逐步补齐 terragady 的规则覆盖度；以 gamescomputersplay 的模拟器做边界验证。

## 六、参考链接

| 项目 | 链接 |
|------|------|
| terragady/monopoly-websockets | https://github.com/terragady/monopoly-websockets |
| FatPaper-1874/mine-monopoly | https://github.com/FatPaper-1874/mine-monopoly |
| itaylayzer/Monopoly | https://github.com/itaylayzer/Monopoly |
| HumanSean/javascript-monopoly | https://github.com/HumanSean/javascript-monopoly |
| gamescomputersplay/monopoly | https://github.com/gamescomputersplay/monopoly |
| boardgame.io | https://github.com/boardgameio/boardgame.io |
| boardgame.io 文档 | https://boardgame.io/documentation/ |
| 地产大亨规则（萌娘百科） | https://zh.moegirl.org.cn/zh-cn/地产大亨 |
| Hasbro 官方规则（PDF） | https://www.hasbro.com/common/instruct/Monopoly_Vintage.pdf |
