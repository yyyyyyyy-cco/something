/**
 * 音效模块（M4-1）：Web Audio API 合成音，无需素材文件。
 * - 静音开关持久化到 localStorage；AudioContext 懒创建（遵守浏览器自动播放策略）
 * - 全部音效为短促合成音（正弦/方波 + 包络），音量克制
 */
const MUTE_KEY = "monopoly.muted";

let ctx: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* 隐私模式忽略 */
}

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMuted(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* 忽略 */
  }
  return muted;
}

/** 单音：frequency 起始频率，duration 秒，type 波形，volume 音量 */
function tone(frequency: number, duration: number, type: OscillatorType = "sine", volume = 0.08, delay = 0): void {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** 滑音（频率从 from 到 to） */
function sweep(from: number, to: number, duration: number, type: OscillatorType = "sine", volume = 0.08): void {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const sfx = {
  /** 掷骰：两声短促木质敲击 */
  dice(): void {
    tone(180, 0.06, "square", 0.05);
    tone(150, 0.07, "square", 0.05, 0.09);
  },
  /** 棋子移动一步 */
  step(): void {
    tone(520, 0.035, "triangle", 0.03);
  },
  /** 收钱 / 购买 */
  coin(): void {
    tone(880, 0.08, "sine", 0.06);
    tone(1320, 0.12, "sine", 0.05, 0.06);
  },
  /** 抽卡 */
  card(): void {
    sweep(420, 780, 0.18, "sine", 0.05);
  },
  /** 入狱 / 坏消息 */
  bad(): void {
    sweep(320, 130, 0.32, "sawtooth", 0.05);
  },
  /** 出狱 / 好消息 */
  good(): void {
    tone(660, 0.1, "sine", 0.06);
    tone(990, 0.14, "sine", 0.05, 0.08);
  },
  /** 拍卖出价 */
  bid(): void {
    tone(740, 0.07, "square", 0.04);
  },
  /** 破产 */
  bankrupt(): void {
    sweep(300, 70, 0.5, "sawtooth", 0.06);
  },
  /** 对局结束胜利 */
  win(): void {
    tone(523, 0.14, "sine", 0.07);
    tone(659, 0.14, "sine", 0.07, 0.14);
    tone(784, 0.2, "sine", 0.07, 0.28);
    tone(1047, 0.3, "sine", 0.07, 0.44);
  },
};
