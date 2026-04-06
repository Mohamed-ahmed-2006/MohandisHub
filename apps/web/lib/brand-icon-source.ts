import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves a data URL for the brand logo PNG used by dynamic icons and OG images.
 * Tries cwd as repo root or apps/web.
 */
export function getBrandLogoDataUrl(): string | null {
  try {
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, 'components', 'assets', 'mohandishub3 dark.png'),
      path.join(cwd, 'components', 'assets', 'mohandishub3 light.png'),
      path.join(cwd, 'apps', 'web', 'components', 'assets', 'mohandishub3 dark.png'),
      path.join(cwd, 'apps', 'web', 'components', 'assets', 'mohandishub3 light.png'),
      path.join(cwd, 'public', 'icon.png'),
      path.join(cwd, 'public', 'brand', 'mohandishub-email-logo.png'),
      path.join(cwd, 'apps', 'web', 'public', 'icon.png'),
      path.join(cwd, 'apps', 'web', 'public', 'brand', 'mohandishub-email-logo.png'),
    ];
    for (const file of candidates) {
      if (fs.existsSync(file)) {
        const buffer = fs.readFileSync(file);
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    }
  } catch {
    // missing fs access
  }
  return null;
}

/** Theme primary for generated imagery when no logo file exists (matches viewport / manifest). */
export const BRAND_ACCENT_HEX = '#ea580c';
