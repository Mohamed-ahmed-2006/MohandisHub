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

const sourceMojibakePatterns = ['Ã', 'Â', 'â', '�', 'Ø', 'Ù'];
const sourceRoots = [
  path.join(repoRoot, 'apps/web/components'),
  path.join(repoRoot, 'apps/web/app'),
  path.join(repoRoot, 'apps/web/lib'),
  path.join(repoRoot, 'apps/api/src'),
  path.join(repoRoot, 'packages/shared/src'),
];
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      files.push(...walk(full));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

for (const file of sourceRoots.flatMap(walk)) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of sourceMojibakePatterns) {
    if (content.includes(pattern)) {
      throw new Error(
        `Detected possible encoding corruption pattern "${pattern}" in ${path.relative(repoRoot, file)}.`,
      );
    }
  }
}

console.log('i18n validation passed.');
