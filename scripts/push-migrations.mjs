import { execSync } from 'child_process';
import fs from 'fs';

const envPath = 'apps/api/.env';
if (!fs.existsSync(envPath)) {
  console.error('apps/api/.env not found');
  process.exit(1);
}
const line = fs.readFileSync(envPath, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL=') && l.trim().length > 'DATABASE_URL='.length);
if (!line) {
  console.error('DATABASE_URL not found in apps/api/.env');
  process.exit(1);
}
const url = line.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '');
console.log('Pushing migrations to database...');
execSync(`npx supabase db push --db-url "${url.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
console.log('Done.');
