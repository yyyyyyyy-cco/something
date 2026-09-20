import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "./logger.js";

/** 打开 SQLite（WAL 模式）并确保基础表结构存在（快照在 M2 起写入；战绩在 M4 起写入） */
export function openDatabase(dbFile: string) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_records (
      room_code  TEXT PRIMARY KEY,
      phase      TEXT NOT NULL,
      meta_json  TEXT NOT NULL,
      state_json TEXT,
      version    INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_records (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      room_code    TEXT NOT NULL,
      ended_at     INTEGER NOT NULL,
      winner_id    TEXT NOT NULL,
      winner_name  TEXT NOT NULL,
      reason       TEXT NOT NULL,
      players_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_game_records_ended_at ON game_records (ended_at DESC);
  `);
  logger.info({ dbFile }, "SQLite 已就绪（WAL）");
  return db;
}

export type Db = ReturnType<typeof openDatabase>;

/** 健康检查用连通性探测 */
export function pingDatabase(db: Db): boolean {
  try {
    db.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}
