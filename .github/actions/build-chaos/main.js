const fs = require('fs');
const path = require('path');
const { fail, git, output, publish } = require('../_lib/actions.js');
const { depsHashOf } = require('../build-vcpkg-share/build.js');
const { build, hostTarget } = require('./build.js');
const { workDir } = require('./work.js');

// Checkouts, relative to $GITHUB_WORKSPACE: chaos (with r-share and c-share
// next to it), and vcpkg-share's deps branch.
const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
function checkout(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return path.resolve(workspace, value);
}
const sourceDir = checkout('BUILD_CHAOS_SOURCE');
const depsDir = checkout('BUILD_CHAOS_DEPS');

let target;
try {
  target = hostTarget();
} catch (error) {
  fail(error.message);
}

for (const name of ['r-share', 'c-share']) {
  const dir = path.join(path.dirname(sourceDir), name);
  if (!fs.existsSync(dir)) fail(`no ${name} at ${dir}: check it out next to the chaos checkout`);
}
const cargoConfig = path.join(sourceDir, '.cargo', 'config.toml');
if (!fs.existsSync(cargoConfig)) {
  fs.mkdirSync(path.dirname(cargoConfig), { recursive: true });
  fs.writeFileSync(cargoConfig, '[patch."https://github.com/longht021189/r-share"]\nr-share = { path = "../r-share" }\n');
}

// c-share's vcpkg dependencies, prebuilt for this platform by vcpkg-share's
// deps workflow (on every push to its main), taken as they are. build() runs
// its tools with this process's environment, where r-share's build.rs finds
// VCPKG_SHARE_PREFIX.
if (!fs.existsSync(path.join(depsDir, target, 'lib'))) fail(`vcpkg-share's deps has no ${target}: run vcpkg-share's deps workflow with it`);
console.log(`vcpkg-share's deps ${depsHashOf(git(['-C', depsDir, 'log', '-1', '--format=%B'])) || '(no deps hash)'}`);
process.env.VCPKG_SHARE_PREFIX = path.join(depsDir, target);

fs.rmSync(workDir, { recursive: true, force: true });
const filesDir = path.join(workDir, 'files');
fs.mkdirSync(filesDir, { recursive: true });

async function main() {
  try {
    await build(sourceDir, { steps: ['go', 'pack', 'rust'], outDir: path.join(filesDir, target) });
  } catch (error) {
    fail(error.message);
  }

  // One branch, bin, whose commit message names the chaos commit built: the
  // other platform already there is kept only if built from the same one.
  // (stalePrefix: the bin/<commit> branches this replaced.)
  const sourceCommit = git(['-C', sourceDir, 'rev-parse', 'HEAD']);
  const branch = 'bin';
  const commit = publish({
    gitDir: git(['-C', sourceDir, 'rev-parse', '--absolute-git-dir']),
    filesDir,
    indexFile: path.join(workDir, 'index'),
    target,
    branch,
    stalePrefix: 'bin/',
    keep: (message) => /^chaos ([0-9a-f]{40})$/m.exec(message)?.[1] === sourceCommit,
    message: `chaos ${sourceCommit}\n`,
  });
  fs.rmSync(filesDir, { recursive: true, force: true });

  output('source-commit', sourceCommit);
  output('commit', commit);
}

main();
