import { execSync } from 'child_process';
import fs from 'fs';
import process from 'process';
import { URL } from 'url';

function run(command) {
  console.log(`\n> ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`\n❌ Command failed: ${command}`);
    process.exit(1);
  }
}

function getApiDatabaseUrl() {
  const envPath = 'apps/api/.env';
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL=') && l.trim().length > 'DATABASE_URL='.length);
  if (!line) return null;
  return line.slice('DATABASE_URL='.length).trim();
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

console.log('🚀 Starting ship: check, build, and migrate (no git commit)...');

// 1. Check for errors (Typecheck)
console.log('\n1️⃣  Checking for errors (typecheck)...');
run('npm run typecheck');

// 2. Lint
console.log('\n2️⃣  Running lint...');
run('npm run lint');

// 3. Build npm
console.log('\n3️⃣  Building the project...');
run('npm run build');

// 4. Migrate database
console.log('\n4️⃣  Pushing database migrations...');
// Uses local DATABASE_URL when available to avoid requiring a linked Supabase project in local dev.
const dbUrl = getApiDatabaseUrl();
if (process.env.SHIP_CONFIRM !== 'YES') {
  console.error(
    '\n❌ Refusing to run migrations without explicit confirmation. Set SHIP_CONFIRM=YES and rerun.',
  );
  process.exit(1);
}
ensureSupabaseCli();
if (dbUrl) {
  console.log(`Target database: ${getDbTargetLabel(dbUrl)}`);
  run(`supabase db push --db-url "${dbUrl}"`);
} else {
  console.log('Target database: linked Supabase project (no DATABASE_URL in apps/api/.env)');
  run('supabase db push');
}

console.log('\n🎉 Ship completed: checks, build, and migrations all passed. You can now commit and push.');
