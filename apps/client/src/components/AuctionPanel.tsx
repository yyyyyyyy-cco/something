/**
 * 拍卖面板（M3-1）：公开递增出价、轮转提示、30 秒倒计时、放弃与出价操作
 */
import { useState } from "react";
import { BOARD_TILES } from "@monopoly/shared";
import { useStore } from "../store.js";
import { toSeconds, useRemainingMs } from "../use-countdown.js";

export default function AuctionPanel() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const act = useStore((s) => s.act);
  const timers = useStore((s) => s.timers);
  const receivedAt = useStore((s) => s.timersReceivedAt);
  const [bidInput, setBidInput] = useState("");

  const remain = useRemainingMs(game?.auction ? (timers?.auction ?? null) : null, receivedAt);
  const seconds = toSeconds(remain);

  if (!game || !room || !session || !game.auction) return null;

  const auction = game.auction;
  const tile = BOARD_TILES[auction.tileIndex]!;
  const waitingId = auction.queue[0] ?? null;
  const name = (id: string | null): string =>
    id === null ? "—" : (room.members.find((m) => m.id === id)?.name ?? id);
  const isMyTurn = waitingId === session.memberId;
  const me = game.players.find((p) => p.id === session.memberId);
  const meMember = room.members.find((m) => m.id === session.memberId);
  const isSpectator = meMember?.kind === "spectator";
  const locked = playing || isSpectator;
  const minBid = (auction.highBid ?? 0) + 1;
  const canAfford = (me?.money ?? 0) >= minBid;

  const bid = (): void => {
    const amount = Number(bidInput);
    if (!Number.isInteger(amount) || amount < minBid) return;
    act({ type: "BID", amount });
    setBidInput("");
  };

  return (
    <section className="panel auction-panel">
      <h3>
        🔨 拍卖中
        {seconds !== null && <span className={`countdown${seconds <= 5 ? " urgent" : ""}`}>{seconds}s</span>}
      </h3>
      <p className="auction-tile">
        <strong>{tile.name}</strong>
        <span className="muted small">（挂牌 ${tile.price}）</span>
      </p>
      <p className="auction-high">
        最高价：
        {auction.highBid === null ? (
          <span className="muted">暂无出价</span>
        ) : (
          <strong>
            ${auction.highBid} · {name(auction.highBidderId)}
          </strong>
        )}
      </p>
      <p className="hint">
        等待 <strong>{name(waitingId)}</strong> 出价
        {auction.queue.length > 1 && `（余 ${auction.queue.length - 1} 人）`}
        {auction.cause === "bankruptcy" && " · 破产清算拍卖"}
      </p>

      {isMyTurn && !isSpectator ? (
        <div className="btn-row">
          <input
            className="bid-input"
            type="number"
            placeholder={`≥ $${minBid}`}
            min={minBid}
            max={me?.money ?? 0}
            value={bidInput}
            disabled={locked}
            onChange={(e) => setBidInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") bid();
            }}
          />
          <button
            className="btn btn-primary"
            disabled={locked || !canAfford || !bidInput}
            title={canAfford ? undefined : "现金不足以达到最低出价"}
            onClick={bid}
          >
            出价
          </button>
          <button className="btn" disabled={locked} onClick={() => act({ type: "PASS_BID" })}>
            放弃
          </button>
        </div>
      ) : (
        <p className="hint">{isSpectator ? "旁观模式" : locked ? "动画播放中…" : "等待他人出价"}</p>
      )}
      {isMyTurn && !canAfford && <p className="hint">现金不足以达到最低出价，请选择放弃</p>}
    </section>
  );
}
