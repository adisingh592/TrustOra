# Provider mode note (for `docs/SECURITY.md`) + consent text

## Paragraph for `docs/SECURITY.md` (hand to M5)
TRUSTORA sends deliverable text to a third-party 0G Private Computer Router provider for AI evaluation. The 0G
vendor describes three trust modes — Standard (not attested), Verified (TeeML + TeeTLS) and Private Inference
(TeeML, which 0G states is not visible even to 0G. These are **vendor claims and are unaudited by TRUSTORA**. In
practice the Router operator and the selected provider can see the prompt we send, which includes the deliverable
content. The `tee_verified` flag returned in `x_0g_trace` is the **Router's own report**, not an independent
attestation; TRUSTORA labels it `router-reported` and never upgrades a ProofTrack entry to `VERIFIED` on the
strength of it. Only the compute-broker path's `processResponse` check is labelled `sdk-independent`. All of this
runs on **0G testnet** only, and during the hackathon only a synthetic fixture deliverable is ever sent — never
real third-party content. The deliverable itself is treated as untrusted input: instructions embedded in it are
ignored by design, and the evaluation report is advisory and cannot release or refund funds.

## Consent checkbox text (hand to M4)
> **Send this deliverable to 0G for AI evaluation?**
> The deliverable's text is sent to a third-party AI provider on the 0G testnet network for an advisory review
> against the agreed criteria. The provider and the 0G Router operator can see what is sent. Any trusted-execution
> ("TEE") protection is the vendor's own claim and is not independently verified by TRUSTORA. The AI report is
> advisory only: it **cannot release, refund or move your funds**, and it can be wrong. You can skip the AI review
> and have the milestone reviewed by a person instead.
> ☐ I understand and consent to this deliverable being sent for AI evaluation.

## "What AI can and cannot do" (hand to M4, for UI copy)
**Can:** read the deliverable's text, judge it against each agreed criterion (PASS / FAIL / UNABLE_TO_ASSESS),
quote what it saw as evidence, and record an inference request ID on the ProofTrack.
**Cannot:** release, refund or move escrowed funds; change the agreed criteria; see files it cannot read as text;
guarantee it was not misled by content hidden inside the deliverable; prove a TEE claim.
