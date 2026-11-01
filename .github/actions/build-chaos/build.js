// Builds every binary of a chaos checkout for the machine it runs on, with
// that machine's own toolchains -- no cross-compiling, no containers -- into
// <chaos>/dist/<os>-<arch>/, laid out as an install prefix: darwin-arm64 on an
// Apple Silicon Mac, linux-arm64 on Linux arm64 (GitHub's ubuntu-*-arm
// runners, the mcp-gateway-service VM). From the checkout as it is:
// uncommitted changes and the local .cargo/config.toml patch included.
//
//   go     into libexec/chaos/: the Go binaries (entrypoint/bin/*/main.go:
//          chaos-oci, chaos-mcp), which chaos runs; the Pulumi stacks
//          (entrypoint/stacks/) are no binary, they run from source with the
//          Pulumi CLI
//   pack   in libexec/chaos/: compresses each of them into chaos-<name>.zst
//          (zstd -19), adds the decompress-only zstd that chaos unpacks them
//          with, and lists the SHA-256 of all of it, packed and unpacked, in
//          chaos.sha256 -- the manifest the rust step builds into chaos
//   rust   into bin/: every Rust binary (entrypoint/bin/*/main.rs): chaos's
//          (chaos, the front binary; the gha-*) and g-bot's, each a package of
//          its own (entrypoint/bin/*/Cargo.toml)
//   image  the localhost/chaos image (linux/arm64, in podman) from
//          dist/linux-arm64/: Oracle's OCI CLI image, the Pulumi CLI (checked
//          against the release's checksums file), chaos and its binaries
//
// Usage: node build.js [--source <chaos>] [--out <dir>] [go] [pack] [rust] [image]
// (default source: the current directory; default steps: all four, in that
// order, whatever the order given; image only on Linux). chaos refuses
// binaries its manifest does not list, so after go and pack, build it again
// (rust).
//
// Needs on PATH: go; cargo; make and a C compiler (zstd); tar; and what
// r-share's build script needs for c-share (CMake, Ninja, clang for bindgen,
// and VCPKG_SHARE_PREFIX -- vcpkg-share's prebuilt dependencies -- or
// VCPKG_ROOT; see r-share's README). r-share and c-share are found next to the
// checkout (../r-share, ../c-share), as its .cargo/config.toml says.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STEPS = ['go', 'pack', 'rust', 'image'];
const IMAGE = 'localhost/chaos';
const PULUMI_VERSION = '3.272.0';
const ZSTD_VERSION = '1.5.7';
const ZSTD_SHA256 = 'eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3';
// Every platform chaos is built for, each on that very OS and architecture;
// runner is the GitHub-hosted runner g-bot's chaos workflow builds it on.
const PLATFORMS = {
  'darwin-arm64': { host: 'darwin/arm64', runner: 'macos-latest' },
  'linux-arm64': { host: 'linux/arm64', runner: 'ubuntu-24.04-arm' },
};

