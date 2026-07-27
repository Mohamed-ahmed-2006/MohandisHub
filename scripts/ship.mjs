import { execSync } from 'child_process';
import process from 'process';
import { URL } from 'url';

function run(command) {
  console.log(`\n> ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`\nCommand failed: ${command}`);
    process.exit(1);
  }
}

function getDbTargetLabel(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return 'unknown-database-target';
  }
}

function ensureSupabaseCli() {
  try {
    execSync('supabase --version', { stdio: 'ignore' });
  } catch {
    console.error(
      '\nSupabase CLI is not installed. Install it from https://github.com/supabase/cli before running ship.',
    );
    process.exit(1);
  }
}

const shouldMigrate = process.argv.includes('--migrate');

console.log(
  `Starting release validation${shouldMigrate ? ' with an explicit staging migration' : ''}...`,
);

// 1. Check for errors (Typecheck)
console.log('\n1. Checking for errors (typecheck)...');
run('npm run typecheck');

// 2. Lint
console.log('\n2. Running lint...');
run('npm run lint');

// 3. Build npm
console.log('\n3. Building the project...');
run('npm run build');

if (shouldMigrate) {
  console.log('\n4. Pushing migrations to the explicitly selected staging database...');
  const dbUrl = process.env.SHIP_DATABASE_URL?.trim();
  if (
    process.env.SHIP_CONFIRM !== 'MIGRATE_DEDICATED_STAGING' ||
    process.env.SHIP_DEPLOYMENT_ENV !== 'staging' ||
    !dbUrl
  ) {
    console.error(
      '\nRefusing migration. --migrate requires SHIP_CONFIRM=MIGRATE_DEDICATED_STAGING, SHIP_DEPLOYMENT_ENV=staging, and SHIP_DATABASE_URL.',
    );
    process.exit(1);
  }
  const target = new URL(dbUrl);
  if (
    ['localhost', '127.0.0.1', '::1'].includes(target.hostname) ||
    target.hostname === 'mohandishub.app' ||
    target.hostname.endsWith('.mohandishub.app')
  ) {
    console.error('\nSHIP_DATABASE_URL must identify a dedicated remote staging database.');
    process.exit(1);
  }
  const projectRef = process.env.NON_PRODUCTION_SUPABASE_PROJECT_REF?.trim().toLowerCase();
  if (
    target.hostname.includes('supabase') &&
    (!projectRef || !dbUrl.toLowerCase().includes(projectRef))
  ) {
    console.error(
      '\nSupabase staging migrations require a matching NON_PRODUCTION_SUPABASE_PROJECT_REF.',
    );
    process.exit(1);
  }
  ensureSupabaseCli();
  console.log(`Target staging database: ${getDbTargetLabel(dbUrl)}`);
  process.env.MIGRATION_DATABASE_URL = dbUrl;
  process.env.MIGRATION_DEPLOYMENT_ENV = 'staging';
  process.env.MIGRATION_CONFIRM = 'MIGRATE_DEDICATED_STAGING';
  run('node scripts/push-migrations.mjs');
} else {
  console.log('\n4. Migration skipped (validation-only default).');
}

console.log('\nRelease validation completed.');
