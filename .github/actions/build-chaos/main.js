const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { workDir } = require('./work.js');

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  if (result.error) {
    fail(`cannot run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited ${result.status}`);
  }
  return result;
}

function tryGit(args, options = {}) {
  const result = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
  if (result.error) {
    fail(`cannot run git: ${result.error.message}`);
  }
  return result;
}

function git(args, options = {}) {
  const result = tryGit(args, options);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    fail(`git ${args[0] === '-C' ? args[2] : args[0]} exited ${result.status}`);
  }
  return result.stdout.trim();
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  } else {
    console.log(`${name}=${value}`);
  }
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

const source = process.env.BUILD_CHAOS_SOURCE;
if (!source) fail('BUILD_CHAOS_SOURCE is required');
const sourceDir = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), source);

const targets = { 'darwin/arm64': 'darwin-arm64', 'linux/arm64': 'linux-arm64' };
const target = targets[`${process.platform}/${process.arch}`];
if (!target) fail(`chaos has no build for ${process.platform}/${process.arch} (${Object.keys(targets).join(', ')})`);

const sharedRepositories = {
  'r-share': 'https://github.com/longht021189/r-share.git',
  'c-share': 'https://github.com/longht021189/c-share.git',
};
const maxFileSize = 100 * 1024 * 1024;

fs.rmSync(workDir, { recursive: true, force: true });
const filesDir = path.join(workDir, 'files');
fs.mkdirSync(filesDir, { recursive: true });
const created = [];
const remember = (dir) => {
  created.push(dir);
  fs.writeFileSync(path.join(workDir, 'created.json'), JSON.stringify(created));
};

for (const [name, url] of Object.entries(sharedRepositories)) {
  const dir = path.join(path.dirname(sourceDir), name);
  if (fs.existsSync(dir)) fail(`${dir} already exists: ${name} is cloned there, next to the chaos checkout`);
  remember(dir);
  git(['clone', '--quiet', '--depth', '1', url, dir]);
}
const cargoConfig = path.join(sourceDir, '.cargo', 'config.toml');
if (!fs.existsSync(cargoConfig)) {
  fs.mkdirSync(path.dirname(cargoConfig), { recursive: true });
  fs.writeFileSync(cargoConfig, '[patch."https://github.com/longht021189/r-share"]\nr-share = { path = "../r-share" }\n');
}

const buildEnv = { ...process.env, OUT_DIR: path.join(filesDir, target) };
if (target === 'linux-arm64') buildEnv.VCPKG_FORCE_SYSTEM_BINARIES = '1';
if (!buildEnv.VCPKG_ROOT) {
  const vcpkg = path.join(workDir, 'vcpkg');
  git(['clone', '--quiet', '--depth', '1', 'https://github.com/microsoft/vcpkg.git', vcpkg]);
  run(path.join(vcpkg, 'bootstrap-vcpkg.sh'), ['-disableMetrics'], { env: buildEnv });
  buildEnv.VCPKG_ROOT = vcpkg;
}
run(path.join(sourceDir, 'scripts', 'build.sh'), ['go', 'pack', 'rust'], { cwd: sourceDir, env: buildEnv });

for (const file of files(filesDir)) {
  const size = fs.statSync(file).size;
  if (size >= maxFileSize) fail(`${path.relative(filesDir, file)} is ${(size / 1024 / 1024).toFixed(2)} MiB, over GitHub's 100 MiB file limit`);
}

const sourceCommit = git(['-C', sourceDir, 'rev-parse', 'HEAD']);
const branch = `bin/${sourceCommit.slice(0, 12)}`;
const ref = `refs/heads/${branch}`;
const gitDir = git(['-C', sourceDir, 'rev-parse', '--absolute-git-dir']);
const identity = { name: 'g-bot', email: 'g-bot@users.noreply.github.com' };
const indexFile = path.join(workDir, 'index');
const env = {
  ...process.env,
  GIT_DIR: gitDir,
  GIT_WORK_TREE: filesDir,
  GIT_INDEX_FILE: indexFile,
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
};

let commit = '';
let stale = [];
for (let attempt = 1; ; attempt++) {
  const heads = git(['ls-remote', '--heads', 'origin'], { cwd: filesDir, env })
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'));
  const current = (heads.find(([, name]) => name === ref) || [''])[0];
  stale = heads.map(([, name]) => name).filter((name) => name.startsWith('refs/heads/bin/') && name !== ref);

  fs.rmSync(indexFile, { force: true });
  if (current) {
    git(['fetch', '--quiet', '--depth', '1', 'origin', ref], { cwd: filesDir, env });
    git(['read-tree', current], { cwd: filesDir, env });
    git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', target], { cwd: filesDir, env });
  }
  git(['add', '--all', '--', target], { cwd: filesDir, env });
  const tree = git(['write-tree'], { cwd: filesDir, env });
  commit = git(['commit-tree', tree, '-m', `chaos ${sourceCommit}`], { cwd: filesDir, env });

  const push = tryGit(
    ['push', '--quiet', '--atomic', `--force-with-lease=${ref}:${current}`, 'origin', `${commit}:${ref}`, ...stale.map((name) => `:${name}`)],
    { cwd: filesDir, env },
  );
  if (push.status === 0) break;
  if (attempt === 5) {
    process.stderr.write(push.stderr);
    fail(`cannot push ${branch}`);
  }
  console.log(`${branch} or a stale bin/* branch changed while pushing, trying again`);
}

fs.rmSync(filesDir, { recursive: true, force: true });

console.log(`Pushed ${target} to ${branch}`);
if (stale.length > 0) console.log(`Deleted ${stale.map((name) => name.slice('refs/heads/'.length)).join(', ')}`);
output('branch', branch);
output('commit', commit);
