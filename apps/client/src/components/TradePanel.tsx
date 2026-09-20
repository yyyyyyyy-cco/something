/**
 * 交易与市场面板（M3-4）
 * - 私有报价：收到的报价（接受 / 拒绝）、发出的报价（撤回）
 * - 发起报价：选择对象，勾选双方可交易地产（无建筑），现金与出狱卡数量
 * - 开放市场：挂售列表（买断 / 撤回）；挂售入口在「我的资产」面板
 * - 报价 60 秒限时（服务端超时视为拒绝；面板显示剩余秒数）
 */
import { useState } from "react";
import { BOARD_TILES } from "@monopoly/shared";
import type { TradeBundle, TradeOffer } from "@monopoly/shared";
import { useStore } from "../store.js";
import { toSeconds, useRemainingMs } from "../use-countdown.js";

const EMPTY: TradeBundle = { money: 0, tiles: [], jailCards: 0 };

function bundleText(b: TradeBundle): string {
  const parts: string[] = [];
  if (b.money > 0) parts.push(`$${b.money}`);
  for (const t of b.tiles) parts.push(BOARD_TILES[t]?.name ?? `格 ${t}`);
  if (b.jailCards > 0) parts.push(`${b.jailCards} 张出狱卡`);
  return parts.length > 0 ? parts.join(" + ") : "无";
}

function OfferRow({ offer, actions }: { offer: TradeOffer; actions: React.ReactNode }) {
  return (
    <li>
      <div className="pt-head">
        <span className="pt-name">给：{bundleText(offer.give)}</span>
      </div>
      <div className="pt-head">
        <span className="pt-name">索：{bundleText(offer.want)}</span>
      </div>
      <div className="btn-row small">{actions}</div>
    </li>
  );
}

/** 报价倒计时（子组件内使用 hook，避免在列表循环中调用 hook） */
function OfferCountdown({ offerId }: { offerId: string }) {
  const timers = useStore((s) => s.timers);
  const receivedAt = useStore((s) => s.timersReceivedAt);
  const sec = toSeconds(useRemainingMs(timers?.trades?.[offerId] ?? null, receivedAt));
  return sec !== null ? <span className="muted small"> · {sec}s</span> : null;
}

