const assetFiles = [
  'alpine.jpg', 'vendor.js', 'lucide-LICENSE.txt', 'ajv-LICENSE.txt',
  'dm-sans-LICENSE.txt', 'space-grotesk-LICENSE.txt',
  ...['dm-sans', 'space-grotesk'].flatMap((family) => ['latin', 'latin-ext'].flatMap((subset) => [400, 500, 600, 700].map((weight) => `${family}-${subset}-${weight}-normal.woff2`))),
].map((file) => `assets/${file}`);

const siteFiles = ['index.html', 'styles.css', 'engine.js', 'content.js', 'scenarios.js', 'questions.js', 'i18n.js', 'locales/hu.js', 'locales/es.js', 'locales/ui.js', 'audio.js', 'app.js', ...assetFiles];
const publicFiles = [
  ...siteFiles, '.gitignore', 'README.md', 'package.json', 'package-lock.json',
  'build.cjs', 'vendor-entry.mjs', 'site-files.cjs', 'publish-check.cjs', 'release.cjs',
  'engine.test.cjs', 'content.test.cjs', 'verify.cjs', '.github/workflows/pages.yml',
];

module.exports = { siteFiles, publicFiles };