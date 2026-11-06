-- SEC-002: agreement terms can never change once written. The previous migration
-- was committed without this trigger. Safe on a database that already has it.
DROP TRIGGER IF EXISTS "AgreementVersion_terms_immutable";

CREATE TRIGGER "AgreementVersion_terms_immutable"
BEFORE UPDATE OF "id", "milestoneId", "version", "criteriaJson", "agreementHash", "createdAt" ON "AgreementVersion"
BEGIN
    SELECT RAISE(ABORT, 'AgreementVersion terms are immutable');
END;
