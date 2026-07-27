import { spawnSync } from 'node:child_process';

const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim();
const deploymentEnv = process.env.MIGRATION_DEPLOYMENT_ENV?.trim();
const confirmation = process.env.MIGRATION_CONFIRM?.trim();
const projectRef = process.env.NON_PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();

if (
  !databaseUrl ||
  deploymentEnv !== 'staging' ||
  confirmation !== 'MIGRATE_DEDICATED_STAGING' ||
  !projectRef
) {
  console.error(
    'Refusing migration. Provide MIGRATION_DATABASE_URL, MIGRATION_DEPLOYMENT_ENV=staging, ' +
      'MIGRATION_CONFIRM=MIGRATE_DEDICATED_STAGING, and NON_PRODUCTION_SUPABASE_PROJECT_REF.',
  );
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch {
  console.error('MIGRATION_DATABASE_URL is invalid.');
  process.exit(1);
}

if (
  !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
  !parsed.hostname.toLowerCase().includes(projectRef) ||
  /(^|[.-])(prod|production)([.-]|$)/i.test(parsed.hostname)
) {
  console.error('Migration target does not match the dedicated non-production Supabase project.');
  process.exit(1);
}

const command = spawnSync('supabase', ['db', 'push', '--db-url', databaseUrl], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(command.status ?? 1);
