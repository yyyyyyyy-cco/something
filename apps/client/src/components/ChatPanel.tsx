import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { playerColorMap } from "../theme.js";

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const room = useStore((s) => s.room);
  const connected = useStore((s) => s.connected);
  const sendChat = useStore((s) => s.sendChat);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const colors = playerColorMap(room);

  const submit = (): void => {
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  };

  return (
    <section className="panel">
      <h3>聊天</h3>
      <div className="chat-scroll" ref={ref}>
        {chat.length === 0 && <p className="muted small">还不热闹，说点什么吧</p>}
        {chat.map((m) => (
          <p key={m.id} className="chat-line">
            <span className="chat-name" style={{ color: colors[m.from] ?? "#9aa0a6" }}>
              {m.name}
            </span>
            <span className="chat-text">{m.text}</span>
          </p>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={text}
          maxLength={200}
          placeholder={connected ? "说点什么…" : "连接中断…"}
          disabled={!connected}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className="btn btn-small" disabled={!connected} onClick={submit}>
          发送
        </button>
      </div>
    </section>
  );
}
