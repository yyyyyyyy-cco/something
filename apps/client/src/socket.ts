/**
 * Socket.IO 客户端单例（同源连接；开发环境由 Vite 代理 /socket.io 到 server）
 */
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@monopoly/shared";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(); // 同源；默认 polling → websocket 升级，自动重连
  }
  return socket;
}

/** 主动断开并重建连接（离开房间时使用，避免自动归位） */
export function resetSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
