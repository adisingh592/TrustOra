# TRUSTORA demo script

Use a local environment with seeded/test data and two distinct wallets. Distinguish application workflow from live chain activity. Do not show mock responses as real provider or blockchain results.

## 1. Explain the problem

Show the landing page and describe the product: wallet-bound project agreements, milestone escrow, optional advisory AI evaluation, and a record of supporting evidence.

## 2. Walk through client and freelancer roles

1. Sign in as Wallet A and create a project with milestones and acceptance criteria.
2. Invite Wallet B using its address.
3. Sign in as Wallet B and show the invitation, project criteria, agreement acceptance, and deliverable submission.
4. Return to Wallet A and show the submission, revision controls, and project state.

These application routes can be demonstrated locally. If tests or seeded data are used, label them as test data.

## 3. Show evaluation honestly

Show the evaluation consent step and the advisory-only warning. With no valid 0G credentials/provider response, show `UNABLE_TO_ASSESS`. If a real provider is separately configured and returns a genuine response, show its returned request ID and clearly identify the provider; never invent an ID or present a mock as live inference.

## 4. Explain escrow status

The contract has local Hardhat tests, but this repository currently has no configured TRUSTORA escrow deployment. Do not claim funds are locked or released on Arc. If demonstrating the contract suite, identify the local network and mock token. A live Arc demonstration requires a separately deployed, verified contract and wallet-signed testnet transactions.

## 5. Explain ProofTrack and Hedera status

Show application evidence records and explain which Arc records are independently verified by receipt/event/state checks. An application event or 0G request ID is not a blockchain transaction. Hedera x402 execution and a public ProofTrack verification portal are not implemented.

## Closing

TRUSTORA keeps payment authorization with the client or contract-authorized arbiter. AI output is advisory. State the current live integration limitations before presenting the prototype as a release candidate.
