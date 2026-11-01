const { fail, output } = require('../_lib/actions.js');

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

const include = [...new Set(chosen)].map((platform) => ({ platform, runner: platforms[platform].runner }));
console.log(include.map(({ platform, runner }) => `${platform} on ${runner}`).join('\n'));
output('matrix', JSON.stringify({ include }));
