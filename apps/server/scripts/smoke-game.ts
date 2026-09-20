/**
 * 在线冒烟驱动：对"正在运行"的服务端执行一场多人自动对局
 * 用途：M2 联调 / M0-5 部署后验证 / 内存指标观测
 * 用法：pnpm -F @monopoly/server exec tsx scripts/smoke-game.ts [baseUrl] [players] [maxSteps]
 */
import { io as ioc } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";
import { canBuildHouse, canSellHouse, mortgageValueOf } from "@monopoly/engine";
import { BOARD_TILES, JAIL_BAIL } from "@monopoly/shared";
import type {
  Action,
  ClientToServerEvents,
  GameState,
  JoinAck,
  OkAck,
  RoomStatePayload,
  ServerToClientEvents,
} from "@monopoly/shared";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:3000";
const playerCount = Number(process.argv[3] ?? 3);
const maxSteps = Number(process.argv[4] ?? 40);

type S = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function connect(): Promise<S> {
  return new Promise((resolve, reject) => {
    const socket: S = ioc(baseUrl, { transports: ["websocket"], forceNew: true });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function join(socket: S, roomCode: string, name: string): Promise<JoinAck> {
  return new Promise((resolve) => socket.emit("room:join", { roomCode, name }, resolve));
}

function start(socket: S): Promise<OkAck> {
  return new Promise((resolve) => socket.emit("room:start", resolve));
}

function act(socket: S, action: Action, actionId: string): Promise<OkAck> {
  return new Promise((resolve) => socket.emit("game:action", { action, actionId }, resolve));
}

function waitFor<T>(socket: S, event: keyof ServerToClientEvents, predicate?: (p: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const handler = (payload: T): void => {
      if (!predicate || predicate(payload)) {
        (socket as unknown as { off: (e: string, h: unknown) => void }).off(event, handler);
        resolve(payload);
      }
    };
    (socket as unknown as { on: (e: string, h: unknown) => void }).on(event, handler);
  });
}

async function main(): Promise<void> {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  const { roomCode } = (await res.json()) as { roomCode: string };
  console.log(`[smoke] 房间 ${roomCode}（${playerCount} 人，最多 ${maxSteps} 步）`);

  const clients: S[] = [];
  const sockets = new Map<string, S>();
  try {
    for (let i = 0; i < playerCount; i++) {
      const c = await connect();
      clients.push(c);
      const ack = await join(c, roomCode, `冒烟${i + 1}`);
      if (!ack.ok) throw new Error(`加入失败: ${ack.error.code}`);
      sockets.set(ack.you.memberId, c);
    }

    const started = waitFor<RoomStatePayload>(clients[0]!, "room:state", (p) => p.game !== null);
    const startAck = await start(clients[0]!);
    if (!startAck.ok) throw new Error(`开局失败: ${startAck.error.code}`);
    let latest = (await started).game!;
    console.log(`[smoke] 对局开始，玩家 ${latest.players.length} 人`);

    let steps = 0;
    while (steps < maxSteps && latest.phase !== "ENDED") {
      const pid = latest.currentPlayerId;
      const p = latest.players.find((x) => x.id === pid)!;
      let actorId = pid;
      let action: Action;
      if (latest.phase === "AWAITING_ACTION") {
        const price = BOARD_TILES[latest.pendingPurchase!.tileIndex]!.price ?? 0;
        action =
          p.money >= price
            ? { type: "BUY_PROPERTY", playerId: pid }
            : { type: "DECLINE_PURCHASE", playerId: pid };
      } else if (latest.phase === "AUCTION") {
        // 拍卖：队首玩家直接出到自身上限（≤ 现金且 ≤ 挂牌价 80%），否则放弃
        const waiting = latest.auction!.queue[0]!;
        actorId = waiting;
        const wp = latest.players.find((x) => x.id === waiting)!;
        const price = BOARD_TILES[latest.auction!.tileIndex]!.price ?? 0;
        const cap = Math.min(wp.money, Math.floor(price * 0.8));
        const minBid = (latest.auction!.highBid ?? 0) + 1;
        action =
          minBid <= cap
            ? { type: "BID", playerId: waiting, amount: cap }
            : { type: "PASS_BID", playerId: waiting };
      } else if (latest.phase === "CASH_WINDOW") {
        // 套现窗口：先卖房（平均原则由引擎校验），再抵押担保值最高者
        const debt = latest.pendingDebt!;
        actorId = debt.payerId;
        const payer = latest.players.find((x) => x.id === debt.payerId)!;
        const sellable = latest.tiles.find(
          (t) => t.ownerId === payer.id && (t.houses > 0 || t.hotel) && canSellHouse(latest, payer.id, t.index) === null,
        );
        if (sellable) {
          action = { type: "SELL_HOUSE", playerId: payer.id, tile: sellable.index };
        } else {
          const mortgagable = latest.tiles
            .filter((t) => t.ownerId === payer.id && !t.mortgaged && t.houses === 0 && !t.hotel)
            .sort((a, b) => mortgageValueOf(BOARD_TILES[b.index]!) - mortgageValueOf(BOARD_TILES[a.index]!))[0];
          action = mortgagable
            ? { type: "MORTGAGE", playerId: payer.id, tile: mortgagable.index }
            : { type: "CASH_TIMEOUT", playerId: payer.id };
        }
      } else if (p.inJail && p.getOutOfJailCards.length > 0) {
        action = { type: "USE_JAIL_CARD", playerId: pid };
      } else if (p.inJail && p.money >= JAIL_BAIL) {
        action = { type: "PAY_BAIL", playerId: pid };
      } else {
        // 掷骰前：现金充裕时建房（提升租金压力，与 CLI/仿真策略一致）
        const buildable = latest.tiles
          .filter((t) => t.ownerId === pid && BOARD_TILES[t.index]!.kind === "property")
          .filter((t) => canBuildHouse(latest, pid, t.index) === null)
          .sort((a, b) => (BOARD_TILES[a.index]!.houseCost ?? 0) - (BOARD_TILES[b.index]!.houseCost ?? 0))[0];
        const buildCost = buildable ? (BOARD_TILES[buildable.index]!.houseCost ?? 0) : 0;
        action =
          buildable && p.money >= buildCost + 200
            ? { type: "BUILD_HOUSE", playerId: pid, tile: buildable.index }
            : { type: "ROLL_DICE", playerId: pid };
      }

      const socket = sockets.get(actorId);
      if (!socket) throw new Error(`未知操作者: ${actorId}`);
      const update = waitFor<{ version: number; state: GameState }>(clients[0]!, "game:update");
      const ack = await act(socket, action, `smoke-${steps}`);
      if (!ack.ok) throw new Error(`动作失败: ${ack.error.code}`);
      latest = (await update).state;
      steps++;
      if (steps % 10 === 0) {
        console.log(
          `[smoke] ${steps} 步 ｜ version=${latest.version} ｜ 现金 ${latest.players.map((x) => x.money).join("/")}`,
        );
      }
    }

    const money = latest.players.map((x) => x.money).join("/");
    console.log(
      `SMOKE_OK ${JSON.stringify({ roomCode, steps, version: latest.version, phase: latest.phase, money })}`,
    );
  } finally {
    for (const c of clients) c.close();
  }
}

main().catch((err: unknown) => {
  console.error("SMOKE_FAIL", err);
  process.exit(1);
});
