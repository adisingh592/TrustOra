import { test } from "node:test";
import assert from "node:assert/strict";
import { milestoneActions, nextStepFor, statusNote, projectActions, type WalletContext, type WorkflowMilestone, type WorkflowProject } from "../src/lib/workflow";

const ms = (over: Partial<WorkflowMilestone> = {}): WorkflowMilestone => ({
  id: "m1", milestoneIndex: 1, state: "UNFUNDED", amountUsdc: 250, addTxHash: "0xadd", ...over,
});
const proj = (over: Partial<WorkflowProject> = {}, milestones: WorkflowMilestone[] = [ms()]): WorkflowProject => ({
  status: "AGREED", registerTxHash: "0xreg",
  agreement: { clientAccepted: true, freelancerAccepted: true, isLocked: true },
  milestones, ...over,
});
const wallet = (over: Partial<WalletContext> = {}): WalletContext => ({
  roles: ["client"], escrowConfigured: true, connected: true, onArc: true, allowanceUnits: 0n, amountUnits: 250_000_000n, ...over,
});
const get = (list: ReturnType<typeof milestoneActions>, id: string) => list.find((a) => a.id === id);
const ok = (list: ReturnType<typeof milestoneActions>, id: string) => !!get(list, id)?.available;

test("client path: approve before fund, then fund once allowance covers the amount", () => {
  const p = proj();
  let a = milestoneActions(p, p.milestones[0]!, wallet());
  assert.equal(ok(a, "approve_usdc"), true);
  assert.equal(ok(a, "fund"), false);
  assert.match(get(a, "fund")!.reason!, /Approve USDC/);

  a = milestoneActions(p, p.milestones[0]!, wallet({ allowanceUnits: 250_000_000n }));
  assert.equal(ok(a, "approve_usdc"), false);
  assert.equal(ok(a, "fund"), true);
  a = milestoneActions(p, p.milestones[0]!, wallet({ allowanceUnits: 249_999_999n }));
  assert.equal(ok(a, "fund"), false, "allowance one unit short is not enough");
});

test("funding needs the milestone registered on Arc first (DB record is not on-chain)", () => {
  const p = proj({}, [ms({ addTxHash: null })]);
  const a = milestoneActions(p, p.milestones[0]!, wallet({ allowanceUnits: 999_000_000n }));
  assert.equal(ok(a, "fund"), false);
  assert.match(get(a, "fund")!.reason!, /Register this milestone on Arc/);
});

test("registration order: project first, then milestones in index order, only after agreement is locked", () => {
  const unlocked = proj({ agreement: { clientAccepted: true, freelancerAccepted: false, isLocked: false }, registerTxHash: null });
  assert.equal(projectActions(unlocked, wallet())[0]!.available, false);
  const lockedUnreg = proj({ registerTxHash: null });
  assert.equal(projectActions(lockedUnreg, wallet())[0]!.available, true);
  assert.equal(projectActions(proj(), wallet())[0]!.available, false); // already registered

  const two = proj({}, [ms({ addTxHash: null }), ms({ id: "m2", milestoneIndex: 2, addTxHash: null })]);
  const [m1, m2] = two.milestones as [WorkflowMilestone, WorkflowMilestone];
  assert.equal(ok(milestoneActions(two, m1, wallet()), "register_milestone"), true);
  assert.equal(ok(milestoneActions(two, m2, wallet()), "register_milestone"), false);
  assert.match(get(milestoneActions(two, m2, wallet()), "register_milestone")!.reason!, /earlier milestones/);
  const noProject = proj({ registerTxHash: null }, [ms({ addTxHash: null })]);
  assert.equal(ok(milestoneActions(noProject, noProject.milestones[0]!, wallet()), "register_milestone"), false);
});

test("release, revision and evaluation are offered to the client only once work is submitted", () => {
  for (const state of ["UNFUNDED", "FUNDED", "REVISION_REQUESTED", "RELEASED", "REFUNDED", "DISPUTED"]) {
    const p = proj({}, [ms({ state })]);
    const a = milestoneActions(p, p.milestones[0]!, wallet());
    for (const id of ["release", "request_revision", "evaluate"]) assert.equal(ok(a, id), false, `${id} in ${state}`);
  }
  const p = proj({}, [ms({ state: "SUBMITTED" })]);
  const a = milestoneActions(p, p.milestones[0]!, wallet());
  for (const id of ["release", "request_revision", "evaluate", "dispute"]) assert.equal(ok(a, id), true, id);
});

test("the freelancer can never release or fund; evaluation and release are not freelancer actions at all", () => {
  const p = proj({}, [ms({ state: "SUBMITTED" })]);
  const ids = milestoneActions(p, p.milestones[0]!, wallet({ roles: ["freelancer"] })).map((a) => a.id);
  for (const forbidden of ["release", "fund", "approve_usdc", "evaluate", "request_revision", "register_milestone"]) {
    assert.ok(!ids.includes(forbidden as never), `${forbidden} must not be offered to a freelancer`);
  }
});

