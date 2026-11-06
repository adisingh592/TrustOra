# TRUSTORA — second developer setup and remaining work

This is a wallet-authenticated project and milestone escrow application. A client creates an agreement with frozen acceptance criteria, assigns a freelancer wallet, and funds milestones in USDC on Arc. The freelancer signs and submits work; TRUSTORA anchors the deliverable hash and can request an advisory 0G evaluation. The client decides whether to release escrow. ProofTrack correlates evidence. AI never releases funds.

## 1. Get a local copy

1. Clone the private repository (or use the approved source archive).
2. Install Node.js and npm, then run `npm install` at the repository root.
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill only values you are authorized to use. The example intentionally contains no credentials.
4. Keep `.env*`, private keys, browser wallet seed phrases, and local databases out of Git and chat. Use a secrets manager for shared credentials.
5. From the repository root, run `npm test`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `npm run build`, and `npm run dev`. Open `http://localhost:3000`.

The SQLite path is fixed at `apps/web/prisma/dev.db`. There is no `DATABASE_URL`. For a new local database, use the Prisma `db:push` command only as documented by the project owner; for an existing database, review the safe update dry run first and apply only when appropriate. Do not run `prisma db push --accept-data-loss`.

## 2. Use the second developer's test wallet

1. Create or choose a dedicated **testnet** wallet in the browser wallet extension. Never share its seed phrase or private key.
2. Add/select Arc Testnet (chain ID `5042002`) in that wallet and obtain testnet USDC/gas through the authorized faucet.
3. Connect the wallet in TRUSTORA and sign in. Client and freelancer addresses are authenticated wallet addresses, not `.env` settings. Use two different wallets for the client/freelancer rehearsal; use a separately authorized arbiter wallet for dispute resolution.
4. A public wallet address may be entered as the assigned freelancer when creating/inviting. Project permissions still come from the signed-in wallet and the database participant records.
5. The web server's `ESCROW_CONTRACT_ADDRESS` is a separate setting. It is currently unconfigured in the checked runtime. Do not invent an address or deploy without explicit team authorization.

## 3. Current implementation baseline

- Wallet nonce authentication, hashed server-side sessions, SQLite persistence, role-scoped project access, freelancer assignment/invitations, agreement signing, submission/revision/dispute/release flows, ProofTrack, and advisory evaluation paths are implemented.
- Tests use mocked wallet/blockchain/provider responses for workflow coverage. The checked baseline was 184 unit/API tests and 14 Hardhat tests passing, plus a passing TypeScript check and production build. Re-run them on the new laptop.
- Arc read-only checks previously confirmed chain ID `5042002`, testnet USDC contract code, and six USDC decimals. No contract deployment or live transaction was performed.
- The checked app status reports Arc escrow not configured, 0G not usable with the current runtime credentials/SDK, and Hedera x402 not implemented. Status never proves an integration works merely because a setting exists.

## 4. Remaining work, in order

### A. Arc escrow demonstration

1. Review the escrow contract, constructor, deployment script, and Arc configuration tests.
2. Run contract tests and the read-only deployment preflight.
3. Obtain explicit authorization before deployment. Deployment uses an authorized testnet key and is a real on-chain transaction.
4. After deployment, set the verified contract address in the local web configuration, restart, and confirm status.
5. Using test tokens and two test wallets, exercise project registration, milestone registration/funding, submission, client release, and authorized arbiter resolution. Verify each receipt/state against Arc.

### B. Genuine 0G evaluation

1. Obtain an authorized 0G testnet Router credential and configure it locally (`ZG_ROUTER_API_KEY`; optional model/base URL settings are listed in the example).
2. Verify provider connectivity with a real test inference and confirm request IDs/model/provider metadata originate from the provider response.
3. Evaluate only after explicit user consent and only against the frozen agreement criteria and the anchored submission.
4. Test missing credentials, timeouts, malformed output, and absent request IDs. These cases must yield `UNABLE_TO_ASSESS`; never fabricate output or IDs.
5. Confirm the report remains advisory and cannot call any escrow release path.

### C. Hedera x402 service (not yet wired into the app)

1. Specify and operate the TRUSTORA scanning service with a real Hedera Testnet recipient account; remove placeholder provider/account assumptions.
2. Implement the x402 v2 `exact` flow on `hedera:testnet` for native HBAR. Amounts and caps must be integer tinybars end-to-end.
3. Add persistent, concurrency-safe spending reservations and limits in SQLite; define how pending/failed/settled requests affect the daily limit.
4. Add an explicit user-consent step before any paid scan, then integrate the selected facilitator.
5. Accept settlement identifiers only from the facilitator. Verify exact payer debit, recipient credit, amount, successful consensus, and transaction ID through the Hedera Testnet Mirror Node before accepting the scan result or recording settlement.
6. Persist and display real payment history. Test policy rejection, over-limit/concurrent requests, facilitator failures, Mirror Node lag, mismatched transfers, and retries with mocks.
7. Enable live testnet settlement only with authorized service/facilitator credentials and user approval. Never fabricate settlement IDs or transfer HBAR during development tests.

### D. Finish UI and final review

1. Finish the light-theme pass for client, freelancer, arbiter, evaluation, ProofTrack, escrow/transaction, and payment-history screens.
2. Review desktop and mobile layouts and all loading, empty, error, and access-denied states in a browser.
3. Rehearse the whole workflow with two real test wallets and an authorized arbiter wallet after Arc is configured.
4. Run the full unit/API suite, Hardhat suite, TypeScript check, and production build. Record which external services were actually exercised.

## Safety rules

- Never commit or share `.env` credentials, seed phrases, or private keys.
- Never deploy or broadcast a transaction without explicit authorization.
- Never use mainnet or real funds for the rehearsal.
- Never let AI or a backend key release client escrow.
- A mocked test is not evidence of a live provider or blockchain transaction.
