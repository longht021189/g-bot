const { fail, output } = require('../_lib/actions.js');
const { PLATFORMS } = require('../build-vcpkg-share/build.js');

// Platform names, separated by whitespace or commas.
const chosen = (process.env.PLAN_VCPKG_SHARE_PLATFORMS || '').split(/[\s,]+/).filter(Boolean);
if (chosen.length === 0) fail(`choose at least one platform (${Object.keys(PLATFORMS).join(', ')})`);
for (const name of chosen) {
  if (!PLATFORMS[name]) fail(`unknown platform ${name} (${Object.keys(PLATFORMS).join(', ')})`);
}

const include = [...new Set(chosen)].map((platform) => ({ platform, runner: PLATFORMS[platform].runner }));
console.log(include.map(({ platform, runner }) => `${platform} on ${runner}`).join('\n'));
output('matrix', JSON.stringify({ include }));
