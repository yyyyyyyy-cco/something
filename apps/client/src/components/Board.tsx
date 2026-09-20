import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BOARD_TILES } from "@monopoly/shared";
import type { BoardTile } from "@monopoly/shared";
import { useStore } from "../store.js";
import { GROUP_COLORS, playerColorAt } from "../theme.js";

/** 计算格子在 11×11 环形布局中的位置（0 = 右下角起点，逆时针排布底部→左侧→顶部→右侧） */
function gridArea(index: number): string {
  if (index <= 10) return `${11} / ${11 - index} / ${12} / ${12 - index}`; // 底行：右→左
  if (index <= 20) return `${11 - (index - 10)} / ${1} / ${12 - (index - 10)} / ${2}`; // 左列：下→上
  if (index <= 30) return `${1} / ${1 + (index - 20)} / ${2} / ${2 + (index - 20)}`; // 顶行：左→右
  return `${1 + (index - 30)} / ${11} / ${2 + (index - 30)} / ${12}`; // 右列：上→下
}

/**
 * 格子（M4 性能优化）：全部使用精确/浅比较选择器，
 * 动画期间仅 token 位置变化的格子重渲染（原先 40 格全量重渲染）。
 */
function Tile({ tile }: { tile: BoardTile }) {
  const tileState = useStore(
    useShallow((s) => {
      const ts = s.game?.tiles[tile.index];
      return {
        ownerId: ts?.ownerId ?? null,
        houses: ts?.houses ?? 0,
        hotel: ts?.hotel ?? false,
        mortgaged: ts?.mortgaged ?? false,
      };
    }),
  );
  const tokens = useStore(
    useShallow((s) => {
      if (!s.game) return [] as string[];
      const out: string[] = [];
      for (const p of s.game.players) {
        if ((s.animPositions[p.id] ?? p.position) === tile.index) {
          out.push(p.id === s.game.currentPlayerId ? `*${p.id}` : p.id); // * 前缀标记当前行动玩家
        }
      }
      return out;
    }),
  );
  const ownerColor = useStore((s) => playerColorAt(s.room, tileState.ownerId));
  const room = useStore((s) => s.room); // token 颜色随成员变化刷新
  const playing = useStore((s) => s.playing);
  const isActive = useStore((s) => s.activeTile === tile.index);
  const setActiveTile = useStore((s) => s.setActiveTile);

  const purchasable = tile.kind === "property" || tile.kind === "railroad" || tile.kind === "utility";
  const shortName = tile.name.length > 5 ? tile.name.slice(0, 5) : tile.name;

  return (
    <button
      className={`tile tile-${tile.kind} ${isActive ? "active" : ""}`}
      style={{ gridArea: gridArea(tile.index) }}
      onClick={() => setActiveTile(tile.index)}
      title={tile.name}
    >
      {tile.colorGroup !== undefined && (
        <span className="group-bar" style={{ background: GROUP_COLORS[tile.colorGroup] }} />
      )}
      <span className="tile-name">{shortName}</span>
      {purchasable && (
        <span className="tile-info">
          {tileState.ownerId ? (
            <>
              <span className="owner-dot" style={{ background: ownerColor }} />
              {tileState.hotel && <span className="bldg bldg-hotel" title="旅馆">H</span>}
              {!tileState.hotel && tileState.houses > 0 && (
                <span className="bldg" title={`${tileState.houses} 栋房屋`}>
                  {tileState.houses}
                </span>
              )}
              {tileState.mortgaged && (
                <span className="bldg bldg-mort" title="抵押中">
                  押
                </span>
              )}
            </>
          ) : (
            <span className="price">${tile.price}</span>
          )}
        </span>
      )}
      {tokens.length > 0 && (
        <span className="tokens">
          {tokens.map((t) => {
            const current = t.startsWith("*");
            const id = current ? t.slice(1) : t;
            return (
              <span
                key={id}
                className={`token ${current ? "token-current" : ""} ${playing ? "token-moving" : ""}`}
                style={{ background: playerColorAt(room, id) }}
              />
            );
          })}
        </span>
      )}
    </button>
  );
}

