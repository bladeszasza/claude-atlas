const { test } = require('node:test');
const assert = require('node:assert/strict');
const content = require('./content.js');
const questions = require('./questions.js');
const engine = require('./engine.js');
const scenarios = require('./scenarios.js');

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