/**
 * 我的资产面板（M3-2 / M3-3 / M3-5）
 * - 掷骰前（AWAITING_ROLL，仅当前玩家）与套现窗口（CASH_WINDOW，仅欠款人）可操作
 * - 操作：建房（含旅馆升级）/ 卖房 / 抵押 / 赎回 / 挂售（价格内联输入）
 * - 可用性判定与引擎一致（canBuildHouse / canSellHouse / 抵押与利息计算）
 */
import { useState } from "react";
import { BOARD_TILES } from "@monopoly/shared";
import { canBuildHouse, canSellHouse, mortgageInterestOf, mortgageValueOf } from "@monopoly/engine";
import { useStore } from "../store.js";

export default function PortfolioPanel() {
  const game = useStore((s) => s.game);
  const session = useStore((s) => s.session);
  const playing = useStore((s) => s.playing);
  const act = useStore((s) => s.act);
  const [open, setOpen] = useState(false);
  const [listTile, setListTile] = useState<number | null>(null);
  const [listPrice, setListPrice] = useState("");

  if (!game || !session) return null;
  const me = game.players.find((p) => p.id === session.memberId);
  if (!me || me.bankrupt) return null;

  const myTiles = game.tiles.filter((t) => t.ownerId === session.memberId);
  const isMyTurn = game.currentPlayerId === session.memberId;
  const isDebtor = game.phase === "CASH_WINDOW" && game.pendingDebt?.payerId === session.memberId;
  const canOperate = !playing && (isDebtor || (isMyTurn && game.phase === "AWAITING_ROLL"));

  const levelOf = (hotel: boolean, houses: number): string =>
    hotel ? "旅馆" : houses > 0 ? `${houses} 房` : "空地";

  const submitListing = (tile: number): void => {
    const price = Number(listPrice);
    if (!Number.isInteger(price) || price < 1) return;
    act({ type: "LIST_PROPERTY", tile, price });
    setListTile(null);
    setListPrice("");
  };

  return (
    <section className="panel portfolio-panel">
      <h3 className="collapsible" onClick={() => setOpen((v) => !v)}>
        我的资产（{myTiles.length}）<span className="muted small">{open ? "收起" : "展开"}</span>
      </h3>

      {open && (
        <>
          {isDebtor && (
            <p className="hint debt-hint">
              套现窗口：优先卖房 → 抵押 → 协商交易；凑足后自动支付
            </p>
          )}
          {myTiles.length === 0 && <p className="muted small">还没有地产</p>}
          <ul className="portfolio-list">
            {myTiles.map((ts) => {
              const tile = BOARD_TILES[ts.index]!;
              const listed = game.listings.find((l) => l.tile === ts.index);
              const mortgageValue = mortgageValueOf(tile);
              const redeemCost = mortgageValue + mortgageInterestOf(tile);
              const buildError = canBuildHouse(game, session.memberId, ts.index);
              const buildOk = buildError === null && !ts.mortgaged && !listed;
              const sellOk = canSellHouse(game, session.memberId, ts.index) === null;
              // 套现模式（非正常回合窗口）仅允许变现类：卖房 / 抵押
              const allowBuild = canOperate && !isDebtor;
              const allowMortgage = canOperate && !listed && !ts.mortgaged && ts.houses === 0 && !ts.hotel;
              const allowUnmortgage =
                canOperate &&
                !isDebtor &&
                ts.mortgaged &&
                me.money >= redeemCost;
              const allowList = canOperate && !isDebtor && !listed && ts.houses === 0 && !ts.hotel;

              return (
                <li key={ts.index} className={ts.mortgaged ? "mortgaged" : undefined}>
                  <div className="pt-head">
                    <span className="pt-name">{tile.name}</span>
                    <span className="pt-badge muted small">
                      {levelOf(ts.hotel, ts.houses)}
                      {ts.mortgaged && " · 抵押中"}
                      {listed && ` · 挂售 $${listed.price}`}
                    </span>
                  </div>
                  <div className="btn-row small">
                    {allowBuild && (
                      <button
                        className="btn btn-xs"
                        disabled={!buildOk}
                        title={buildError?.message}
                        onClick={() => act({ type: "BUILD_HOUSE", tile: ts.index })}
                      >
                        {ts.houses === 4 ? `升级旅馆 $${tile.houseCost ?? 0}` : `建房 $${tile.houseCost ?? 0}`}
                      </button>
                    )}
                    {canOperate && (
                      <button
                        className="btn btn-xs"
                        disabled={!sellOk}
                        title={sellOk ? undefined : "仅可卖出组内房屋最多的地产"}
                        onClick={() => act({ type: "SELL_HOUSE", tile: ts.index })}
                      >
                        卖房{isDebtor ? "（套现）" : ""}
                      </button>
                    )}
                    {allowMortgage && (
                      <button className="btn btn-xs" onClick={() => act({ type: "MORTGAGE", tile: ts.index })}>
                        抵押 +${mortgageValue}
                      </button>
                    )}
                    {allowUnmortgage && (
                      <button className="btn btn-xs" onClick={() => act({ type: "UNMORTGAGE", tile: ts.index })}>
                        赎回 -${redeemCost}
                      </button>
                    )}
                    {allowList && (
                      <button className="btn btn-xs" onClick={() => setListTile(listTile === ts.index ? null : ts.index)}>
                        挂售
                      </button>
                    )}
                    {listed && canOperate && (
                      <button className="btn btn-xs" onClick={() => act({ type: "CANCEL_LISTING", listingId: listed.id })}>
                        撤回挂售
                      </button>
                    )}
                  </div>
                  {listTile === ts.index && (
                    <div className="btn-row small">
                      <input
                        className="bid-input"
                        type="number"
                        min={1}
                        placeholder="售价 $"
                        value={listPrice}
                        onChange={(e) => setListPrice(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitListing(ts.index);
                        }}
                      />
                      <button className="btn btn-xs btn-primary" disabled={!listPrice} onClick={() => submitListing(ts.index)}>
                        确认挂售
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {!canOperate && <p className="hint">仅可在自己回合掷骰前，或套现窗口中操作资产</p>}
        </>
      )}
    </section>
  );
}
