# M3 TEAM-FINDINGS

Status of every claim here: **relayed from the M3 brief, NOT independently verified by M3.** I have made no web
request and no 0G request in this session. M4 confirms deadlines on the ETHGlobal dashboard; M3 confirms the 0G
items with the first real run.

## Deadline
- ETHGlobal Mumbai submission closes **Saturday 7 Nov 2026, 09:00 IST** (brief cites ethglobal.com/events/mumbai/info/details). UNVERIFIED by M3.
- Team target: submission-ready end of **6 Nov IST**. Checkpoints C0 (setup), C1 14:00, **0G go/no-go 15:00**, C2 17:00 first full run, feature freeze 20:00.

## Rules that bind M3 (UNVERIFIED by M3; M4 to confirm)
- From-Scratch track forbids pre-existing project-specific code. All code in `packages/og` and `packages/evaluation` was written during the event.
- Pre-event work must be disclosed. AI tool use must be documented, **including spec files, prompts and planning artifacts** — so the M3 master prompt and these docs belong in the submission's AI-use disclosure.
- Demo video **< 3:00**.
- 0G prize needs: inference in the main flow with request IDs, public repo + README, live demo link, video, and one sentence on what breaks without 0G.
- Hedera prize needs: a settled Hedera tx ID in the README and a HashScan link in the video.

## 0G facts to confirm on the first real run
| Item | Brief says | M3 status |
|---|---|---|
| Testnet router base URL | `https://router-api-testnet.integratenetwork.work/v1` | coded as default, **UNVERIFIED** |
| Auth | `Authorization: Bearer sk-...` (Dashboard → API Keys) | coded, UNVERIFIED |
| Funding | deposit testnet 0G to Router payment contract; amount unknown | **UNKNOWN** |
| Faucet | `https://faucet.0g.ai`, reportedly 0.1 0G/day | UNVERIFIED; ask 0G staff on site |
| `verify_tee: true` body flag | supported | sent on every call, UNVERIFIED |
| `x_0g_trace.{request_id,provider,tee_verified}` | returned | parsed, UNVERIFIED |
| `ZG-Res-Key` header = chat ID | yes, body `id` as fallback | both parsed in priority order, UNVERIFIED |
| `X-0G-Provider-Trust-Mode: private` | not on router docs pages | **UNVERIFIED → opt-in only** via `ZG_ROUTER_TRUST_MODE`; never sent by default |
| Broker SDK method names | `createZGComputeNetworkBroker`, `listService`, `getServiceMetadata`, `getRequestHeaders`, `processResponse` | **UNVERIFIED**; fix only in `compute.ts` |

`tee_verified` from the Router is the **router's own claim** (`router-reported`). Only the broker path's
`processResponse` is labelled `sdk-independent`. Neither ever makes a ProofTrack entry `VERIFIED`.

## Hedera feasibility (stretch only)
- Verdict: **plausible but unproven.** Nothing about Hedera has been tested by M3.
- Recommended for a demo if it goes ahead: scheme `exact`, network `hedera:testnet`, HBAR asset `0.0.0`.
- Unknowns: facilitator URLs and liveness (Official x402 / Ax402 / Blocky402, or self-run), token IDs, the
  `@x402/hedera` import path, and the HashScan URL format.
- Go/no-go = a 10-minute check that a listed facilitator advertises `hedera:testnet` + `exact`. Otherwise **BLOCKED**.
- Hard stop 18:00 on 6 Nov: no independently verified settled Hedera tx ⇒ BLOCKED and removed from the demo.

## What breaks without 0G (draft sentence for the 0G submission)
> Without 0G, a milestone has no evidence-backed evaluation report and no inference request ID on the ProofTrack,
> so the client reviews the deliverable blind.
