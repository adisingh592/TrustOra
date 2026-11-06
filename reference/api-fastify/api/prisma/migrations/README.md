# Prisma Migrations & SQLite Triggers (SEC-002)

## CRITICAL: AgreementVersion Immutability Triggers

The `AgreementVersion` table is protected by four SQLite database triggers that enforce cryptographic immutability:
1. `AgreementVersion_terms_immutable`: Prevents any UPDATE on `id`, `milestoneId`, `version`, `criteriaJson`, `agreementHash`, and `createdAt`.
2. `AgreementVersion_no_delete`: Prevents any DELETE on `AgreementVersion` rows.
3. `AgreementVersion_client_acceptance_final`: Ensures `clientAcceptedAt` can be set once and never altered or cleared.
4. `AgreementVersion_freelancer_acceptance_final`: Ensures `freelancerAcceptedAt` can be set once and never altered or cleared.

> **IMPORTANT WARNING FOR MIGRATIONS**:
> Prisma Migrate does NOT track SQLite database triggers. If any future migration rebuilds, renames, or recreates the `AgreementVersion` table, it will silently drop these triggers unless explicitly recreated in the migration SQL file!
> Always verify that all four triggers exist in `sqlite_master` after running migrations:
> ```sql
> SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'AgreementVersion';
> ```
