/**
 * 套现窗口与罚金池（规则规格 §13 / §8）
 * - 支付义务触发但现金不足：进入 CASH_WINDOW（60 秒由服务端计时），
 *   期间可卖房 → 抵押 → 交易协商；现金足够时自动结算恢复原流程
 * - 超时 / 主动认输：破产清算（见 money.ts declareBankruptcy）
 * - 罚金池房规：税金与罚款（tax / card-pay / bail，付给银行）汇入免费停车场
 */
import type { GameEvent, GameState, MoneyReason, PendingDebt } from "@monopoly/shared";
import { findPlayer } from "./lookups.js";
import { transferMoney } from "./money.js";

/** 罚金池记账（potEnabled 房规；仅"付给银行"的税金/罚款入池，规则规格 §8） */
export function applyPotIfEnabled(state: GameState, amount: number, reason: MoneyReason, to: string | "bank"): void {
  if (!state.settings.potEnabled || amount <= 0 || to !== "bank") return;
  if (reason === "tax" || reason === "card-pay" || reason === "bail") {
    state.pot += amount;
  }
}

/**
 * 支付义务入口：足额则立即支付；不足则开启套现窗口。
 * resume 决定支付完成后的恢复动作（由 apply.ts 的 resumeAfterDebt 执行）。
 */
export function requirePayment(
  state: GameState,
  events: GameEvent[],
  payerId: string,
  creditor: string | "bank",
  amount: number,
  reason: MoneyReason,
  resume: PendingDebt["resume"],
  payees?: PendingDebt["payees"],
): void {
  const payer = findPlayer(state, payerId);
  if (payer.money >= amount) {
    transferMoney(state, events, payerId, creditor, amount, reason);
    if (payees) {
      // 多人清偿（payEach）：银行经手转付各债权人
      for (const payee of payees) {
        transferMoney(state, events, "bank", payee.id, payee.amount, "card-gain");
      }
    } else {
      applyPotIfEnabled(state, amount, reason, creditor);
    }
    return;
  }
  state.pendingDebt = { payerId, creditor, amount, reason, resume, ...(payees ? { payees } : {}) };
  state.phase = "CASH_WINDOW";
  events.push({ type: "DEBT_OPENED", playerId: payerId, creditor, amount, reason });
}

/**
 * 检查待决债务是否已可结算（每次套现动作后调用）。
 * 返回已结算的债务对象（调用方据 resume 恢复流程）；未结算返回 null。
 */
export function settleDebtIfPossible(state: GameState, events: GameEvent[]): PendingDebt | null {
  const debt = state.pendingDebt;
  if (!debt) return null;
  const payer = findPlayer(state, debt.payerId);
  if (payer.money < debt.amount) return null;

  if (debt.resume === "payEach" && debt.payees) {
    // 银行代收后转付各债权人（规则规格 §12：多人清偿由银行经手）
    transferMoney(state, events, debt.payerId, "bank", debt.amount, debt.reason);
    for (const payee of debt.payees) {
      transferMoney(state, events, "bank", payee.id, payee.amount, "card-gain");
    }
  } else {
    transferMoney(state, events, debt.payerId, debt.creditor, debt.amount, debt.reason);
    applyPotIfEnabled(state, debt.amount, debt.reason, debt.creditor);
  }

  state.pendingDebt = null;
  events.push({ type: "DEBT_SETTLED", playerId: debt.payerId, creditor: debt.creditor, amount: debt.amount });
  return debt;
}

/** 套现窗口是否由指定玩家持有（服务端 CASH_TIMEOUT 校验用） */
export function isCashWindowPayer(state: GameState, playerId: string): boolean {
  return state.phase === "CASH_WINDOW" && state.pendingDebt?.payerId === playerId;
}
