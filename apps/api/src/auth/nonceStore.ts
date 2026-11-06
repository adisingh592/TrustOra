import type { PrismaClient } from "@prisma/client";
import type { NonceRecord, NonceStore } from "@trustora/security";

export const createPrismaNonceStore = (prisma: PrismaClient): NonceStore => ({
  async save(record) {
    // The nonce endpoint is public, so expired rows must not pile up.
    await prisma.authNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await prisma.authNonce.create({
      data: {
        nonce: record.nonce,
        domain: record.domain,
        chainId: record.chainId,
        address: record.address ?? null,
        expiresAt: record.expiresAt,
        usedAt: record.usedAt ?? null,
      },
    });
  },

  async get(nonce) {
    const row = await prisma.authNonce.findUnique({ where: { nonce } });
    if (!row) return null;
    const record: NonceRecord = {
      nonce: row.nonce,
      domain: row.domain,
      chainId: row.chainId,
      expiresAt: row.expiresAt,
      ...(row.address ? { address: row.address } : {}),
      ...(row.usedAt ? { usedAt: row.usedAt } : {}),
    };
    return record;
  },

  // One conditional UPDATE: the database lets exactly one caller change the row.
  async consume(nonce, now) {
    const { count } = await prisma.authNonce.updateMany({
      where: { nonce, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  },
});
