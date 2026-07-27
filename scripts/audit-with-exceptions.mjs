import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(
  readFileSync(resolve(root, 'docs/SECURITY_AUDIT_EXCEPTIONS.json'), 'utf8'),
);
const exception = policy.exceptions.find((entry) => entry.id === 'NEXT-15-TRANSITIVE-2026-07');
if (!exception) throw new Error('Required dependency-audit exception is missing.');

const expiry = new Date(`${exception.expiresOn}T23:59:59.999Z`);
if (!Number.isFinite(expiry.getTime()) || expiry.getTime() < Date.now()) {
  throw new Error(`Dependency-audit exception ${exception.id} is expired.`);
}

const nextPackage = JSON.parse(
  readFileSync(resolve(root, 'node_modules/next/package.json'), 'utf8'),
);
if (nextPackage.version !== exception.requiredNextVersion) {
  throw new Error(
    `Dependency-audit exception applies only to Next ${exception.requiredNextVersion}; found ${nextPackage.version}.`,
  );
}

const nextConfig = readFileSync(resolve(root, 'apps/web/next.config.ts'), 'utf8');
if (!/images:\s*\{[\s\S]*?unoptimized:\s*true/.test(nextConfig)) {
  throw new Error('Sharp exception requires Next image optimization to remain disabled.');
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error('npm_execpath is required to run the dependency audit safely.');
}
const audit = spawnSync(process.execPath, [npmCli, 'audit', '--omit=dev', '--json'], {
  cwd: root,
  encoding: 'utf8',
});
if (audit.error) {
  throw audit.error;
}
if (!audit.stdout?.trim()) {
  throw new Error(audit.stderr || 'npm audit did not return JSON.');
}
const report = JSON.parse(audit.stdout);
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
if (vulnerabilities.length === 0) {
  console.log('Dependency audit passed with no production vulnerabilities.');
  process.exit(0);
}

const allowedPackages = new Set(exception.packages);
const allowedSources = new Set(exception.advisorySources);
for (const vulnerability of vulnerabilities) {
  if (!allowedPackages.has(vulnerability.name)) {
    throw new Error(`Unapproved production vulnerability: ${vulnerability.name}.`);
  }
  if (vulnerability.severity === 'critical') {
    throw new Error(`Critical vulnerability cannot be excepted: ${vulnerability.name}.`);
  }
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'string') {
      if (!allowedPackages.has(via)) {
        throw new Error(`Unapproved inherited vulnerability: ${vulnerability.name} via ${via}.`);
      }
    } else if (!allowedSources.has(via.source)) {
      throw new Error(
        `Unapproved advisory ${via.source} affects production package ${vulnerability.name}.`,
      );
    }
  }
}

console.log(
  `Dependency audit passed under ${exception.id}; owner=${exception.owner}; expires=${exception.expiresOn}.`,
);
