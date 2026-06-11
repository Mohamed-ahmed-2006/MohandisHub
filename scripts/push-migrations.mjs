import { execSync } from 'child_process';
import fs from 'fs';

const envPath = 'apps/api/.env';
if (!fs.existsSync(envPath)) {
  console.error('apps/api/.env not found');
  process.exit(1);
}
const line = fs
  .readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL=') && l.trim().length > 'DATABASE_URL='.length);
if (!line) {
  console.error('DATABASE_URL not found in apps/api/.env');
  process.exit(1);
}
const url = line
  .slice('DATABASE_URL='.length)
  .trim()
  .replace(/^['"]|['"]$/g, '');
const confirmation = process.env.CONFIRM_PRODUCTION_MIGRATION;
const looksProduction = /mohandishub|prod|production/i.test(url);

if (looksProduction && confirmation !== 'I_UNDERSTAND_RUN_PRODUCTION_MIGRATIONS') {
  console.error('Refusing to push migrations to a production-looking database URL.');
  console.error(
    'Set CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_RUN_PRODUCTION_MIGRATIONS after taking a backup.',
  );
  process.exit(1);
}

console.log('Pushing migrations to database...');
try {
  execSync('supabase --version', { stdio: 'ignore' });
} catch {
  console.error(
    'Supabase CLI is not installed. Install it from https://github.com/supabase/cli before pushing migrations.',
  );
  process.exit(1);
}
execSync(`supabase db push --db-url "${url.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
console.log('Done.');
