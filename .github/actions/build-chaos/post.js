// build-chaos's post run: removes everything main wrote, the encrypted file
// included (the job's upload step has run by now).
const fs = require('fs');
const { workDir } = require('./work.js');

fs.rmSync(workDir, { recursive: true, force: true });
console.log(`Removed ${workDir}`);
