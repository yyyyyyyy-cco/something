import { useState } from "react";
import { useStore } from "../store.js";
import { isMuted, toggleMuted } from "../sound.js";
import GameView from "./GameView.js";
import LobbyView from "./LobbyView.js";

export default function RoomView() {
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);
  const session = useStore((s) => s.session);
  const leave = useStore((s) => s.leave);
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(() => isMuted());

  if (!room) return <div className="loading">正在进入房间…</div>;

  const playerCount = room.members.filter((m) => m.kind === "player").length;
  const spectatorCount = room.members.filter((m) => m.kind === "spectator").length;
  const me = room.members.find((m) => m.id === session?.memberId);
  const isSpectator = me?.kind === "spectator";

  const copyCode = (): void => {
    void navigator.clipboard?.writeText(room.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <span className="muted">房间</span>
          <button className="code" onClick={copyCode} title="点击复制房间码">
            {room.code}
          </button>
          {copied && <span className="tag ok">已复制</span>}
          <span className={`dot ${connected ? "dot-ok" : "dot-bad"}`} title={connected ? "已连接" : "连接中断"} />
        </div>
        <div className="room-side">
          <span className="muted small">
            {playerCount} 玩家{spectatorCount > 0 ? ` · ${spectatorCount} 旁观` : ""}
          </span>
          <button
            className="btn btn-ghost btn-small"
            title={muted ? "开启音效" : "关闭音效"}
            onClick={() => setMuted(toggleMuted())}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button className="btn btn-ghost btn-small" onClick={leave}>
            离开
          </button>
        </div>
      </header>
      {isSpectator && room.phase !== "lobby" && (
        <div className="spectator-banner" role="status">
          👀 观战中：你可以查看牌局、拍卖与聊天，但不能操作游戏
        </div>
      )}
      {room.phase === "lobby" ? <LobbyView /> : <GameView />}
    </div>
  );
}
