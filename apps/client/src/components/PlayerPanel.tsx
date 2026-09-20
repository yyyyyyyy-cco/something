import { BOARD_TILES } from "@monopoly/shared";
import { useStore } from "../store.js";
import { playerColorMap } from "../theme.js";
import { toSeconds, useRemainingMs } from "../use-countdown.js";

/** 玩家面板（M4：托管开关 + 限时倒计时提示） */
export default function PlayerPanel() {
  const room = useStore((s) => s.room);
  const game = useStore((s) => s.game);
  const session = useStore((s) => s.session);
  const setAutopilot = useStore((s) => s.setAutopilot);
  const timers = useStore((s) => s.timers);
  const receivedAt = useStore((s) => s.timersReceivedAt);

  const timeLeftMs = useRemainingMs(game && game.phase !== "ENDED" ? (timers?.timeLeft ?? null) : null, receivedAt);
  const timeLeftSec = toSeconds(timeLeftMs);

  if (!room || !game) return null;
  const colors = playerColorMap(room);
  const posName = (i: number): string => BOARD_TILES[i]?.name ?? `格 ${i}`;
  const me = room.members.find((m) => m.id === session?.memberId);
  const isHost = me?.isHost === true;

  const fmtTime = (sec: number | null): string => {
    if (sec === null) return "";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <section className="panel">
      <h3>
        玩家
        {timeLeftSec !== null && (
          <span className={`countdown${timeLeftSec <= 300 ? " urgent" : ""}`} title="限时模式剩余时间">
            ⏱ {fmtTime(timeLeftSec)}
          </span>
        )}
      </h3>
      <ul className="player-list">
        {game.players.map((p) => {
          const member = room.members.find((m) => m.id === p.id);
          const name = member?.name ?? p.name;
          const props = game.tiles.filter((t) => t.ownerId === p.id).length;
          const isCurrent = game.currentPlayerId === p.id && game.phase !== "ENDED";
          const auto = member?.autopilot === true;
          const canToggle = isHost || p.id === session?.memberId;
          return (
            <li
              key={p.id}
              className={`${isCurrent ? "current" : ""} ${p.bankrupt ? "bankrupt" : ""}`}
            >
              <span className="swatch" style={{ background: colors[p.id] }} />
              <span className="name">
                {name}
                {p.id === session?.memberId ? "（你）" : ""}
                {isCurrent ? " ▶" : ""}
                {auto && <span className="tag auto">托管</span>}
                {member && !member.connected && !auto && <span className="tag off">离线</span>}
              </span>
              <span className="money">${p.money}</span>
              <span className="meta muted small">
                {p.inJail ? "狱中 · " : ""}
                {props} 处地产 · {posName(p.position)}
                {p.getOutOfJailCards.length > 0 ? ` · 卡×${p.getOutOfJailCards.length}` : ""}
              </span>
              {!p.bankrupt && canToggle && (
                <button
                  className={`btn btn-xs ${auto ? "" : "btn-ghost"}`}
                  title={auto ? "关闭托管（恢复手动操作）" : "开启托管（自动掷骰·保守买地）"}
                  onClick={() => setAutopilot(p.id, !auto)}
                >
                  {auto ? "接管" : "托管"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {isHost && game.settings.timeLimitMinutes !== null && (
        <p className="muted small">限时模式：到点按总资产（现金 + 地产 + 建筑）决胜</p>
      )}
    </section>
  );
}
