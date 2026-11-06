# Interface proposals for M2 (proposals — M3 does not change the shared contract unilaterally)

1. **`requestId` is `string | null`.** It is `null` whenever no model was called (unsupported kind, unreadable
   content, consent refused). Please allow null in the shared evaluation type.
2. **Extra result fields M3 produces** (all optional from M2's side, all present in `EvaluationReport`):
   `requestIdSource`, `chatId`, `providerAddress`, `teeVerified` (`true|false|null`), `teeVerifiedBy`
   (`"router-reported" | "sdk-independent" | null`), `trustModeRequested`, `modelId`, `promptHash`,
   `criteriaVersion`, `submissionHash`, `modelCalled`, `attempts`, `advisoryNotice`, `reportHash`.
3. **ProofTrack evaluation event** should be exactly:
   ```json
   { "ecosystem": "ZERO_G", "network": "0g-testnet", "referenceType": "INFERENCE_REQUEST_ID",
     "referenceValue": "<requestId>", "verificationStatus": "PENDING" }
   ```
   with **no `explorerUrl`** — a 0G inference request ID is not a transaction hash and has no explorer page.
4. **`teeVerified` must NOT turn a ProofTrack entry into `VERIFIED`.** A router-reported flag is the vendor's claim.
   `VERIFIED` stays reserved for something TRUSTORA checks itself.
5. **Health vocabulary M3 uses:** `NOT_CONFIGURED` (no key), `CONFIGURED` (reachable + key accepted),
   `CONNECTED` (a real inference succeeded), `DEGRADED`, `UNAVAILABLE`. M3 never emits `VERIFIED`, and clamps a
   client that claims `CONNECTED`/`VERIFIED` before a real success.
6. **Env var names for `.env.example`** (names only, no values):
   `ZG_ROUTER_API_KEY`, `ZG_ROUTER_BASE_URL`, `ZG_ROUTER_MODEL`, `ZG_ROUTER_TRUST_MODE`,
   `ZG_ROUTER_PROVIDER_ADDRESS`, `ZG_PRIVATE_KEY`, `ZG_RPC_URL`, `ZG_PROVIDER_ADDRESS`.
7. **Error codes M2 should expect** from `Evaluator.evaluate`: `INVALID_INPUT`, `CONSENT_REQUIRED`,
   `MODEL_OUTPUT_INVALID`, `PROVIDER_UNAVAILABLE`, `PROVIDER_NOT_CONFIGURED`, `INSUFFICIENT_FUNDS`.
8. `packages/og/src/types.ts` currently **mirrors** the shared status vocabulary. Swap it for `packages/shared`
   imports as soon as M2 publishes; M3 will not edit `packages/shared`.
