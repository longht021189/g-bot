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
}

const source = process.env.BUILD_CHAOS_SOURCE;
const passphrase = process.env.BUILD_CHAOS_PASSPHRASE;
if (!source) fail('BUILD_CHAOS_SOURCE is required');
if (!passphrase) fail('BUILD_CHAOS_PASSPHRASE is required');

const sourceDir = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), source);
const goos = process.env.BUILD_CHAOS_GOOS || { linux: 'linux', darwin: 'darwin' }[process.platform] || process.platform;
const goarch = process.env.BUILD_CHAOS_GOARCH || { arm64: 'arm64', x64: 'amd64' }[process.arch] || process.arch;
const name = `chaos-${goos}-${goarch}`;

fs.rmSync(workDir, { recursive: true, force: true });
const binDir = path.join(workDir, 'bin');
const gnupgHome = path.join(workDir, 'gnupg');
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(gnupgHome, { recursive: true, mode: 0o700 });

const binary = path.join(binDir, 'chaos');
run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', binary, './cmd/chaos'], {
  cwd: sourceDir,
  env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-buildvcs=false', GOOS: goos, GOARCH: goarch },
});

const tarball = path.join(workDir, `${name}.tar.gz`);
run('tar', ['-czf', tarball, '-C', binDir, 'chaos']);

const encrypted = path.join(workDir, `${name}.tar.gz.gpg`);
run('gpg', [
  '--batch', '--yes', '--no-symkey-cache', '--pinentry-mode', 'loopback', '--passphrase-fd', '0',
  '--symmetric', '--cipher-algo', 'AES256', '--s2k-digest-algo', 'SHA512', '--s2k-count', '65011712',
  '-o', encrypted, tarball,
], { input: passphrase, stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, GNUPGHOME: gnupgHome } });

fs.rmSync(binDir, { recursive: true, force: true });
fs.rmSync(tarball, { force: true });
fs.rmSync(gnupgHome, { recursive: true, force: true });

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `path=${encrypted}\n`);
} else {
  console.log(`path=${encrypted}`);
}
