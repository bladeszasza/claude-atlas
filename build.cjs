const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');
const { siteFiles } = require('./site-files.cjs');

async function build() {
  const base = __dirname;
  const assets = path.join(base, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  await esbuild.build({ entryPoints: [path.join(base, 'vendor-entry.mjs')], bundle: true, format: 'iife', globalName: 'AtlasVendors', outfile: path.join(assets, 'vendor.js'), minify: true, legalComments: 'eof' });
  for (const [family, weights] of [['dm-sans', [400, 500, 600, 700]], ['space-grotesk', [400, 500, 600, 700]]]) {
    for (const weight of weights) {
      for (const subset of ['latin', 'latin-ext']) {
        const name = `${family}-${subset}-${weight}-normal.woff2`;
        fs.copyFileSync(path.join(base, 'node_modules', '@fontsource', family, 'files', name), path.join(assets, name));
      }
    }
    fs.copyFileSync(path.join(base, 'node_modules', '@fontsource', family, 'LICENSE'), path.join(assets, `${family}-LICENSE.txt`));
  }
  for (const dependency of ['lucide', 'ajv']) {
    fs.copyFileSync(path.join(base, 'node_modules', dependency, 'LICENSE'), path.join(assets, `${dependency}-LICENSE.txt`));
  }
  const output = path.join(base, '_site');
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw new Error('The site output directory must not be a symlink.');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const revision = createHash('sha256');
  for (const file of siteFiles) {
    fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true });
    fs.copyFileSync(path.join(base, file), path.join(output, file));
    revision.update(file).update(fs.readFileSync(path.join(base, file)));
  }
  const version = revision.digest('hex').slice(0, 16);
  const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(output, 'index.html'), html.replaceAll('?v=atlas', `?v=${version}`));
  console.log(`Built ${siteFiles.length} local web assets. Open index.html or publish _site.`);
}

build().catch((error) => { console.error(error); process.exitCode = 1; });