import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = 'node --test test/*.test.js';
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });

if (git.status !== 0) {
  process.stderr.write(git.stderr || 'Could not read HEAD commit.\n');
  process.exit(git.status || 1);
}

const child = spawn(process.execPath, ['--test', 'test/*.test.js'], { cwd: root });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });

const exitCode = await new Promise((resolveExit, reject) => {
  child.once('error', reject);
  child.once('close', resolveExit);
});

process.stdout.write(stdout);
process.stderr.write(stderr);

const readCount = (name) => {
  const match = stdout.match(new RegExp(`^(?:# |ℹ )${name} (\\d+)$`, 'm'));
  if (!match) throw new Error(`Node test output is missing the "${name}" count.`);
  return Number(match[1]);
};

const counts = {
  tests: readCount('tests'),
  passed: readCount('pass'),
  failed: readCount('fail'),
  todo: readCount('todo'),
  skipped: readCount('skipped'),
};

const report = [
  'Vespi Kernel suite result',
  `Date (UTC): ${new Date().toISOString()}`,
  `Package version: ${packageJson.version}`,
  `Node version: ${process.version}`,
  `Git baseline SHA: ${git.stdout.trim()}`,
  'The tests run against the current working tree; the baseline SHA alone does not identify uncommitted candidate changes.',
  `Command: ${command}`,
  `Tests: ${counts.tests}`,
  `Passed: ${counts.passed}`,
  `Failed: ${counts.failed}`,
  `Todo: ${counts.todo}`,
  `Skipped: ${counts.skipped}`,
  '',
].join('\n');

await writeFile(resolve(root, `docs/SUITE_RESULT_${packageJson.version}.txt`), report, 'utf8');
process.exitCode = exitCode ?? 1;
