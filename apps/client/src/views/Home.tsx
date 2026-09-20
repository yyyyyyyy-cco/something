import { useEffect, useState } from "react";
import { useStore } from "../store.js";

const NICK_KEY = "monopoly.nick";

/** 最近战绩（M4-4）：首页底部列表 */
function RecentRecords() {
  const records = useStore((s) => s.records);
  const loadRecords = useStore((s) => s.loadRecords);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  if (!records || records.length === 0) return null;

  const fmtDate = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="records">
      <h3>最近对局</h3>
      <ul className="records-list">
        {records.map((r) => (
          <li key={r.id}>
            <div className="record-head">
              <span className="record-winner">🏆 {r.winnerName}</span>
              <span className="muted small">
                {fmtDate(r.endedAt)} · {r.roomCode}
                {r.reason === "time-up" ? " · 限时结算" : ""}
              </span>
            </div>
            <div className="muted small">
              {r.players
                .slice()
                .sort((a, b) => b.assets - a.assets)
                .map((p) => `${p.name} $${p.assets}${p.bankrupt ? "（破产）" : ""}`)
                .join(" ｜ ")}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Home() {
  const [name, setName] = useState(() => localStorage.getItem(NICK_KEY) ?? "");
  const [code, setCode] = useState("");
  const createAndJoin = useStore((s) => s.createAndJoin);
  const joinWithCode = useStore((s) => s.joinWithCode);

  const remember = (): boolean => {
    const nick = name.trim();
    if (!nick) return false;
    localStorage.setItem(NICK_KEY, nick);
    return true;
  };

  return (
    <div className="home">
      <div className="home-card">
        <h1>monopoly · 联机大富翁</h1>
        <p className="muted">和朋友一起玩：房主创建房间，把房间码发到群里</p>

        <label className="field">
          <span>昵称</span>
          <input
            value={name}
            maxLength={12}
            placeholder="最多 12 个字"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <div className="home-actions">
          <button
            className="btn btn-primary"
            onClick={() => {
              if (remember()) void createAndJoin(name);
            }}
          >
            创建房间
          </button>
        </div>

        <div className="divider">
          <span>或</span>
        </div>

        <div className="join-row">
          <input
            value={code}
            maxLength={8}
            placeholder="输入房间码"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter" && remember()) void joinWithCode(code, name);
            }}
          />
          <button
            className="btn"
            onClick={() => {
              if (remember()) void joinWithCode(code, name);
            }}
          >
            加入
          </button>
        </div>

        <RecentRecords />
      </div>
    </div>
  );
}
