import { Prisma, type PrismaClient, type ProofEvent as ProofEventRow } from "@prisma/client";
import {
  DuplicateEventError,
  type EventStore,
  type StoredEvent,
} from "@trustora/prooftrack";
import {
  EcosystemSchema,
  ProofEventExpectedSchema,
  ProofEventTypeSchema,
  ReferenceTypeSchema,
  VerificationStatusSchema,
} from "@trustora/shared";

const toStored = (row: ProofEventRow): StoredEvent => ({
  id: row.id,
  publicProjectId: row.publicProjectId,
  milestoneId: row.milestoneId,
  occurredAt: row.occurredAt,
  createdAt: row.createdAt,
  // SQLite stores these as plain strings, so they are checked on the way out too.
  ecosystem: EcosystemSchema.parse(row.ecosystem),
  network: row.network,
  chainId: row.chainId,
  eventType: ProofEventTypeSchema.parse(row.eventType),
  referenceType: ReferenceTypeSchema.parse(row.referenceType),
  referenceValue: row.referenceValue,
  verificationStatus: VerificationStatusSchema.parse(row.verificationStatus),
  statusReason: row.statusReason,
  lastCheckedAt: row.lastCheckedAt,
  verifiedAt: row.verifiedAt,
  summary: row.summary,
  expected: ProofEventExpectedSchema.parse(JSON.parse(row.expectedJson)),
});

export const createPrismaEventStore = (prisma: PrismaClient): EventStore => ({
  async insert({ expected, ...event }) {
    try {
      const row = await prisma.proofEvent.create({
        data: { ...event, expectedJson: JSON.stringify(expected) },
      });
      return toStored(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new DuplicateEventError();
      }
      throw error;
    }
  },

  async findByNaturalKey(key) {
    const row = await prisma.proofEvent.findUnique({
      where: { referenceType_referenceValue_eventType: key },
    });
    return row ? toStored(row) : null;
  },

  async listByProject(publicProjectId) {
    const rows = await prisma.proofEvent.findMany({ where: { publicProjectId } });
    return rows.map(toStored);
  },

  async getById(id) {
    const row = await prisma.proofEvent.findUnique({ where: { id } });
    return row ? toStored(row) : null;
  },

  async updateVerification(id, update) {
    return toStored(await prisma.proofEvent.update({ where: { id }, data: update }));
  },
});
