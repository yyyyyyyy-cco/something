/**
 * 房间记录与战绩持久化（SQLite，写穿模式：每次关键变更落库）
 * 表结构见 db.ts：room_records / game_records（M4-4）
 */
import type { ChatMessage, GameRecord, GameRecordPlayer, GameState, RoomPhase } from "@monopoly/shared";
import type { Db } from "./db.js";

export interface PersistedMember {
  id: string;
  name: string;
  token: string;
  kind: "player" | "spectator";
}

export interface RoomMeta {
  hostId: string | null;
  members: PersistedMember[];
  chat: ChatMessage[];
}

export interface RoomRecord {
  roomCode: string;
  phase: RoomPhase;
  meta: RoomMeta;
  state: GameState | null;
  version: number;
  updatedAt: number;
}

interface RoomRecordRow {
  room_code: string;
  phase: string;
  meta_json: string;
  state_json: string | null;
  version: number;
  updated_at: number;
}

export class RoomStore {
  constructor(private readonly db: Db) {}

  save(record: RoomRecord): void {
    this.db
      .prepare(
        `INSERT INTO room_records (room_code, phase, meta_json, state_json, version, updated_at)
         VALUES (@room_code, @phase, @meta_json, @state_json, @version, @updated_at)
         ON CONFLICT(room_code) DO UPDATE SET
           phase = excluded.phase,
           meta_json = excluded.meta_json,
           state_json = excluded.state_json,
           version = excluded.version,
           updated_at = excluded.updated_at`,
      )
      .run({
        room_code: record.roomCode,
        phase: record.phase,
        meta_json: JSON.stringify(record.meta),
        state_json: record.state ? JSON.stringify(record.state) : null,
        version: record.version,
        updated_at: record.updatedAt,
      });
  }

  load(roomCode: string): RoomRecord | null {
    const row = this.db
      .prepare("SELECT room_code, phase, meta_json, state_json, version, updated_at FROM room_records WHERE room_code = ?")
      .get(roomCode) as RoomRecordRow | undefined;
    if (!row) return null;
    return {
      roomCode: row.room_code,
      phase: row.phase as RoomPhase,
      meta: JSON.parse(row.meta_json) as RoomMeta,
      state: row.state_json ? (JSON.parse(row.state_json) as GameState) : null,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  delete(roomCode: string): void {
    this.db.prepare("DELETE FROM room_records WHERE room_code = ?").run(roomCode);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM room_records").get() as { n: number };
    return row.n;
  }

  // ===== M4-4：对局战绩 =====

  /** 记录一局结果（对局结束时调用一次） */
  saveGameRecord(record: Omit<GameRecord, "id">): void {
    this.db
      .prepare(
        `INSERT INTO game_records (room_code, ended_at, winner_id, winner_name, reason, players_json)
         VALUES (@room_code, @ended_at, @winner_id, @winner_name, @reason, @players_json)`,
      )
      .run({
        room_code: record.roomCode,
        ended_at: record.endedAt,
        winner_id: record.winnerId,
        winner_name: record.winnerName,
        reason: record.reason,
        players_json: JSON.stringify(record.players),
      });
  }

  /** 最近战绩（按结束时间倒序） */
  listGameRecords(limit = 20): GameRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, room_code, ended_at, winner_id, winner_name, reason, players_json
         FROM game_records ORDER BY ended_at DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 100))) as Array<{
      id: number;
      room_code: string;
      ended_at: number;
      winner_id: string;
      winner_name: string;
      reason: string;
      players_json: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      roomCode: r.room_code,
      endedAt: r.ended_at,
      winnerId: r.winner_id,
      winnerName: r.winner_name,
      reason: r.reason as GameRecord["reason"],
      players: JSON.parse(r.players_json) as GameRecordPlayer[],
    }));
  }
}
