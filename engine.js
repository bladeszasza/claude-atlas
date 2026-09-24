(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.AtlasEngine = engine;
})(globalThis, function () {
  'use strict';

  const DAY = 86400000;
  const STORAGE_KEY = 'claude-atlas-v1';
  const MAX_PROGRESS_BYTES = 16000000;
  const TRACKS = ['architect', 'developer', 'associate', 'professional'];

  function freshProgress() {
    return {
      version: 1, track: 'architect', completed: [], bookmarks: [], notes: {},
      answers: {}, reviews: {}, sessions: [], activeDays: [], lastLesson: 'first-principles',
      examDate: '', focusMinutes: 0,
    };
  }

  function normalizeProgress(value) {
    if (!value || value.version !== 1) throw new Error('This is not a supported Atlas progress file.');
    const clean = freshProgress();
    const strings = (items) => Array.isArray(items)
      ? [...new Set(items.filter((item) => typeof item === 'string' && item.length < 160))].slice(0, 2000)
      : [];
    clean.track = TRACKS.includes(value.track) ? value.track : 'architect';
    clean.completed = strings(value.completed);
    clean.bookmarks = strings(value.bookmarks);
    clean.activeDays = strings(value.activeDays).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
    clean.lastLesson = typeof value.lastLesson === 'string' ? value.lastLesson.slice(0, 160) : clean.lastLesson;
    clean.examDate = /^\d{4}-\d{2}-\d{2}$/.test(value.examDate || '') ? value.examDate : '';
    clean.focusMinutes = Number.isFinite(value.focusMinutes) ? Math.max(0, Math.min(1000000, value.focusMinutes)) : 0;
    for (const [key, note] of Object.entries(value.notes || {}).slice(0, 1000)) {
      if (typeof note === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)) {
        Object.defineProperty(clean.notes, key, { value: note.slice(0, 20000), writable: true, enumerable: true, configurable: true });
      }
    }
    for (const [key, answer] of Object.entries(value.answers || {}).slice(0, 2000)) {
      if (!answer || !Number.isInteger(answer.attempts) || answer.attempts < 1 || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      clean.answers[key] = {
        attempts: Math.min(answer.attempts, 100000), correct: answer.correct === true,
        firstCorrect: answer.firstCorrect === true, at: Number.isFinite(answer.at) ? answer.at : 0,
      };
    }
    for (const [key, review] of Object.entries(value.reviews || {}).slice(0, 2000)) {
      if (!review || !Number.isFinite(review.due) || !Number.isFinite(review.interval) || ['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      clean.reviews[key] = { due: review.due, interval: Math.max(0, Math.min(365, review.interval)) };
    }
    clean.sessions = (Array.isArray(value.sessions) ? value.sessions : []).filter((entry) =>
      entry && TRACKS.includes(entry.track) && Number.isFinite(entry.at) &&
      Number.isInteger(entry.total) && entry.total > 0 && entry.total <= 500 &&
      Number.isInteger(entry.correct) && entry.correct >= 0 && entry.correct <= entry.total
    ).slice(-100).map(({ track, at, total, correct }) => ({ track, at, total, correct }));
    return clean;
  }

  function normalizeSelection(question, selection) {
    const valid = (answer) => Number.isInteger(answer) && answer >= 0 && answer < question.options.length;
    if (question.kind === 'matching') {
      return question.items.map((item, index) => valid(selection?.[index]) ? selection[index] : -1);
    }
    if (!Array.isArray(selection)) return [];
    return [...new Set(selection.filter(valid))].slice(0, question.correct.length);
  }

  function hasAnswer(question, selection) {
    if (!Array.isArray(selection)) return false;
    const normalized = normalizeSelection(question, selection);
    return normalized.length === question.correct.length &&
      normalized.every((answer, index) => answer >= 0 && answer === selection[index]) &&
      normalized.length === selection.length;
  }

  function restoreDeadline(startedAt, deadline, durationMinutes = 120, now = Date.now()) {
    if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now ||
        !Number.isFinite(deadline) || deadline <= 0) return now;
    return Math.min(deadline, startedAt + durationMinutes * 60000);
  }

  function grade(question, selected) {
    if (!Array.isArray(selected) || !Array.isArray(question.correct)) return false;
    if (question.kind === 'matching') {
      return selected.length === question.correct.length && selected.every((answer, index) => answer === question.correct[index]);
    }
    const unique = [...new Set(selected)];
    return unique.length === selected.length && unique.length === question.correct.length &&
      unique.every((answer) => question.correct.includes(answer));
  }

  function signalSegments(text, signals, limit = 3) {
    const value = String(text ?? '');
    const cues = new Map((signals || []).filter((signal) =>
      signal && typeof signal.text === 'string' && signal.text.length > 1 && ['term', 'code'].includes(signal.kind)
    ).map((signal) => [signal.text.toLowerCase(), signal]));
    if (!cues.size || limit < 1) return [{ text: value, kind: 'text' }];
    const alternatives = [...cues.keys()].sort((left, right) => right.length - left.length)
      .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(alternatives.join('|'), 'giu');
    const word = /[\p{L}\p{N}_]/u;
    const parts = [];
    const used = new Set();
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      const key = match[0].toLowerCase();
      const end = match.index + match[0].length;
      if (used.has(key) || word.test(value[match.index - 1] || '') || word.test(value[end] || '')) continue;
      if (match.index > cursor) parts.push({ text: value.slice(cursor, match.index), kind: 'text' });
      parts.push({ text: match[0], kind: cues.get(key).kind });
      cursor = end;
      used.add(key);
      if (used.size >= limit) break;
    }
    if (cursor < value.length) parts.push({ text: value.slice(cursor), kind: 'text' });
    return parts.length ? parts : [{ text: value, kind: 'text' }];
  }

  function shuffle(items, random = Math.random) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [copy[index], copy[other]] = [copy[other], copy[index]];
    }
    return copy;
  }

  function weightedSample(bank, track, weights, count, random = Math.random) {
    const pool = bank.filter((question) => question.domains[track]);
    const total = Math.min(count, pool.length);
    const weightSum = weights.reduce((sum, domain) => sum + domain.weight, 0);
    const quotas = weights.map((domain) => {
      const exact = total * domain.weight / weightSum;
      return { id: domain.id, quota: Math.floor(exact), remainder: exact % 1 };
    });
    let extra = total - quotas.reduce((sum, domain) => sum + domain.quota, 0);
    for (const domain of [...quotas].sort((left, right) => right.remainder - left.remainder)) {
      if (extra-- > 0) domain.quota += 1;
    }
    const chosen = quotas.flatMap((domain) =>
      shuffle(pool.filter((question) => question.domains[track] === domain.id), random).slice(0, domain.quota)
    );
    const used = new Set(chosen.map((question) => question.id));
    chosen.push(...shuffle(pool.filter((question) => !used.has(question.id)), random).slice(0, total - chosen.length));
    return shuffle(chosen, random);
  }

  function scenarioSample(scenarios, random = Math.random) {
    if (scenarios.length < 4 || scenarios.some((scenario) => scenario.questions.length < 15 ||
        scenario.questions.some((question) => question.kind !== 'single' || question.options.length !== 4))) {
      throw new Error('Exam rehearsal needs four complete single-answer case studies.');
    }
    return shuffle(scenarios, random).slice(0, 4).flatMap((scenario) => shuffle(scenario.questions, random).slice(0, 15));
  }

  function localDay(now = Date.now()) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function touchDay(progress, now = Date.now()) {
    const day = localDay(now);
    if (!progress.activeDays.includes(day)) progress.activeDays.push(day);
    progress.activeDays = progress.activeDays.slice(-730);
  }

  function completeLesson(progress, id, now = Date.now()) {
    if (!progress.completed.includes(id)) progress.completed.push(id);
    progress.lastLesson = id;
    touchDay(progress, now);
    return progress;
  }

  function recordAnswer(progress, question, selected, now = Date.now()) {
    const correct = grade(question, selected);
    const previous = progress.answers[question.id];
    progress.answers[question.id] = {
      attempts: (previous?.attempts || 0) + 1, correct,
      firstCorrect: previous ? previous.firstCorrect : correct, at: now,
    };
    touchDay(progress, now);
    return correct;
  }

  function scheduleReview(previous, rating, now = Date.now()) {
    const last = previous?.interval || 0;
    if (rating === 'again') return { interval: 0, due: now + 5 * 60000 };
    const interval = rating === 'hard' ? Math.max(1, Math.round(last * 1.2)) :
      rating === 'easy' ? Math.max(4, Math.round(last * 3)) : Math.max(1, Math.round(last * 2.2));
    return { interval: Math.min(365, interval), due: now + Math.min(365, interval) * DAY };
  }

  function domainStats(bank, progress, track, domains) {
    return domains.map((domain) => {
      const questions = bank.filter((question) => question.domains[track] === domain.id);
      const seen = questions.map((question) => progress.answers[question.id]).filter(Boolean);
      const correct = seen.filter((answer) => answer.firstCorrect).length;
      return { ...domain, total: questions.length, seen: seen.length, correct, accuracy: seen.length ? Math.round(correct / seen.length * 100) : null };
    });
  }

  function remainingSeconds(deadline, now = Date.now()) {
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  }

  function streak(days, now = Date.now()) {
    const recorded = new Set(days);
    const cursor = new Date(now);
    cursor.setHours(12, 0, 0, 0);
    if (!recorded.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
    let length = 0;
    while (recorded.has(localDay(cursor))) {
      length += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return length;
  }

  return { STORAGE_KEY, MAX_PROGRESS_BYTES, TRACKS, freshProgress, normalizeProgress, normalizeSelection, hasAnswer, restoreDeadline, grade, signalSegments, shuffle, weightedSample, scenarioSample, localDay, touchDay, completeLesson, recordAnswer, scheduleReview, domainStats, remainingSeconds, streak };
});