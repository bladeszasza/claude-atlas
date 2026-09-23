const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { siteFiles, publicFiles } = require('./site-files.cjs');
const { sources, lessons, architectExam } = require('./content.js');

function checkPublic(base = __dirname, exact = false) {
  const forbidden = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
    [/\b(?:ghp_|github_pat_|sk-ant-)[A-Za-z0-9_-]{18,}/, 'access credential'],
    [/[?&](?:Signature|Key-Pair-Id|Expires|session_id)=/i, 'signed or session URL'],
    [/\/Users\/[^\s"']+|[A-Z]:\\Users\\/i, 'private local path'],
    [/\b(?:com\.nestle|dolcegusto|KDC_DEBUG)\b/i, 'unrelated application content'],
    [/\/learn\/quiz\/\d+\/results|Your order ID is/i, 'personal course result'],
  ];
  for (const file of publicFiles) {
    const location = path.join(base, file);
    assert.ok(fs.existsSync(location), `Missing release file: ${file}`);
    assert.ok(!fs.lstatSync(location).isSymbolicLink(), `Release must not follow a symlink: ${file}`);
    if (location.endsWith('publish-check.cjs')) continue;
    if (/\.(?:js|cjs|mjs|json|html|css|md|yml|txt)$/.test(file)) {
      const text = fs.readFileSync(location, 'utf8');
      for (const [pattern, label] of forbidden) assert.ok(!pattern.test(text), `${file}: found ${label}`);
    }
  }
  for (const source of Object.values(sources)) {
    for (const value of [source.url, source.accessUrl].filter(Boolean)) {
      const url = new URL(value);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username, '');
      assert.equal(url.password, '');
      assert.equal(url.search, '', `Use a stable resource link: ${source.name}`);
    }
  }
  for (const lesson of lessons) {
    assert.ok(lesson.sources.some((id) => /Official|Anthropic/.test(sources[id].kind)), `No primary learning source: ${lesson.id}`);
  }
  assert.equal(architectExam.questions, 60);
  assert.equal(architectExam.correctPerQuestion, 1);
  assert.equal(architectExam.provider, 'Pearson VUE');
  const allowed = new Set(publicFiles);
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return [];
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [path.relative(base, full).split(path.sep).join('/')];
  });
  if (exact) {
    for (const file of walk(base)) assert.ok(allowed.has(file), `Unexpected file in public export: ${file}`);
  }
  const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!/^https:/.test(match[1])) assert.ok(siteFiles.includes(match[1]), `Unpublished page dependency: ${match[1]}`);
  }
  console.log(`Public check passed: ${publicFiles.length} allowlisted files; ${Object.keys(sources).length} stable references; no detected credentials, private paths, signed links, or course-result pages.`);
}

if (require.main === module) checkPublic(process.argv[2] ? path.resolve(process.argv[2]) : __dirname, process.argv.includes('--exact'));
module.exports = { checkPublic };