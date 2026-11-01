// Builds vcpkg-share's dependencies (its vcpkg.json, overlay ports and
// triplets, at the vcpkg commit in VCPKG_COMMIT) into one install prefix per
// platform: <vcpkg-share>/dist/<platform>/{include,lib,share}, static
// libraries only, for c-share's CMake (CMAKE_PREFIX_PATH) and r-share's
// build.rs (VCPKG_SHARE_PREFIX) to use instead of running vcpkg themselves.
//
// Platforms are named as chaos names its builds, not by vcpkg triplet:
// darwin-arm64 and linux-* build on that very OS and architecture (never
// cross-compiled); android-* on any Linux or macOS host with the Android NDK
// (ANDROID_NDK_HOME, else ANDROID_NDK_LATEST_HOME or ANDROID_NDK_ROOT).
//
// Usage: node build.js [--source <vcpkg-share>] [--out <dir>] [platform...]
// (default source: the current directory; default out: <source>/dist;
// default platform: this machine's own). vcpkg itself is checked out at
// VCPKG_COMMIT into <source>/dist/.vcpkg/ once, and reuses its binary cache
// (VCPKG_DEFAULT_BINARY_CACHE, by default ~/.cache/vcpkg) across builds.
//
// Needs on PATH: git, CMake, Ninja, a C/C++ compiler, make, pkg-config, and
// what the ports' builds need (perl, autoconf/automake/libtool for some).
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// runner is the GitHub-hosted runner g-bot's vcpkg-share workflow builds it on.
const PLATFORMS = {
  'darwin-arm64': { triplet: 'arm64-osx', host: 'darwin/arm64', runner: 'macos-latest' },
  'linux-arm64': { triplet: 'arm64-linux', host: 'linux/arm64', runner: 'ubuntu-24.04-arm' },
  'linux-x64': { triplet: 'x64-linux', host: 'linux/x64', runner: 'ubuntu-24.04' },
  'android-arm64': { triplet: 'arm64-android', android: true, runner: 'ubuntu-24.04' },
  'android-armv7': { triplet: 'arm-neon-android', android: true, runner: 'ubuntu-24.04' },
  'android-x86_64': { triplet: 'x64-android', android: true, runner: 'ubuntu-24.04' },
  'android-x86': { triplet: 'x86-android', android: true, runner: 'ubuntu-24.04' },
};

const host = `${process.platform}/${process.arch}`;

