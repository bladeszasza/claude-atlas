const { test } = require('node:test');
const assert = require('node:assert/strict');
const content = require('./content.js');
const questions = require('./questions.js');
const engine = require('./engine.js');
const scenarios = require('./scenarios.js');
const i18n = require('./i18n.js');

test('every lesson has progressive content, valid domains, and sources', () => {
  assert.equal(new Set(content.lessons.map((lesson) => lesson.id)).size, content.lessons.length);
  for (const lesson of content.lessons) {
    for (const field of ['simple', 'analogy', 'deep', 'trap', 'recall', 'example']) assert.ok(lesson[field]?.length > 20, `${lesson.id}: ${field}`);
    assert.ok(lesson.points.length >= 3);
    for (const source of lesson.sources) assert.ok(content.sources[source], `${lesson.id}: ${source}`);
    for (const [track, domain] of Object.entries(lesson.domains)) assert.ok(content.tracks[track].domains.some((item) => item.id === domain), `${lesson.id}: ${track}/${domain}`);
  }
});

test('all 30 Architect objectives and all 20 supplemental concepts have coverage', () => {
  const actual = new Set(content.lessons.flatMap((lesson) => lesson.objectives));
  [7, 5, 6, 6, 6].forEach((count, index) => {
    for (let number = 1; number <= count; number++) assert.ok(actual.has(`${index + 1}.${number}`));
  });
  assert.equal(content.supplementMap.length, 20);
  for (const [, , id] of content.supplementMap) assert.ok(content.lessons.some((lesson) => lesson.id === id));
});

test('every question has an unambiguous key, linked lesson, explanation, and valid domain', () => {
  assert.equal(new Set(questions.map((question) => question.id)).size, questions.length);
  for (const question of questions) {
    assert.ok(content.lessons.some((lesson) => lesson.id === question.lesson), question.id);
    assert.ok(question.rationale.length > 30, question.id);
    assert.ok(question.correct.length > 0, question.id);
    assert.ok(question.correct.every((index) => Number.isInteger(index) && index >= 0 && index < question.options.length), question.id);
    if (question.kind !== 'matching') assert.equal(new Set(question.correct).size, question.correct.length);
    else assert.equal(question.items.length, question.correct.length);
    assert.equal(engine.grade(question, question.correct), true);
    for (const [track, domain] of Object.entries(question.domains)) assert.ok(content.tracks[track].domains.some((item) => item.id === domain), question.id);
  }
});

test('every lesson is connected to a practice item', () => {
  for (const lesson of content.lessons) assert.ok(questions.some((question) => question.lesson === lesson.id), lesson.id);
});

test('all four tracks have enough questions for their supplied full-length format', () => {
  for (const [track, config] of Object.entries(content.tracks)) {
    const available = questions.filter((question) => question.domains[track]);
    assert.ok(available.length >= config.target, `${track}: ${available.length}/${config.target}`);
    const sample = engine.weightedSample(questions, track, config.domains, config.target);
    assert.equal(sample.length, config.target);
    for (const domain of config.domains) assert.ok(sample.some((question) => question.domains[track] === domain.id), `${track}/${domain.id}`);
    assert.ok(Math.abs(config.domains.reduce((sum, domain) => sum + domain.weight, 0) - 100) < 0.01);
    console.log(`${track}: ${available.length} practice questions, ${content.lessons.filter((lesson) => lesson.domains[track]).length} lessons`);
  }
});

test('Architect rehearsal draws four intact cases with fifteen single-answer items each', () => {
  assert.equal(scenarios.length, 6);
  const sample = engine.scenarioSample(scenarios);
  assert.equal(sample.length, 60);
  assert.equal(new Set(sample.map((question) => question.id)).size, 60);
  assert.equal(new Set(sample.map((question) => question.caseId)).size, 4);
  for (let index = 0; index < 60; index += 15) {
    assert.equal(new Set(sample.slice(index, index + 15).map((question) => question.caseId)).size, 1);
  }
  assert.ok(sample.every((question) => question.kind === 'single' && question.correct.length === 1 && question.options.length === 4));
});

test('public lessons cite concepts without reproducing source-specific answer keys', () => {
  assert.doesNotMatch(JSON.stringify({ lessons: content.lessons, notes: content.corrections }), /\bQ\d+\.\d+\b/);
  for (const source of Object.values(content.sources)) {
    assert.ok(source.url.startsWith('https://'));
    assert.equal(new URL(source.url).search, '');
  }
});

