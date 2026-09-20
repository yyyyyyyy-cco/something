import { describe, expect, it } from "vitest";
import { BANK_INITIAL_HOUSES } from "@monopoly/shared";
import type { GameState } from "@monopoly/shared";
import { act, actFail, eventsOfType, giveTile, makeGame, place, player, roll, scriptedRng, setMoney } from "./test-utils.js";

/** 布置建筑（直接修改测试自有状态） */
function setBuild(state: GameState, tile: number, houses: number, hotel = false): void {
  const ts = state.tiles[tile]!;
  ts.houses = houses;
  ts.hotel = hotel;
}

/** 布置棕组（1、3）归 p1，现金充足 */
function brownOwner(money = 1500): GameState {
  const state = makeGame(2);
  giveTile(state, 1, "p1");
  giveTile(state, 3, "p1");
  setMoney(state, "p1", money);
  return state;
}

describe("建房（规则规格 §6：前置 / 平均原则 / 库存）", () => {
  it("拥整组可建房：扣建房价、房屋入册、银行库存 -1", () => {
    const state = brownOwner();
    const r = act(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 });

    expect(r.state.tiles[1]!.houses).toBe(1);
    expect(player(r.state, "p1").money).toBe(1450); // 建房价 $50
    expect(r.state.bank.housesLeft).toBe(BANK_INITIAL_HOUSES - 1);
    expect(eventsOfType(r.events, "HOUSE_BUILT")[0]).toMatchObject({ playerId: "p1", tile: 1 });
  });

  it("平均原则：只能建在组内房屋最少的地产上", () => {
    const state = brownOwner();
    setBuild(state, 1, 1); // 1 号已有 1 房，3 号 0 房
    expect(actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");
    // 3 号是最少 → 可以建
    const r = act(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 3 });
    expect(r.state.tiles[3]!.houses).toBe(1);
  });

  it("前置：未拥整组不可建", () => {
    const state = makeGame(2);
    giveTile(state, 1, "p1"); // 只持有棕组一半
    const err = actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 });
    expect(err.code).toBe("INVALID_ACTION");
    expect(err.message).toContain("整组");
  });

  it("前置：组内有抵押不可建、抵押地自身不可建", () => {
    const state = brownOwner();
    state.tiles[3]!.mortgaged = true;
    expect(actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");
  });

  it("现金不足拒绝；非回合玩家不可操作", () => {
    const state = brownOwner(40);
    expect(actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INSUFFICIENT_FUNDS");
    // p2 不是当前玩家 → NOT_YOUR_TURN（回合内动作的权限校验先于资产校验）
    expect(actFail(state, { type: "BUILD_HOUSE", playerId: "p2", tile: 1 }).code).toBe("NOT_YOUR_TURN");
  });

  it("银行房屋库存耗尽时拒绝（housingLimited 默认开启）", () => {
    const state = brownOwner();
    state.bank.housesLeft = 0;
    const err = actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 });
    expect(err.code).toBe("INVALID_ACTION");
    expect(err.message).toContain("库存");
  });

  it("housingLimited=false（休闲房规）：不限库存", () => {
    const state = makeGame(2, { settings: { housingLimited: false } });
    giveTile(state, 1, "p1");
    giveTile(state, 3, "p1");
    state.bank.housesLeft = 0;
    const r = act(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 });
    expect(r.state.tiles[1]!.houses).toBe(1);
    expect(r.state.bank.housesLeft).toBe(0); // 不消耗
  });
});

describe("旅馆（4 房 + 升级；全组 4 房前置）", () => {
  it("全组 4 房 → 升级成功：房屋退库、旅馆 -1", () => {
    const state = brownOwner();
    setBuild(state, 1, 4);
    setBuild(state, 3, 4);
    const r = act(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 });

    expect(r.state.tiles[1]!.hotel).toBe(true);
    expect(r.state.tiles[1]!.houses).toBe(0);
    expect(r.state.bank.hotelsLeft).toBe(11);
    expect(r.state.bank.housesLeft).toBe(BANK_INITIAL_HOUSES + 4); // 4 栋退库
    expect(eventsOfType(r.events, "HOTEL_BUILT")).toHaveLength(1);
  });

  it("全组未达 4 房（3+4）→ 不可升级（平均原则）", () => {
    const state = brownOwner();
    setBuild(state, 1, 4);
    setBuild(state, 3, 3);
    const err = actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 });
    expect(err.code).toBe("INVALID_ACTION");
  });

  it("旅馆库存耗尽 → 拒绝", () => {
    const state = brownOwner();
    setBuild(state, 1, 4);
    setBuild(state, 3, 4);
    state.bank.hotelsLeft = 0;
    expect(actFail(state, { type: "BUILD_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");
  });
});