function hostTarget() {
  const host = `${process.platform}/${process.arch}`;
  const target = Object.keys(PLATFORMS).find((name) => PLATFORMS[name].host === host);
  if (!target) {
    throw new Error(`no build for ${host}: chaos is built for ${Object.keys(PLATFORMS).join(' and ')}`);
  }
  return target;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  if (result.error) throw new Error(`cannot run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`cannot download ${url}: ${response.status} ${response.statusText}`);
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

// The directories under entrypoint/bin/ with a file named main.
function entrypoints(source, main) {
  const dir = path.join(source, 'entrypoint', 'bin');
  return fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, main)))
    .sort();
}

function buildGo(source, outDir) {
  console.log('== Go binaries');
  for (const name of entrypoints(source, 'main.go')) {
    run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(outDir, 'libexec', 'chaos', name), `./entrypoint/bin/${name}`], {
      cwd: source,
      env: { ...process.env, CGO_ENABLED: '0', GOFLAGS: '-buildvcs=false' },
    });
  }
}

// zstd's own CLI, built once per machine from its release's source (checked
// against ZSTD_SHA256) into dist/.tools/: the decompress-only build ships
// next to the binaries, the compress-only one packs them.
async function zstdTools(source, target) {
  const dir = path.join(source, 'dist', '.tools', target, `zstd-${ZSTD_VERSION}`);
  const tools = { decompress: path.join(dir, 'zstd-decompress'), compress: path.join(dir, 'zstd-compress') };
  if (fs.existsSync(tools.decompress) && fs.existsSync(tools.compress)) return tools;

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-zstd-'));
  try {
    const tarball = path.join(work, 'zstd.tar.gz');
    await download(`https://github.com/facebook/zstd/releases/download/v${ZSTD_VERSION}/zstd-${ZSTD_VERSION}.tar.gz`, tarball);
    if (sha256(tarball) !== ZSTD_SHA256) throw new Error(`zstd-${ZSTD_VERSION}.tar.gz does not match ZSTD_SHA256`);
    run('tar', ['-xzf', tarball, '-C', work]);
    const programs = path.join(work, `zstd-${ZSTD_VERSION}`, 'programs');
    // Statically linked on Linux, so it runs on any distribution.
    run('make', ['-s', '-C', programs, 'zstd-decompress', 'zstd-compress', `LDFLAGS=${target === 'linux-arm64' ? '-static' : ''}`]);
    fs.mkdirSync(dir, { recursive: true });
    for (const tool of Object.values(tools)) {
      fs.copyFileSync(path.join(programs, path.basename(tool)), tool);
      fs.chmodSync(tool, 0o755);
      run('strip', [tool]);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return tools;
}

async function pack(source, target, outDir) {
  console.log('== packing the Go binaries');
  const tools = await zstdTools(source, target);
  const libexec = path.join(outDir, 'libexec', 'chaos');
  const binaries = fs.readdirSync(libexec).filter((f) => f.startsWith('chaos-') && !f.endsWith('.zst')).sort();
  if (binaries.length === 0) throw new Error('nothing to pack: build the binaries first (go)');

  for (const f of fs.readdirSync(libexec).filter((f) => f.endsWith('.zst'))) fs.rmSync(path.join(libexec, f));
  fs.copyFileSync(tools.decompress, path.join(libexec, 'zstd'));
  fs.chmodSync(path.join(libexec, 'zstd'), 0o755);
  // sha256sum's format, which chaos's build.rs reads.
  const manifest = [`${sha256(path.join(libexec, 'zstd'))}  zstd`];
  for (const f of binaries) {
    const file = path.join(libexec, f);
    run(tools.compress, ['-19', '-q', '-f', '-o', `${file}.zst`, file]);
    manifest.push(`${sha256(file)}  ${f}`, `${sha256(`${file}.zst`)}  ${f}.zst`);
    fs.rmSync(file);
  }
  fs.writeFileSync(path.join(outDir, 'chaos.sha256'), `${manifest.join('\n')}\n`);
}

function buildRust(source, outDir) {
  console.log('== Rust binaries');
  const manifest = path.join(outDir, 'chaos.sha256');
  if (!fs.existsSync(manifest)) throw new Error(`no ${manifest}: build it first (go pack)`);
  // chaos's own (entrypoint/bin/<bin>/main.rs, of the chaos package) and the
  // packages of their own (entrypoint/bin/<package>/Cargo.toml, one binary
  // each, named after it).
  const bins = entrypoints(source, 'main.rs');
  const args = ['build', '--release', '--locked', '--features', 'chaos/actions', '-p', 'chaos'];
  for (const name of bins) {
    if (fs.existsSync(path.join(source, 'entrypoint', 'bin', name, 'Cargo.toml'))) args.push('-p', name);
    args.push('--bin', name);
  }
  run('cargo', args, { cwd: source, env: { ...process.env, CHAOS_MANIFEST: manifest } });
  for (const name of bins) {
    fs.copyFileSync(path.join(source, 'target', 'release', name), path.join(outDir, 'bin', name));
    fs.chmodSync(path.join(outDir, 'bin', name), 0o755);
  }
}

async function image(source) {
  console.log('== chaos image');
  const dir = path.join(source, 'dist', 'linux-arm64');
  if (!fs.existsSync(path.join(dir, 'bin', 'chaos'))) {
    throw new Error(`no ${dir}/bin/chaos: build it on Linux arm64, or fetch it from the bin branch`);
  }
  const libexec = path.join(dir, 'libexec', 'chaos');
  if (!fs.existsSync(libexec) || !fs.readdirSync(libexec).some((f) => f.startsWith('chaos-'))) {
    throw new Error(`no ${libexec}/chaos-*`);
  }

  const context = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-image-'));
  try {
    fs.copyFileSync(path.join(dir, 'bin', 'chaos'), path.join(context, 'chaos'));
    fs.cpSync(libexec, path.join(context, 'libexec'), { recursive: true });
    const file = `pulumi-v${PULUMI_VERSION}-linux-arm64.tar.gz`;
    await download(`https://get.pulumi.com/releases/sdk/${file}`, path.join(context, file));
    const checksums = path.join(context, 'checksums.txt');
    await download(`https://github.com/pulumi/pulumi/releases/download/v${PULUMI_VERSION}/pulumi-${PULUMI_VERSION}-checksums.txt`, checksums);
    const line = fs.readFileSync(checksums, 'utf8').split('\n').find((l) => l.endsWith(` ${file}`));
    if (!line || line.split(/\s+/)[0] !== sha256(path.join(context, file))) throw new Error(`${file} does not match the release's checksums`);
    run('tar', ['-xzf', path.join(context, file), '-C', context]);
    run('podman', ['build', '--platform', 'linux/arm64', '-t', IMAGE, '-f', '-', context], {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: `FROM ghcr.io/oracle/oci-cli:latest
COPY pulumi /opt/pulumi
# chaos runs its binaries from <its prefix>/libexec/chaos, and only if no one
# but their owner (root, here) can write to them.
COPY --chmod=755 chaos /usr/local/bin/chaos
COPY --chmod=755 libexec /usr/local/libexec/chaos
ENV PATH=/opt/pulumi:$PATH \\
    PULUMI_SKIP_UPDATE_CHECK=true
ENTRYPOINT ["chaos"]
CMD ["--help"]
`,
    });
  } finally {
    fs.rmSync(context, { recursive: true, force: true });
  }
}

// Runs steps (in STEPS' order) on the chaos checkout at source, into outDir
// (default <source>/dist/<target>). Returns the target and outDir.
async function build(source, { steps = [], outDir } = {}) {
  const target = hostTarget();
  for (const step of steps) {
    if (!STEPS.includes(step)) throw new Error(`unknown step ${step} (${STEPS.join(', ')})`);
  }
  if (steps.length === 0) steps = target === 'linux-arm64' ? STEPS : ['go', 'pack', 'rust'];
  source = path.resolve(source);
  outDir = path.resolve(outDir || path.join(source, 'dist', target));
  fs.mkdirSync(path.join(outDir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'libexec', 'chaos'), { recursive: true });

  if (steps.includes('go')) buildGo(source, outDir);
  if (steps.includes('pack')) await pack(source, target, outDir);
  if (steps.includes('rust')) buildRust(source, outDir);
  if (steps.includes('image')) await image(source);
  return { target, outDir };
}

module.exports = { PLATFORMS, build, hostTarget };

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = { steps: [] };
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
      options.steps.push(args[i]);
    }
  }
  build(source, options).then(
    ({ outDir }) => {
      console.log('== done');
      run('ls', ['-l', path.join(outDir, 'bin'), path.join(outDir, 'libexec', 'chaos')]);
    },
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
