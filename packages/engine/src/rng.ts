/**
 * 随机源与骰子工具
 * 设计：引擎保持纯函数——所有随机性由外部注入的 rng 提供（服务端/CLI/测试各自选择实现）
 */

export type DiceRoll = [number, number];
export type Rng = () => DiceRoll;

/** 生产 rng：基于 Web Crypto（Node 18+ / 浏览器均可用） */
export function secureRng(): Rng {
  const buf = new Uint8Array(2);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return [1 + (buf[0]! % 6), 1 + (buf[1]! % 6)];
  };
}

/** 可复现 rng（mulberry32）：用于测试与 CLI 的 --seed */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => [1 + Math.floor(next() * 6), 1 + Math.floor(next() * 6)];
}

/** Fisher-Yates 洗牌（默认 crypto 随机源；createGame 可注入替代实现） */
export function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  const buf = new Uint32Array(1);
  for (let i = out.length - 1; i > 0; i--) {
    globalThis.crypto.getRandomValues(buf);
    const j = buf[0]! % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function isDoubles(dice: DiceRoll): boolean {
  return dice[0] === dice[1];
}

export function diceSum(dice: DiceRoll): number {
  return dice[0] + dice[1];
}
