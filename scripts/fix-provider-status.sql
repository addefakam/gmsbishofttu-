-- ============================================================================
-- fix-provider-status.sql
-- ----------------------------------------------------------------------------
-- One-shot SQL fix for the recurring Prisma error:
--   "operator does not exist: text = \"ProviderStatus\"" (SQLSTATE 42883)
--
-- ROOT CAUSE
-- The Provider.status column in Postgres is type TEXT, but the Prisma schema
-- (prisma/schema.prisma) declares it as the ProviderStatus enum. When Prisma
-- runs e.g. `db.provider.count({ where: { status: "APPROVED" } })`, it emits
--   WHERE "Provider"."status" = $1::"ProviderStatus"
-- but the column is TEXT — Postgres has no `=` operator between TEXT and
-- ProviderStatus, so it errors out.
--
-- This script converts the column from TEXT to the proper enum type IN-PLACE.
-- Idempotent — safe to run multiple times. Also fixes User.role (same issue).
--
-- USAGE
--   psql "$DATABASE_URL" -f scripts/fix-provider-status.sql
-- or
--   psql "postgresql://user:pass@host:5432/db?sslmode=require" \
--       -f scripts/fix-provider-status.sql
--
-- After running this, the in-app guard in src/lib/ensure-provider-enum.ts
-- becomes a no-op (it checks the column type and skips if already enum).
-- ============================================================================

\echo '=== Step 1: Create enum types (idempotent) ==='
DO $$ BEGIN
  CREATE TYPE "ProviderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('POLICE','SUPERUSER','OPERATOR','STAFF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


\echo '=== Step 2: Pre-flight check — current state of Provider.status ==='
SELECT
  table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Provider'
  AND column_name = 'status';


\echo '=== Step 3: Normalize bad values in Provider.status to PENDING ==='
-- This must happen BEFORE the ALTER COLUMN TYPE — otherwise invalid values
-- (NULL, '', 'foo') will make the USING clause fail.
UPDATE "Provider"
SET "status" = 'PENDING'
WHERE "status" IS NULL
   OR "status"::text NOT IN ('PENDING','APPROVED','REJECTED','SUSPENDED');


\echo '=== Step 4: Convert Provider.status from TEXT to ProviderStatus enum ==='
ALTER TABLE "Provider"
  ALTER COLUMN "status" TYPE "ProviderStatus"
  USING "status"::"ProviderStatus";

ALTER TABLE "Provider"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "Provider"
  ALTER COLUMN "status" SET NOT NULL;


\echo '=== Step 5: Convert User.role from TEXT to UserRole enum ==='
DO $$
BEGIN
  -- Only run if the User.role column exists and is currently text/varchar.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = 'role'
      AND data_type IN ('text', 'character varying')
  ) THEN
    UPDATE "User"
    SET "role" = 'STAFF'
    WHERE "role" IS NULL
       OR "role"::text NOT IN ('POLICE','SUPERUSER','OPERATOR','STAFF');

    ALTER TABLE "User"
      ALTER COLUMN "role" TYPE "UserRole"
      USING "role"::"UserRole";

    RAISE NOTICE 'User.role converted to UserRole enum.';
  ELSE
    RAISE NOTICE 'User.role is already enum-typed or column missing — skipping.';
  END IF;
END $$;


\echo '=== Step 6: Verify the fix ==='
SELECT
  table_name, column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'Provider' AND column_name = 'status')
       OR (table_name = 'User' AND column_name = 'role'))
ORDER BY table_name;

-- Expected output:
--  table_name | column_name |   data_type   |   udt_name
-- ------------+-------------+---------------+-----------------
--  Provider   | status      | USER-DEFINED | ProviderStatus
--  User       | role        | USER-DEFINED | UserRole
--
-- If you see `data_type=USER-DEFINED` for both rows, you're done.
-- Subsequent `prisma.provider.count({ where: { status: "APPROVED" } })`
-- will succeed.

\echo '=== Done. ==='
