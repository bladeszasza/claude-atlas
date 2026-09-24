const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const http = require('node:http');
const { siteFiles } = require('./site-files.cjs');
const engine = require('./engine.js');
const content = require('./content.js');
const bank = require('./questions.js');

const results = path.join(__dirname, 'test-results');
let url = pathToFileURL(path.join(__dirname, 'index.html')).href;
fs.mkdirSync(results, { recursive: true });
let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions += 1; }

async function navigate(page, hash) {
  await page.evaluate((next) => { location.hash = next; }, hash);
  await page.waitForFunction((next) => location.hash === next, hash);
  await expect(page.locator('main')).not.toBeEmpty();
}

async function noHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  check(dimensions.width <= dimensions.viewport + 1, `${label}: horizontal overflow ${dimensions.width}/${dimensions.viewport}`);
}

async function verifyLanguages(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    const errors = [];
    const fontRequests = [];
    await page.clock.install();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', (request) => { if (request.url().includes('latin-ext')) fontRequests.push(request.url()); });
    const shared = require('./locales/ui.js');
    const locales = Object.fromEntries(['hu', 'es'].map((language) => [language, { ...require(`./locales/${language}.js`), ...shared[language] }]));
    const i18n = require('./i18n.js');
    const translate = (text, language) => i18n.translate(text, locales[language]);
    const switchLanguage = async (language) => {
      await page.locator('#language-select').selectOption(language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('#search-toggle')).toHaveAttribute('aria-label', translate('Search concepts', language));
    };
    await page.goto(`${url}#lesson/first-principles`);
    await expect(page.locator('.avatar')).toHaveCount(0);
    const note = '<img src=x onerror=alert(1)> Focus mode: árvíztűrő, pingüino.';
    await page.locator('#lesson-note').fill(note);
    await page.locator('.lesson-tabs [data-value="check"]').click();
    await expect(page.locator('.lesson-tabs [data-value="check"]')).toBeFocused();
    await page.locator('[data-action="select-answer"][data-index="1"]').click();
    const initialProgress = await page.evaluate(() => localStorage.getItem('claude-atlas-v1'));
    for (const language of ['hu', 'es', 'en', 'hu', 'es', 'en']) {
      await switchLanguage(language);
      const localized = language === 'en' ? bank[0] : i18n.localizeQuestions([bank[0]], locales[language])[0];
      await expect(page.locator('.question-box h3')).toHaveText(localized.stem);
      await expect(page.locator('.answer-option[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('#lesson-note')).toHaveValue(note);
      await expect(page.locator('.answer-option strong,.answer-option code,.question-box h3 strong')).toHaveCount(0);
      check(await page.evaluate(() => localStorage.getItem('claude-atlas-v1')) === initialProgress, `${language}: switching does not mutate saved progress`);
    }
    await navigate(page, '#notebook');
    await switchLanguage('hu');
    await expect(page.locator('.notebook-entry > p')).toHaveText(note);
    await expect(page.locator('.notebook-entry img')).toHaveCount(0);
    await navigate(page, '#practice');
    await page.locator('[data-action="practice-mode"][data-value="exam"]').click();
    await expect(page.locator('[data-action="practice-mode"][data-value="exam"]')).toBeFocused();
    await page.locator('[data-action="start-practice"]').click();
    const questionId = await page.locator('.question-box').getAttribute('data-question-id');
    await page.locator('[data-action="select-answer"][data-index="1"]').click();
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('claude-atlas-v1-quiz')));
    await page.clock.fastForward(65000);
    for (const language of ['es', 'en', 'hu']) {
      await switchLanguage(language);
      const question = bank.find((item) => item.id === questionId);
      const stem = language === 'en' ? question.stem : locales[language].questions[questionId][0];
      await expect(page.locator('.question-box h3')).toHaveText(stem);
      await expect(page.locator('[data-action="select-answer"][data-index="1"]')).toHaveAttribute('aria-pressed', 'true');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-atlas-v1-quiz'))), session);
    }
    await page.reload();
    await expect(page.locator('#language-select')).toHaveValue('hu');
    await expect(page.locator('[data-action="exit-quiz"]')).toHaveText('Kilépés');
    await expect(page.locator('.question-box')).toHaveAttribute('data-question-id', questionId);
    await expect(page.locator('[data-action="select-answer"][data-index="1"]')).toHaveAttribute('aria-pressed', 'true');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-atlas-v1-quiz'))), session);
    const remaining = await page.evaluate((deadline) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)), session.deadline);
    const clockParts = (await page.locator('#quiz-clock span').textContent()).split(':').map(Number);
    const displayed = clockParts.reduce((total, part) => total * 60 + part, 0);
    check(Math.abs(displayed - remaining) <= 1 && remaining < 7150, 'Reloaded translated rehearsal uses the original partially elapsed countdown');
    await page.clock.fastForward((remaining + 1) * 1000);
    await expect(page.locator('.results-header')).toBeVisible();
    await expect(page.locator('.page-heading')).toContainText('Lejárt az idő');
    await page.locator('[data-action="new-quiz"]').click();
    check(true, 'Locale changes and reload preserve timed answers, question IDs and original deadline');

    await navigate(page, '#labs/loop');
    await expect(page.locator('[data-action="open-lab"][data-value="loop"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="loop-step"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('2. A modell eszközt kér');
    await expect(page.locator('#lab-output code')).toContainText(['stop_reason', 'tool_use', 'lookup_order']);
    await switchLanguage('es');
    await expect(page.locator('#lab-output > strong')).toHaveText('2. El modelo solicita una herramienta');
    await page.screenshot({ path: path.join(results, 'es-desktop-loop.png'), animations: 'disabled' });
    await navigate(page, '#labs/prompt');
    await expect(page.locator('#brief-audience')).toHaveValue('Dirección no técnica');
    await page.locator('#brief-audience').fill('Focus mode: my own audience');
    await switchLanguage('hu');
    await expect(page.locator('#brief-audience')).toHaveValue('Focus mode: my own audience');
    await expect(page.locator('#brief-task')).toHaveValue('Foglald össze az incidensjelentést');
    await navigate(page, '#labs/schema');
    await expect(page.locator('#json-input')).toBeVisible();
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output')).toContainText('a tételek összege 65, nem 80');
    await switchLanguage('es');
    await expect(page.locator('#lab-output')).toContainText('las partidas suman 65, no 80');
    await page.locator('#json-input').fill('{"total":"65","line_items":[40,25],"tax_id":null}');
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output')).toContainText('/total debe ser number');
    await switchLanguage('en');
    await expect(page.locator('#lab-output')).toContainText('/total must be number');
    check(true, 'Lab state, user-authored input and validation details survive language changes');

    for (const language of ['en', 'hu', 'es']) {
      await switchLanguage(language);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        for (const [hash, title] of [['#learn', 'Make the concepts click.'], ['#labs/loop', 'The scenario lab'], ['#practice', 'The practice room'], ['#progress', 'Keep the momentum.'], ['#library', 'The field guide']]) {
          await navigate(page, hash);
          await expect(page.locator('main h1')).toHaveText(translate(title, language));
          await page.evaluate(() => document.fonts.ready);
          await noHorizontalOverflow(page, `${language} ${width} ${hash}`);
        }
        await navigate(page, '#labs/loop');
        await expect(page.locator('#lab-output > strong')).toHaveText(translate('1. A request enters', language));
        await page.locator('[data-action="loop-step"]').click();
        await page.screenshot({ path: path.join(results, `${language}-${width}-loop.png`), animations: 'disabled' });
        await expect(page.locator('#focus-toggle')).toHaveAttribute('aria-label', translate('Focus mode', language));
        await page.locator('#focus-toggle').click();
        await expect(page.locator('#focus-toggle')).toHaveAttribute('aria-label', translate('Leave focus', language));
        await noHorizontalOverflow(page, `${language} ${width} focused lab`);
        await page.locator('#focus-toggle').click();
      }
      await navigate(page, '#library');
      await expect(page.locator('.source-card')).toHaveCount(Object.keys(content.sources).length);
      await expect(page.locator('#source-signaling a')).toHaveAttribute('href', content.sources.signaling.url);
      await page.locator('[data-action="library-tab"][data-value="glossary"]').click();
      await expect(page.locator('.glossary a')).toHaveCount(content.glossary.length);
      await navigate(page, '#recall');
      await expect(page.locator('[data-action="flip-card"]')).toBeVisible();
      if (!await page.locator('.flashcard').evaluate((card) => card.classList.contains('revealed'))) await page.locator('[data-action="flip-card"]').click();
      await expect(page.locator('#recall-face')).toContainText(language === 'en' ? content.lessons[0].simple : locales[language].lessons['first-principles'].simple);
      await navigate(page, '#library/sources');
    }
    check(fontRequests.length > 0, 'Hungarian extended Latin font assets load');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate(page, '#labs/prompt');
    await expect(page.locator('#brief-task')).toBeVisible();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'QuotaExceededError'); }; });
    await page.locator('[data-action="save-brief"]').click();
    await expect(page.locator('#toast')).toContainText('solo está en memoria');
    await navigate(page, '#lesson/prompt-brief');
    await expect(page.locator('#note-status')).toHaveText('Solo en memoria; exporta una copia');
    await page.locator('.lesson-tabs [data-value="deeper"]').click();
    await expect(page.locator('.lesson-tabs [data-value="deeper"]')).toBeFocused();
    await expect(page.locator('#note-status')).toHaveText('Solo en memoria; exporta una copia');
    check(errors.length === 0, `Locale browser errors: ${errors.join('\n')}`);
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  let server;
  try {
    if (process.argv.includes('--http')) {
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain' };
      server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const relative = pathname.startsWith('/claude-atlas/') ? pathname.slice('/claude-atlas/'.length) || 'index.html' : '';
        if (!siteFiles.includes(relative)) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': types[path.extname(relative)] || 'application/octet-stream' });
        fs.createReadStream(path.join(__dirname, '_site', relative)).pipe(response);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      url = `http://127.0.0.1:${server.address().port}/claude-atlas/index.html`;
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      window.__audioContexts = [];
      window.__analysers = [];
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(...args) {
          super(...args);
          window.__audioContexts.push(this);
        }
        createAnalyser() {
          const analyser = super.createAnalyser();
          window.__analysers.push(analyser);
          return analyser;
        }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.lesson-card')).toHaveCount(33);
    check(await page.evaluate(() => window.__audioContexts.length === 0), 'Audio must not start before a user gesture');
    check(await page.locator('.focus-scene img').evaluate((image) => image.complete && image.naturalWidth > 1000), 'Local mountain image loaded');
    check(await page.evaluate(() => document.fonts.check('600 20px "Space Grotesk"') && document.fonts.check('400 14px "DM Sans"')), 'Local fonts loaded');
    await noHorizontalOverflow(page, 'Desktop home');
    await page.screenshot({ path: path.join(results, 'desktop.png'), animations: 'disabled' });

    await page.locator('.next-lesson .primary').click();
    await expect(page.locator('h1')).toHaveText('Meet the model, not the magic');
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    check(await page.evaluate(() => location.hash === '#lesson/first-principles'), 'Skip link preserves the current study route');
    await page.locator('[data-action="lesson-tab"][data-value="deeper"]').first().click();
    await expect(page.locator('.code-sample')).toBeVisible();
    await page.locator('[data-action="lesson-tab"][data-value="check"]').first().click();
    await expect(page.locator('[data-action="complete-lesson"]')).toBeDisabled();
    await page.locator('[data-action="select-answer"][data-index="1"]').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-action="select-answer"][data-index="1"]')).toBeFocused();
    await page.locator('[data-action="check-answer"]').click();
    await expect(page.locator('.answer-feedback h4')).toHaveText('That is the right distinction.');
    await expect(page.locator('.answer-feedback')).toBeFocused();
    await page.locator('[data-action="complete-lesson"]').click();
    await expect(page.locator('#lesson-count')).toHaveText('1/33');
    await page.locator('#lesson-note').fill('<img src=x onerror=alert(1)> A tool request is not an executed action.');
    await page.locator('[data-action="bookmark"]').click();
    await page.reload();
    await expect(page.locator('#lesson-note')).toHaveValue('<img src=x onerror=alert(1)> A tool request is not an executed action.');
    await expect(page.locator('#lesson-count')).toHaveText('1/33');
    await navigate(page, '#notebook');
    await expect(page.locator('.notebook-entry')).toHaveCount(1);
    check(await page.locator('.notebook-entry img').count() === 0, 'Notes render as escaped text, never HTML');
    await page.locator('#notebook-search').fill('executed');
    await expect(page.locator('.notebook-entry')).toHaveCount(1);
    await page.locator('#notebook-search').fill('zzzznotfound');
    await expect(page.locator('.empty-state')).toBeVisible();

    await navigate(page, '#labs/schema');
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('Layer 3 failed: meaning');
    await page.locator('[data-action="json-example"][data-value="syntax"]').click();
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('Layer 1 failed: JSON syntax');
    await page.locator('#json-input').fill('{"total":"65","line_items":[40,25],"tax_id":null}');
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('Layer 2 failed: schema');
    await page.locator('[data-action="json-example"][data-value="valid"]').click();
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('All three local checks passed');
    await page.screenshot({ path: path.join(results, 'schema-lab.png'), animations: 'disabled' });

    await navigate(page, '#labs/policy');
    await page.locator('[data-action="policy-run"]').click();
    await expect(page.locator('#lab-output > strong')).toContainText('BLOCKED');
    await page.locator('#refund-amount').fill('250');
    await expect(page.locator('#lab-output > strong')).toContainText('ALLOWED');
    await page.locator('#verified-customer').uncheck();
    await expect(page.locator('#lab-output > strong')).toContainText('identity');

    await navigate(page, '#labs/cache');
    await expect(page.locator('#lab-output > strong')).toHaveText('0 stable prefix tokens');
    for (let index = 0; index < 3; index += 1) await page.locator(`.cache-block.dynamic [data-direction="1"]`).click();
    await expect(page.locator('#lab-output > strong')).toHaveText('7,000 stable prefix tokens');
    await navigate(page, '#labs/context');
    await expect(page.locator('#lab-output')).toHaveClass(/failed/);
    await page.locator('#context-trim').check();
    await page.locator('#context-summarize').check();
    await page.locator('#context-pin').check();
    await expect(page.locator('#lab-output')).not.toHaveClass(/failed/);

    await navigate(page, '#labs/config');
    for (let index = 0; index < 5; index += 1) await page.locator(`[data-config-index="${index}"]`).selectOption(String(index));
    await page.locator('[data-action="check-config"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('5 / 5 correctly placed');
    await navigate(page, '#labs/calibration');
    await expect(page.locator('#aggregate-value')).toHaveText('97%');
    await expect(page.locator('#segment-errors')).toHaveText('21');
    await navigate(page, '#labs/prompt');
    await page.locator('#brief-audience').fill('Technical leadership');
    await expect(page.locator('#brief-preview')).toContainText('Technical leadership');
    await page.locator('[data-action="save-brief"]').click();
    await navigate(page, '#labs/architecture');
    await page.locator('[data-action="architecture-answer"][data-index="1"]').click();
    await expect(page.locator('#lab-output > strong')).toContainText('proportionate');
    await navigate(page, '#labs/loop');
    for (let index = 0; index < 4; index += 1) await page.locator('[data-action="loop-step"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('5. A new model turn');

    await navigate(page, '#practice');
    await page.locator('#practice-count').selectOption('5');
    await page.locator('[data-action="start-practice"]').click();
    const firstId = await page.locator('.question-box').getAttribute('data-question-id');
    const firstQuestion = bank.find((question) => question.id === firstId);
    for (const index of firstQuestion.correct) await page.locator(`[data-action="select-answer"][data-index="${index}"]`).click();
    await page.locator('[data-action="check-answer"]').click();
    await expect(page.locator('.answer-feedback h4')).toContainText('right distinction');
    await page.locator('[data-action="flag-question"]').click();
    await page.reload();
    await expect(page.locator('.question-box')).toHaveAttribute('data-question-id', firstId);
    await expect(page.locator('[data-action="flag-question"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.quiz-aside [data-action="finish-quiz"]').click();
    await page.locator('#confirm-accept').click();
    await expect(page.locator('.results-header h2')).toHaveText('1 of 5 correct');
    await page.locator('[data-action="new-quiz"]').click();

    await page.locator('[data-action="practice-mode"][data-value="exam"]').click();
    await page.locator('[data-action="start-practice"]').click();
    await expect(page.locator('.question-nav button')).toHaveCount(60);
    await expect(page.locator('.case-brief')).toBeVisible();
    const rehearsal = await page.evaluate(() => JSON.parse(localStorage.getItem('claude-atlas-v1-quiz')));
    check(new Set(rehearsal.questions.map((id) => bank.find((question) => question.id === id).caseId)).size === 4, 'Architect rehearsal uses four cases');
    check(rehearsal.questions.every((id) => bank.find((question) => question.id === id).kind === 'single'), 'Architect rehearsal is single-answer only');
    const firstRehearsalId = await page.locator('.question-box').getAttribute('data-question-id');
    await page.locator('[data-action="quiz-next"]').click();
    await expect(page.locator('.question-box')).toHaveAttribute('data-question-id', firstRehearsalId);
    await page.locator('[data-action="select-answer"][data-index="0"]').click();
    await page.locator('[data-action="quiz-next"]').click();
    await expect(page.locator('.question-box')).not.toHaveAttribute('data-question-id', firstRehearsalId);
    await page.locator('[data-action="exit-quiz"]').click();
    await page.locator('#confirm-accept').click();

    await navigate(page, '#lesson/workflow-choice');
    await page.locator('[data-action="lesson-tab"][data-value="check"]').first().click();
    const checkpointQuestions = bank.filter((question) => question.lesson === 'workflow-choice');
    for (let questionIndex = 0; questionIndex < 3; questionIndex += 1) {
      await page.locator(`[data-action="select-answer"][data-index="${checkpointQuestions[questionIndex].correct[0]}"]`).click();
      await page.locator('[data-action="check-answer"]').click();
      await page.locator('[data-action="next-checkpoint"]').click();
    }
    await expect(page.locator('[data-match-index]')).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) await page.locator(`[data-match-index="${index}"]`).selectOption(String(index));
    await expect(page.locator('[data-action="check-answer"]')).toBeEnabled();
    await page.locator('[data-action="check-answer"]').click();
    await expect(page.locator('.answer-feedback h4')).toHaveText('That is the right distinction.');

    await navigate(page, '#recall');
    await page.locator('[data-action="flip-card"]').click();
    await expect(page.locator('#recall-face')).toBeFocused();
    await expect(page.locator('#recall-face')).not.toBeEmpty();
    await expect(page.locator('.recall-ratings')).toBeVisible();
    await page.locator('[data-action="rate-card"][data-value="good"]').click();
    check(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('claude-atlas-v1')).reviews).length > 0), 'Recall rating persists schedule');

    await page.locator('#audio-toggle').click();
    await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => {
      const analyser = window.__analysers.at(-1);
      if (!analyser) return false;
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      return values.some((value) => Math.abs(value) > 0.0001);
    });
    check(true, 'Web Audio produces a non-silent signal after play');
    await page.locator('#sound-select').selectOption('rain');
    await expect(page.locator('#sound-title')).toHaveText('Soft rainfall');
    await page.locator('#audio-toggle').click();
    await expect(page.locator('#audio-toggle')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#timer-toggle').click();
    await expect(page.locator('#focus-duration')).toBeDisabled();
    await page.locator('#timer-toggle').click();
    await expect(page.locator('#focus-duration')).toBeEnabled();
    await page.locator('#timer-reset').click();
    await expect(page.locator('#timer-display')).toHaveText('25:00');

    await page.locator('#search-toggle').click();
    await page.locator('#global-search').fill('hooks');
    await expect(page.locator('#search-results .search-result')).not.toHaveCount(0);
    await page.locator('#search-results a[href="#lesson/hooks"]').click();
    await expect(page.locator('h1')).toHaveText('Make the non-negotiable rules code');
    await page.locator('#focus-toggle').click();
    await expect(page.locator('body')).toHaveClass(/focus-active/);
    await page.screenshot({ path: path.join(results, 'focus-reading.png'), animations: 'disabled' });
    await page.locator('#focus-toggle').click();

    for (const [track, config] of Object.entries(content.tracks)) {
      await page.locator('#track-select').selectOption(track);
      await expect(page.locator('.lesson-card')).toHaveCount(content.lessons.filter((lesson) => lesson.domains[track]).length);
      await navigate(page, '#practice');
      await page.locator('[data-action="practice-mode"][data-value="exam"]').click();
      await expect(page.locator('#practice-count')).toHaveValue(String(config.target));
    }

    await page.locator('[data-action="start-practice"]').click();
    await expect(page.locator('.question-nav button')).toHaveCount(63);
    check(await page.locator('[data-action="check-answer"]').count() === 0, 'Timed mode never offers early answer reveal');
    const savedQuiz = await page.evaluate(() => JSON.parse(localStorage.getItem('claude-atlas-v1-quiz')));
    const matchingIndex = savedQuiz.questions.findIndex((id) => bank.find((question) => question.id === id).kind === 'matching');
    if (matchingIndex >= 0) {
      await page.locator(`[data-action="quiz-jump"][data-index="${matchingIndex}"]`).click();
      const matchingQuestion = bank.find((question) => question.id === savedQuiz.questions[matchingIndex]);
      for (let index = 0; index < matchingQuestion.correct.length; index += 1) await page.locator(`[data-match-index="${index}"]`).selectOption(String(matchingQuestion.correct[index]));
      await expect(page.locator(`[data-action="quiz-jump"][data-index="${matchingIndex}"]`)).toHaveClass(/answered/);
    }
    await page.clock.install();
    await page.clock.setSystemTime(new Date(savedQuiz.deadline + 1000));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.results-header')).toBeVisible();
    await expect(page.locator('.page-heading')).toContainText('Time limit reached');
    check(await page.evaluate(() => localStorage.getItem('claude-atlas-v1-quiz') === null), 'Timed submission clears resumable state');

    await navigate(page, '#progress');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-action="export-progress"]').click();
    const download = await downloadEvent;
    const downloadPath = path.join(results, 'exported-progress.json');
    await download.saveAs(downloadPath);
    const exported = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
    check(exported.version === 1 && exported.completed.includes('first-principles'), 'Export contains real saved progress');
    await page.locator('#import-progress').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":77}') });
    await expect(page.locator('#toast')).toContainText('Import not applied');
    await page.locator('#timer-toggle').click();
    await page.clock.fastForward(120000);
    const replacement = engine.freshProgress();
    replacement.track = 'architect';
    replacement.notes.hooks = 'Imported note';
    replacement.bookmarks = ['hooks'];
    await page.locator('#import-progress').setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
    await page.locator('#confirm-accept').click();
    await expect(page.locator('#track-select')).toHaveValue('architect');
    await expect(page.locator('#focus-duration')).toBeEnabled();
    await expect(page.locator('#timer-display')).toHaveText('25:00');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('claude-atlas-v1')).focusMinutes === 0), 'Import must not inherit pre-import timer activity');
    await navigate(page, '#notebook');
    await page.locator('#notebook-search').fill('');
    await expect(page.locator('.notebook-entry')).toContainText('Imported note');

    await page.locator('#track-select').selectOption('developer');
    await navigate(page, '#practice');
    await page.locator('[data-action="practice-mode"][data-value="learn"]').click();
    await page.locator('#practice-domain').selectOption('models');
    await navigate(page, '#progress');
    await page.locator('[data-action="reset-progress"]').click();
    await page.locator('#confirm-accept').click();
    await navigate(page, '#practice');
    await expect(page.locator('#track-select')).toHaveValue('architect');
    await expect(page.locator('#practice-domain')).toHaveValue('all');
    await page.locator('[data-action="start-practice"]').click();
    await expect(page.locator('.question-box')).toBeVisible();
    await page.locator('[data-action="exit-quiz"]').click();
    await page.locator('#confirm-accept').click();
    await page.clock.fastForward(6000);

    const multiQuestion = bank.find((question) => question.kind === 'multiple' && question.domains.architect);
    await page.addInitScript(({ id }) => {
      if (sessionStorage.getItem('atlas-test-corrupt-selection')) return;
      sessionStorage.setItem('atlas-test-corrupt-selection', 'done');
      localStorage.setItem('claude-atlas-v1-quiz', JSON.stringify({ track: 'architect', mode: 'learn', questions: [id], selections: { [id]: [999, 999] }, checked: {}, flags: [], index: 0, startedAt: Date.now(), deadline: null }));
    }, { id: multiQuestion.id });
    await navigate(page, '#practice');
    await page.reload();
    for (const answer of multiQuestion.correct) await page.locator(`[data-action="select-answer"][data-index="${answer}"]`).click();
    await expect(page.locator('[data-action="check-answer"]')).toBeEnabled();
    await page.locator('[data-action="exit-quiz"]').click();
    await page.locator('#confirm-accept').click();
    await page.addInitScript(({ id }) => {
      if (sessionStorage.getItem('atlas-test-zero-deadline')) return;
      sessionStorage.setItem('atlas-test-zero-deadline', 'done');
      localStorage.setItem('claude-atlas-v1-quiz', JSON.stringify({ track: 'architect', mode: 'exam', questions: [id], selections: {}, checked: {}, flags: [], index: 0, startedAt: Date.now() - 60000, deadline: 0 }));
    }, { id: multiQuestion.id });
    await page.reload();
    await expect(page.locator('.results-header')).toBeVisible();
    await expect(page.locator('.page-heading')).toContainText('Time limit reached');
    await page.locator('[data-action="new-quiz"]').click();

    await navigate(page, '#learn');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');
    await noHorizontalOverflow(page, 'Phone home');
    check(await page.locator('.sound-info').evaluate((element) => element.getBoundingClientRect().width > 100 && element.getBoundingClientRect().height < 40), 'Phone sound title fits without stacked wrapping');
    check(await page.locator('#sidebar').evaluate((sidebar) => sidebar.getBoundingClientRect().right <= 1), 'Mobile navigation hidden until opened');
    check(await page.locator('#sidebar').evaluate((sidebar) => sidebar.inert), 'Closed mobile navigation is inert');
    await page.screenshot({ path: path.join(results, 'mobile.png'), animations: 'disabled' });
    await page.locator('#menu-toggle').click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    check(await page.locator('#sidebar').evaluate((sidebar) => !sidebar.inert), 'Open mobile navigation is interactive');
    await page.locator('#sidebar a[href="#practice"]').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    await noHorizontalOverflow(page, 'Phone practice');
    await page.screenshot({ path: path.join(results, 'mobile-practice.png'), animations: 'disabled' });
    for (const route of ['#lesson/hooks', '#labs/schema', '#labs/cache', '#recall', '#progress', '#library']) {
      await navigate(page, route);
      await noHorizontalOverflow(page, `Phone ${route}`);
    }
    await navigate(page, '#library');
    await page.locator('[data-action="library-tab"][data-value="exam"]').click();
    await expect(page.locator('.exam-brief')).toContainText('Pearson VUE');
    await expect(page.locator('.exam-brief')).toContainText('$125');
    await expect(page.locator('.exam-brief')).toContainText('Single-answer questions');
    await page.locator('[data-action="library-tab"][data-value="sources"]').click();
    await expect(page.locator('#source-udemy a')).toHaveCount(2);
    await expect(page.locator('#source-udemy')).toContainText('IBM Learning access');
    check(await page.locator('.source-card').count() === Object.keys(content.sources).length, 'Every credited public resource is reachable from the reading shelf');
    await page.locator('[data-action="library-tab"][data-value="coverage"]').click();
    await noHorizontalOverflow(page, 'Phone coverage');
    await page.setViewportSize({ width: 320, height: 740 });
    await noHorizontalOverflow(page, 'Small phone coverage');
    await navigate(page, '#learn');
    await noHorizontalOverflow(page, 'Small phone home');
    await page.screenshot({ path: path.join(results, 'small-mobile.png'), animations: 'disabled' });
    await context.setOffline(true);
    if (!server) await page.reload();
    await navigate(page, '#labs/schema');
    await expect(page.locator('#json-input')).toBeVisible();
    await page.locator('[data-action="validate-json"]').click();
    await expect(page.locator('#lab-output > strong')).toHaveText('Layer 3 failed: meaning');
    check(true, 'Loaded study features work without network access');
    check(errors.length === 0, `Browser errors: ${errors.join('\n')}`);
    await verifyLanguages(browser);
    console.log(`Browser verification passed: ${assertions} explicit assertions plus Playwright checks across lessons, labs, practice, reload, audio, recall, search, import/export, and responsive views.`);
    console.log(`Verified ${server ? 'built HTTP site at /claude-atlas/' : 'local file page'}. Screenshots: ${results}`);
    await context.close();
  } finally {
    await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });