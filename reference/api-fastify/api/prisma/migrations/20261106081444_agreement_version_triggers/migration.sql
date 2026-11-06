-- Safe on a database that already has these triggers.
DROP TRIGGER IF EXISTS "AgreementVersion_terms_immutable";
DROP TRIGGER IF EXISTS "AgreementVersion_no_delete";
DROP TRIGGER IF EXISTS "AgreementVersion_client_acceptance_final";
DROP TRIGGER IF EXISTS "AgreementVersion_freelancer_acceptance_final";

-- SEC-002: agreement terms can never change once written. Prisma does not track
-- triggers, so a later migration that rebuilds AgreementVersion must recreate them.


CREATE TRIGGER "AgreementVersion_no_delete"
BEFORE DELETE ON "AgreementVersion"
BEGIN
    SELECT RAISE(ABORT, 'AgreementVersion rows cannot be deleted');
END;

-- An acceptance can be recorded once. It cannot be changed or cleared afterwards.
CREATE TRIGGER "AgreementVersion_client_acceptance_final"
BEFORE UPDATE OF "clientAcceptedAt" ON "AgreementVersion"
WHEN OLD."clientAcceptedAt" IS NOT NULL AND NEW."clientAcceptedAt" IS NOT OLD."clientAcceptedAt"
BEGIN
    SELECT RAISE(ABORT, 'An acceptance cannot be changed');
END;

CREATE TRIGGER "AgreementVersion_freelancer_acceptance_final"
BEFORE UPDATE OF "freelancerAcceptedAt" ON "AgreementVersion"
WHEN OLD."freelancerAcceptedAt" IS NOT NULL AND NEW."freelancerAcceptedAt" IS NOT OLD."freelancerAcceptedAt"
BEGIN
    SELECT RAISE(ABORT, 'An acceptance cannot be changed');
END;
