import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 开发环境：将健康检查 / API / Socket.IO 代理到本地 server（生产由 server 同源托管）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/healthz": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
      },
    },
  },
});
