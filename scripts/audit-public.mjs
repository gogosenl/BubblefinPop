import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const issues = [];
const forbiddenPaths = [
  /(^|\/)(node_modules|\.expo|dist|coverage|outputs|work)(\/|$)/i,
  /\.(?:env|pem|p8|p12|key|jks|keystore|mobileprovision|ipa|apk|aab|zip)$/i,
  /(?:credentials|service-account).*\.json$/i,
  /(?:GoogleService-Info\.plist|google-services\.json)$/i,
];
const secretPatterns = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /expo_[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}/i,
  /[A-Za-z]:\\Users\\[^\\]+\\/i,
];
const textExtensions = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.txt', '.yml', '.yaml',
  '.toml', '.xml', '.plist', '.gradle', '.properties', '.sh', '.ps1', '.py', '.gitignore',
]);

for (const relativePath of tracked) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (forbiddenPaths.some(pattern => pattern.test(normalized))) {
    issues.push(`${normalized}: forbidden public-repository file`);
    continue;
  }
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
  if (fs.statSync(absolutePath).size > 10 * 1024 * 1024) {
    issues.push(`${normalized}: tracked file exceeds 10 MB`);
  }
  const extension = path.extname(relativePath).toLowerCase() || path.basename(relativePath).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const content = fs.readFileSync(absolutePath, 'utf8');
  if (secretPatterns.some(pattern => pattern.test(content))) {
    issues.push(`${normalized}: possible secret or personal absolute path`);
  }
}

if (issues.length) {
  console.error(`FAILED: ${issues.length} public-repository hygiene issue(s)`);
  issues.forEach(issue => console.error(`- ${issue}`));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${tracked.length} publishable files contain no known secrets, credentials, build archives, or personal absolute paths.`);
}
