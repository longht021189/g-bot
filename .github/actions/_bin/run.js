// Runs one of g-bot's gha-* binaries (bin/<os>-<arch>/<binary>, built from
// g-bot's src/bin/) as an action's `main` or `post` run. This wrapper only
// exists because GitHub runs a post step for JavaScript (and Docker)
// actions alone, never for composite ones. Settings reach the binary as the
// step's own env (CHECKOUT_*, SETUP_GO_*, ...: the actions declare no
// inputs); outputs, PATH and env go through $GITHUB_OUTPUT/$GITHUB_PATH/
// $GITHUB_ENV, and main's state through files in $RUNNER_TEMP, all of which
// the binary handles itself.
const { spawnSync } = require('child_process');
const path = require('path');

const PLATFORMS = { linux: 'linux' };
const ARCHES = { arm64: 'arm64' };

module.exports = function run(binary, phase) {
  const platform = PLATFORMS[process.platform];
  const arch = ARCHES[process.arch];
  if (!platform || !arch) {
    console.log(`::error::${binary} has no build for ${process.platform}/${process.arch}`);
    process.exit(1);
  }

  const file = path.join(__dirname, '..', '..', '..', 'bin', `${platform}-${arch}`, binary);
  const result = spawnSync(file, [phase], { stdio: 'inherit' });
  if (result.error) {
    console.log(`::error::cannot run ${file}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
};
