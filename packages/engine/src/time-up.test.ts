import { describe, expect, it } from "vitest";
import { act, actFail, eventsOfType, giveTile, makeGame, player, setMoney } from "./test-utils.js";
import { computeNetWorth, rankByNetWorth } from "./networth.js";

describe("总资产计算（规则规格 §14）", () => {
  it("现金 + 地产牌面价 + 建筑成本（旅馆按 5 × 建房价）", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p1"); // 地中海大道 $60
    giveTile(state, 5, "p1"); // 雷丁铁路 $200
    giveTile(state, 39, "p1"); // 木板路 $400，建房价 $200
    setMoney(state, "p1", 100);
    state.tiles[39]!.hotel = true; // 旅馆：200 × 5 = $1000

    expect(computeNetWorth(state, "p1")).toBe(100 + 60 + 200 + 400 + 1000);
  });

  it("抵押地产按半价计；房屋按栋计建房价", () => {
    const state = makeGame(2);
    giveTile(state, 11, "p1"); // 圣查尔斯广场 $140 → 抵押半价 $70
    giveTile(state, 1, "p1"); // 地中海大道 $60，2 栋房 × $50 = $100
    state.tiles[11]!.mortgaged = true;
    state.tiles[1]!.houses = 2;
    setMoney(state, "p1", 0);

    expect(computeNetWorth(state, "p1")).toBe(70 + 60 + 100);
  });

  it("排名：资产降序；同资产比现金；再同按玩家顺序", () => {
    const state = makeGame(3);
    setMoney(state, "p1", 100);
    setMoney(state, "p2", 500);
    setMoney(state, "p3", 100); // 与 p1 同资产 → 按现金同为 100 → 顺序 p1 优先
    const ranked = rankByNetWorth(state);
    expect(ranked.map((r) => r.id)).toEqual(["p2", "p1", "p3"]);
    expect(ranked[0]!.assets).toBe(500);
  });

  it("破产者不参与排名", () => {
    const state = makeGame(3);
    player(state, "p2").bankrupt = true;
    setMoney(state, "p2", 9999);
    const ranked = rankByNetWorth(state);
    expect(ranked.map((r) => r.id).sort()).toEqual(["p1", "p3"]);
  });
});

describe("限时模式 TIME_UP 裁决", () => {
  it("到点按总资产判胜负并结束（reason = time-up）", () => {
    const state = makeGame(2, { settings: { timeLimitMinutes: 60 } });
    giveTile(state, 39, "p1"); // 木板路 $400
    setMoney(state, "p1", 100); // 总资产 500
    setMoney(state, "p2", 400); // 总资产 400

    const r = act(state, { type: "TIME_UP", playerId: "p1" });

    expect(r.state.phase).toBe("ENDED");
    expect(r.state.winnerId).toBe("p1");
    expect(eventsOfType(r.events, "GAME_ENDED")[0]).toMatchObject({ winnerId: "p1", reason: "time-up" });
  });

  it("未开启限时模式时 TIME_UP 被拒绝", () => {
    const state = makeGame(2); // 默认 timeLimitMinutes = null
    const err = actFail(state, { type: "TIME_UP", playerId: "p1" });
    expect(err.code).toBe("INVALID_ACTION");
    expect(state.phase).not.toBe("ENDED");
  });

  it("破产清算结束的 reason 为 last-standing（回归）", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    const p1 = player(state, "p1");
    p1.position = 0;
    p1.money = 300;
    player(state, "p2").bankrupt = true; // 只剩 p1 存活
    // p1 掷 [1,3] → 4 所得税（足额支付）→ 回合收尾时发现仅剩一人
    const r = act(state, { type: "ROLL_DICE", playerId: "p1" }, () => [1, 3] as [number, number]);
    const ended = eventsOfType(r.events, "GAME_ENDED").find((e) => e.reason !== undefined);
    expect(ended?.reason).toBe("last-standing");
    expect(r.state.phase).toBe("ENDED");
    expect(r.state.winnerId).toBe("p1");
  });
});
