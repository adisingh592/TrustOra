// Manual database check. Run it with: pnpm --filter @trustora/api db:check
//
// Never touches prisma/dev.db. It creates a scratch SQLite file in the OS temp
// folder, applies the real migrations to it the same way src/db.test.ts does,
// runs the checks, then deletes the file, even if a check fails.
//
// All data here is fake and prefixed FIXTURE. The hex values are valid in
// format only: they are not real wallets, transactions or escrow keys.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Prisma, type PrismaClient } from "@prisma/client";

const EXPECTED_TABLES = [
  "User",
  "AuthNonce",
  "Project",
  "Milestone",
  "AgreementVersion",
  "Submission",
  "Evaluation",
  "ProofEvent",
];

const FIXTURE_AMOUNT = "50000000";
const FIXTURE_CLIENT_WALLET = `0x${"0".repeat(39)}1`;
const FIXTURE_FREELANCER_WALLET = `0x${"0".repeat(39)}2`;
const FIXTURE_PROJECT_ID = "TRU-PROJ-2026-FIXTURE1";
const FIXTURE_ONCHAIN_MILESTONE_ID = `0x${"0".repeat(63)}1`;
const FIXTURE_TX_HASH = `0x${"0".repeat(64)}`;

const apiDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const devDbPath = join(apiDir, "prisma", "dev.db");

const results: { name: string; passed: boolean }[] = [];

const errorSummary = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const lines = message.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "unknown error";
};

