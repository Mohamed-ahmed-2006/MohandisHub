import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const enPath = path.join(repoRoot, 'apps/web/lib/i18n/dictionaries/en.ts');
const arPath = path.join(repoRoot, 'apps/web/lib/i18n/dictionaries/ar.ts');

const en = fs.readFileSync(enPath, 'utf8');
const ar = fs.readFileSync(arPath, 'utf8');

const requiredSnippets = [
  'onboarding: {',
  'craftsman:',
  'chatPage:',
  'supportPage:',
  'verification:',
  'joinAsCraftsman',
  'kycRequirementsHint',
];

for (const snippet of requiredSnippets) {
  if (!en.includes(snippet)) {
    throw new Error(`Missing required i18n snippet in en dictionary: ${snippet}`);
  }
  if (!ar.includes(snippet)) {
    throw new Error(`Missing required i18n snippet in ar dictionary: ${snippet}`);
  }
}

const mojibakePatterns = ['â€”', 'Ã', 'ï¿½', '�'];
for (const p of mojibakePatterns) {
  if (en.includes(p) || ar.includes(p)) {
    throw new Error(`Detected encoding corruption pattern "${p}" in dictionaries.`);
  }
}

console.log('i18n validation passed.');
