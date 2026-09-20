import fs from "node:fs";
import path from "node:path";

/** 自动探测客户端构建产物目录（兼容「仓库根 / 服务包目录」两种运行 cwd） */
export function resolveClientDist(): string | null {
  const candidates = [
    process.env.CLIENT_DIST,
    path.resolve(process.cwd(), "apps/client/dist"),
    path.resolve(process.cwd(), "../client/dist"),
  ].filter((v): v is string => Boolean(v));

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dataDir: path.resolve(process.env.DATA_DIR ?? "data"),
  clientDist: resolveClientDist(),
  logLevel: process.env.LOG_LEVEL ?? "info",
};