const record = (name: string, passed: boolean, detail: string) => {
  results.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}: ${detail}`);
};

const check = async (name: string, run: () => Promise<string>) => {
  try {
    record(name, true, await run());
  } catch (error) {
    record(name, false, errorSummary(error));
  }
};

const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

const expectDuplicateRejected = async (write: () => Promise<unknown>) => {
  try {
    await write();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return `duplicate rejected (P2002 on ${String(error.meta?.target)})`;
    }
    throw new Error(`rejected for the wrong reason: ${errorSummary(error)}`);
  }
  throw new Error("duplicate was accepted");
};

const hashFile = (path: string) =>
  existsSync(path)
    ? createHash("sha256").update(readFileSync(path)).digest("hex")
    : null;

const insertChain = async (prisma: PrismaClient) => {
  const client = await prisma.user.create({
    data: { walletAddress: FIXTURE_CLIENT_WALLET, displayName: "FIXTURE Client" },
  });
  const freelancer = await prisma.user.create({
    data: {
      walletAddress: FIXTURE_FREELANCER_WALLET,
      displayName: "FIXTURE Freelancer",
    },
  });
  const project = await prisma.project.create({
    data: {
      publicProjectId: FIXTURE_PROJECT_ID,
      title: "FIXTURE project",
      description: "FIXTURE description",
      clientId: client.id,
      freelancerId: freelancer.id,
      status: "FIXTURE_STATUS",
    },
  });
  const milestone = await prisma.milestone.create({
    data: {
      projectId: project.id,
      onchainMilestoneId: FIXTURE_ONCHAIN_MILESTONE_ID,
      title: "FIXTURE milestone",
      amountBaseUnits: FIXTURE_AMOUNT,
      tokenAddress: "FIXTURE_TOKEN_ADDRESS",
      tokenDecimals: 6,
      deadline: new Date("2026-01-01T00:00:00.000Z"),
      status: "DRAFT",
    },
  });
  const agreementVersion = await prisma.agreementVersion.create({
    data: {
      milestoneId: milestone.id,
      version: 1,
      criteriaJson: '["FIXTURE criterion"]',
      agreementHash: "FIXTURE_AGREEMENT_HASH",
    },
  });
  const submission = await prisma.submission.create({
    data: {
      milestoneId: milestone.id,
      freelancerId: freelancer.id,
      agreementVersionId: agreementVersion.id,
      privateFilePath: "FIXTURE/private/path",
      fileHash: "FIXTURE_FILE_HASH",
      aiConsent: true,
      aiConsentAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "FIXTURE_STATUS",
    },
  });
  const evaluation = await prisma.evaluation.create({
    data: {
      submissionId: submission.id,
      provider: "FIXTURE_PROVIDER",
      modelId: "FIXTURE_MODEL",
      requestId: "FIXTURE_REQUEST_ID",
      promptHash: "FIXTURE_PROMPT_HASH",
      reportHash: "FIXTURE_REPORT_HASH",
      resultJson: '{"fixture":true}',
      status: "FIXTURE_STATUS",
    },
  });
  const proofEvent = await prisma.proofEvent.create({
    data: {
      publicProjectId: project.publicProjectId,
      milestoneId: milestone.id,
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      ecosystem: "ARC",
      network: "Arc Testnet",
      chainId: 5042002,
      eventType: "MILESTONE_FUNDED",
      referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
      referenceValue: FIXTURE_TX_HASH,
      verificationStatus: "PENDING",
      summary: "FIXTURE: sample event, not real.",
    },
  });
  return {
    client,
    freelancer,
    project,
    milestone,
    agreementVersion,
    submission,
    evaluation,
    proofEvent,
  };
};

const runChecks = async (prisma: PrismaClient) => {
  type Chain = Awaited<ReturnType<typeof insertChain>>;
  let inserted: Chain | undefined;
  const chain = () => {
    if (!inserted) throw new Error("skipped: the check 2 insert did not finish");
    return inserted;
  };

  await check("1. Connection and tables", async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type = 'table'`;
    const names = rows.map((row) => row.name);
    const missing = EXPECTED_TABLES.filter((table) => !names.includes(table));
    assert(missing.length === 0, `missing tables: ${missing.join(", ")}`);
    return `database opened, all ${EXPECTED_TABLES.length} tables exist`;
  });

  await check("2. Insert full chain and read back", async () => {
    const c = await insertChain(prisma);
    inserted = c;
    const readBack = {
      client: await prisma.user.findUniqueOrThrow({ where: { id: c.client.id } }),
      freelancer: await prisma.user.findUniqueOrThrow({
        where: { id: c.freelancer.id },
      }),
      project: await prisma.project.findUniqueOrThrow({
        where: { id: c.project.id },
      }),
      milestone: await prisma.milestone.findUniqueOrThrow({
        where: { id: c.milestone.id },
      }),
      agreementVersion: await prisma.agreementVersion.findUniqueOrThrow({
        where: { id: c.agreementVersion.id },
      }),
      submission: await prisma.submission.findUniqueOrThrow({
        where: { id: c.submission.id },
      }),
      evaluation: await prisma.evaluation.findUniqueOrThrow({
        where: { id: c.evaluation.id },
      }),
      proofEvent: await prisma.proofEvent.findUniqueOrThrow({
        where: { id: c.proofEvent.id },
      }),
    };
    assert(
      JSON.stringify(readBack) === JSON.stringify(c),
      "a row read back differs from what was inserted",
    );
    console.table([
      { model: "User (client)", key: `walletAddress=${readBack.client.walletAddress}` },
      {
        model: "User (freelancer)",
        key: `walletAddress=${readBack.freelancer.walletAddress}`,
      },
      { model: "Project", key: `publicProjectId=${readBack.project.publicProjectId}` },
      {
        model: "Milestone",
        key: `amountBaseUnits=${readBack.milestone.amountBaseUnits} status=${readBack.milestone.status}`,
      },
      {
        model: "AgreementVersion",
        key: `version=${readBack.agreementVersion.version} hash=${readBack.agreementVersion.agreementHash}`,
      },
      {
        model: "Submission",
        key: `fileHash=${readBack.submission.fileHash} aiConsent=${readBack.submission.aiConsent}`,
      },
      { model: "Evaluation", key: `requestId=${readBack.evaluation.requestId}` },
      {
        model: "ProofEvent",
        key: `eventType=${readBack.proofEvent.eventType} status=${readBack.proofEvent.verificationStatus}`,
      },
    ]);
    return "8 rows inserted, each read back identical to what was inserted";
  });

  await check("3. Amount stored as exact string", async () => {
    const { milestone } = chain();
    const rows = await prisma.$queryRaw<{ amount: unknown; storage: string }[]>`
      SELECT amountBaseUnits AS amount, typeof(amountBaseUnits) AS storage
      FROM Milestone WHERE id = ${milestone.id}`;
    const row = rows[0];
    assert(row?.amount === FIXTURE_AMOUNT, `read back ${String(row?.amount)}`);
    assert(row?.storage === "text", `stored as ${String(row?.storage)}, not text`);
    return `read back "${FIXTURE_AMOUNT}", SQLite storage type is text`;
  });

  await check("4a. Duplicate User.walletAddress rejected", () =>
    expectDuplicateRejected(() =>
      prisma.user.create({ data: { walletAddress: FIXTURE_CLIENT_WALLET } }),
    ),
  );

  await check("4b. Duplicate Project.publicProjectId rejected", () => {
    const { client } = chain();
    return expectDuplicateRejected(() =>
      prisma.project.create({
        data: {
          publicProjectId: FIXTURE_PROJECT_ID,
          title: "FIXTURE duplicate",
          description: "FIXTURE duplicate",
          clientId: client.id,
          status: "FIXTURE_STATUS",
        },
      }),
    );
  });

  await check("4c. Duplicate Milestone.onchainMilestoneId rejected", () => {
    const { project } = chain();
    return expectDuplicateRejected(() =>
      prisma.milestone.create({
        data: {
          projectId: project.id,
          onchainMilestoneId: FIXTURE_ONCHAIN_MILESTONE_ID,
          title: "FIXTURE duplicate",
          amountBaseUnits: FIXTURE_AMOUNT,
          tokenAddress: "FIXTURE_TOKEN_ADDRESS",
          tokenDecimals: 6,
          deadline: new Date("2026-01-01T00:00:00.000Z"),
          status: "DRAFT",
        },
      }),
    );
  });

  const agreementVersion = (milestoneId: string, version: number) => ({
    milestoneId,
    version,
    criteriaJson: '["FIXTURE criterion"]',
    agreementHash: "FIXTURE_AGREEMENT_HASH",
  });

  await check("4d. Duplicate AgreementVersion (milestoneId, version) rejected", () => {
    const { milestone } = chain();
    return expectDuplicateRejected(() =>
      prisma.agreementVersion.create({ data: agreementVersion(milestone.id, 1) }),
    );
  });

  const proofEventData = (eventType: string) => ({
    publicProjectId: FIXTURE_PROJECT_ID,
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    ecosystem: "ARC",
    network: "Arc Testnet",
    chainId: 5042002,
    eventType,
    referenceType: "BLOCKCHAIN_TRANSACTION_HASH",
    referenceValue: FIXTURE_TX_HASH,
    verificationStatus: "PENDING",
    summary: "FIXTURE: sample event, not real.",
  });

  await check(
    "4e. Duplicate ProofEvent (referenceType, referenceValue, eventType) rejected",
    () => {
      chain();
      return expectDuplicateRejected(() =>
        prisma.proofEvent.create({ data: proofEventData("MILESTONE_FUNDED") }),
      );
    },
  );

  await check("5a. Same ProofEvent reference with different eventType allowed", async () => {
    chain();
    await prisma.proofEvent.create({ data: proofEventData("PAYMENT_RELEASED") });
    return "second event with the same reference was accepted";
  });

  await check("5b. AgreementVersion version 2 on same milestone allowed", async () => {
    const { milestone } = chain();
    await prisma.agreementVersion.create({ data: agreementVersion(milestone.id, 2) });
    return "version 2 was accepted";
  });

  await check("6. Project loads with milestones and agreement versions", async () => {
    const { project, milestone } = chain();
    const loaded = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: {
        milestones: {
          include: { agreementVersions: { orderBy: { version: "asc" } } },
        },
      },
    });
    assert(
      loaded.milestones.length === 1,
      `expected 1 milestone, got ${loaded.milestones.length}`,
    );
    const loadedMilestone = loaded.milestones[0];
    assert(loadedMilestone?.id === milestone.id, "wrong milestone returned");
    assert(
      loadedMilestone?.amountBaseUnits === FIXTURE_AMOUNT,
      "wrong milestone amount returned",
    );
    const versions = loadedMilestone?.agreementVersions.map((v) => v.version) ?? [];
    assert(
      versions.join() === "1,2",
      `expected versions 1,2, got ${versions.join() || "none"}`,
    );
    return `${loaded.publicProjectId} returned 1 milestone with agreement versions ${versions.join(", ")}`;
  });
};

