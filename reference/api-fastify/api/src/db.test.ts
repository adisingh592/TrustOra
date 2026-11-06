import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real migrations against a temporary database, never dev.db.
const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "trustora-test-"));
const databaseUrl = `file:${join(tempDir, "test.db").replaceAll("\\", "/")}`;

let prisma: PrismaClient;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  ({ prisma } = await import("./db.js"));
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
});

let sequence = 0;
const unique = (prefix: string) => `${prefix}-${++sequence}`;

const expectUniqueViolation = async (write: Promise<unknown>) => {
  const error = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
};

const createUser = () =>
  prisma.user.create({ data: { walletAddress: unique("test-wallet") } });

const projectData = (clientId: string) => ({
  publicProjectId: unique("test-project"),
  title: "test",
  description: "test",
  clientId,
  status: "test",
});

const createMilestone = async () => {
  const client = await createUser();
  const project = await prisma.project.create({ data: projectData(client.id) });
  return prisma.milestone.create({
    data: {
      projectId: project.id,
      onchainMilestoneId: unique("test-onchain-id"),
      title: "test",
      amountBaseUnits: "1500000",
      tokenAddress: "test-token",
      tokenDecimals: 6,
      deadline: new Date("2026-01-01T00:00:00.000Z"),
      status: "DRAFT",
    },
  });
};

describe("test database", () => {
  it("is the temporary database, not dev.db", () => {
    expect(process.env.DATABASE_URL).toBe(databaseUrl);
    expect(databaseUrl).not.toContain("dev.db");
  });
});

describe("ProofEvent", () => {
  const event = {
    publicProjectId: "test-project",
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ecosystem: "ARC",
    network: "test-network",
    eventType: "MILESTONE_FUNDED",
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue: "test-reference",
    verificationStatus: "PENDING",
    summary: "test",
  };

  it("rejects a duplicate (referenceType, referenceValue, eventType)", async () => {
    await prisma.proofEvent.create({ data: event });
    await expectUniqueViolation(prisma.proofEvent.create({ data: event }));
  });

  it("allows the same reference with a different eventType", async () => {
    const data = { ...event, referenceValue: unique("test-reference") };
    await prisma.proofEvent.create({ data });
    await expect(
      prisma.proofEvent.create({ data: { ...data, eventType: "PAYMENT_RELEASED" } }),
    ).resolves.toBeDefined();
  });
});

describe("AgreementVersion", () => {
  const version = (milestoneId: string, number: number) => ({
    milestoneId,
    version: number,
    criteriaJson: "[]",
    agreementHash: "test-hash",
  });

  it("rejects a duplicate (milestoneId, version)", async () => {
    const { id } = await createMilestone();
    await prisma.agreementVersion.create({ data: version(id, 1) });
    await expectUniqueViolation(
      prisma.agreementVersion.create({ data: version(id, 1) }),
    );
  });

  it("allows a new version on the same milestone", async () => {
    const { id } = await createMilestone();
    await prisma.agreementVersion.create({ data: version(id, 1) });
    await expect(
      prisma.agreementVersion.create({ data: version(id, 2) }),
    ).resolves.toBeDefined();
  });
});

describe("Project", () => {
  it("rejects a duplicate publicProjectId", async () => {
    const client = await createUser();
    const data = projectData(client.id);
    await prisma.project.create({ data });
    await expectUniqueViolation(prisma.project.create({ data }));
  });
});
