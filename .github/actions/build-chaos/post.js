const fs = require('fs');
const { workDir } = require('./work.js');

fs.rmSync(workDir, { recursive: true, force: true });
console.log(`Removed ${workDir}`);
