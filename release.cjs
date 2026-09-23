const fs = require('node:fs');
const path = require('node:path');
const { publicFiles } = require('./site-files.cjs');
const { checkPublic } = require('./publish-check.cjs');

const destination = process.argv[2] && path.resolve(process.argv[2]);
if (!destination || destination === __dirname || destination.startsWith(`${__dirname}${path.sep}`)) throw new Error('Choose a separate, empty release directory.');
if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('The release destination must be empty.');
checkPublic();
fs.mkdirSync(destination, { recursive: true });
for (const file of publicFiles) {
  fs.mkdirSync(path.dirname(path.join(destination, file)), { recursive: true });
  fs.copyFileSync(path.join(__dirname, file), path.join(destination, file));
}
checkPublic(destination, true);
console.log(`Release snapshot ready at ${destination}`);