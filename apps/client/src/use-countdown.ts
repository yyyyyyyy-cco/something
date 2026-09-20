/**
 * 本地倒计时 hook（M3）：基于服务端剩余毫秒快照 + 本地流逝时间，
 * 每 250ms 刷新一次（服务器真实超时以事件为准，此处仅用于展示）。
 */
import { useEffect, useState } from "react";

export function useRemainingMs(baseMs: number | null | undefined, receivedAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (baseMs === null || baseMs === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [baseMs, receivedAt]);

  if (baseMs === null || baseMs === undefined) return null;
  return Math.max(0, baseMs - (now - receivedAt));
}

/** 毫秒 → 秒（向上取整，用于倒计时展示） */
export function toSeconds(ms: number | null): number | null {
  return ms === null ? null : Math.ceil(ms / 1000);
}
