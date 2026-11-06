# Evaluator limits

1. **Advisory only.** The report is advice to the client. It carries `advisoryNotice: "ADVISORY_ONLY_CANNOT_RELEASE_FUNDS"`.
2. **It cannot release or refund funds.** There is no code path from an AI verdict to escrow. `packages/evaluation`
   and `packages/og` do not import `packages/arc`, and a test asserts that.
3. **It can be wrong, and it can be injected.** The deliverable is untrusted input. We wrap it in a random
   per-call boundary, strip boundary-lookalike and invisible characters, exclude the filename from the prompt, and
   instruct the model to ignore embedded instructions. Our own `M3-PRELIM` probes measure those ten cases against
   the configured model and nothing more — **not a security guarantee.**
4. **Unreadable or unsupported deliverables get `UNABLE_TO_ASSESS`,** with no model call at all: submission kind
   `other`, or no readable text. `requestId` is then `null` and `modelCalled` is `false`.
5. **Long deliverables are truncated at 24,000 characters.** When that happens the report says so in
   `limitations`; content past the cut was not assessed.
6. **The overall verdict is computed by TRUSTORA, not the model**: all UNABLE → UNABLE_TO_ASSESS; any FAIL → FAIL;
   all PASS → PASS; otherwise PARTIAL. The model's own output is rejected if it includes an `overall` field, adds,
   drops or reorders criteria, or adds any other field. Criterion text in the report is copied from the agreed
   criteria, never from the model.
7. **The request ID is an INFERENCE_REQUEST_ID, not a transaction hash.** It gets no explorer link.
8. **TEE status is a label, not a proof.** `teeVerifiedBy: "router-reported"` means the Router claimed it;
   TRUSTORA did not confirm it. A `teeVerified: false` adds a WARNING limitation.
9. **Reproducibility, not authority.** `promptHash` covers the system prompt, criteria version, criteria and
   submission hash (the per-call nonce is excluded); `reportHash` is SHA-256 over the canonical JSON of the rest of
   the report. Equal hashes mean the same inputs were used — they say nothing about whether the verdict is right.
10. **Mock-backed tests prove logic only.** They do not show that 0G works, nor that a real model resists injection.
