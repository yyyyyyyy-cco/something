import { useEffect, useRef } from "react";
import { useStore } from "../store.js";

export default function LogPanel() {
  const logs = useStore((s) => s.logs);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  return (
    <section className="panel">
      <h3>日志</h3>
      <div className="log-scroll" ref={ref}>
        {logs.length === 0 && <p className="muted small">暂无记录</p>}
        {logs.map((l) => (
          <p key={l.id} className={`log-line kind-${l.kind}`}>
            {l.text}
          </p>
        ))}
      </div>
    </section>
  );
}
