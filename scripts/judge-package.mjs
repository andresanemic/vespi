import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs', 'JUDGE_PACKAGE.json');
const DIRECTORIES = ['src', 'docs', 'demo', 'scripts'];
const PROJECT_REPOSITORIES = [
  { name: 'Queen', url: 'https://github.com/andresanemic/queen', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Casa Firme', url: 'https://github.com/andresanemic/casa-firme', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Ficha Contigo', url: 'https://github.com/andresanemic/ficha-contigo', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Cátedra', url: 'https://github.com/andresanemic/catedra', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Escribano', url: 'https://github.com/andresanemic/escribano', status: 'public repository link in README; availability was not checked by this offline script' },
  { name: 'Llavero', url: 'https://github.com/andresanemic/llavero', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Farolero', url: 'https://github.com/andresanemic/farolero', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Marea', url: 'https://github.com/andresanemic/marea', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'Vela', url: 'https://github.com/andresanemic/vela', status: 'public project repository; code and tests listed in the kernel README' },
  { name: 'TEMIS', url: 'https://github.com/andresanemic/temis', status: 'public project repository; code and tests listed in the kernel README' },
];

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function parseTestCounts(tap) {
  const read = (name) => {
    const match = tap.match(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  const counts = { tests: read('tests'), passed: read('pass'), failed: read('fail') };
  if (Object.values(counts).some((value) => value === null)) {
    throw new Error('Node test runner output did not contain complete TAP counts');
  }
  return counts;
}

async function listFiles(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, base));
    else if (entry.isFile()) files.push(path.relative(ROOT, fullPath).split(path.sep).join('/'));
  }
  return files;
}

async function fileHashes() {
  const files = (await Promise.all(DIRECTORIES.map((dir) => listFiles(path.join(ROOT, dir)))))
    .flat()
    .sort();
  const hashes = {};
  for (const relativePath of files) {
    if (relativePath === 'docs/JUDGE_PACKAGE.json') continue;
    hashes[relativePath] = sha256(await readFile(path.join(ROOT, relativePath)));
  }
  return hashes;
}

function currentCommit() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function runKernelSuite() {
  const tests = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...await testFiles()], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (tests.status !== 0) throw new Error(`Kernel suite failed:\n${tests.stdout}\n${tests.stderr}`);
  return parseTestCounts(tests.stdout);
}

async function testFiles() {
  // Keep the reported suite identical to the documented test/*.test.js command.
  const names = await readdir(path.join(ROOT, 'test'));
  return names.filter((name) => name.endsWith('.test.js')).sort().map((name) => path.join('test', name));
}

export async function buildPackage({ counts, commit = currentCommit() } = {}) {
  counts ??= await runKernelSuite();
  const packageJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const hashes = await fileHashes();
  const payload = {
    schemaVersion: 1,
    generatedBy: 'node scripts/judge-package.mjs',
    packageVersion: packageJson.version,
    gitCommit: commit,
    fileHashes: hashes,
    excludedPaths: ['**/node_modules/**', '**/.git/**'],
    tests: { command: 'node --test test/*.test.js', ...counts },
    publicProjectRepositories: PROJECT_REPOSITORIES,
    hashNote: 'Ordinary hashes use SHA-256 over exact bytes. Generated dependencies under node_modules and Git metadata under .git are excluded. The docs/JUDGE_PACKAGE.json hash and manifestSelfHash use SHA-256 over this JSON after removing both manifestSelfHash and fileHashes["docs/JUDGE_PACKAGE.json"], to avoid a self-referential hash.',
  };
  const manifestSelfHash = sha256(`${JSON.stringify(payload, null, 2)}\n`);
  payload.fileHashes['docs/JUDGE_PACKAGE.json'] = manifestSelfHash;
  payload.manifestSelfHash = manifestSelfHash;
  return payload;
}

async function main() {
  const report = await buildPackage();
  const output = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(OUTPUT, output, 'utf8');
  process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