export default function TradePanel() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const act = useStore((s) => s.act);

  const [open, setOpen] = useState(false);
  const [toId, setToId] = useState("");
  const [giveMoney, setGiveMoney] = useState("");
  const [wantMoney, setWantMoney] = useState("");
  const [giveTiles, setGiveTiles] = useState<number[]>([]);
  const [wantTiles, setWantTiles] = useState<number[]>([]);
  const [giveCards, setGiveCards] = useState("");
  const [wantCards, setWantCards] = useState("");

  if (!game || !room || !session) return null;
  const me = game.players.find((p) => p.id === session.memberId);
  if (!me) return null;

  const name = (id: string): string => room.members.find((m) => m.id === id)?.name ?? id;
  const others = game.players.filter((p) => p.id !== session.memberId && !p.bankrupt);
  const tradable = (ownerId: string): number[] =>
    game.tiles
      .filter((t) => t.ownerId === ownerId && t.houses === 0 && !t.hotel)
      .map((t) => t.index);

  const isOpenWindow = game.phase === "AWAITING_ROLL" || game.phase === "CASH_WINDOW";
  const meMember = room.members.find((m) => m.id === session.memberId);
  const isSpectator = meMember?.kind === "spectator";
  const canPropose = !playing && !isSpectator && isOpenWindow && !me.bankrupt && others.length > 0;
  const offeredTarget = toId || others[0]?.id || "";

  const inbox = game.trades.filter((o) => o.toId === session.memberId);
  const outbox = game.trades.filter((o) => o.fromId === session.memberId);
  const market = game.listings;

  const toggleTile = (list: number[], set: (v: number[]) => void, tile: number): void => {
    set(list.includes(tile) ? list.filter((t) => t !== tile) : [...list, tile]);
  };

  const propose = (): void => {
    if (!offeredTarget) return;
    const give: TradeBundle = {
      money: Number(giveMoney) || 0,
      tiles: giveTiles,
      jailCards: Number(giveCards) || 0,
    };
    const want: TradeBundle = {
      money: Number(wantMoney) || 0,
      tiles: wantTiles,
      jailCards: Number(wantCards) || 0,
    };
    act({ type: "PROPOSE_TRADE", toId: offeredTarget, give, want });
    setGiveMoney("");
    setWantMoney("");
    setGiveTiles([]);
    setWantTiles([]);
    setGiveCards("");
    setWantCards("");
  };

  const offerCount = inbox.length + outbox.length + market.length;

  return (
    <section className="panel trade-panel">
      <h3 className="collapsible" onClick={() => setOpen((v) => !v)}>
        交易与市场{offerCount > 0 ? `（${offerCount}）` : ""}
        <span className="muted small">{open ? "收起" : "展开"}</span>
      </h3>

      {open && (
        <>
          {inbox.length > 0 && (
            <>
              <p className="section-label">收到的报价</p>
              <ul className="portfolio-list">
                {inbox.map((o) => (
                  <OfferRow
                    key={o.id}
                    offer={o}
                    actions={
                      <>
                        <span className="muted small">来自 {name(o.fromId)}</span>
                        <OfferCountdown offerId={o.id} />
                        <button
                          className="btn btn-xs btn-primary"
                          disabled={playing}
                          onClick={() => act({ type: "ACCEPT_TRADE", offerId: o.id })}
                        >
                          接受
                        </button>
                        <button className="btn btn-xs" disabled={playing} onClick={() => act({ type: "REJECT_TRADE", offerId: o.id })}>
                          拒绝
                        </button>
                      </>
                    }
                  />
                ))}
              </ul>
            </>
          )}

          {outbox.length > 0 && (
            <>
              <p className="section-label">我发出的报价</p>
              <ul className="portfolio-list">
                {outbox.map((o) => (
                  <OfferRow
                    key={o.id}
                    offer={o}
                    actions={
                      <>
                        <span className="muted small">等待 {name(o.toId)} 应答</span>
                        <OfferCountdown offerId={o.id} />
                        <button className="btn btn-xs" disabled={playing} onClick={() => act({ type: "CANCEL_TRADE", offerId: o.id })}>
                          撤回
                        </button>
                      </>
                    }
                  />
                ))}
              </ul>
            </>
          )}

          {market.length > 0 && (
            <>
              <p className="section-label">市场挂售</p>
              <ul className="portfolio-list">
                {market.map((l) => {
                  const tile = BOARD_TILES[l.tile]!;
                  const mine = l.sellerId === session.memberId;
                  return (
                    <li key={l.id}>
                      <div className="pt-head">
                        <span className="pt-name">
                          {tile.name} <span className="muted small">${l.price}</span>
                        </span>
                        <span className="pt-badge muted small">
                          卖方 {name(l.sellerId)}
                          {game.tiles[l.tile]!.mortgaged ? " · 抵押中" : ""}
                        </span>
                      </div>
                      <div className="btn-row small">
                        {mine ? (
                          <button className="btn btn-xs" disabled={playing} onClick={() => act({ type: "CANCEL_LISTING", listingId: l.id })}>
                            撤回
                          </button>
                        ) : (
                          <button
                            className="btn btn-xs btn-primary"
                            disabled={playing || me.money < l.price}
                            title={me.money < l.price ? "现金不足" : undefined}
                            onClick={() => act({ type: "BUY_LISTING", listingId: l.id })}
                          >
                            买断 ${l.price}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {inbox.length + outbox.length + market.length === 0 && <p className="muted small">暂无交易与挂售</p>}

          <p className="section-label">发起报价</p>
          {!canPropose && (
            <p className="hint">
              {isSpectator ? "旁观模式" : me.bankrupt ? "你已破产" : isOpenWindow ? "动画播放中…" : "当前阶段不可发起交易"}
            </p>
          )}
          {canPropose && (
            <div className="trade-form">
              <div className="btn-row small">
                <span className="muted small">对象</span>
                <select value={offeredTarget} onChange={(e) => setToId(e.target.value)}>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {name(o.id)}（${o.money}）
                    </option>
                  ))}
                </select>
              </div>

              <div className="trade-side">
                <span className="muted small">我给出</span>
                <input className="bid-input" type="number" min={0} placeholder="现金 $" value={giveMoney} onChange={(e) => setGiveMoney(e.target.value)} />
                <input className="bid-input" type="number" min={0} placeholder="出狱卡" value={giveCards} onChange={(e) => setGiveCards(e.target.value)} />
              </div>
              <div className="tile-picker">
                {tradable(session.memberId).map((t) => (
                  <label key={t} className="check">
                    <input type="checkbox" checked={giveTiles.includes(t)} onChange={() => toggleTile(giveTiles, setGiveTiles, t)} />
                    {BOARD_TILES[t]!.name}
                  </label>
                ))}
                {tradable(session.memberId).length === 0 && <span className="muted small">（无可交易地产）</span>}
              </div>

              <div className="trade-side">
                <span className="muted small">我索取</span>
                <input className="bid-input" type="number" min={0} placeholder="现金 $" value={wantMoney} onChange={(e) => setWantMoney(e.target.value)} />
                <input className="bid-input" type="number" min={0} placeholder="出狱卡" value={wantCards} onChange={(e) => setWantCards(e.target.value)} />
              </div>
              <div className="tile-picker">
                {offeredTarget &&
                  tradable(offeredTarget).map((t) => (
                    <label key={t} className="check">
                      <input type="checkbox" checked={wantTiles.includes(t)} onChange={() => toggleTile(wantTiles, setWantTiles, t)} />
                      {BOARD_TILES[t]!.name}
                    </label>
                  ))}
                {offeredTarget && tradable(offeredTarget).length === 0 && <span className="muted small">（对方无可交易地产）</span>}
              </div>

              <div className="btn-row small">
                <button
                  className="btn btn-xs btn-primary"
                  disabled={playing}
                  title="送出清单为空或索取清单为空也可发起（对方自行判断）"
                  onClick={propose}
                >
                  发起报价（60 秒限时）
                </button>
                <span className="muted small">
                  给：{bundleText({ money: Number(giveMoney) || 0, tiles: giveTiles, jailCards: Number(giveCards) || 0 })} ｜ 索：
                  {bundleText({ money: Number(wantMoney) || 0, tiles: wantTiles, jailCards: Number(wantCards) || 0 })}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
