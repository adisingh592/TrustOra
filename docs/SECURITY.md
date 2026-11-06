# Security status and reporting

## Scope

TRUSTORA is a prototype using wallet authentication, an off-chain application database, an Arc escrow contract, optional 0G evaluation, and a ProofTrack evidence timeline. Security behavior below describes code in this repository; it is not an independent security audit or a guarantee against all attacks.

## Implemented controls

- Wallet login uses a single-use, domain-bound signed nonce. Sessions are random tokens stored as hashes and sent in an `HttpOnly`, `SameSite=Lax` cookie. Protected project routes derive the acting wallet from that session and check project membership in the database.
- Client transactions are signed by the connected wallet. The application server has no escrow signing key and AI evaluation has no path to release funds.
- `TrustoraEscrow.sol` uses role checks, OpenZeppelin `SafeERC20` and `ReentrancyGuard`, integer token units, and explicit milestone states. The client authorizes release; the configured arbiter resolves disputes. The owner can pause the contract. There is no multisignature requirement.
- The evaluation package validates provider output against the locked criteria, computes the overall result in application code, bounds input size, labels AI output advisory, and returns `UNABLE_TO_ASSESS` when it cannot obtain a valid provider result. Evaluation and prompt defenses are covered by tests using mocked provider responses; live 0G inference has not been verified for this release.
- Arc event records are marked verified only after the application checks a successful receipt, expected contract and event, transaction parties, project/milestone identifiers, and current contract state. Other evidence types are application/provider records and must not be presented as independently verified chain events.

## Not implemented / limitations

- SQLite-backed fixed-window throttles are applied to nonce requests and authenticated mutation requests. This is application-level protection, not a network-wide gateway limit; nonce identity uses the forwarded client address and depends on a correctly configured trusted proxy. It has not had a separate load or proxy-spoofing review.
- Hedera x402 payment execution and facilitator settlement are not implemented. A persistent tinybar budget reservation helper exists, but it is not part of a completed payment flow. The coordinator reports unavailable rather than creating a settlement; no live Mirror Node payment verification is claimed.
- There is no public ProofTrack verification portal. ProofTrack records are exposed only through authenticated application views and the implemented APIs.
- No independent security audit, penetration test, production deployment, or live escrow transaction is claimed by the repository.
- Arc escrow is not deployed/configured in the checked-in release. Local Hardhat tests use a mock ERC-20 and do not prove live Arc behavior.

## Reporting

Do not report vulnerabilities publicly with exploit details. Contact the repository maintainers privately first and include the affected revision, impact, and a minimal reproduction. Do not include private keys, API tokens, session cookies, or real user data in an issue.
