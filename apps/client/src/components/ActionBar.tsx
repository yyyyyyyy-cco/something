import { BOARD_TILES, JAIL_BAIL } from "@monopoly/shared";
import { useStore } from "../store.js";
import { MONEY_LABEL } from "../event-text.js";
import { toSeconds, useRemainingMs } from "../use-countdown.js";

/** 操作栏：按阶段渲染可用动作；禁用时给出原因提示（M2-6 验收点；M3 扩展套现窗口） */
export default function ActionBar() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const act = useStore((s) => s.act);
  const timers = useStore((s) => s.timers);
  const receivedAt = useStore((s) => s.timersReceivedAt);

  const cashRemain = useRemainingMs(game?.phase === "CASH_WINDOW" ? (timers?.cash ?? null) : null, receivedAt);
  const cashSeconds = toSeconds(cashRemain);

  if (!game || !room || !session) return null;

  const me = game.players.find((p) => p.id === session.memberId);
  const meMember = room.members.find((m) => m.id === session.memberId);
  const isSpectator = meMember?.kind === "spectator";
  const isMyTurn = game.currentPlayerId === session.memberId;
  const current = game.players.find((p) => p.id === game.currentPlayerId);
  const currentName = room.members.find((m) => m.id === current?.id)?.name ?? current?.name ?? "";
  const nameOf = (id: string): string => room.members.find((m) => m.id === id)?.name ?? id;

  if (game.phase === "ENDED") {
    const winner = room.members.find((m) => m.id === game.winnerId)?.name ?? "";
    return (
      <section className="panel action-bar">
        <p className="ended">对局结束 · {winner} 获胜！</p>
      </section>
    );
  }

  // 拍卖期间由拍卖面板接管操作
  if (game.phase === "AUCTION") return null;

  // 套现窗口：欠款人变现自救 / 其他玩家可协商交易
  if (game.phase === "CASH_WINDOW" && game.pendingDebt) {
    const debt = game.pendingDebt;
    const isDebtor = debt.payerId === session.memberId;
    return (
      <section className="panel action-bar debt-bar">
        <p>
          ⏳ {isDebtor ? "你需要支付" : `${nameOf(debt.payerId)} 需要支付`}{" "}
          <strong>${debt.amount}</strong>
          <span className="muted small">
            （{MONEY_LABEL[debt.reason] ?? debt.reason} → {nameOf(debt.creditor)}）
          </span>
          {cashSeconds !== null && <span className={`countdown${cashSeconds <= 10 ? " urgent" : ""}`}>{cashSeconds}s</span>}
        </p>
        {isDebtor ? (
          <>
            <p className="hint">在下方「我的资产」中卖房 / 抵押凑足，或在「交易与市场」中协商；凑足后自动支付。</p>
            <div className="btn-row">
              <button className="btn btn-danger" disabled={playing} onClick={() => act({ type: "DECLARE_BANKRUPTCY" })}>
                放弃并宣告破产
              </button>
            </div>
          </>
        ) : (
          <p className="hint">等待 {nameOf(debt.payerId)} 处理…（可在「交易与市场」中提议相助）</p>
        )}
      </section>
    );
  }

  const locked = !isMyTurn || playing || isSpectator || !me || me.bankrupt;
  const reason = playing
    ? "动画播放中…"
    : !isMyTurn
      ? `等待 ${currentName} 行动`
      : isSpectator
        ? "旁观模式"
        : me?.bankrupt
          ? "你已破产"
          : "";

  if (game.phase === "AWAITING_ACTION" && game.pendingPurchase) {
    const tile = BOARD_TILES[game.pendingPurchase.tileIndex]!;
    const price = tile.price ?? 0;
    const cannotAfford = (me?.money ?? 0) < price;
    const hint = isMyTurn && !playing ? (cannotAfford ? "现金不足，无法购买" : "") : reason;
    return (
      <section className="panel action-bar">
        <p>
          落格：<strong>{tile.name}</strong>（${price}）
        </p>
        <div className="btn-row">
          <button
            className="btn btn-primary"
            disabled={locked || cannotAfford}
            title={cannotAfford ? "现金不足" : undefined}
            onClick={() => act({ type: "BUY_PROPERTY" })}
          >
            购买 ${price}
          </button>
          <button className="btn" disabled={locked} onClick={() => act({ type: "DECLINE_PURCHASE" })}>
            {game.settings.auctionEnabled ? "放弃（进入拍卖）" : "放弃（流拍）"}
          </button>
        </div>
        {hint && <p className="hint">{hint}</p>}
      </section>
    );
  }

  const jailCardCount = me?.getOutOfJailCards.length ?? 0;
  const bailShort = (me?.money ?? 0) < JAIL_BAIL;
  return (
    <section className="panel action-bar">
      <div className="btn-row">
        <button className="btn btn-primary" disabled={locked} onClick={() => act({ type: "ROLL_DICE" })}>
          掷骰子
        </button>
        {me?.inJail && (
          <>
            <button
              className="btn"
              disabled={locked || bailShort}
              title={bailShort ? "现金不足" : undefined}
              onClick={() => act({ type: "PAY_BAIL" })}
            >
              保释 ${JAIL_BAIL}
            </button>
            <button
              className="btn"
              disabled={locked || jailCardCount === 0}
              title={jailCardCount === 0 ? "没有出狱许可证" : undefined}
              onClick={() => act({ type: "USE_JAIL_CARD" })}
            >
              用卡（{jailCardCount}）
            </button>
          </>
        )}
      </div>
      {reason && <p className="hint">{reason}</p>}
      {isMyTurn && !playing && !isSpectator && <p className="hint">掷骰前可在下方「我的资产」中建房 / 卖房 / 抵押 / 赎回</p>}
    </section>
  );
}
