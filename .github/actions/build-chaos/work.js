const os = require('os');
const path = require('path');

module.exports.workDir = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'g-bot-actions', 'build-chaos');
