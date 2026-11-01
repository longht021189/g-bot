const fs = require('fs');
const path = require('path');
const { fail, git, output, publish } = require('../_lib/actions.js');
const { build, depsHashOf, depsMessage } = require('./build.js');
const { workDir } = require('./work.js');

const source = process.env.BUILD_VCPKG_SHARE_SOURCE;
if (!source) fail('BUILD_VCPKG_SHARE_SOURCE is required');
const platform = process.env.BUILD_VCPKG_SHARE_PLATFORM;
if (!platform) fail('BUILD_VCPKG_SHARE_PLATFORM is required');
const sourceDir = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), source);

fs.rmSync(workDir, { recursive: true, force: true });
const filesDir = path.join(workDir, 'files');
fs.mkdirSync(filesDir, { recursive: true });

let hash;
try {
  hash = build(sourceDir, { platforms: [platform], outDir: filesDir });
} catch (error) {
  fail(error.message);
}

// One branch, deps: the other platforms already there are kept only if they
// were built from the same hash. (stalePrefix: the deps/<hash> branches this
// replaced.)
const branch = 'deps';
const commit = publish({
  gitDir: git(['-C', sourceDir, 'rev-parse', '--absolute-git-dir']),
  filesDir,
  indexFile: path.join(workDir, 'index'),
  target: platform,
  branch,
  stalePrefix: 'deps/',
  keep: (message) => depsHashOf(message) === hash,
  message: depsMessage(hash, git(['-C', sourceDir, 'rev-parse', 'HEAD'])),
});
fs.rmSync(filesDir, { recursive: true, force: true });

output('hash', hash);
output('commit', commit);
