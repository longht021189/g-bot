// What the JavaScript actions share: running tools, failing the step, and
// adding one platform's files to a branch of a repository.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const maxFileSize = 100 * 1024 * 1024;

// Adds filesDir/<target>/ to the branch of gitDir's origin (one orphan commit,
// replacing what that branch had under <target>/ and keeping the rest, so one
// job per platform can each add its own), and deletes every other branch whose
// name starts with stalePrefix (e.g. "bin/"). Retries when another job pushed
// in between. Uses its own index: gitDir's checkout is left as it is.
function publish({ gitDir, filesDir, indexFile, target, branch, stalePrefix, message }) {
  for (const file of files(filesDir)) {
    const size = fs.statSync(file).size;
    if (size >= maxFileSize) fail(`${path.relative(filesDir, file)} is ${(size / 1024 / 1024).toFixed(2)} MiB, over GitHub's 100 MiB file limit`);
  }

  const ref = `refs/heads/${branch}`;
  const identity = { name: 'g-bot', email: 'g-bot@users.noreply.github.com' };
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
    stale = heads.map(([, name]) => name).filter((name) => name.startsWith(`refs/heads/${stalePrefix}`) && name !== ref);

    fs.rmSync(indexFile, { force: true });
    if (current) {
      git(['fetch', '--quiet', '--depth', '1', 'origin', ref], { cwd: filesDir, env });
      git(['read-tree', current], { cwd: filesDir, env });
      git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', target], { cwd: filesDir, env });
    }
    git(['add', '--all', '--', target], { cwd: filesDir, env });
    const tree = git(['write-tree'], { cwd: filesDir, env });
    commit = git(['commit-tree', tree, '-m', message], { cwd: filesDir, env });

    const push = tryGit(
      ['push', '--quiet', '--atomic', `--force-with-lease=${ref}:${current}`, 'origin', `${commit}:${ref}`, ...stale.map((name) => `:${name}`)],
      { cwd: filesDir, env },
    );
    if (push.status === 0) break;
    if (attempt === 5) {
      process.stderr.write(push.stderr);
      fail(`cannot push ${branch}`);
    }
    console.log(`${branch} or a stale ${stalePrefix}* branch changed while pushing, trying again`);
  }

  console.log(`Pushed ${target} to ${branch}`);
  if (stale.length > 0) console.log(`Deleted ${stale.map((name) => name.slice('refs/heads/'.length)).join(', ')}`);
  return commit;
}

module.exports = { fail, run, tryGit, git, output, files, publish };
