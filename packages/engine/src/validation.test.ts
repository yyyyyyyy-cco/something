import { describe, expect, it } from "vitest";
import { act, actFail, decline, makeGame, place, roll, scriptedRng } from "./test-utils.js";

describe("动作校验与纯函数约束", () => {
  it("NOT_YOUR_TURN：非当前玩家动作被拒绝", () => {
    const state = makeGame(2);
    const err = actFail(state, { type: "ROLL_DICE", playerId: "p2" });
    expect(err.code).toBe("NOT_YOUR_TURN");
  });

  it("INVALID_PHASE：购买决策期间不可掷骰", () => {
    const state = makeGame(2);
    place(state, "p1", 0);
    const r = roll(state, "p1", scriptedRng([1, 2])); // → 3 无主地 → AWAITING_ACTION

    const err = actFail(r.state, { type: "ROLL_DICE", playerId: "p1" });
    expect(err.code).toBe("INVALID_PHASE");
  });

  it("INVALID_ACTION：无待决购买时 BUY / DECLINE 被拒绝", () => {
    const state = makeGame(2);
    expect(actFail(state, { type: "BUY_PROPERTY", playerId: "p1" }).code).toBe("INVALID_ACTION");
    expect(actFail(state, { type: "DECLINE_PURCHASE", playerId: "p1" }).code).toBe("INVALID_ACTION");
  });

  it("GAME_ENDED：对局结束后任何动作被拒绝", () => {
    const state = makeGame(2);
    place(state, "p1", 0);
    const r = roll(state, "p1", scriptedRng([1, 2]));
    decline(r.state, "p1"); // 正常对局……这里构造结束局更直接：
    const finished = makeGame(2);
    finished.phase = "ENDED";
    finished.winnerId = "p2";
    const err = actFail(finished, { type: "ROLL_DICE", playerId: "p1" });
    expect(err.code).toBe("GAME_ENDED");
  });

  it("纯函数：applyAction 不修改入参状态", () => {
    const state = makeGame(2);
    const before = JSON.stringify(state);

    const r = act(state, { type: "ROLL_DICE", playerId: "p1" }, scriptedRng([2, 3]));

    expect(JSON.stringify(state)).toBe(before);
    expect(r.state.version).toBe(1);
  });

  it("version 仅在成功动作时递增", () => {
    const state = makeGame(2);
    actFail(state, { type: "ROLL_DICE", playerId: "p2" });
    expect(state.version).toBe(0);

    const r = act(state, { type: "ROLL_DICE", playerId: "p1" }, scriptedRng([2, 3]));
    expect(r.state.version).toBe(1);
  });

  it("非法骰值（rng 越界）直接抛错（调用方编程错误）", () => {
    const state = makeGame(2);
    expect(() => roll(state, "p1", scriptedRng([0, 7]))).toThrow(/非法骰值/);
  });
});