/** 棋盘中心区：默认显示骰子/回合信息；点击格子后显示地产详情 */
function BoardCenter() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const dice = useStore((s) => s.dice);
  const playing = useStore((s) => s.playing);
  const activeTile = useStore((s) => s.activeTile);
  const setActiveTile = useStore((s) => s.setActiveTile);

  if (activeTile !== null) {
    const tile = BOARD_TILES[activeTile]!;
    const ts = game?.tiles[activeTile];
    const owner = ts?.ownerId ? room?.members.find((m) => m.id === ts.ownerId) : undefined;
    return (
      <div className="center-card" onClick={() => setActiveTile(null)} title="点击关闭">
        <h3>{tile.name}</h3>
        <p className="muted small">{tile.nameEn}</p>
        {tile.price !== undefined && (
          <p>
            价格：<strong>${tile.price}</strong>
            {tile.mortgageValue !== undefined ? ` ｜ 抵押 $${tile.mortgageValue}` : ""}
          </p>
        )}
        {tile.rentTable && <p>基础租金：${tile.rentTable[0]}（集齐色组 ×2）</p>}
        {tile.kind === "railroad" && <p>租金：25 / 50 / 100 / 200（按持有数）</p>}
        {tile.kind === "utility" && <p>租金：点数 ×4（1 座）/ ×10（2 座）</p>}
        {tile.taxAmount !== undefined && <p>税金：${tile.taxAmount}</p>}
        <p className="owner-line">
          归属：
          {owner ? (
            <>
              <span className="swatch" style={{ background: playerColorAt(room, owner.id) }} />
              {owner.name}
            </>
          ) : tile.price !== undefined ? (
            "无主"
          ) : (
            "—"
          )}
        </p>
        {ts?.ownerId && (
          <p className="owner-line">
            状态：
            {ts.mortgaged
              ? `抵押中（赎回需 $${(tile.mortgageValue ?? 0) + Math.max(1, Math.ceil((tile.mortgageValue ?? 0) * 0.1))}）`
              : ts.hotel
                ? `旅馆（租金 $${tile.rentTable?.[5] ?? "—"}）`
                : ts.houses > 0
                  ? `${ts.houses} 栋房屋（租金 $${tile.rentTable?.[ts.houses] ?? "—"}）`
                  : `空地（租金 $${tile.rentTable ? tile.rentTable[0] : "—"}）`}
          </p>
        )}
        <p className="muted small">点击卡片关闭</p>
      </div>
    );
  }

  const current = game?.players.find((p) => p.id === game.currentPlayerId);
  const currentName = room?.members.find((m) => m.id === current?.id)?.name ?? "";
  const winnerName = room?.members.find((m) => m.id === game?.winnerId)?.name ?? "";

  return (
    <div className="center-default">
      <div className={`dice ${playing ? "dice-rolling" : ""}`}>
        {dice ? (
          <>
            <span>{dice[0]}</span>
            <span>{dice[1]}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      {game?.phase === "ENDED" ? (
        <p className="ended">对局结束 · {winnerName} 获胜！</p>
      ) : (
        <p className="muted">{currentName ? `轮到 ${currentName}` : ""}</p>
      )}
      <p className="muted small">点击格子查看详情</p>
    </div>
  );
}

/**
 * 棋盘容器（M4-6 彩蛋）：滚轮缩放 / Shift+滚轮旋转 / 控制按钮复位
 */
export default function Board() {
  const [view, setView] = useState({ scale: 1, rotation: 0 });

  const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
  const onWheel = (e: React.WheelEvent): void => {
    if (e.shiftKey) {
      setView((v) => ({ ...v, rotation: v.rotation + (e.deltaY > 0 ? 15 : -15) }));
    } else {
      setView((v) => ({ ...v, scale: clamp(v.scale * (e.deltaY > 0 ? 0.94 : 1.06), 0.6, 1.6) }));
    }
  };

  return (
    <div className="board-viewport" onWheel={onWheel}>
      <div
        className="board"
        style={{ transform: `scale(${view.scale}) rotate(${view.rotation}deg)` }}
      >
        {BOARD_TILES.map((t) => (
          <Tile key={t.index} tile={t} />
        ))}
        <div className="board-center">
          <BoardCenter />
        </div>
      </div>
      <div className="board-controls" title="滚轮缩放 / Shift+滚轮旋转">
        <button className="btn btn-xs" onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 1.1, 0.6, 1.6) }))}>
          ＋
        </button>
        <button className="btn btn-xs" onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 0.9, 0.6, 1.6) }))}>
          －
        </button>
        <button className="btn btn-xs" onClick={() => setView((v) => ({ ...v, rotation: v.rotation + 90 }))}>
          旋转 90°
        </button>
        <button className="btn btn-xs" onClick={() => setView({ scale: 1, rotation: 0 })}>
          复位
        </button>
      </div>
    </div>
  );
}
