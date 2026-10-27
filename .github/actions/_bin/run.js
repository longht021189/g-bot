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