test('every lesson has selective authored cues without changing its learning text', () => {
  for (const lesson of content.lessons) {
    assert.ok(lesson.signals.length >= 3, lesson.id);
    const parts = engine.signalSegments(lesson.simple, lesson.signals);
    assert.equal(parts.map((part) => part.text).join(''), lesson.simple);
    const cues = parts.filter((part) => part.kind !== 'text');
    assert.ok(cues.length > 0 && cues.length <= 3, `${lesson.id}: ${cues.length} cues`);
    for (const value of [lesson.deep, lesson.trap, ...lesson.points]) {
      assert.equal(engine.signalSegments(value, lesson.signals).map((part) => part.text).join(''), value);
    }
  }
});

test('localization preserves whitespace, dynamic values, code names, and grading identities', () => {
  const locale = { language: 'hu', ui: { 'Learning path': 'Tanulási útvonal' }, patterns: [['Question {0} of {1}', '{0}. kérdés / {1}']], questions: { 'atlas-1': ['Kérdés', ['A', 'B', 'C', 'D'], 'Magyarázat'] } };
  assert.equal(i18n.translate(' Learning path ', locale), ' Tanulási útvonal ');
  assert.equal(i18n.translate('Question 12 of 60', locale), '12. kérdés / 60');
  assert.equal(i18n.translate('tool_use', locale), 'tool_use');
  const localized = i18n.localizeQuestions(questions, locale)[0];
  assert.equal(localized.id, questions[0].id);
  assert.deepEqual(localized.correct, questions[0].correct);
  assert.equal(engine.grade(localized, questions[0].correct), true);
  assert.equal(questions[0].stem.startsWith('A teammate'), true);
});

test('specific localized status templates win over general count templates', () => {
  const dictionaries = require('./locales/ui.js');
  assert.equal(i18n.translate('Question 2 of 60 · 1 answered', { language: 'hu', ...dictionaries.hu }), '2. kérdés / 60 · 1 megválaszolva');
  assert.equal(i18n.translate('10 of 20 correct', { language: 'es', ...dictionaries.es }), '10 de 20 correctas');
});

test('Hungarian and Spanish cover every lesson, question, case, and reference without changing identities', () => {
  const shared = require('./locales/ui.js');
  for (const language of ['hu', 'es']) {
    const locale = { ...require(`./locales/${language}.js`), ...shared[language] };
    const translated = i18n.localizeContent(content, locale);
    assert.deepEqual(Object.keys(locale.lessons).sort(), content.lessons.map((lesson) => lesson.id).sort());
    assert.deepEqual(Object.keys(locale.questions).sort(), questions.map((question) => question.id).sort());
    assert.deepEqual(Object.keys(locale.cases).sort(), scenarios.map((scenario) => scenario.id).sort());
    assert.deepEqual(Object.keys(locale.sources).sort(), Object.keys(content.sources).sort());
    assert.equal(locale.glossary.length, content.glossary.length);
    assert.equal(locale.corrections.length, content.corrections.length);
    assert.equal(locale.supplement.length, content.supplementMap.length);
    for (const [index, lesson] of translated.lessons.entries()) {
      const original = content.lessons[index];
      assert.equal(lesson.id, original.id);
      assert.deepEqual(lesson.domains, original.domains);
      assert.deepEqual(lesson.sources, original.sources);
      for (const field of ['title', 'simple', 'analogy', 'example', 'deep', 'trap', 'recall']) assert.ok(lesson[field]?.trim(), `${language}:${lesson.id}:${field}`);
      assert.notEqual(lesson.simple, original.simple);
      assert.notEqual(lesson.deep, original.deep);
      assert.equal(lesson.points.length, original.points.length);
      assert.equal(Boolean(lesson.examNote), Boolean(original.examNote));
      const segments = engine.signalSegments(lesson.simple, lesson.signals);
      assert.equal(segments.map((segment) => segment.text).join(''), lesson.simple);
      assert.ok(segments.filter((segment) => segment.kind !== 'text').length >= 1, `${language}:${lesson.id}:signals`);
      assert.ok(segments.filter((segment) => segment.kind !== 'text').length <= 3);
    }
    for (const [index, question] of i18n.localizeQuestions(questions, locale).entries()) {
      const original = questions[index];
      assert.equal(question.id, original.id);
      assert.equal(question.kind, original.kind);
      assert.deepEqual(question.correct, original.correct);
      assert.notEqual(question.stem, original.stem);
      assert.notEqual(question.rationale, original.rationale);
      assert.equal(question.options.length, original.options.length);
      assert.equal(new Set(question.options).size, question.options.length);
      assert.equal(engine.grade(question, original.correct), true);
      if (original.kind === 'matching') assert.equal(question.items.length, original.items.length);
    }
    for (const [id, source] of Object.entries(translated.sources)) {
      assert.equal(source.url, content.sources[id].url);
      assert.equal(source.name, content.sources[id].name);
      assert.equal(source.kind, content.sources[id].kind);
      assert.notEqual(source.note, content.sources[id].note);
    }
  }
});