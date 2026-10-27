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

function git(args, options = {}) {
  const result = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
  if (result.error) {
    fail(`cannot run git: ${result.error.message}`);
  }
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

const source = process.env.BUILD_CHAOS_SOURCE;
if (!source) fail('BUILD_CHAOS_SOURCE is required');
const sourceDir = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), source);

const targets = (process.env.BUILD_CHAOS_TARGETS || 'linux/arm64 darwin/arm64')
  .split(/\s+/)
  .filter(Boolean)
  .map((target) => {
    const [goos, goarch, rest] = target.split('/');
    if (!goos || !goarch || rest !== undefined) fail(`BUILD_CHAOS_TARGETS: expected <goos>/<goarch>, got ${target}`);
    return { goos, goarch };
  });
if (targets.length === 0) fail('BUILD_CHAOS_TARGETS names no target');

fs.rmSync(workDir, { recursive: true, force: true });
const filesDir = path.join(workDir, 'files');
fs.mkdirSync(filesDir, { recursive: true });

for (const { goos, goarch } of targets) {
  run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(filesDir, `chaos-${goos}-${goarch}`), './cmd/chaos'], {
    cwd: sourceDir,
    env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-buildvcs=false', GOOS: goos, GOARCH: goarch },
  });
}

const sourceCommit = git(['-C', sourceDir, 'rev-parse', 'HEAD']);
const branch = `bin/${sourceCommit.slice(0, 12)}`;
const gitDir = git(['-C', sourceDir, 'rev-parse', '--absolute-git-dir']);
const identity = { name: 'g-bot', email: 'g-bot@users.noreply.github.com' };
const env = {
  ...process.env,
  GIT_DIR: gitDir,
  GIT_WORK_TREE: filesDir,
  GIT_INDEX_FILE: path.join(workDir, 'index'),
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: identity.name,
  GIT_COMMITTER_EMAIL: identity.email,
};

git(['add', '--all', '.'], { cwd: filesDir, env });
const tree = git(['write-tree'], { cwd: filesDir, env });
const commit = git(['commit-tree', tree, '-m', `chaos ${sourceCommit}`], { cwd: filesDir, env });

const stale = git(['ls-remote', '--heads', 'origin'], { cwd: filesDir, env })
  .split('\n')
  .map((line) => line.split('\t')[1])
  .filter((ref) => ref && ref.startsWith('refs/heads/bin/') && ref !== `refs/heads/${branch}`);
git(['push', '--quiet', '--atomic', 'origin', `+${commit}:refs/heads/${branch}`, ...stale.map((ref) => `:${ref}`)], {
  cwd: filesDir,
  env,
});

fs.rmSync(workDir, { recursive: true, force: true });

console.log(`Pushed ${targets.map(({ goos, goarch }) => `chaos-${goos}-${goarch}`).join(', ')} to ${branch}`);
if (stale.length > 0) console.log(`Deleted ${stale.map((ref) => ref.slice('refs/heads/'.length)).join(', ')}`);
output('branch', branch);
output('commit', commit);