describe("卖房（半价 / 平均原则 / 旅馆拆除）", () => {
  it("卖房半价回款、房屋回库", () => {
    const state = brownOwner();
    setBuild(state, 1, 2);
    setBuild(state, 3, 2);
    const r = act(state, { type: "SELL_HOUSE", playerId: "p1", tile: 1 });

    expect(r.state.tiles[1]!.houses).toBe(1);
    expect(player(r.state, "p1").money).toBe(1525); // 半价 $25
    expect(r.state.bank.housesLeft).toBe(BANK_INITIAL_HOUSES + 1);
    expect(eventsOfType(r.events, "HOUSE_SOLD")[0]).toMatchObject({ tile: 1, amount: 25 });
  });

  it("平均原则：只能卖组内房屋最多的地产（1+2 → 只能卖 3）", () => {
    const state = brownOwner();
    setBuild(state, 1, 1);
    setBuild(state, 3, 2);
    expect(actFail(state, { type: "SELL_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");
    const r = act(state, { type: "SELL_HOUSE", playerId: "p1", tile: 3 });
    expect(r.state.tiles[3]!.houses).toBe(1);
  });

  it("旅馆拆除：房屋库存 ≥4 时换回 4 房（无现金回款）", () => {
    const state = brownOwner();
    setBuild(state, 1, 0, true);
    const r = act(state, { type: "SELL_HOUSE", playerId: "p1", tile: 1 });

    expect(r.state.tiles[1]!.hotel).toBe(false);
    expect(r.state.tiles[1]!.houses).toBe(4);
    expect(player(r.state, "p1").money).toBe(1500); // 无回款
    expect(r.state.bank.housesLeft).toBe(BANK_INITIAL_HOUSES - 4);
    expect(r.state.bank.hotelsLeft).toBe(13);
  });

  it("旅馆拆除：房屋库存 <4 时按 5 房半价售出（$125）", () => {
    const state = brownOwner();
    setBuild(state, 1, 0, true);
    state.bank.housesLeft = 3;
    const r = act(state, { type: "SELL_HOUSE", playerId: "p1", tile: 1 });

    expect(r.state.tiles[1]!.hotel).toBe(false);
    expect(r.state.tiles[1]!.houses).toBe(0);
    expect(player(r.state, "p1").money).toBe(1625); // 50 × 5 / 2
    expect(r.state.bank.hotelsLeft).toBe(13);
    expect(eventsOfType(r.events, "HOTEL_SOLD")[0]).toMatchObject({ amount: 125 });
  });

  it("无房可卖 → 拒绝", () => {
    const state = brownOwner();
    expect(actFail(state, { type: "SELL_HOUSE", playerId: "p1", tile: 1 }).code).toBe("INVALID_ACTION");
  });
});

describe("建筑影响租金（规则规格 §5）", () => {
  it("1 房租金按租金表档位（覆盖双倍基础）", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    giveTile(state, 1, "p2");
    giveTile(state, 3, "p2"); // 棕组齐全
    setBuild(state, 1, 1); // 1 房
    place(state, "p1", 38);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 38 + 3 = 41 → 1

    const rent = eventsOfType(r.events, "RENT_PAID")[0]!;
    expect(rent.amount).toBe(10); // 租金表 1 房 = $10（非双倍基础 $4）
  });

  it("旅馆租金按租金表末档（木板路 $2000）", () => {
    const state = makeGame(2, { settings: { auctionEnabled: false } });
    giveTile(state, 37, "p2");
    giveTile(state, 39, "p2");
    setBuild(state, 39, 0, true); // 旅馆
    place(state, "p1", 36);

    const r = roll(state, "p1", scriptedRng([1, 2])); // 36 + 3 = 39

    const rent = eventsOfType(r.events, "RENT_PAID")[0]!;
    expect(rent.amount).toBe(2000);
  });
});
