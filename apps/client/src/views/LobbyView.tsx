import { SETTINGS_LIMITS } from "@monopoly/shared";
import { useStore } from "../store.js";
import { playerColorMap } from "../theme.js";

/** 房规面板（M4-3）：房主可编辑，全员实时预览（room:members 广播同步） */
function SettingsPanel({ isHost }: { isHost: boolean }) {
  const room = useStore((s) => s.room);
  const updateSettings = useStore((s) => s.updateSettings);
  if (!room) return null;
  const s = room.settings;

  const toggle = (key: "auctionEnabled" | "potEnabled" | "mortgageBreaksMonopoly" | "housingLimited"): void => {
    updateSettings({ [key]: !s[key] } as never);
  };

  return (
    <div className="settings-panel">
      <h3>房规{isHost ? "（可修改）" : "（房主配置）"}</h3>
      <ul className="settings-list">
        <li>
          <label className="check">
            <input
              type="checkbox"
              checked={s.auctionEnabled}
              disabled={!isHost}
              onChange={() => toggle("auctionEnabled")}
            />
            拍卖（放弃购买进入拍卖）
          </label>
        </li>
        <li>
          <label className="check">
            <input type="checkbox" checked={s.potEnabled} disabled={!isHost} onChange={() => toggle("potEnabled")} />
            免费停车场罚金池
          </label>
        </li>
        <li>
          <label className="check">
            <input
              type="checkbox"
              checked={s.mortgageBreaksMonopoly}
              disabled={!isHost}
              onChange={() => toggle("mortgageBreaksMonopoly")}
            />
            抵押破垄断加成
          </label>
        </li>
        <li>
          <label className="check">
            <input
              type="checkbox"
              checked={s.housingLimited}
              disabled={!isHost}
              onChange={() => toggle("housingLimited")}
            />
            建筑库存限制（关闭 = 无限）
          </label>
        </li>
        <li>
          <label className="check">
            起始资金 $
            <input
              className="bid-input"
              type="number"
              min={SETTINGS_LIMITS.startMoneyMin}
              max={SETTINGS_LIMITS.startMoneyMax}
              step={100}
              value={s.startMoney}
              disabled={!isHost}
              onChange={(e) => {
                const v = Number(e.target.value);
                // 仅提交范围内的完整数值（避免中途值触发服务端校验错误提示）
                if (Number.isInteger(v) && v >= SETTINGS_LIMITS.startMoneyMin && v <= SETTINGS_LIMITS.startMoneyMax) {
                  updateSettings({ startMoney: v });
                }
              }}
            />
            <span className="muted small">
              （{SETTINGS_LIMITS.startMoneyMin}-{SETTINGS_LIMITS.startMoneyMax}）
            </span>
          </label>
        </li>
        <li>
          <label className="check">
            限时模式
            <select
              value={s.timeLimitMinutes === null ? "off" : String(s.timeLimitMinutes)}
              disabled={!isHost}
              onChange={(e) => {
                const v = e.target.value;
                updateSettings({ timeLimitMinutes: v === "off" ? null : Number(v) });
              }}
            >
              <option value="off">关闭（最后存活者胜）</option>
              {SETTINGS_LIMITS.timeLimitOptions.map((min) => (
                <option key={min} value={min}>
                  {min} 分钟后按总资产判胜负
                </option>
              ))}
            </select>
          </label>
        </li>
      </ul>
    </div>
  );
}

export default function LobbyView() {
  const room = useStore((s) => s.room);
  const session = useStore((s) => s.session);
  const startGame = useStore((s) => s.startGame);

  if (!room) return null;
  const colors = playerColorMap(room);
  const me = room.members.find((m) => m.id === session?.memberId);
  const isHost = me?.isHost === true;
  const players = room.members.filter((m) => m.kind === "player");
  const spectators = room.members.filter((m) => m.kind === "spectator");

  return (
    <div className="lobby">
      <h2>等待开局</h2>
      <ul className="member-list">
        {players.map((m) => (
          <li key={m.id}>
            <span className="swatch" style={{ background: colors[m.id] }} />
            <span className="name">
              {m.name}
              {m.id === session?.memberId ? "（你）" : ""}
            </span>
            {m.isHost && <span className="tag">房主</span>}
            {!m.connected && <span className="tag off">离线</span>}
          </li>
        ))}
      </ul>
      {spectators.length > 0 && (
        <p className="muted small">旁观：{spectators.map((s) => s.name).join("、")}</p>
      )}
      <SettingsPanel isHost={isHost} />
      {isHost ? (
        <button
          className="btn btn-primary"
          disabled={players.length < 2}
          title={players.length < 2 ? "至少需要 2 名玩家" : undefined}
          onClick={startGame}
        >
          开始游戏{players.length < 2 ? "（至少 2 人）" : `（${players.length} 人）`}
        </button>
      ) : (
        <p className="muted">等待房主开始游戏…</p>
      )}
      <p className="muted small">把房间码发给朋友；对局中掉线不会被踢出，刷新页面即可回到座位。</p>
    </div>
  );
}