test("freelancer submits only when funded or after a revision request", () => {
  for (const [state, expected] of [["UNFUNDED", false], ["FUNDED", true], ["SUBMITTED", false], ["REVISION_REQUESTED", true], ["RELEASED", false]] as const) {
    const p = proj({}, [ms({ state })]);
    assert.equal(ok(milestoneActions(p, p.milestones[0]!, wallet({ roles: ["freelancer"] })), "submit"), expected, state);
  }
});

test("dispute and refund apply only while funds are in escrow; resolve only on a dispute and only for the arbiter", () => {
  for (const state of ["FUNDED", "SUBMITTED", "REVISION_REQUESTED"]) {
    const p = proj({}, [ms({ state })]);
    const f = milestoneActions(p, p.milestones[0]!, wallet({ roles: ["freelancer"] }));
    assert.equal(ok(f, "dispute"), true);
    assert.equal(ok(f, "refund"), true);
  }
  const done = proj({}, [ms({ state: "RELEASED" })]);
  assert.equal(ok(milestoneActions(done, done.milestones[0]!, wallet({ roles: ["freelancer"] })), "refund"), false);
  const d = proj({}, [ms({ state: "DISPUTED" })]);
  assert.equal(ok(milestoneActions(d, d.milestones[0]!, wallet({ roles: ["arbiter"] })), "resolve"), true);
  assert.equal(ok(milestoneActions(d, d.milestones[0]!, wallet({ roles: ["client"] })), "resolve"), false);
});

test("chain actions are blocked, with a reason, when the wallet or server is not ready", () => {
  const p = proj({}, [ms({ state: "SUBMITTED" })]);
  for (const [over, re] of [
    [{ escrowConfigured: false }, /not configured/],
    [{ connected: false, onArc: false }, /Connect your wallet/],
    [{ onArc: false }, /Arc Testnet/],
  ] as const) {
    const a = get(milestoneActions(p, p.milestones[0]!, wallet(over)), "release")!;
    assert.equal(a.available, false);
    assert.match(a.reason!, re);
  }
});

test("freelancer acceptance is offered once and only to the freelancer", () => {
  const pending = proj({ agreement: { clientAccepted: true, freelancerAccepted: false, isLocked: false } });
  assert.equal(projectActions(pending, wallet({ roles: ["freelancer"] }))[0]!.available, true);
  assert.equal(projectActions(proj(), wallet({ roles: ["freelancer"] }))[0]!.available, false);
  assert.ok(!projectActions(pending, wallet({ roles: ["client"] })).some((a) => a.id === "accept_agreement"));
});

test("nextStepFor guides each role and returns null when waiting on someone else", () => {
  const agreed = { clientAccepted: true, freelancerAccepted: true, isLocked: true };
  const base = { registerTxHash: "0xreg", agreement: agreed, milestones: [{ state: "UNFUNDED" }] };
  assert.equal(nextStepFor({ ...base, agreement: { ...agreed, freelancerAccepted: false, isLocked: false } }, ["freelancer"])?.tab, "freelancer");
  assert.equal(nextStepFor({ ...base, registerTxHash: null }, ["client"])?.text, "Register the project on Arc from your wallet.");
  assert.match(nextStepFor(base, ["client"])!.text, /approve and fund/);
  assert.match(nextStepFor({ ...base, milestones: [{ state: "SUBMITTED" }] }, ["client"])!.text, /release funds/);
  assert.equal(nextStepFor({ ...base, milestones: [{ state: "FUNDED" }] }, ["freelancer"])?.tab, "freelancer");
  assert.equal(nextStepFor({ ...base, milestones: [{ state: "DISPUTED" }] }, ["arbiter"])?.tab, "arbiter");
  // waiting on the other party / nothing to do
  assert.equal(nextStepFor({ ...base, milestones: [{ state: "UNFUNDED" }] }, ["freelancer"]), null);
  assert.equal(nextStepFor({ ...base, milestones: [{ state: "RELEASED" }] }, ["client"]), null);
  assert.equal(nextStepFor({ ...base, milestones: [{ state: "FUNDED" }] }, ["client"]), null);
});

test("statusNote tells every role where a milestone stands, for every state", () => {
  const states = ["UNFUNDED", "FUNDED", "SUBMITTED", "REVISION_REQUESTED", "DISPUTED", "RELEASED", "REFUNDED"];
  for (const role of ["client", "freelancer"] as const) {
    for (const st of states) assert.ok(statusNote(st, role).length > 10 && !/No action is needed/.test(statusNote(st, role)), `${role}/${st}`);
  }
  assert.match(statusNote("SUBMITTED", "client"), /release funds/i);
  assert.match(statusNote("SUBMITTED", "freelancer"), /Waiting for the client/);
  assert.match(statusNote("DISPUTED", "arbiter"), /Split/);
  assert.match(statusNote("FUNDED", "arbiter"), /No open dispute/);
});
