const fs = require('fs');
const path = require('path');
const { fail, git, output, publish } = require('../_lib/actions.js');
const { depsHash } = require('../build-vcpkg-share/build.js');
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
// vcpkg-share workflow, on vcpkg-share's deps/<hash> branch for its main as
// it is now: a change there not built yet fails here, rather than linking
// older libraries. build() runs its tools with this process's environment,
// where r-share's build.rs finds VCPKG_SHARE_PREFIX.
if (!process.env.VCPKG_SHARE_PREFIX) {
  const vcpkgShare = path.join(workDir, 'vcpkg-share');
  git(['clone', '--quiet', '--depth', '1', vcpkgShareRepository, vcpkgShare]);
  const branch = `deps/${depsHash(vcpkgShare).slice(0, 12)}`;
  if (git(['ls-remote', '--heads', vcpkgShareRepository, branch]) === '') {
    fail(`vcpkg-share has no ${branch}: run g-bot's vcpkg-share workflow with ${target}`);
  }
  const deps = path.join(workDir, 'deps');
  git(['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', '--branch', branch, vcpkgShareRepository, deps]);
  git(['-C', deps, 'sparse-checkout', 'set', target]);
  if (!fs.existsSync(path.join(deps, target, 'lib'))) fail(`vcpkg-share's ${branch} has no ${target}: run g-bot's vcpkg-share workflow with it`);
  process.env.VCPKG_SHARE_PREFIX = path.join(deps, target);
}

async function main() {
  try {
    await build(sourceDir, { steps: ['go', 'pack', 'rust'], outDir: path.join(filesDir, target) });
  } catch (error) {
    fail(error.message);
  }

  const sourceCommit = git(['-C', sourceDir, 'rev-parse', 'HEAD']);
  const branch = `bin/${sourceCommit.slice(0, 12)}`;
  const commit = publish({
    gitDir: git(['-C', sourceDir, 'rev-parse', '--absolute-git-dir']),
    filesDir,
    indexFile: path.join(workDir, 'index'),
    target,
    branch,
    stalePrefix: 'bin/',
    message: `chaos ${sourceCommit}`,
  });
  fs.rmSync(filesDir, { recursive: true, force: true });

  output('branch', branch);
  output('commit', commit);
}

main();
