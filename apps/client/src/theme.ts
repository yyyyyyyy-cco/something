/**
 * 客户端主题常量：色组颜色（与棋盘色组一致）与玩家颜色分配
 */
import type { ColorGroup, RoomInfo } from "@monopoly/shared";

export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: "#9c7a5b",
  "light-blue": "#5bc0eb",
  pink: "#e470a9",
  orange: "#f5a623",
  red: "#e0484f",
  yellow: "#e8c74c",
  green: "#4caf72",
  "dark-blue": "#5b74d6",
};

/** 玩家颜色板（按房间加入顺序稳定分配，≤6 人） */
export const PLAYER_COLORS = ["#ef5350", "#42a5f5", "#66bb6a", "#ffca28", "#ab47bc", "#26c6da"];

export function playerColorMap(room: RoomInfo | null): Record<string, string> {
  const map: Record<string, string> = {};
  room?.members.forEach((m, i) => {
    map[m.id] = PLAYER_COLORS[i % PLAYER_COLORS.length]!;
  });
  return map;
}

/** 单玩家颜色（供 Tile 精确订阅使用，避免全量成员映射重算） */
export function playerColorAt(room: RoomInfo | null, memberId: string | null): string {
  if (!room || !memberId) return "#888";
  const idx = room.members.findIndex((m) => m.id === memberId);
  return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length]! : "#888";
}
