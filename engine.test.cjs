const { test } = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./engine.js');

test('multi-response grading requires the complete set and rejects extras or duplicates', () => {
  const question = { correct: [1, 3] };
  assert.equal(engine.grade(question, [3, 1]), true);
  for (const answer of [[1], [1, 2, 3], [1, 1, 3], [], null]) assert.equal(engine.grade(question, answer), false);
});

test('scenario matching preserves position', () => {
  const question = { kind: 'matching', correct: [0, 1, 0] };
  assert.equal(engine.grade(question, [0, 1, 0]), true);
  assert.equal(engine.grade(question, [1, 0, 0]), false);
});

test('completion is idempotent and practice repeats do not inflate first-attempt accuracy', () => {
  const progress = engine.freshProgress();
  engine.completeLesson(progress, 'loop');
  engine.completeLesson(progress, 'loop');
  assert.deepEqual(progress.completed, ['loop']);
  const question = { id: 'one', correct: [1], domains: { architect: 'agents' } };
  engine.recordAnswer(progress, question, [0]);
  engine.recordAnswer(progress, question, [1]);
  assert.equal(progress.answers.one.correct, true);
  assert.equal(progress.answers.one.firstCorrect, false);
  assert.equal(engine.domainStats([question], progress, 'architect', [{ id: 'agents' }])[0].accuracy, 0);
});

test('weighted sampling meets quotas without duplicate questions and does not mutate its bank', () => {
  const bank = Array.from({ length: 100 }, (_, index) => ({ id: `q${index}`, domains: { architect: index < 70 ? 'agents' : 'tools' } }));
  const sample = engine.weightedSample(bank, 'architect', [{ id: 'agents', weight: 70 }, { id: 'tools', weight: 30 }], 20);
  assert.equal(sample.length, 20);
  assert.equal(new Set(sample.map((question) => question.id)).size, 20);
  assert.equal(sample.filter((question) => question.domains.architect === 'agents').length, 14);
  assert.equal(bank[0].id, 'q0');
});

test('small question pools fill from remaining domains and never manufacture questions', () => {
  const bank = [{ id: 'a', domains: { architect: 'tools' } }, { id: 'b', domains: { architect: 'tools' } }];
  assert.equal(engine.weightedSample(bank, 'architect', [{ id: 'agents', weight: 90 }, { id: 'tools', weight: 10 }], 60).length, 2);
});

test('progress import validates records and treats notes as data', () => {
  assert.throws(() => engine.normalizeProgress({ version: 9 }));
  const progress = engine.normalizeProgress({ version: 1, track: 'invalid', completed: ['one', 'one', 9], notes: { one: '<img onerror="alert(1)">' }, answers: { bad: { attempts: -5 } }, focusMinutes: -4 });
  assert.equal(progress.track, 'architect');
  assert.deepEqual(progress.completed, ['one']);
  assert.deepEqual(progress.answers, {});
  assert.equal(progress.focusMinutes, 0);
  assert.equal(progress.notes.one, '<img onerror="alert(1)">');
});

test('flashcard ratings schedule an actual future review', () => {
  const now = 1000000;
  assert.equal(engine.scheduleReview(null, 'again', now).due, now + 300000);
  assert.equal(engine.scheduleReview(null, 'good', now).interval, 1);
  assert.equal(engine.scheduleReview({ interval: 4 }, 'good', now).interval, 9);
  assert.equal(engine.scheduleReview(null, 'easy', now).interval, 4);
});

test('timers use wall-clock deadlines so background tabs cannot add time', () => {
  assert.equal(engine.remainingSeconds(90000, 75001), 15);
  assert.equal(engine.remainingSeconds(90000, 120000), 0);
});

test('streak allows yesterday before today has been studied', () => {
  const today = new Date(2026, 8, 23, 12).getTime();
  assert.equal(engine.streak(['2026-09-21', '2026-09-22'], today), 2);
  assert.equal(engine.streak(['2026-09-21', '2026-09-23'], today), 1);
});

test('damaged selections leave valid selectable slots after restoration', () => {
  const question = { options: ['one', 'two', 'three', 'four'], correct: [1, 3] };
  assert.deepEqual(engine.normalizeSelection(question, [999, 999]), []);
  assert.deepEqual(engine.normalizeSelection(question, [1, 1, 3, -1]), [1, 3]);
  assert.equal(engine.hasAnswer(question, [-1, -1]), false);
  assert.equal(engine.hasAnswer(question, [1, 1]), false);
  assert.equal(engine.hasAnswer(question, [3, 1]), true);
});

test('timed restoration cannot bypass expiry with zero or an extended deadline', () => {
  const now = 1800000000000;
  assert.equal(engine.restoreDeadline(now - 60000, 0, 120, now), now);
  assert.equal(engine.restoreDeadline(now - 60000, now + 999999999, 120, now), now - 60000 + 120 * 60000);
  assert.equal(engine.restoreDeadline(now - 8000000, now - 800000, 120, now), now - 800000);
  assert.equal(engine.restoreDeadline(now + 1000, now + 7200000, 120, now), now);
});

test('large Unicode notebook exports fit the recovery limit', () => {
  const progress = engine.freshProgress();
  for (let index = 0; index < 48; index += 1) progress.notes[`lesson-${index}`] = '\u6f22'.repeat(20000);
  const serialized = JSON.stringify(progress, null, 2);
  assert.ok(Buffer.byteLength(serialized) > 2000000);
  assert.ok(Buffer.byteLength(serialized) < engine.MAX_PROGRESS_BYTES);
  assert.deepEqual(engine.normalizeProgress(JSON.parse(serialized)).notes, progress.notes);
});

test('learning signals preserve exact text and mark only the first few distinct authored cues', () => {
  const text = 'The runtime checks stop_reason: tool_use, then end_turn. The runtime keeps the result.';
  const cues = [{ text: 'runtime', kind: 'term' }, ...['stop_reason', 'tool_use', 'end_turn'].map((term) => ({ text: term, kind: 'code' }))];
  const parts = engine.signalSegments(text, cues);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(parts.filter((part) => part.kind !== 'text').map((part) => part.text), ['runtime', 'stop_reason', 'tool_use']);
  assert.deepEqual(engine.signalSegments(text, cues, 0), [{ text, kind: 'text' }]);
});

test('signals prefer full phrases, match literal punctuation, and avoid substrings of identifiers', () => {
  const cues = [{ text: 'tool', kind: 'term' }, { text: 'tool result', kind: 'term' }, { text: 'CLAUDE.md', kind: 'code' }, { text: 'tool_use', kind: 'code' }];
  const text = 'Tool result; tool_result; CLAUDE.md; CLAUDExmd; tool_use_extra; tool_use.';
  const parts = engine.signalSegments(text, cues, 10);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(parts.filter((part) => part.kind !== 'text').map((part) => part.text), ['Tool result', 'CLAUDE.md', 'tool_use']);
});

test('signals return text data rather than executable markup', () => {
  const text = '<img src=x onerror=alert(1)> tool_use & "quoted"';
  const parts = engine.signalSegments(text, [{ text: 'tool_use', kind: 'code' }]);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(parts.filter((part) => part.kind !== 'text'), [{ text: 'tool_use', kind: 'code' }]);
});