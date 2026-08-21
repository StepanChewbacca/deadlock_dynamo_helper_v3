import fs from 'node:fs';
import path from 'node:path';

const workflowDir = path.resolve('.github/workflows');
const errors = [];
for (const name of fs.existsSync(workflowDir) ? fs.readdirSync(workflowDir) : []) {
  if (!/\.ya?ml$/i.test(name)) continue;
  const filePath = path.join(workflowDir, name);
  const text = fs.readFileSync(filePath, 'utf8');
  const normalized = text.replace(/\r\n/g, '\n');
  const hasPullRequest = /^\s*pull_request\s*:/m.test(normalized);
  const hasSelfHosted = /runs-on\s*:\s*[^\n]*self-hosted/i.test(normalized)
    || /runs-on\s*:\s*\[[^\]]*self-hosted/i.test(normalized);
  if (hasPullRequest && hasSelfHosted) {
    errors.push(`${name}: pull_request workflow must not execute on self-hosted runner`);
  }
  if (/^\s*pull_request_target\s*:/m.test(normalized)) {
    errors.push(`${name}: pull_request_target is forbidden for recommendation workflows`);
  }
  if (/permissions\s*:\s*write-all/i.test(normalized)) {
    errors.push(`${name}: write-all GITHUB_TOKEN permission is forbidden`);
  }
  if (/docker\s+compose[^\n]*--env-file\s+\.env[^\n]*\sconfig(?:\s|$)(?![^\n]*--no-interpolate)/i.test(normalized)) {
    errors.push(`${name}: expanded docker compose config may materialize .env secrets`);
  }
}

if (errors.length > 0) {
  console.error('recommendation security audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('recommendation security audit: PASS');
