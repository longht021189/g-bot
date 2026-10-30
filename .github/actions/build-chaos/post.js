const fs = require('fs');
const path = require('path');
const { workDir } = require('./work.js');

const created = path.join(workDir, 'created.json');
if (fs.existsSync(created)) {
  for (const dir of JSON.parse(fs.readFileSync(created, 'utf8'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Removed ${dir}`);
  }
}
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`Removed ${workDir}`);
