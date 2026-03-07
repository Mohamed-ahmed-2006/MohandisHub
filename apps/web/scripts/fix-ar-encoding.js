import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const filePath = path.join(__dirname, '..', 'lib/i18n/dictionaries/ar.ts');
let content = fs.readFileSync(filePath, 'utf8');

function decode(str) {
  try {
    return Buffer.from(str, 'latin1').toString('utf8');
  } catch {
    return str;
  }
}

// Only decode if string looks like mojibake (has Latin-1 chars used in UTF-8 misinterpretation)
// and does NOT already contain real Arabic (U+0600-U+06FF)
function looksLikeMojibake(s) {
  if (!/[ØÙ]/.test(s)) return false;
  if (/[\u0600-\u06FF]/.test(s)) return false; // already has Arabic
  if (/\\u[0-9a-fA-F]{4}/.test(s)) return false; // unicode escape
  return true;
}
content = content.replace(/'([^']*)'/g, (full, s) => {
  if (looksLikeMojibake(s)) {
    return "'" + decode(s) + "'";
  }
  return full;
});

fs.writeFileSync(filePath, content);
console.log('Decoded ar.ts');
