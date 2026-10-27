// The one directory build-chaos writes to, like the gha-* actions':
// <$RUNNER_TEMP, else the system temp dir>/g-bot-actions/build-chaos.
const os = require('os');
const path = require('path');

module.exports.workDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'g-bot-actions', 'build-chaos');
