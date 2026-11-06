# Security

## Scope and honesty

- TRUSTORA runs on Arc Testnet only, with test funds. Arc Mainnet is never used.
- The escrow contract is unaudited. Do not use it to protect real value.
- The arbiter is centralized: one key can decide disputes, so users must trust whoever holds it.
- AI evaluation is advisory. It can never release or refund escrow.
- This document records what was tested. It does not claim the project is secure.

## Key rules

1. Use dedicated, low-value testnet keys only.
2. Use a separate key for each role: deployer, client, freelancer, arbiter, Hedera agent.
3. Never put a key in Git.
4. Never put a key in chat.
5. Never put a key in logs.
6. Never put a key in the database.
7. Never put a key in a `NEXT_PUBLIC_*` variable: those reach every browser.
8. Never reuse any old Whitechain key.
9. Never use Arc Mainnet.
10. Keep keys only in your local, git-ignored `.env`, and enable the hook once per clone: `git config core.hooksPath .githooks`.

### Who holds which key

Team to fill in.

| Key | Owner |
| --- | --- |
| Deployer | |
| Client (demo) | |
| Freelancer (demo) | |
| Arbiter | |
| Hedera agent | |

## If a key leaks

1. Stop using the key immediately.
2. Move any remaining funds to a new key.
3. Rotate: create a new key and update your local `.env`. Removing a key from Git does not make it safe again, so treat it as public forever.
4. If the key was the deployer or arbiter, redeploy the contract with a new key and update its address everywhere.
5. Tell the team what leaked, when, and what you did.

## Provider-mode note

TO BE FILLED BY M3: TeeML versus TeeTLS, and what content reaches a third party.

## Findings

Severities are for the current state: no endpoint uses these tables yet. Reproduced on a scratch database with Prisma 6.19.3.

| ID | Severity | Location | Evidence / repro | Impact | Suggested fix | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | Medium | `apps/api/prisma/schema.prisma`, `User.walletAddress` | Created one wallet in lowercase and in uppercase: 2 `User` rows, no unique error | One wallet can hold two accounts, which can split ownership checks | Lowercase in one shared write path before every insert or lookup; `verify()` already returns lowercase | M2 | Fixed by M2 in `apps/api/src/auth/users.ts`, with a test that fails if other source writes the field. The database itself still accepts mixed case. M5 to verify |
| SEC-002 | Medium | `apps/api/prisma/schema.prisma`, `AgreementVersion` | `update` changed `agreementHash` from `FIXTURE_ORIGINAL` to `FIXTURE_CHANGED` with no error. Immutability is a comment only | An accepted agreement could be changed after both parties agreed | Allow only the two acceptance timestamps to be updated, ideally with a SQLite trigger in a migration | M2 | Open |
| SEC-003 | Medium | `apps/api/prisma/schema.prisma`, `Milestone` | Created with `amountBaseUnits` `1.5`, `status` `NOT_A_STATUS`, `onchainMilestoneId` `FIXTURE-not-hex`: all accepted | Bad amounts or IDs could reach escrow logic or the UI | Validate at the API boundary with the `@trustora/shared` schemas; add a format check for `onchainMilestoneId` | M2 | Open |
| SEC-004 | Low | `.gitignore` | `git check-ignore --no-index a.db-journal a.db-wal` matches neither | SQLite side files holding database content could be committed | Add `*.db-journal`, `*.db-wal`, `*.db-shm` | M2 | Fixed by M2 in `.gitignore`. M5 to verify |

## Gates

| Gate | When | Status |
| --- | --- | --- |
| S1 | Before escrow deploy | NOT PASSED yet |
| S2 | Before real deliverable content goes to 0G | NOT PASSED yet |
| S3 | Before the Hedera agent account is funded, only if Hedera goes ahead | NOT PASSED yet |
| S4 | Before submission | NOT PASSED yet |

## What was not tested

Part 1 tested the wallet auth verifier, upload validator and secret scanner in isolation. The following was not tested:

- Everything in the `tests/security/README.md` checklist: contracts, 0G, Hedera, `/verify`, IDOR, prompt injection.
- The upload validator wired into the API: no endpoint uses it yet.
- Rate limiting: there is none on the auth endpoints, and `/auth/nonce` is public and writes to the database.
- Revoking a session: logout clears the browser's cookie, but a copied cookie stays valid until it expires, up to 24 hours.
- Parallel single-use on any database except SQLite, which is the only one the database nonce store has run on.
- Real browser wallets. Signatures came from viem test accounts. Smart-contract wallets (EIP-1271) are unsupported.
- Malicious content inside text files or zip entries. The validator checks type and structure only: an allowed `.html` or `.js` can still hold a script, and a zip can hold an `.exe`. Anything serving uploads must not render or run them.
- Other archive formats, such as `.tar.gz` inside a zip. Only nested zips are rejected.
- Upload validation time on the largest allowed zip. It runs synchronously, so a large file can briefly block the server.
- Zip entry checksums (CRC-32), which are not verified.
- The secret scanner's accuracy beyond its test cases: it is pattern-based, so it can miss secrets. Reflog entries and unreachable commits are not scanned. `.secret-scan-baseline` lists reviewed false positives in commits that can no longer change.
