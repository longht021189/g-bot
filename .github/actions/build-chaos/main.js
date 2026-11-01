const fs = require('fs');
const path = require('path');
const { fail, git, output, publish } = require('../_lib/actions.js');
const { depsHash, depsHashOf } = require('../build-vcpkg-share/build.js');
const { build, hostTarget } = require('./build.js');
const { workDir } = require('./work.js');

const source = process.env.BUILD_CHAOS_SOURCE;
if (!source) fail('BUILD_CHAOS_SOURCE is required');
const sourceDir = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), source);

let target;
try {
  target = hostTarget();
} catch (error) {
  fail(error.message);
}

const sharedRepositories = {
  'r-share': 'https://github.com/longht021189/r-share.git',
  'c-share': 'https://github.com/longht021189/c-share.git',
};
const vcpkgShareRepository = 'https://github.com/longht021189/vcpkg-share.git';

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

// c-share's vcpkg dependencies, prebuilt for this platform by g-bot's
// vcpkg-share workflow, on vcpkg-share's deps branch -- if built from
// vcpkg-share's main as it is now (the deps hash its commit message names): a
// change there not built yet fails here, rather than linking older libraries.
// build() runs its tools with this process's environment, where r-share's
// build.rs finds VCPKG_SHARE_PREFIX.
if (!process.env.VCPKG_SHARE_PREFIX) {
  const rerun = `run g-bot's vcpkg-share workflow with ${target}`;
  const vcpkgShare = path.join(workDir, 'vcpkg-share');
  git(['clone', '--quiet', '--depth', '1', vcpkgShareRepository, vcpkgShare]);
  const hash = depsHash(vcpkgShare);
  if (git(['ls-remote', '--heads', vcpkgShareRepository, 'deps']) === '') fail(`vcpkg-share has no deps branch: ${rerun}`);
  const deps = path.join(workDir, 'deps');
  git(['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', 'deps', vcpkgShareRepository, deps]);
  const built = depsHashOf(git(['-C', deps, 'log', '-1', '--format=%B']));
  if (built !== hash) fail(`vcpkg-share's deps is built from ${built || 'an unknown hash'}, its main is ${hash}: ${rerun}`);
  git(['-C', deps, 'sparse-checkout', 'set', target]);
  if (!fs.existsSync(path.join(deps, target, 'lib'))) fail(`vcpkg-share's deps has no ${target}: ${rerun}`);
  process.env.VCPKG_SHARE_PREFIX = path.join(deps, target);
}

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
