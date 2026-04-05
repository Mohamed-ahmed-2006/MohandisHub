import fs from 'node:fs';
import path from 'node:path';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

/** Delete a file from local `uploads/` by basename only (same safety rules as public-uploads middleware). */
export function deleteLocalUploadBasenameIfExists(basename: string): boolean {
  const safe = path.basename(basename);
  if (safe !== basename || !safe || safe === '.' || safe === '..') {
    return false;
  }
  const localPath = path.join(UPLOAD_DIR, safe);
  const resolvedLocal = path.resolve(localPath);
  const resolvedDir = path.resolve(UPLOAD_DIR);
  if (!resolvedLocal.startsWith(resolvedDir + path.sep) && resolvedLocal !== resolvedDir) {
    return false;
  }
  try {
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}
