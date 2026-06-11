const fs = require('fs');
const path = require('path');

function checkDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach((f) => {
    const fullPath = path.join(dir, f);
    if (fs.statSync(fullPath).isDirectory()) {
      if (f !== 'node_modules' && f !== '.next' && f !== '.git' && f !== 'dist') {
        checkDir(fullPath);
      }
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const importRegex = /from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          const resolvedDir = path.resolve(dir, importPath);
          const parentDir = path.dirname(resolvedDir);
          const baseName = path.basename(resolvedDir);
          if (fs.existsSync(parentDir)) {
            const actualFiles = fs.readdirSync(parentDir);

            // Exact match?
            let hasExact = false;
            let hasCaseInsensitive = false;
            let matchedName = '';

            for (const af of actualFiles) {
              const withoutExt = af.replace(/\.(ts|tsx|js|jsx)$/, '');
              if (withoutExt === baseName) {
                hasExact = true;
              }
              if (withoutExt.toLowerCase() === baseName.toLowerCase()) {
                hasCaseInsensitive = true;
                matchedName = af;
              }
            }

            if (!hasExact && hasCaseInsensitive) {
              console.log(
                'Case mismatch in',
                fullPath,
                'Import:',
                importPath,
                'Actual file:',
                matchedName,
              );
            }
          }
        }
      }
    }
  });
}

console.log('Checking for case mismatches...');
checkDir('.');
console.log('Done');