const devDbHashBefore = hashFile(devDbPath);
const tempDir = mkdtempSync(join(tmpdir(), "trustora-db-check-"));
const scratchFile = join(tempDir, "scratch.db");
const databaseUrl = `file:${scratchFile.replaceAll("\\", "/")}`;

console.log(`Scratch database: ${scratchFile}`);
console.log(
  devDbHashBefore
    ? `dev.db hash before: ${devDbHashBefore}`
    : "dev.db does not exist",
);
console.log("");

let prisma: PrismaClient | undefined;

try {
  process.env.DATABASE_URL = databaseUrl;
  execSync("pnpm exec prisma migrate deploy", {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  ({ prisma } = await import("../src/db.js"));

  // Stop before any write unless SQLite really has the scratch file open.
  const databases = await prisma.$queryRaw<{ name: string; file: string }[]>`
    PRAGMA database_list`;
  const openFile = databases.find((database) => database.name === "main")?.file;
  const onScratch =
    openFile !== undefined &&
    realpathSync.native(openFile) === realpathSync.native(scratchFile);
  if (!onScratch) {
    throw new Error(`refusing to run: open database is ${String(openFile)}`);
  }

  await runChecks(prisma);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  record("Setup", false, "the checks could not run, see the error above");
} finally {
  console.log("");
  await prisma?.$disconnect().catch(() => undefined);
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    assert(!existsSync(scratchFile), "file still exists");
    record("Scratch database deleted", true, scratchFile);
  } catch (error) {
    record("Scratch database deleted", false, `${scratchFile}: ${errorSummary(error)}`);
  }
  const devDbHashAfter = hashFile(devDbPath);
  if (devDbHashBefore === devDbHashAfter) {
    record(
      "dev.db not touched",
      true,
      devDbHashAfter
        ? `hash unchanged: ${devDbHashAfter}`
        : "dev.db did not exist and was not created",
    );
  } else {
    record(
      "dev.db not touched",
      false,
      `hash changed from ${String(devDbHashBefore)} to ${String(devDbHashAfter)}`,
    );
  }
}

const passed = results.filter((result) => result.passed).length;
const failed = results.length - passed;
console.log("");
console.log(`Summary: ${results.length} checks, ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