// This machine's own platform, the default one to build.
function hostPlatform() {
  const name = Object.keys(PLATFORMS).find((p) => PLATFORMS[p].host === host);
  if (!name) throw new Error(`no native platform for ${host}; name one (${Object.keys(PLATFORMS).join(', ')})`);
  return name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  if (result.error) throw new Error(`cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function listFiles(dir, rel = '') {
  const full = path.join(dir, rel);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.posix.join(rel, entry.name);
      return entry.isDirectory() ? listFiles(dir, file) : [file];
    });
}

// What a prefix is built from: VCPKG_COMMIT, vcpkg.json, ports/ and
// triplets/. Its SHA-256, hex; the first 12 characters name the deps/<hash>
// branch the prefixes are pushed to, the same for every platform.
function depsHash(source) {
  const inputs = ['VCPKG_COMMIT', 'vcpkg.json', ...listFiles(source, 'ports'), ...listFiles(source, 'triplets')].sort();
  const hash = crypto.createHash('sha256');
  for (const file of inputs) {
    const content = fs.readFileSync(path.join(source, file));
    hash.update(`${file}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest('hex');
}

function vcpkgCommit(source) {
  const commit = fs.readFileSync(path.join(source, 'VCPKG_COMMIT'), 'utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('VCPKG_COMMIT is not a full commit hash');
  return commit;
}

// vcpkg checked out at commit and bootstrapped, once, under dist/.vcpkg/.
function vcpkgAt(source, commit, env) {
  const root = path.join(source, 'dist', '.vcpkg', commit);
  const tool = path.join(root, 'vcpkg');
  if (fs.existsSync(tool)) return tool;
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  run('git', ['init', '--quiet', root]);
  run('git', ['-C', root, 'fetch', '--quiet', '--depth', '1', 'https://github.com/microsoft/vcpkg.git', commit]);
  run('git', ['-C', root, 'checkout', '--quiet', 'FETCH_HEAD']);
  run(path.join(root, 'bootstrap-vcpkg.sh'), ['-disableMetrics'], { env });
  return tool;
}

function androidNdk() {
  const ndk = process.env.ANDROID_NDK_HOME || process.env.ANDROID_NDK_LATEST_HOME || process.env.ANDROID_NDK_ROOT;
  if (!ndk || !fs.existsSync(ndk)) throw new Error('android-* needs the Android NDK: set ANDROID_NDK_HOME');
  return ndk;
}

// Builds each of platforms into <outDir>/<platform>/, replacing what was
// there. Returns the deps hash.
function build(source, { platforms = [], outDir } = {}) {
  source = path.resolve(source);
  outDir = path.resolve(outDir || path.join(source, 'dist'));
  if (platforms.length === 0) platforms = [hostPlatform()];
  for (const name of platforms) {
    const platform = PLATFORMS[name];
    if (!platform) throw new Error(`unknown platform ${name} (${Object.keys(PLATFORMS).join(', ')})`);
    if (platform.host && platform.host !== host) throw new Error(`${name} is built on ${platform.host} only, not cross-compiled (this is ${host})`);
    if (platform.android && process.platform !== 'linux' && process.platform !== 'darwin') throw new Error(`${name} is built on Linux or macOS`);
  }

  const env = { ...process.env, VCPKG_DISABLE_METRICS: '1' };
  // vcpkg has no prebuilt CMake/Ninja for Linux arm64.
  if (host === 'linux/arm64') env.VCPKG_FORCE_SYSTEM_BINARIES = '1';
  const commit = vcpkgCommit(source);
  const hash = depsHash(source);
  const vcpkg = vcpkgAt(source, commit, env);

  for (const name of platforms) {
    const { triplet, android } = PLATFORMS[name];
    console.log(`== ${name} (${triplet})`);
    const installRoot = path.join(source, 'dist', '.installed', name);
    fs.rmSync(installRoot, { recursive: true, force: true });
    const platformEnv = android ? { ...env, ANDROID_NDK_HOME: androidNdk() } : env;
    run(
      vcpkg,
      [
        'install',
        `--x-manifest-root=${source}`,
        `--x-install-root=${installRoot}`,
        `--overlay-ports=${path.join(source, 'ports')}`,
        `--overlay-triplets=${path.join(source, 'triplets')}`,
        `--triplet=${triplet}`,
        '--clean-after-build',
      ],
      { cwd: source, env: platformEnv },
    );

    const prefix = path.join(outDir, name);
    fs.rmSync(prefix, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    try {
      fs.renameSync(path.join(installRoot, triplet), prefix);
    } catch (error) {
      if (error.code !== 'EXDEV') throw error;
      fs.cpSync(path.join(installRoot, triplet), prefix, { recursive: true, verbatimSymlinks: true });
    }
    fs.rmSync(installRoot, { recursive: true, force: true });
    // What the prefix was built from, for whoever uses it to check.
    fs.writeFileSync(path.join(prefix, 'vcpkg-share.json'), `${JSON.stringify({ platform: name, triplet, hash, vcpkgCommit: commit }, null, 2)}\n`);
    console.log(`${name}: ${prefix}`);
  }
  return hash;
}

module.exports = { PLATFORMS, build, depsHash, hostPlatform };

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = { platforms: [] };
  let source = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' || args[i] === '--out') {
      if (i + 1 >= args.length) {
        console.error(`${args[i]} needs a value`);
        process.exit(2);
      }
      if (args[i] === '--source') source = args[++i];
      else options.outDir = args[++i];
    } else {
      options.platforms.push(args[i]);
    }
  }
  try {
    const hash = build(source, options);
    console.log(`== done: deps ${hash.slice(0, 12)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
