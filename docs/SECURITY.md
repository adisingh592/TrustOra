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

| ID | Severity | Location | Evidence / repro | Impact | Suggested fix | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |

## Gates

| Gate | When | Status |
| --- | --- | --- |
| S1 | Before escrow deploy | NOT PASSED yet |
| S2 | Before real deliverable content goes to 0G | NOT PASSED yet |
| S3 | Before the Hedera agent account is funded, only if Hedera goes ahead | NOT PASSED yet |
| S4 | Before submission | NOT PASSED yet |

## What was not tested
