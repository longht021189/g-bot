const path = require('path');
const { fail, output, tryGit } = require('../_lib/actions.js');

// What is built (PLAN_PLATFORMS_FOR), and the platforms it can be built for,
// each with its runner.
const builds = {
  chaos: () => require('../build-chaos/build.js').PLATFORMS,
  'vcpkg-share': () => require('../build-vcpkg-share/build.js').PLATFORMS,
};
const what = process.env.PLAN_PLATFORMS_FOR;
if (!builds[what]) fail(`PLAN_PLATFORMS_FOR must be one of ${Object.keys(builds).join(', ')}`);
const platforms = builds[what]();

// Platform names, separated by whitespace or commas.
const chosen = (process.env.PLAN_PLATFORMS || '').split(/[\s,]+/).filter(Boolean);
if (chosen.length === 0) fail(`choose at least one platform (${Object.keys(platforms).join(', ')})`);
for (const name of chosen) {
  if (!platforms[name]) fail(`${what} has no platform ${name} (${Object.keys(platforms).join(', ')})`);
}

// vcpkg-share only: with PLAN_PLATFORMS_SKIP_BUILT naming its checkout, the
// platforms its deps branch already has, built from that checkout's deps
// hash, are left out -- a push that changes nothing they are built from
// builds nothing.
let planned = [...new Set(chosen)];
const checkout = process.env.PLAN_PLATFORMS_SKIP_BUILT;
if (checkout && what === 'vcpkg-share') {
  const { depsHash, depsHashOf } = require('../build-vcpkg-share/build.js');
  const dir = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd(), checkout);
  const fetched = tryGit(['-C', dir, 'fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', 'refs/heads/deps']);
  if (fetched.status === 0) {
    const message = tryGit(['-C', dir, 'log', '-1', '--format=%B', 'FETCH_HEAD']).stdout;
    if (depsHashOf(message) === depsHash(dir)) {
      const built = tryGit(['-C', dir, 'ls-tree', '--name-only', 'FETCH_HEAD']).stdout.split('\n');
      const skipped = planned.filter((name) => built.includes(name));
      if (skipped.length > 0) console.log(`deps already has ${skipped.join(', ')}, built from this deps hash`);
      planned = planned.filter((name) => !built.includes(name));
    }
  }
}

const include = planned.map((platform) => ({ platform, runner: platforms[platform].runner }));
console.log(include.length > 0 ? include.map(({ platform, runner }) => `${platform} on ${runner}`).join('\n') : 'Nothing to build');
output('matrix', JSON.stringify({ include }));
output('count', String(include.length));
