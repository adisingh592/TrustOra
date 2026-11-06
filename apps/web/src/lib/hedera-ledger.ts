import { prisma } from "./prisma";
import { DEFAULT_HEDERA_POLICY } from "../../../../packages/hedera/src/policy";

/**
 * Persistent reservation ledger for Hedera spending limits.
 * Reservations are idempotent and counted for 24 hours before a facilitator
 * flow is allowed to submit a payment.
 */
export async function reserveHederaSpend(amountTinybars: bigint, idempotencyKey: string): Promise<{ allowed: boolean; reason?: string }> {
  if (amountTinybars <= 0n || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) {
    return { allowed: false, reason: "INVALID_SPEND_RESERVATION" };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.agentPayment.findUnique({ where: { idempotencyKey } });
      if (existing) return { allowed: true };

      const rows = await tx.$queryRaw<Array<{ total: bigint | number | null }>>`
        SELECT COALESCE(SUM(CAST("amountTinybars" AS INTEGER)), 0) AS total
        FROM "AgentPayment"
        WHERE "createdAt" >= datetime('now', '-24 hours')
          AND "status" IN ('PENDING', 'SETTLED')
      `;
      const spent = BigInt(rows[0]?.total ?? 0);
      if (spent + amountTinybars > DEFAULT_HEDERA_POLICY.maxDailyBudgetTinybars) {
        return { allowed: false, reason: "DAILY_BUDGET_EXCEEDED" };
      }

      await tx.agentPayment.create({
        data: {
          idempotencyKey,
          serviceName: "x402 facilitator reservation",
          providerAccount: "pending",
          amountTinybars: amountTinybars.toString(),
          status: "PENDING",
          policyDecision: "PERSISTENT_BUDGET_RESERVED",
        },
      });
      return { allowed: true };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return { allowed: true };
    }
    throw error;
  }
}
