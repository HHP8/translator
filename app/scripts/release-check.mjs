import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
const patterns = [
  /\bsk-(?!test-only-)[A-Za-z0-9_-]{20,}/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /[A-Z]:[\\/]Users[\\/][^\s"']+/i,
];
for (const name of names) {
  if (/(^|\/)\.env(?:\.|$)/.test(name) && !name.endsWith('/.env.example')) failures.push(`Local environment file: ${name}`);
  if (/(^|\/)(?:node_modules|dist|\.git|\.key-setup|test-results|playwright-report)\//.test(name) || /\.(?:log|pid)$/.test(name)) failures.push(`Generated or local file: ${name}`);
  const content = fs.readFileSync(path.join(root, name), 'utf8');
  if (patterns.some(pattern => pattern.test(content))) failures.push(`Potential private material: ${name}`);
}
for (const required of ['LICENSE', 'README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md', 'app/.env.example']) {
  if (!names.includes(required)) failures.push(`Missing release file: ${required}`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'app/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'app/package-lock.json'), 'utf8'));
if (pkg.version !== '0.1.0' || lock.version !== pkg.version || lock.packages[''].version !== pkg.version || pkg.license !== 'MIT') failures.push('Version/license metadata mismatch');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Public-source preflight passed: ${names.length} files, version ${pkg.version}, MIT, no detected private material.`);
