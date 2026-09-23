(function () {
  'use strict';
  const content = window.AtlasContent;
  const engine = window.AtlasEngine;
  const bank = window.AtlasQuestions;
  const main = document.getElementById('main');
  const audio = new window.AtlasAudio();
  const icon = (name, className = '') => `<i data-lucide="${name}"${className ? ` class="${className}"` : ''}></i>`;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const lessonById = (id) => content.lessons.find((lesson) => lesson.id === id);
  const questionById = (id) => bank.find((question) => question.id === id);
  const trackConfig = () => content.tracks[progress.track];
  const trackLessons = () => content.lessons.filter((lesson) => lesson.domains[progress.track]).sort((left, right) => left.stage - right.stage);
  const trackBank = () => bank.filter((question) => question.domains[progress.track]);
  let storageProblem = '';
  let progress;
  try {
    const saved = localStorage.getItem(engine.STORAGE_KEY);
    progress = saved ? engine.normalizeProgress(JSON.parse(saved)) : engine.freshProgress();
  } catch (error) {
    progress = engine.freshProgress();
    storageProblem = 'Saved progress could not be loaded. This session is usable; export a backup before closing.';
  }
  let view = 'learn';
  let viewId = '';
  let stageFilter = 'all';
  let lessonTab = 'simple';
  let toastTimer;
  let confirmAction;
  let checkpoint = null;
  let practiceMode = 'learn';
  let practiceDomain = 'all';
  let practiceCount = 10;
  let quiz = null;
  let recallQueue = null;
  let recallIndex = 0;
  let recallRevealed = false;
  let notebookQuery = '';
  let libraryTab = 'sources';
  let audioBusy = false;
  let focusSeconds = 25 * 60;
  let focusDeadline = null;
  let focusStartedAt = null;
  let labState = {};
  const focusCanvas = document.getElementById('sound-wave');
  const focusDrawing = focusCanvas.getContext('2d');
  const iconsForDomain = { agents: 'workflow', tools: 'network', code: 'terminal', prompts: 'braces', reliability: 'shield-check', models: 'sliders-horizontal', integration: 'network', context: 'layers', security: 'lock-keyhole', eval: 'target', prompting: 'pencil', validation: 'circle-check', products: 'compass', workflow: 'route', knowledge: 'library', governance: 'shield-check', troubleshooting: 'search', design: 'workflow', lifecycle: 'route', productivity: 'terminal' };

  function refreshIcons() {
    window.AtlasVendors.createIcons({ icons: window.AtlasVendors.icons, attrs: { 'aria-hidden': 'true' } });
  }

  function save() {
    try {
      localStorage.setItem(engine.STORAGE_KEY, JSON.stringify(progress));
    } catch (error) {
      if (!storageProblem) {
        storageProblem = 'Browser storage is unavailable. Export progress to keep a backup.';
        toast(storageProblem);
      }
    }
    updateSidebar();
  }

  function toast(message) {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('visible'), 4500);
  }

  function confirm(title, message, action, label = 'Continue') {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-accept').textContent = label;
    confirmAction = action;
    document.getElementById('confirm-dialog').showModal();
  }

  function updateSidebar() {
    const lessons = trackLessons();
    document.getElementById('track-select').value = progress.track;
    document.getElementById('lesson-count').textContent = `${lessons.filter((lesson) => progress.completed.includes(lesson.id)).length}/${lessons.length}`;
    const due = lessons.filter((lesson) => !progress.reviews[lesson.id] || progress.reviews[lesson.id].due <= Date.now()).length;
    document.getElementById('recall-count').textContent = due;
    const streak = engine.streak(progress.activeDays);
    document.getElementById('streak-count').textContent = streak ? `${streak} day${streak === 1 ? '' : 's'} of learning` : 'Start your first day';
  }

  function route() {
    const segments = location.hash.slice(1).split('/');
    const requested = segments[0] || 'learn';
    const previousId = viewId;
    view = ['learn', 'lesson', 'labs', 'practice', 'recall', 'notebook', 'progress', 'library'].includes(requested) ? requested : 'learn';
    viewId = segments[1] || '';
    if (view === 'lesson' && !lessonById(viewId)) { view = 'learn'; viewId = ''; }
    if (view === 'library' && ['exam', 'sources', 'corrections', 'glossary', 'coverage'].includes(viewId)) libraryTab = viewId;
    if (view === 'lesson' && viewId !== previousId) { lessonTab = 'simple'; checkpoint = null; }
    if (view === 'labs') labState = {};
    const labels = { learn: 'Learning path', lesson: 'Learning path', labs: 'Scenario lab', practice: 'Practice room', recall: 'Daily recall', notebook: 'My notebook', progress: 'Your progress', library: 'Sources & field guide' };
    document.getElementById('view-name').textContent = labels[view];
    document.querySelectorAll('[data-view]').forEach((link) => {
      const active = link.dataset.view === (view === 'lesson' ? 'learn' : view);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    setDrawer(false);
    document.title = `${view === 'lesson' ? lessonById(viewId).title : labels[view]} | Atlas`;
    render();
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }

  function render() {
    const views = { learn: renderLearn, lesson: renderLesson, labs: renderLabs, practice: renderPractice, recall: renderRecall, notebook: renderNotebook, progress: renderProgress, library: renderLibrary };
    main.innerHTML = `<div class="fade-in">${views[view]()}</div>`;
    updateSidebar();
    refreshIcons();
    if (view === 'lesson') {
      const note = document.getElementById('lesson-note');
      if (note) note.value = progress.notes[viewId] || '';
    }
    if (view === 'labs') updateLab();
  }

  function heading(eyebrow, title, subtitle, actions = '') {
    return `<div class="page-heading"><div><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div>${actions ? `<div class="page-heading-actions">${actions}</div>` : ''}</div>`;
  }

  function domainFor(lesson) {
    return trackConfig().domains.find((domain) => domain.id === lesson.domains[progress.track]) || { name: 'Related learning', color: 'green', id: 'agents' };
  }

  function lessonCard(lesson) {
    const domain = domainFor(lesson);
    const completed = progress.completed.includes(lesson.id);
    return `<a class="lesson-card ${domain.color}${completed ? ' completed' : ''}" href="#lesson/${lesson.id}"><div class="lesson-card-head"><span class="domain-icon ${domain.color}">${icon(iconsForDomain[domain.id] || 'book-open')}</span><span class="lesson-time">${icon(completed ? 'check-check' : 'clock')}${completed ? 'Completed' : `${lesson.minutes} min`}</span></div><h3>${escape(lesson.title)}</h3><div class="lesson-card-foot"><span class="domain-name">${escape(domain.name)}</span>${icon('arrow-up-right')}</div></a>`;
  }

  function renderLearn() {
    const lessons = trackLessons();
    const complete = lessons.filter((lesson) => progress.completed.includes(lesson.id)).length;
    const next = lessons.find((lesson) => !progress.completed.includes(lesson.id)) || lessons[0];
    const studied = trackBank().filter((question) => progress.answers[question.id]);
    const accuracy = studied.length ? Math.round(studied.filter((question) => progress.answers[question.id].firstCorrect).length / studied.length * 100) : null;
    const selected = stageFilter === 'all' ? lessons : lessons.filter((lesson) => lesson.stage === Number(stageFilter));
    return heading('YOUR NEXT CHAPTER', 'Make the concepts click.', trackConfig().description, `<span class="pill">${icon('graduation-cap')}${escape(trackConfig().code)}</span><a class="text-link" href="#progress">Your progress ${icon('arrow-up-right')}</a>`) +
      `<div class="progress-summary"><div>${icon('book-open')}<strong>${complete}<span class="muted"> / ${lessons.length}</span></strong> lessons complete</div><div class="summary-bar" aria-label="${complete} of ${lessons.length} lessons complete"><span style="width:${complete / lessons.length * 100}%"></span></div><div>${icon('target')}<strong>${accuracy === null ? 'Not yet tested' : `${accuracy}%`}</strong>${accuracy === null ? '' : 'first-attempt accuracy'}</div><div>${icon('headphones')}<strong>${Math.floor(progress.focusMinutes)}</strong> focus minutes</div></div>
      <div class="study-grid"><section class="next-lesson"><p class="eyebrow"><span class="status-dot"></span>${complete ? 'CONTINUE YOUR PATH' : 'A GOOD PLACE TO BEGIN'}<span class="small">${next.minutes} MIN</span></p><h2>${escape(next.title)}</h2><p>${escape(next.simple)}</p><div class="button-row"><a class="button primary" href="#lesson/${next.id}">${complete ? 'Continue learning' : 'Start this lesson'} ${icon('arrow-right')}</a><a class="button tertiary" href="#practice">Take a quick check ${icon('arrow-up-right')}</a></div></section><section class="focus-scene"><img src="assets/alpine.jpg" alt="Sunlit mountain peaks above a green alpine valley" fetchpriority="high"><div class="scene-top"><span>THE FOCUS ROOM</span>${icon('headphones')}</div><div class="scene-bottom"><h3>Find your quiet.</h3><p>25 minutes. One small step.</p><button class="scene-button" data-action="start-focus">${icon('play')} Begin a session</button></div></section></div>
      <div class="section-heading"><h2>Your learning path</h2><span class="small">${lessons.length} lessons &middot; ${trackBank().length} practice questions</span></div>
      <div class="filters" role="group" aria-label="Learning stage"><button class="filter-tab ${stageFilter === 'all' ? 'active' : ''}" data-action="filter-stage" data-value="all" aria-pressed="${stageFilter === 'all'}">The whole path</button>${content.stages.map((stage, index) => `<button class="filter-tab ${stageFilter === String(index) ? 'active' : ''}" data-action="filter-stage" data-value="${index}" aria-pressed="${stageFilter === String(index)}">${escape(stage)}</button>`).join('')}</div>
      ${content.stages.map((stage, index) => {
        const group = selected.filter((lesson) => lesson.stage === index);
        return group.length ? `<section class="lesson-group"><div class="group-label"><span class="group-number">${index + 1}</span><strong>${escape(stage)}</strong><span class="small">${group.filter((lesson) => progress.completed.includes(lesson.id)).length} / ${group.length}</span></div><div class="lesson-grid">${group.map(lessonCard).join('')}</div></section>` : '';
      }).join('')}
      <div class="section-heading"><h2>${progress.track === 'architect' ? 'The blueprint, at a glance' : 'Along this side trail'}</h2><a class="text-link" href="#library">Source notes ${icon('arrow-up-right')}</a></div><div class="domain-rail" style="grid-template-columns:repeat(${Math.min(5, trackConfig().domains.length)},minmax(0,1fr))">${trackConfig().domains.map((domain) => `<article class="${domain.color}"><strong>${domain.weight}%</strong><p>${escape(domain.name)}</p></article>`).join('')}</div><p class="lesson-count-line">${progress.track === 'architect' ? 'Domain weights from the official Architect Foundations guide.' : 'Study emphasis adapted from the credited community practice material.'}</p>`;
  }

  function sourceLink(id) {
    const source = content.sources[id];
    if (!source) return '';
    return source.url ? `<a class="source-link" href="${source.url}" target="_blank" rel="noopener noreferrer">${icon('arrow-up-right')}${escape(source.name)}</a>` : `<span class="source-link">${icon('file-text')}${escape(source.name)}</span>`;
  }

  function renderLesson() {
    const lesson = lessonById(viewId);
    const domain = domainFor(lesson);
    progress.lastLesson = lesson.id;
    const lessons = trackLessons();
    const index = lessons.findIndex((item) => item.id === lesson.id);
    const next = lessons[index + 1];
    const previous = index > 0 ? lessons[index - 1] : null;
    const completed = progress.completed.includes(lesson.id);
    const bookmarked = progress.bookmarks.includes(lesson.id);
    const questions = bank.filter((question) => question.lesson === lesson.id);
    let article;
    if (lessonTab === 'simple') {
      article = `<p class="lesson-lead">${escape(lesson.simple)}</p><div class="analogy"><strong>${icon('lightbulb')}A mental model</strong>${escape(lesson.analogy)}</div><section class="lesson-section"><h2>Three things to keep</h2><ol class="concept-list">${lesson.points.map((point) => `<li>${escape(point)}</li>`).join('')}</ol></section><div class="button-row"><button class="button primary" data-action="lesson-tab" data-value="deeper">Go one level deeper ${icon('arrow-right')}</button>${lesson.lab ? `<a class="button tertiary" href="#labs/${lesson.lab}">Try the lab ${icon('flask-conical')}</a>` : ''}</div>`;
    } else if (lessonTab === 'deeper') {
      article = `<section class="lesson-section"><h2>Put it into practice</h2><div class="code-sample"><p class="eyebrow">WORKED EXAMPLE</p><pre>${escape(lesson.example)}</pre></div></section><section class="lesson-section"><h2>Where it gets interesting</h2><p>${escape(lesson.deep)}</p></section><div class="trap-note"><strong>${icon('info')}KEEP THIS DISTINCTION</strong>${escape(lesson.trap)}</div>${lesson.examNote ? `<details class="guide-note"><summary>Exam wording / current tooling</summary><p>${escape(lesson.examNote)}</p>${sourceLink('examGuide')}${sourceLink(lesson.sources[0])}</details>` : ''}<button class="button primary" data-action="lesson-tab" data-value="check">Check your understanding ${icon('arrow-right')}</button>`;
    } else {
      if (!checkpoint || checkpoint.lesson !== lesson.id) checkpoint = { lesson: lesson.id, index: 0, selected: [], checked: false, correct: false, passed: false };
      const question = questions[checkpoint.index % questions.length];
      article = `<p class="lesson-lead">${escape(lesson.recall)}</p><p class="small">${questions.length} original practice checks linked to this lesson.</p>${questionMarkup(question, checkpoint.selected, checkpoint.checked, false, 'checkpoint')}<div class="button-row"><button class="button primary" data-action="complete-lesson" ${checkpoint.passed || completed ? '' : 'disabled'}>${icon(completed ? 'check-check' : 'circle-check')}${completed ? 'Lesson completed' : 'Mark lesson complete'}</button>${lesson.lab ? `<a class="button secondary" href="#labs/${lesson.lab}">${icon('flask-conical')}Try the lab</a>` : ''}</div>${!checkpoint.passed && !completed ? '<p class="small" style="margin-top:12px">A correct checkpoint answer unlocks completion. Your first attempt is kept in the progress record.</p>' : ''}`;
    }
    return `<div class="lesson-top"><a class="text-link" href="#learn">${icon('arrow-left')}Back to the path</a><div class="button-row"><span class="small">${index >= 0 ? `${index + 1} of ${lessons.length}` : 'Supplemental lesson'}</span><button class="icon-button ${bookmarked ? 'bookmark-on' : ''}" data-action="bookmark" data-id="${lesson.id}" aria-label="${bookmarked ? 'Remove bookmark' : 'Bookmark lesson'}" aria-pressed="${bookmarked}" title="Bookmark lesson">${icon('bookmark')}</button></div></div><div class="lesson-layout"><article class="lesson-article"><p class="eyebrow">${escape(content.stages[lesson.stage].toUpperCase())}</p><h1>${escape(lesson.title)}</h1><div class="lesson-meta"><span class="pill">${escape(domain.name)}</span><span>${lesson.minutes} min</span><span>${completed ? 'Completed' : 'In progress'}</span></div><div class="lesson-tabs" role="group" aria-label="Lesson depth">${[['simple', '01  The simple idea'], ['deeper', '02  One level deeper'], ['check', '03  Make it stick']].map(([id, label]) => `<button class="filter-tab ${lessonTab === id ? 'active' : ''}" data-action="lesson-tab" data-value="${id}" aria-pressed="${lessonTab === id}">${label}</button>`).join('')}</div>${article}<section class="lesson-section"><label class="note-label" for="lesson-note">In your own words <span class="small" id="note-status">Saved on this browser</span></label><textarea id="lesson-note" maxlength="20000" placeholder="The idea I want to remember..."></textarea></section><div class="lesson-navigation">${previous ? `<a class="text-link" href="#lesson/${previous.id}">${icon('arrow-left')}Previous lesson</a>` : '<a class="text-link" href="#learn">Back to the path</a>'}${next ? `<a class="button secondary" href="#lesson/${next.id}">Next lesson ${icon('arrow-right')}</a>` : '<a class="button primary" href="#practice">Go to practice room</a>'}</div></article><aside class="lesson-aside"><section class="aside-section"><h3>Your anchor thought</h3><p class="small">${escape(lesson.trap)}</p>${lesson.objectives.length ? `<p class="eyebrow" style="margin-top:23px">ARCHITECT OBJECTIVES</p>${lesson.objectives.map((objective) => `<span class="objective-tag">${objective}</span>`).join('')}` : ''}</section><section class="aside-section"><h3>Follow the evidence</h3>${lesson.sources.map(sourceLink).join('')}<a class="source-link" href="#library">${icon('info')}Source corrections & version notes</a></section><section class="aside-section"><h3>A small practice step</h3><p class="small">${escape(lesson.recall)}</p><button class="text-link" style="border:0;background:none;padding:0" data-action="lesson-tab" data-value="check">Recall it, then check ${icon('arrow-right')}</button></section></aside></div>`;
  }

  function questionMarkup(question, selected, revealed, exam, purpose = 'quiz') {
    const scenario = window.AtlasScenarios.find((item) => item.id === question.caseId);
    const correct = engine.grade(question, selected);
    const needed = question.kind === 'matching' ? question.correct.length : question.correct.length;
    const answerReady = question.kind === 'matching' ? question.items.every((item, index) => Number.isInteger(selected[index]) && selected[index] >= 0) : selected.length === needed;
    const options = question.kind === 'matching' ? question.items.map((item, index) => `<label class="match-row"><span>${index + 1}. ${escape(item)}</span><select data-match-index="${index}" data-purpose="${purpose}" ${revealed ? 'disabled' : ''}><option value="-1">Choose a match</option>${question.options.map((option, optionIndex) => `<option value="${optionIndex}" ${selected[index] === optionIndex ? 'selected' : ''}>${escape(option)}</option>`).join('')}</select></label>`).join('') : `<div class="answer-options" role="group" aria-label="${question.kind === 'multiple' ? `Select ${needed} answers` : 'Select one answer'}">${question.options.map((option, index) => {
      const chosen = selected.includes(index);
      const isCorrect = question.correct.includes(index);
      return `<button class="answer-option${chosen ? ' selected' : ''}${revealed && isCorrect ? ' correct' : ''}${revealed && chosen && !isCorrect ? ' wrong' : ''}" data-action="select-answer" data-index="${index}" data-purpose="${purpose}" aria-pressed="${chosen}" ${revealed ? 'disabled' : ''}><span class="answer-letter">${String.fromCharCode(65 + index)}</span><span>${escape(option)}</span>${revealed && isCorrect ? icon('check', 'option-status') : revealed && chosen ? icon('x', 'option-status') : ''}</button>`;
    }).join('')}</div>`;
    const key = question.kind === 'matching' ? question.correct.map((answer, index) => `${index + 1}: ${question.options[answer]}`).join('; ') : question.correct.map((index) => String.fromCharCode(65 + index)).join(', ');
    const feedback = revealed ? `<div class="answer-feedback ${correct ? '' : 'incorrect'}" tabindex="-1" role="status"><h4>${correct ? 'That is the right distinction.' : 'A useful one to revisit.'}</h4><p><strong>Answer: ${escape(key)}</strong></p><p>${escape(question.rationale)}</p>${purpose === 'checkpoint' ? `<button class="text-link" style="border:0;background:none;padding:0" data-action="next-checkpoint">Another check ${icon('arrow-right')}</button>` : `<a class="text-link" href="#lesson/${question.lesson}">Revisit the concept ${icon('arrow-up-right')}</a>`}<details class="answer-sources"><summary>Go to the source</summary>${lessonById(question.lesson).sources.map(sourceLink).join('')}</details></div>` : '';
    const controls = exam ? `<p class="small">${question.kind === 'matching' ? 'Choose an option for each scenario.' : `Select ${needed === 1 ? 'one answer' : `${needed} answers`}.`} Answers are graded when the session ends.</p>` : `<button class="button primary" data-action="check-answer" data-purpose="${purpose}" ${revealed || !answerReady ? 'disabled' : ''}>Check answer ${icon('arrow-right')}</button>`;
    return `<section class="question-box" data-question-id="${question.id}"><div class="question-eyebrow"><span>${escape(question.scenario.toUpperCase())}</span><span>${question.kind === 'matching' ? 'MATCH EACH' : `SELECT ${needed === 1 ? 'ONE' : needed}`}</span></div>${scenario ? `<details class="case-brief" open><summary>${escape(scenario.title)}</summary><p>${escape(scenario.brief)}</p></details>` : ''}<h3>${escape(question.stem)}</h3>${options}${controls}${feedback}</section>`;
  }

  const scenarios = [
    { name: 'Customer support', title: 'Resolve the case', description: 'Refunds, tool boundaries, verified identity, and the right moment to hand off.', icon: 'headphones', color: 'green' },
    { name: 'Code generation', title: 'Build with intent', description: 'Plan, configure, refactor, and keep earlier evidence from going stale.', icon: 'terminal', color: 'blue' },
    { name: 'Research team', title: 'Coordinate the evidence', description: 'Specialist contexts, shared findings, coverage gaps, and source conflicts.', icon: 'network', color: 'teal' },
    { name: 'Developer productivity', title: 'Navigate the codebase', description: 'Purposeful tools, scoped permissions, and incremental investigation.', icon: 'braces', color: 'yellow' },
    { name: 'Continuous integration', title: 'Make reviews useful', description: 'Headless runs, actionable findings, independent review, and batch timing.', icon: 'workflow', color: 'coral' },
    { name: 'Structured extraction', title: 'Turn documents into data', description: 'Strict shape, semantic checks, bounded repair, and calibrated review.', icon: 'file-text', color: 'blue' },
  ];

  function renderPractice() {
    if (quiz?.finished) return renderQuizResults();
    if (quiz) return renderQuiz();
    const missed = trackBank().filter((question) => progress.answers[question.id] && !progress.answers[question.id].correct).length;
    return heading('TAKE AN IDEA FOR A SPIN', 'The practice room', `${trackConfig().name} · ${trackBank().length} questions to explore.`) +
      `<div class="practice-modes" role="group" aria-label="Practice mode">${[
        ['learn', 'book-open', 'A few good questions', 'Pick an answer. Find the twist. Try another.'],
        ['exam', 'timer', progress.track === 'architect' ? 'Exam rehearsal' : 'The long run', progress.track === 'architect' ? 'Four cases. 60 single-answer questions. 120 minutes.' : `${trackConfig().target} mixed questions. Two hours to think them through.`],
        ['missed', 'repeat-2', 'One more look', `${missed} questions worth a second visit.`],
      ].map(([id, symbol, title, description]) => `<button class="mode-option ${practiceMode === id ? 'selected' : ''}" data-action="practice-mode" data-value="${id}" aria-pressed="${practiceMode === id}">${icon(symbol)}<h3>${title}</h3><p>${description}</p></button>`).join('')}</div>
      <div class="practice-config"><label class="field"><span>Domain</span><select id="practice-domain" ${practiceMode === 'exam' ? 'disabled' : ''}><option value="all">All domains</option>${trackConfig().domains.map((domain) => `<option value="${domain.id}" ${practiceDomain === domain.id ? 'selected' : ''}>${escape(domain.name)}</option>`).join('')}</select></label><label class="field"><span>Session length</span><select id="practice-count" ${practiceMode === 'exam' ? 'disabled' : ''}>${[5, 10, 20, 40].map((count) => `<option value="${count}" ${practiceCount === count ? 'selected' : ''}>${count} questions</option>`).join('')}${practiceMode === 'exam' ? `<option value="${trackConfig().target}" selected>${trackConfig().target} questions</option>` : ''}</select></label><div class="field"><span>${practiceMode === 'exam' ? '120-minute session' : 'Your next practice step'}</span><button class="button primary" data-action="start-practice" ${practiceMode === 'missed' && !missed ? 'disabled' : ''}>${icon(practiceMode === 'exam' ? 'timer' : 'play')}Start ${practiceMode === 'exam' ? 'timed practice' : 'practice'}</button></div></div>
      <p class="practice-footnote">${progress.track === 'architect' ? 'Rehearsal follows the single-answer format in the registered exam guide. Each draw has four original cases; the domain mix varies. ' : 'Side-trail sessions use a mix of question types. '}Results show raw practice accuracy. <a class="text-link" href="#library/exam">Exam brief ${icon('arrow-up-right')}</a></p>
      <div class="section-heading"><h2>Step into a scenario</h2><span class="small">THE SIX FOUNDATIONS FAMILIES</span></div><div class="scenario-grid">${scenarios.map((scenario) => {
        const count = trackBank().filter((question) => question.scenario === scenario.name).length;
        return `<article class="scenario-card ${scenario.color}"><div class="scenario-visual">${icon(scenario.icon)}</div><div class="scenario-card-body"><h3>${scenario.title}</h3><p>${scenario.description}</p><button class="text-link" style="background:none;border:0;padding:0;text-align:left" data-action="scenario-practice" data-scenario="${scenario.name}" ${!count ? 'disabled' : ''}>${count ? `${count} questions` : 'Covered in the Architect track'} ${icon('arrow-right')}</button></div></article>`;
      }).join('')}`;
  }

  function startQuiz(scenario) {
    let pool = trackBank();
    const mode = scenario ? 'learn' : practiceMode;
    if (scenario) pool = pool.filter((question) => question.scenario === scenario);
    else if (practiceDomain !== 'all' && mode !== 'exam') pool = pool.filter((question) => question.domains[progress.track] === practiceDomain);
    if (mode === 'missed') pool = pool.filter((question) => progress.answers[question.id] && !progress.answers[question.id].correct);
    const count = scenario ? pool.length : mode === 'exam' ? trackConfig().target : practiceCount;
    const rehearsal = mode === 'exam' && progress.track === 'architect';
    const questions = rehearsal ? engine.scenarioSample(window.AtlasScenarios) : mode === 'exam' ? engine.weightedSample(pool, progress.track, trackConfig().domains, count) : engine.shuffle(pool).slice(0, count);
    if (!questions.length) return toast('No questions match this selection. Choose another domain or mode.');
    quiz = { track: progress.track, mode, rehearsal, questions, index: 0, selections: {}, checked: {}, flags: [], startedAt: Date.now(), deadline: mode === 'exam' ? Date.now() + 120 * 60000 : null, finished: false };
    persistQuiz();
    if (view !== 'practice') location.hash = '#practice'; else render();
    window.scrollTo(0, 0);
  }

  function persistQuiz() {
    try {
      if (!quiz || quiz.finished) localStorage.removeItem(`${engine.STORAGE_KEY}-quiz`);
      else localStorage.setItem(`${engine.STORAGE_KEY}-quiz`, JSON.stringify({ ...quiz, questions: quiz.questions.map((question) => question.id) }));
    } catch (error) {
      if (!storageProblem) toast('This practice session cannot be saved for reload. Keep this page open.');
    }
  }

  function restoreQuiz() {
    try {
      const saved = JSON.parse(localStorage.getItem(`${engine.STORAGE_KEY}-quiz`) || 'null');
      if (!saved || !engine.TRACKS.includes(saved.track) || !['learn', 'exam', 'missed'].includes(saved.mode) || !Array.isArray(saved.questions)) return;
      const questions = saved.questions.map(questionById).filter(Boolean);
      if (!questions.length || questions.length !== saved.questions.length || new Set(saved.questions).size !== questions.length || questions.some((question) => !question.domains[saved.track])) return;
      const selections = {};
      const checked = {};
      for (const question of questions) {
        selections[question.id] = engine.normalizeSelection(question, saved.selections?.[question.id]);
        if (saved.mode !== 'exam' && saved.checked?.[question.id] === true && engine.hasAnswer(question, selections[question.id])) checked[question.id] = true;
      }
      quiz = { track: saved.track, mode: saved.mode, questions, selections, checked, flags: Array.isArray(saved.flags) ? saved.flags.filter((id) => saved.questions.includes(id)) : [], index: Math.max(0, Math.min(questions.length - 1, Number.isInteger(saved.index) ? saved.index : 0)), startedAt: Number.isFinite(saved.startedAt) ? saved.startedAt : Date.now(), deadline: saved.mode === 'exam' ? engine.restoreDeadline(saved.startedAt, saved.deadline) : null, finished: false };
      quiz.rehearsal = saved.rehearsal === true && saved.track === 'architect' && saved.mode === 'exam' && questions.length === 60 && questions.every((question) => question.caseId && question.kind === 'single');
      if (quiz.rehearsal) quiz.index = Math.min(quiz.index, firstUnanswered());
      progress.track = quiz.track;
    } catch (error) { quiz = null; }
  }

  function isAnswered(question) {
    return engine.hasAnswer(question, quiz.selections[question.id]);
  }

  function firstUnanswered() {
    const index = quiz.questions.findIndex((question) => !isAnswered(question));
    return index < 0 ? quiz.questions.length - 1 : index;
  }

  function formatTime(seconds) {
    const total = Math.max(0, seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const remainder = Math.floor(total % 60);
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function renderQuiz() {
    const question = quiz.questions[quiz.index];
    const answered = quiz.questions.filter(isAnswered).length;
    const flagged = quiz.flags.includes(question.id);
    return `<div class="quiz-header"><div><p class="eyebrow">${quiz.mode === 'exam' ? 'TIMED PRACTICE' : 'PRACTICE SESSION'} &middot; ${escape(content.tracks[quiz.track].name.toUpperCase())}</p><span class="small">Question ${quiz.index + 1} of ${quiz.questions.length} &middot; ${answered} answered</span></div>${quiz.deadline ? `<div class="quiz-clock" id="quiz-clock">${icon('timer')}<span>${formatTime(engine.remainingSeconds(quiz.deadline))}</span></div>` : ''}<button class="button secondary" data-action="exit-quiz">${icon('x')}Exit</button></div><div class="quiz-layout"><div>${questionMarkup(question, quiz.selections[question.id] || [], !!quiz.checked[question.id], quiz.mode === 'exam')}<div class="quiz-navigation"><button class="button secondary" data-action="quiz-prev" ${quiz.index === 0 ? 'disabled' : ''}>${icon('arrow-left')}Previous</button><button class="button secondary ${flagged ? 'bookmark-on' : ''}" data-action="flag-question" aria-pressed="${flagged}">${icon('flag')}${flagged ? 'Flagged' : 'Flag'}</button>${quiz.index === quiz.questions.length - 1 ? '<button class="button primary" data-action="finish-quiz">Finish & review</button>' : `<button class="button primary" data-action="quiz-next">Next ${icon('arrow-right')}</button>`}</div></div><aside class="quiz-aside"><div><h3>Question map</h3><p class="small">Green: answered &middot; Gold dot: flagged</p><div class="question-nav">${quiz.questions.map((item, index) => `<button class="${index === quiz.index ? 'current ' : ''}${isAnswered(item) ? 'answered ' : ''}${quiz.flags.includes(item.id) ? 'flagged' : ''}" data-action="quiz-jump" data-index="${index}" aria-label="Question ${index + 1}${isAnswered(item) ? ', answered' : ''}${quiz.flags.includes(item.id) ? ', flagged' : ''}" ${index === quiz.index ? 'aria-current="step"' : ''}>${index + 1}</button>`).join('')}</div><p class="small">${quiz.mode === 'exam' ? 'The clock continues when this tab is in the background. Unanswered items count as incorrect. Reloading resumes this session.' : 'Check answers as you go. First-attempt accuracy stays separate from your latest result.'}</p></div><button class="button secondary" data-action="finish-quiz">Submit session ${icon('check')}</button></aside></div>`;
  }

  function requestFinish() {
    const unanswered = quiz.questions.filter((question) => !isAnswered(question)).length;
    if (quiz.rehearsal && unanswered) {
      toast('Answer each question before submitting. You can leave the rehearsal with Exit.');
      return;
    }
    confirm('Submit this session?', `${unanswered ? `${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered and will count as incorrect. ` : ''}Your score and explanations will be available after submission.`, () => finishQuiz(), 'Submit session');
  }

  function finishQuiz(expired = false) {
    if (!quiz || quiz.finished) return;
    for (const question of quiz.questions) {
      if (!quiz.checked[question.id]) engine.recordAnswer(progress, question, quiz.selections[question.id] || []);
    }
    quiz.correct = quiz.questions.filter((question) => engine.grade(question, quiz.selections[question.id] || [])).length;
    quiz.finished = true;
    quiz.expired = expired;
    quiz.finishedAt = Date.now();
    progress.sessions.push({ track: quiz.track, at: quiz.finishedAt, total: quiz.questions.length, correct: quiz.correct });
    progress.sessions = progress.sessions.slice(-100);
    save();
    persistQuiz();
    if (view === 'practice') { render(); window.scrollTo(0, 0); }
    if (expired) toast('Time is up. Your practice session has been submitted.');
  }

  function statsMarkup(stats) {
    return stats.map((domain) => `<div class="stats-row ${domain.color}"><strong>${escape(domain.name)}</strong><div class="stats-bar" role="img" aria-label="${escape(domain.name)}: ${domain.accuracy === null ? 'not yet tested' : `${domain.accuracy}%`} "><span style="width:${domain.accuracy || 0}%"></span></div><span class="stats-number">${domain.accuracy === null ? 'Not yet tested' : `${domain.accuracy}% · ${domain.correct}/${domain.seen}`}</span></div>`).join('');
  }

  function renderQuizResults() {
    const percentage = Math.round(quiz.correct / quiz.questions.length * 100);
    const stats = content.tracks[quiz.track].domains.map((domain) => {
      const questions = quiz.questions.filter((question) => question.domains[quiz.track] === domain.id);
      const correct = questions.filter((question) => engine.grade(question, quiz.selections[question.id] || [])).length;
      return { ...domain, seen: questions.length, correct, accuracy: questions.length ? Math.round(correct / questions.length * 100) : null };
    });
    const gaps = [...new Set(quiz.questions.filter((question) => !engine.grade(question, quiz.selections[question.id] || [])).map((question) => question.lesson))];
    return heading('THE NEXT STEP IS CLEARER', 'Your practice debrief', `${content.tracks[quiz.track].name} · ${quiz.expired ? 'Time limit reached' : 'Session submitted'}`, `<button class="button secondary" data-action="new-quiz">${icon('repeat-2')}New session</button>`) + `<div class="results-header"><div class="score-ring" style="--score:${percentage}"><strong>${percentage}%</strong></div><div><h2>${quiz.correct} of ${quiz.questions.length} correct</h2><p>${gaps.length ? `${gaps.length} concepts to revisit. Start with the reasoning, then try a fresh question.` : 'You handled this set well. Test transfer with a new scenario and the official practice material.'}</p><p class="small" style="margin-top:8px">Raw practice score, not an official pass/fail or scaled exam result.</p></div></div><div class="section-heading"><h2>By domain</h2></div>${statsMarkup(stats)}${gaps.length ? `<div class="section-heading"><h2>Your next lessons</h2></div><div class="lesson-grid">${gaps.slice(0, 6).map((id) => lessonCard(lessonById(id))).join('')}</div>` : ''}<div class="section-heading"><h2>Every answer, explained</h2></div>${quiz.questions.map((question, index) => {
      const correct = engine.grade(question, quiz.selections[question.id] || []);
      const selection = quiz.selections[question.id] || [];
      const format = (answers) => question.kind === 'matching' ? question.items.map((item, itemIndex) => `${itemIndex + 1}: ${question.options[answers[itemIndex]] || 'unanswered'}`).join('; ') : answers.length ? answers.map((answer) => `${String.fromCharCode(65 + answer)}. ${question.options[answer]}`).join(' / ') : 'Unanswered';
      return `<details class="result-row ${correct ? '' : 'missed'}"><summary>${icon(correct ? 'circle-check' : 'x')}<span>${index + 1}. ${escape(question.stem)}</span></summary><p><strong>Your answer:</strong> ${escape(format(selection))}</p><p><strong>Correct answer:</strong> ${escape(format(question.correct))}</p><p>${escape(question.rationale)}</p><a class="text-link" href="#lesson/${question.lesson}">Revisit ${escape(lessonById(question.lesson).title)} ${icon('arrow-up-right')}</a></details>`;
    }).join('')}`;
  }

  function renderRecall() {
    if (!recallQueue) recallQueue = trackLessons().filter((lesson) => !progress.reviews[lesson.id] || progress.reviews[lesson.id].due <= Date.now()).sort((left, right) => (progress.reviews[left.id]?.due || 0) - (progress.reviews[right.id]?.due || 0));
    const lesson = recallQueue[recallIndex];
    if (!lesson) return heading('A LITTLE SPACE HELPS IT STICK', 'Daily recall', 'Retrieve the idea before returning to the explanation.') + `<div class="empty-state">${icon('check-check')}<h2>${recallIndex ? 'Your recall session is complete.' : 'Nothing due right now.'}</h2><p>Scheduled cards return when they are due. A practice scenario can test the same ideas in a different setting.</p><div class="button-row" style="justify-content:center"><button class="button secondary" data-action="recall-refresh">Check due cards</button><a class="button primary" href="#practice">Go to practice</a></div></div>`;
    return heading('A LITTLE SPACE HELPS IT STICK', 'Daily recall', 'One question. Say the idea in your own words, then check.') + `<div class="recall-workspace"><div class="recall-toolbar"><span>${recallIndex + 1} / ${recallQueue.length} this session</span><span>${escape(domainFor(lesson).name)}</span></div><section class="flashcard ${recallRevealed ? 'revealed' : ''}" aria-label="Recall card"><div id="recall-face" tabindex="-1"><p class="eyebrow">${recallRevealed ? 'THE ANCHOR IDEA' : 'RECALL BEFORE REVEAL'}</p>${recallRevealed ? `<p>${escape(lesson.simple)}</p><p class="small">${escape(lesson.trap)}</p>` : `<h2>${escape(lesson.recall)}</h2>`}</div><button class="text-link" style="justify-content:center;border:0;background:none" data-action="flip-card" aria-controls="recall-face">${icon('repeat-2')}${recallRevealed ? 'Return to the question' : 'Reveal the explanation'}</button></section>${recallRevealed ? `<div class="recall-ratings">${[['again', 'Again'], ['hard', 'Hard'], ['good', 'Got it'], ['easy', 'Easy']].map(([rating, label]) => {
      const schedule = engine.scheduleReview(progress.reviews[lesson.id], rating);
      return `<button class="rating" data-action="rate-card" data-value="${rating}">${label}<small>${rating === 'again' ? '5 minutes' : `${schedule.interval} day${schedule.interval === 1 ? '' : 's'}`}</small></button>`;
    }).join('')}</div><div class="button-row" style="justify-content:center;margin-top:22px"><a class="text-link" href="#lesson/${lesson.id}">Revisit the lesson ${icon('arrow-up-right')}</a></div>` : ''}</div>`;
  }

  function renderNotebook() {
    const ids = [...new Set([...progress.bookmarks, ...Object.keys(progress.notes).filter((id) => progress.notes[id].trim())])];
    const entries = ids.map(lessonById).filter(Boolean).filter((lesson) => `${lesson.title} ${progress.notes[lesson.id] || ''}`.toLowerCase().includes(notebookQuery.toLowerCase()));
    return heading('KEEP WHAT CLICKED', 'Your notebook', 'Your explanations, questions, and bookmarked concepts.') + `<div class="notebook-toolbar"><label class="sr-only" for="notebook-search">Search notes</label><input id="notebook-search" type="search" placeholder="Search your notes..." value="${escape(notebookQuery)}"><button class="button secondary" data-action="export-notes">${icon('download')}Export notes</button></div>${entries.length ? entries.map((lesson) => `<article class="notebook-entry"><div class="question-eyebrow"><span>${escape(domainFor(lesson).name.toUpperCase())}</span><button class="icon-button ${progress.bookmarks.includes(lesson.id) ? 'bookmark-on' : ''}" data-action="bookmark" data-id="${lesson.id}" aria-label="Toggle bookmark for ${escape(lesson.title)}">${icon('bookmark')}</button></div><h3><a href="#lesson/${lesson.id}">${escape(lesson.title)}</a></h3><p>${escape(progress.notes[lesson.id] || 'Bookmarked. Add your own explanation inside the lesson.')}</p><a class="text-link" href="#lesson/${lesson.id}">${icon('pencil')}Open lesson & notes</a></article>`).join('') : `<div class="empty-state">${icon('notebook-pen')}<h2>${notebookQuery ? 'No matching notes.' : 'Leave yourself a useful trail.'}</h2><p>${notebookQuery ? 'Try another word or return to your learning path.' : 'Your notes and bookmarked lessons will collect here.'}</p><a class="button primary" href="#learn">Back to learning ${icon('arrow-right')}</a></div>`}`;
  }

  function renderProgress() {
    const lessons = trackLessons();
    const completed = lessons.filter((lesson) => progress.completed.includes(lesson.id)).length;
    const questions = trackBank();
    const seen = questions.filter((question) => progress.answers[question.id]);
    const accuracy = seen.length ? Math.round(seen.filter((question) => progress.answers[question.id].firstCorrect).length / seen.length * 100) : null;
    const stats = engine.domainStats(bank, progress, progress.track, trackConfig().domains);
    const weak = [...stats].filter((domain) => domain.seen > 0).sort((left, right) => left.accuracy - right.accuracy)[0];
    const recommended = weak ? lessons.find((lesson) => lesson.domains[progress.track] === weak.id && !progress.completed.includes(lesson.id)) || lessons.find((lesson) => lesson.domains[progress.track] === weak.id) : lessons.find((lesson) => !progress.completed.includes(lesson.id)) || lessons[0];
    const sessions = progress.sessions.filter((session) => session.track === progress.track);
    const days = Array.from({ length: 56 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 55 + index); return engine.localDay(date); });
    let dateNote = 'Set a target date to pace your remaining lessons.';
    if (progress.examDate) {
      const until = Math.ceil((new Date(`${progress.examDate}T23:59:59`).getTime() - Date.now()) / 86400000);
      dateNote = until > 0 ? `${until} days to your target. About ${Math.max(1, Math.ceil((lessons.length - completed) / until))} lesson${Math.ceil((lessons.length - completed) / until) > 1 ? 's' : ''} per day, alongside recall and practice.` : 'Your target date has arrived or passed. Confirm your schedule and use the official readiness assessment.';
    }
    return heading('EVIDENCE OF YOUR PROGRESS', 'Keep the momentum.', trackConfig().name) + `<div class="metrics"><div class="metric">${icon('book-open')}<strong>${completed}<span style="display:inline;font-size:17px"> / ${lessons.length}</span></strong><span>Lessons completed</span></div><div class="metric">${icon('target')}<strong>${accuracy === null ? '--' : `${accuracy}%`}</strong><span>First-attempt accuracy</span></div><div class="metric">${icon('circle-check')}<strong>${seen.length}</strong><span>Unique questions attempted</span></div><div class="metric">${icon('flame')}<strong>${engine.streak(progress.activeDays)}</strong><span>Consecutive study days</span></div></div><p class="small">Progress is local to this browser. Reading completion and repeated practice are not proof of certification readiness. First-attempt accuracy uses each question's first recorded answer, including unanswered submitted items.</p><div class="section-heading"><h2>Where to spend your next session</h2></div><div class="progress-note"><a href="#lesson/${recommended.id}"><strong>${escape(recommended.title)}</strong> ${icon('arrow-up-right')}<br><span class="small">${weak ? `${escape(weak.name)} is your lowest measured domain (${weak.seen} questions). Small samples are noisy.` : 'Start with the first uncompleted lesson, then test it in a new scenario.'}</span></a></div><div class="section-heading"><h2>Domain accuracy</h2><span class="small">FIRST ATTEMPTS &middot; CORRECT / ATTEMPTED</span></div>${statsMarkup(stats)}<div class="section-heading"><h2>Small steps add up</h2><span class="small">LAST 8 WEEKS</span></div><div class="activity-grid">${days.map((day) => `<div class="activity-day ${progress.activeDays.includes(day) ? 'active' : ''}" title="${day}${progress.activeDays.includes(day) ? ': studied' : ': no recorded activity'}" aria-label="${day}${progress.activeDays.includes(day) ? ': studied' : ': no recorded activity'}"></div>`).join('')}</div><div class="progress-tools"><label class="exam-planner">Target date <input type="date" id="exam-date" value="${progress.examDate}" aria-label="Target exam date"></label><div class="button-row"><button class="button secondary" data-action="export-progress">${icon('download')}Export progress</button><button class="button secondary" data-action="import-progress">${icon('upload')}Import</button><button class="icon-button" data-action="reset-progress" aria-label="Reset all study progress" title="Reset progress">${icon('trash-2')}</button></div></div><p class="small">${escape(dateNote)}</p>${storageProblem ? `<div class="notice warning">${escape(storageProblem)}</div>` : ''}<div class="section-heading"><h2>Recent practice</h2></div>${sessions.length ? `<table class="mapping-table"><thead><tr><th>Date</th><th>Questions</th><th>Correct</th><th>Raw score</th></tr></thead><tbody>${sessions.slice(-8).reverse().map((session) => `<tr><td>${new Date(session.at).toLocaleDateString()}</td><td>${session.total}</td><td>${session.correct}</td><td>${Math.round(session.correct / session.total * 100)}%</td></tr>`).join('')}</tbody></table>` : '<p class="small">No submitted sessions yet.</p>'}`;
  }

  function renderLibrary() {
    let body;
    if (libraryTab === 'exam') {
      const exam = content.architectExam;
      body = `<div class="exam-brief"><p class="eyebrow">CLAUDE CERTIFIED ARCHITECT &middot; FOUNDATIONS</p><h2>Know the route before the day.</h2><div class="metrics"><div class="metric"><strong>${exam.questions}</strong><span>Single-answer questions</span></div><div class="metric"><strong>${exam.minutes} min</strong><span>Exam time &middot; about ${exam.seatMinutes} min seat time</span></div><div class="metric"><strong>${exam.scenariosDrawn} of ${exam.scenariosAvailable}</strong><span>Scenarios per sitting</span></div><div class="metric"><strong>${exam.passingScaled}</strong><span>Passing score on the 100-1,000 scale</span></div></div><p class="small">${exam.provider} &middot; Online proctored or test center &middot; $${exam.feeUsd} USD &middot; ${exam.validityMonths}-month credential</p><p class="small">Guide v${exam.guideVersion}, ${exam.guideDate}. Pricing and scheduling follow the current provider terms.</p><div class="button-row"><a class="button primary" href="${content.sources.pearson.url}" target="_blank" rel="noopener noreferrer">Pearson VUE ${icon('arrow-up-right')}</a><a class="button secondary" href="${content.sources.examGuide.url}" target="_blank" rel="noopener noreferrer">Read the exam guide ${icon('arrow-up-right')}</a></div></div><div class="section-heading"><h2>Before you sit down</h2></div><ol class="concept-list"><li>Register through the certification portal, then use Pearson VUE to schedule. Check your inbox for account setup details.</li><li>Bring a valid government-issued ID matching your registration. Request any accommodations before scheduling.</li><li>The registered guide requires one answer before advancing. Atlas rehearsal uses that format; mixed drills are for exploring the ideas.</li><li>Keep study tools, AI assistance, notes, and unauthorized devices outside the exam session. Read the provider's current rules before exam day.</li></ol><details class="guide-note"><summary>Format and retake notes</summary><p>The registered guide and welcome page specify single-answer questions. The public overview also mentions multiple response, so check your appointment's guide if the format changes. Pearson currently lists waits of 14, 30, and 90 days between attempts, with four attempts allowed in a rolling twelve months.</p><p>Atlas reports practice percentages. The official 720 is a scaled score, not a 72% raw-score threshold.</p>${sourceLink('certification')}${sourceLink('pearson')}</details><div class="section-heading"><h2>The official documents</h2></div>${['examGuide', 'examPolicy', 'certificationTerms'].map(sourceLink).join('')}`;
    } else if (libraryTab === 'corrections') body = `<p class="field-intro">A few details worth keeping straight. The exam guide sets the study scope; current documentation sets the implementation contract.</p>${content.corrections.map((correction) => `<article class="correction"><h3>${escape(correction.title)}</h3><p>${escape(correction.text)}</p>${sourceLink(correction.source)}</article>`).join('')}`;
    else if (libraryTab === 'glossary') body = `<div class="glossary">${content.glossary.map(([term, definition, id]) => `<a href="#lesson/${id}"><strong>${escape(term)} ${icon('arrow-up-right')}</strong><p>${escape(definition)}</p></a>`).join('')}</div>`;
    else if (libraryTab === 'coverage') body = `<p class="field-intro">Follow an objective back to its lesson, then take it into a lab. Read the full scope in the <a class="text-link" href="${content.sources.examGuide.url}" target="_blank" rel="noopener noreferrer">official guide</a>.</p><div class="section-heading"><h2>The Architect trail</h2><span class="small">30 OBJECTIVE ANCHORS</span></div><table class="mapping-table"><thead><tr><th>Objective</th><th>Explore it here</th></tr></thead><tbody>${[7, 5, 6, 6, 6].flatMap((count, index) => Array.from({ length: count }, (_, number) => `${index + 1}.${number + 1}`)).map((objective) => `<tr><td>${objective}</td><td>${content.lessons.filter((lesson) => lesson.objectives.includes(objective)).map((lesson) => `<a href="#lesson/${lesson.id}">${escape(lesson.title)}</a>`).join(' &middot; ')}</td></tr>`).join('')}</tbody></table><div class="section-heading"><h2>A detour through API essentials</h2></div><table class="mapping-table"><thead><tr><th>Stop</th><th>Concept</th><th>Lesson</th></tr></thead><tbody>${content.supplementMap.map(([number, topic, id]) => `<tr><td>${number}</td><td>${escape(topic)}</td><td><a href="#lesson/${id}">${escape(lessonById(id).title)}</a></td></tr>`).join('')}</tbody></table>`;
    else {
      const entries = Object.entries(content.sources);
      const groups = [
        ['Learn at the source', entries.filter(([, source]) => source.kind.startsWith('Anthropic course'))],
        ['More paths to explore', entries.filter(([, source]) => ['Community course', 'Community guide', 'Author credit', 'Udemy course'].includes(source.kind))],
        ['Keep the reference open', entries.filter(([, source]) => ['Official documentation', 'Official specification', 'Official SDK', 'Official examples', 'Anthropic engineering'].includes(source.kind))],
        ['The certification desk', entries.filter(([, source]) => ['Official certification', 'Official exam guide', 'Official policy', 'Official terms', 'Exam scheduling', 'Official courses & exam portal'].includes(source.kind))],
        ['The materials behind the room', entries.filter(([, source]) => ['Visual credit', 'Photo credit', 'Implementation reference'].includes(source.kind))],
      ];
      body = `<p class="field-intro">Atlas takes these ideas for a walk: small explanations, hands-on experiments, and a quieter place to practice. The full courses and references live with their authors.</p>${groups.map(([title, sources]) => `<div class="section-heading"><h2>${title}</h2></div><div class="source-grid">${sources.map(([id, source]) => `<article class="source-card" id="source-${id}"><p class="eyebrow">${escape(source.kind.toUpperCase())}</p><h3>${escape(source.name)}</h3><p>${escape(source.note)}</p><div class="button-row"><a class="text-link" href="${source.url}" target="_blank" rel="noopener noreferrer">Open resource ${icon('arrow-up-right')}</a>${source.accessUrl ? `<a class="text-link" href="${source.accessUrl}" target="_blank" rel="noopener noreferrer">IBM Learning access ${icon('arrow-up-right')}</a>` : ''}</div></article>`).join('')}</div>`).join('')}<details class="guide-note"><summary>A note on this little room</summary><p>Atlas is a community study companion. Lessons and case studies are independently written; original courses, exam materials, and trademarks stay with their owners.</p><p>Soundscapes are generated here using Web Audio. Brain.fm opens as a separate service. Keep the volume comfortable.</p><p>Notes and progress stay in this browser. Export a backup before clearing site data or changing devices. GitHub Pages handles delivery of the public site; external resources follow their own privacy terms.</p></details>`;
    }
    return heading('FOLLOW YOUR CURIOSITY', 'The field guide', `Good places to go deeper. Updated ${content.reviewed}.`) + `<div class="filters" role="group" aria-label="Field guide section">${[['sources', 'The reading shelf'], ['exam', 'Exam brief'], ['corrections', 'Version notes'], ['glossary', 'Plain English'], ['coverage', 'Trail map']].map(([id, label]) => `<button class="filter-tab ${libraryTab === id ? 'active' : ''}" data-action="library-tab" data-value="${id}" aria-pressed="${libraryTab === id}">${label}</button>`).join('')}</div>${body}`;
  }

  const labs = [
    { id: 'loop', title: 'The agent loop', icon: 'workflow', lesson: 'agent-loop', description: 'Follow a tool request all the way to the next model turn.' },
    { id: 'architecture', title: 'Architecture choices', icon: 'network', lesson: 'workflow-choice', description: 'Choose the simplest system that handles the uncertainty.' },
    { id: 'policy', title: 'The refund gate', icon: 'shield-check', lesson: 'hooks', description: 'Put a deterministic check between a request and its side effect.' },
    { id: 'schema', title: 'The JSON workbench', icon: 'braces', lesson: 'schemas', description: 'See the difference between syntax, shape, and meaning.' },
    { id: 'context', title: 'The context budget', icon: 'layers', lesson: 'context', description: 'Preserve exact facts while making room for the active task.' },
    { id: 'cache', title: 'The cache prefix', icon: 'repeat-2', lesson: 'caching', description: 'Find which part of the request is actually reusable.' },
    { id: 'config', title: 'Where does it live?', icon: 'terminal', lesson: 'instructions', description: 'Route team rules, skills, and connection settings to their proper homes.' },
    { id: 'prompt', title: 'The prompt brief', icon: 'pencil', lesson: 'prompt-brief', description: 'Turn a vague request into an explicit, reviewable brief.' },
    { id: 'calibration', title: 'Behind the average', icon: 'target', lesson: 'calibration', description: 'Find the weak segment hidden inside an impressive overall number.' },
  ];

  function renderLabs() {
    const lab = labs.find((item) => item.id === viewId) || labs[0];
    viewId = lab.id;
    const lesson = lessonById(lab.lesson);
    let stage = '';
    if (lab.id === 'loop') {
      stage = `<div class="sim-flow">${['Request', 'Model', 'Tool gate', 'Tool result', 'Next turn'].map((name, index) => `<div class="flow-node" data-loop-step="${index}">${name}</div>${index < 4 ? icon('arrow-right') : ''}`).join('')}</div><div id="lab-output" class="sim-output" role="status"></div><div class="button-row"><button class="button primary" data-action="loop-step">Next step ${icon('arrow-right')}</button><button class="icon-button" data-action="lab-reset" title="Reset simulation" aria-label="Reset simulation">${icon('rotate-ccw')}</button></div>`;
    } else if (lab.id === 'architecture') {
      stage = `<label class="field"><span>Task</span><select id="architecture-case"><option value="0">The same validated three-stage invoice process</option><option value="1">Investigate an outage as each new log arrives</option><option value="2">Independent specialist assessments with different tools</option><option value="3">Translate a supplied paragraph with a glossary</option><option value="4">Stable invoice flow with rare ambiguous exceptions</option></select></label><div class="lab-choices">${['Single augmented call', 'Fixed workflow', 'Autonomous agent', 'Multi-agent system', 'Workflow + exception agent'].map((name, index) => `<button class="lab-choice" data-action="architecture-answer" data-index="${index}">${name}</button>`).join('')}</div><div id="lab-output" class="sim-output" role="status"><strong>A decision, not a popularity contest.</strong><p>Which design best matches the task?</p></div>`;
    } else if (lab.id === 'policy') {
      stage = `<div class="lab-controls"><label for="refund-amount">Refund amount</label><input id="refund-amount" type="range" min="0" max="1000" step="25" value="650"><output id="refund-value">$650</output></div><label class="check-label"><input type="checkbox" id="verified-customer" checked>Verified customer identity</label><label class="check-label"><input type="checkbox" id="enforce-policy" checked>Enforce the $500 cap in code</label><div class="code-sample"><p class="eyebrow">SIMULATED POLICY</p><pre>if (!verified) deny("Verify identity");\nif (amount > 500) deny("Human approval required");\notherwise: allow the authorized operation;</pre></div><div id="lab-output" class="sim-output" role="status"></div><button class="button primary" data-action="policy-run">${icon('play')}Attempt simulated refund</button>`;
    } else if (lab.id === 'schema') {
      stage = `<p>Source invoice: <strong>2 items, $40 and $25. Total $65. No tax ID provided.</strong></p><div class="button-row" style="margin-bottom:15px"><button class="button secondary" data-action="json-example" data-value="syntax">Broken syntax</button><button class="button secondary" data-action="json-example" data-value="semantic">Wrong total</button><button class="button secondary" data-action="json-example" data-value="valid">Valid extraction</button></div><label class="sr-only" for="json-input">Invoice JSON to validate</label><textarea id="json-input" class="json-editor" spellcheck="false">{\n  "total": 80,\n  "line_items": [40, 25],\n  "tax_id": null\n}</textarea><div class="button-row" style="margin-top:15px"><button class="button primary" data-action="validate-json">${icon('circle-check')}Validate</button></div><div id="lab-output" class="sim-output" role="status"><strong>Three layers of validation</strong><p>Parse JSON, check its schema, then verify totals and source agreement.</p></div>`;
    } else if (lab.id === 'context') {
      stage = `<div class="lab-controls"><label for="context-turns">Conversation turns</label><input id="context-turns" type="range" min="5" max="60" value="35"><output id="context-value">35</output></div><label class="check-label"><input id="context-trim" type="checkbox">Trim verbose tool outputs</label><label class="check-label"><input id="context-summarize" type="checkbox">Summarize resolved turns</label><label class="check-label"><input id="context-pin" type="checkbox">Keep exact case facts outside summaries</label><div class="context-meter" id="context-meter" role="img" aria-label="Illustrative context use"></div><div class="meter-key"><span><b style="background:#77a75e"></b>Rules & facts</span><span><b style="background:#6b97b5"></b>History</span><span><b style="background:#d29878"></b>Tool results</span><span><b style="background:#d2bf68"></b>Output reservation</span></div><div id="lab-output" class="sim-output" role="status"></div>`;
    } else if (lab.id === 'cache') {
      stage = `<p>The policy, examples, and tool descriptions are identical on every request. The request ID changes every time.</p><div id="cache-blocks"></div><div id="lab-output" class="sim-output" role="status"></div>`;
    } else if (lab.id === 'config') {
      const prompts = ['Universal team coding conventions', 'Rules for test files across directories', 'An occasional release-note workflow', 'Shared MCP server definition', 'Permissions and tool lifecycle hooks'];
      const choices = ['Choose a location', 'Project CLAUDE.md', '.claude/rules/ with paths globs', '.claude/skills/<name>/SKILL.md', 'Project-root .mcp.json', '.claude/settings.json'];
      stage = prompts.map((prompt, index) => `<label class="config-row"><span>${index + 1}. ${prompt}</span><select data-config-index="${index}">${choices.map((choice, option) => `<option value="${option - 1}">${escape(choice)}</option>`).join('')}</select></label>`).join('') + '<div class="button-row" style="margin-top:20px"><button class="button primary" data-action="check-config">Check placement</button></div><div id="lab-output" class="sim-output" role="status"><p>Match each responsibility to the configuration that owns it.</p></div>';
    } else if (lab.id === 'prompt') {
      stage = `<div class="form-grid"><label class="field"><span>Deliverable</span><input id="brief-task" type="text" value="Summarize the incident report" maxlength="500"></label><label class="field"><span>Audience</span><input id="brief-audience" type="text" value="Non-technical executives" maxlength="500"></label><label class="field"><span>Evidence</span><input id="brief-evidence" type="text" value="The supplied incident report only" maxlength="500"></label><label class="field"><span>Format & constraints</span><input id="brief-format" type="text" value="180 words: impact, cause, next steps" maxlength="500"></label><label class="field wide"><span>Missing information</span><input id="brief-missing" type="text" value="Say not provided; do not invent an amount or date" maxlength="500"></label></div><div class="code-sample"><p class="eyebrow">YOUR BRIEF</p><pre id="brief-preview"></pre></div><div class="button-row" style="margin-top:18px"><button class="button secondary" data-action="save-brief">${icon('notebook-pen')}Keep in notebook</button></div><div id="lab-output" class="sim-output" role="status"></div>`;
    } else if (lab.id === 'calibration') {
      stage = `<p>900 typed invoices are <strong>99% accurate</strong>. The smaller group contains 100 handwritten invoices.</p><div class="lab-controls"><label for="segment-accuracy">Handwritten accuracy</label><input id="segment-accuracy" type="range" min="0" max="100" value="79"><output id="segment-value">79%</output></div><div class="metrics" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="metric"><strong id="aggregate-value">97%</strong><span>Overall accuracy</span></div><div class="metric"><strong id="segment-errors">21</strong><span>Errors in the handwritten segment</span></div></div><div id="lab-output" class="sim-output" role="status"></div>`;
    }
    return heading('LEARN IT BY CHANGING SOMETHING', 'The scenario lab', 'A small experiment makes the mechanism easier to remember.') + `<div class="lab-tabs" role="group" aria-label="Interactive lab">${labs.map((item) => `<button class="${lab.id === item.id ? 'active' : ''}" data-action="open-lab" data-value="${item.id}" aria-pressed="${lab.id === item.id}">${icon(item.icon)}${item.title}</button>`).join('')}</div><div class="lab-layout"><section class="lab-stage"><span class="simulation-tag">LOCAL SIMULATION &middot; NO AI REQUESTS</span><h2>${lab.title}</h2><p>${lab.description}</p>${stage}</section><aside class="lab-aside"><h3>The concept behind the control</h3><p>${escape(lesson.simple)}</p><div class="trap-note"><strong>The important boundary</strong>${escape(lesson.trap)}</div><a class="text-link" href="#lesson/${lesson.id}">Open the full lesson ${icon('arrow-up-right')}</a></aside></div>`;
  }

  function labOutput(title, text, failed = false) {
    const output = document.getElementById('lab-output');
    if (!output) return;
    output.classList.toggle('failed', failed);
    output.innerHTML = `<strong>${escape(title)}</strong><p>${escape(text)}</p>`;
  }

  function updateLab() {
    if (viewId === 'loop') {
      const step = labState.step || 0;
      const phases = [
        ['1. A request enters', 'The user asks about order ORD-81. The runtime sends instructions, relevant history, and the available tools.'],
        ['2. The model requests a tool', 'stop_reason = tool_use. The assistant includes lookup_order with call ID call_7. Text in this response does not make the turn complete.'],
        ['3. The runtime checks permission', 'The service verifies the caller may access ORD-81. If the gate fails, no lookup or consequential action is authorized by prompt text.'],
        ['4. Execution becomes context', 'The runtime appends the assistant response and a user-role tool_result referring to call_7. It returns the actual permitted result, not an empty success.'],
        ['5. A new model turn', 'The next request includes the tool result. stop_reason = end_turn ends this assistant turn; application checks still determine whether the customer issue is resolved.'],
      ];
      document.querySelectorAll('[data-loop-step]').forEach((node, index) => { node.classList.toggle('active', index === step); node.classList.toggle('past', index < step); });
      labOutput(...phases[step]);
      const button = document.querySelector('[data-action="loop-step"]');
      button.innerHTML = `${step === 4 ? 'Run it again' : 'Next step'} ${icon(step === 4 ? 'rotate-ccw' : 'arrow-right')}`;
      refreshIcons();
    } else if (viewId === 'policy') {
      document.getElementById('refund-value').textContent = `$${document.getElementById('refund-amount').value}`;
      if (labState.attempted) runPolicy();
      else labOutput('Ready at the execution boundary', 'The model is proposing a refund. No payment is sent in this local simulation.');
    } else if (viewId === 'context') {
      const turns = Number(document.getElementById('context-turns').value);
      const trim = document.getElementById('context-trim').checked;
      const summarize = document.getElementById('context-summarize').checked;
      const pin = document.getElementById('context-pin').checked;
      const budget = 16000;
      const amounts = [900 + (pin ? 200 : 0), summarize ? 2000 + turns * 20 : turns * 120, turns * (trim ? 100 : 500), 2000];
      const total = amounts.reduce((sum, amount) => sum + amount, 0);
      const colors = ['#77a75e', '#6b97b5', '#d29878', '#d2bf68'];
      document.getElementById('context-value').textContent = turns;
      document.getElementById('context-meter').innerHTML = amounts.map((amount, index) => `<span style="width:${amount / Math.max(budget, total) * 100}%;background:${colors[index]}" title="${amount} illustrative tokens"></span>`).join('');
      labOutput(`${total.toLocaleString()} / ${budget.toLocaleString()} illustrative tokens`, `${total > budget ? 'This example exceeds its budget. Trim payloads and summarize resolved work. ' : 'The example fits the budget. Fitting does not itself prove good attention. '}${summarize && !pin ? 'Exact identifiers and amounts remain at risk in a lossy summary.' : pin ? 'Exact case facts are preserved separately from summaries.' : 'Keep precise case facts separate before compressing history.'} Counts are a teaching model, not a real tokenizer.`, total > budget || (summarize && !pin));
    } else if (viewId === 'cache') {
      labState.blocks ||= [
        { name: 'Request ID & timestamp', tokens: 80, dynamic: true },
        { name: 'Shared policy', tokens: 4000, dynamic: false },
        { name: 'Tool descriptions', tokens: 2000, dynamic: false },
        { name: 'Worked examples', tokens: 1000, dynamic: false },
      ];
      let stable = 0;
      for (const block of labState.blocks) { if (block.dynamic) break; stable += block.tokens; }
      document.getElementById('cache-blocks').innerHTML = labState.blocks.map((block, index) => `<div class="cache-block ${block.dynamic ? 'dynamic' : ''}"><span class="block-num">0${index + 1}</span><span class="block-name">${block.name}<br><small>${block.tokens.toLocaleString()} illustrative tokens &middot; ${block.dynamic ? 'changes every request' : 'stable'}</small></span><button class="icon-button" data-action="move-cache" data-index="${index}" data-direction="-1" ${index === 0 ? 'disabled' : ''} aria-label="Move ${block.name} up">${icon('arrow-up')}</button><button class="icon-button" data-action="move-cache" data-index="${index}" data-direction="1" ${index === labState.blocks.length - 1 ? 'disabled' : ''} aria-label="Move ${block.name} down">${icon('arrow-down')}</button></div>`).join('');
      labOutput(`${stable.toLocaleString()} stable prefix tokens`, `${stable ? 'These stable tokens precede the first changing block and can be candidates for reuse. ' : 'The first block changes, so none of the later static material forms a matching prefix. '}Actual caching also needs supported cache configuration, matching content, the model-specific size floor, and an unexpired cache entry.`, stable === 0);
      refreshIcons();
    } else if (viewId === 'prompt') {
      const values = ['brief-task', 'brief-audience', 'brief-evidence', 'brief-format', 'brief-missing'].map((id) => document.getElementById(id).value.trim());
      const labels = ['Task', 'Audience', 'Evidence', 'Output', 'Missing information'];
      document.getElementById('brief-preview').textContent = values.map((value, index) => `${labels[index]}: ${value || '[not specified]'}`).join('\n\n');
      const defined = values.filter(Boolean).length;
      labOutput(`${defined} / 5 brief components specified`, 'This is a deterministic template, not an AI quality grade. Clear inputs reduce ambiguity; test the resulting output against evidence and your rubric.');
    } else if (viewId === 'calibration') {
      const accuracy = Number(document.getElementById('segment-accuracy').value);
      const overall = (891 + accuracy) / 10;
      document.getElementById('segment-value').textContent = `${accuracy}%`;
      document.getElementById('aggregate-value').textContent = `${Number(overall.toFixed(1))}%`;
      document.getElementById('segment-errors').textContent = 100 - accuracy;
      labOutput('The small segment still counts', `${100 - accuracy} errors among 100 handwritten invoices can hide behind ${Number(overall.toFixed(1))}% overall accuracy. Measure each relevant segment, calibrate review routing, and audit high-confidence cases after automation.`, accuracy < 90);
    }
  }

  function runPolicy() {
    const amount = Number(document.getElementById('refund-amount').value);
    const verified = document.getElementById('verified-customer').checked;
    const enforced = document.getElementById('enforce-policy').checked;
    if (!verified) labOutput('BLOCKED: identity prerequisite', 'No action is executed. Verification is enforced independently of the proposed amount. A customer-provided name is not proof of authority.', true);
    else if (enforced && amount > 500) labOutput('BLOCKED: human approval required', `The proposed $${amount} refund exceeds the $500 autonomous cap. Return a structured policy error and route to approved human review.`, true);
    else if (!enforced && amount > 500) labOutput('NO ENFORCED CAP: unsafe proposal could execute', 'With the amount gate disabled, this simulation has no code barrier to the over-cap operation. A prompt may discourage it but cannot replace the missing check.', true);
    else labOutput('ALLOWED by the simulated checks', `$${amount} is within the cap and identity is verified. Production still needs order-level authorization, amount validation, idempotency, and a reliable backend policy check.`);
    labState.attempted = true;
  }

  function validateJson() {
    let payload;
    try { payload = JSON.parse(document.getElementById('json-input').value); }
    catch (error) { labOutput('Layer 1 failed: JSON syntax', `A standard parser rejected the text: ${error.message}. No downstream operation should consume it.`, true); return; }
    const validator = new window.AtlasVendors.Ajv({ allErrors: true });
    const schema = { type: 'object', properties: { total: { type: 'number', minimum: 0 }, line_items: { type: 'array', minItems: 1, items: { type: 'number', minimum: 0 } }, tax_id: { type: ['string', 'null'] } }, required: ['total', 'line_items', 'tax_id'], additionalProperties: false };
    if (!validator.validate(schema, payload)) {
      labOutput('Layer 2 failed: schema', validator.errors.map((error) => `${error.instancePath || 'root'} ${error.message}`).join('; '), true);
      return;
    }
    const sum = payload.line_items.reduce((total, item) => total + item, 0);
    const violations = [];
    if (Math.abs(sum - payload.total) > 0.001) violations.push(`items sum to ${sum}, not ${payload.total}`);
    if (payload.total !== 65 || payload.line_items.length !== 2 || [...payload.line_items].sort((left, right) => left - right).join(',') !== '25,40') violations.push('values do not match the provided invoice');
    if (payload.tax_id !== null) violations.push('tax ID must be null because the source does not provide it');
    if (violations.length) labOutput('Layer 3 failed: meaning', `Valid JSON and a valid schema are not enough: ${violations.join('; ')}. Repair against the source, with a retry cap.`, true);
    else labOutput('All three local checks passed', 'JSON parses, required fields and types conform, amounts match the source and sum correctly, and absent information remains null. These checks cover this small example, not every possible invoice.');
  }

  function chooseAnswer(index, purpose) {
    const state = purpose === 'checkpoint' ? checkpoint : quiz;
    if (!state) return;
    const question = purpose === 'checkpoint' ? bank.filter((item) => item.lesson === checkpoint.lesson)[checkpoint.index] : quiz.questions[quiz.index];
    if (purpose === 'checkpoint' ? checkpoint.checked : quiz.checked[question.id]) return;
    let selected = purpose === 'checkpoint' ? [...checkpoint.selected] : [...(quiz.selections[question.id] || [])];
    if (question.correct.length === 1) selected = [index];
    else if (selected.includes(index)) selected = selected.filter((item) => item !== index);
    else if (selected.length < question.correct.length) selected.push(index);
    else return toast(`Select exactly ${question.correct.length}. Deselect an option to change your answer.`);
    if (purpose === 'checkpoint') checkpoint.selected = selected;
    else { quiz.selections[question.id] = selected; persistQuiz(); }
    rerenderAtPosition(`[data-action="select-answer"][data-index="${index}"][data-purpose="${purpose}"]`);
  }

  function rerenderAtPosition(focusSelector) {
    const top = window.scrollY;
    render();
    window.scrollTo(0, top);
    if (focusSelector) document.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function checkAnswer(purpose) {
    if (purpose === 'checkpoint') {
      const question = bank.filter((item) => item.lesson === checkpoint.lesson)[checkpoint.index];
      if (checkpoint.checked) return;
      checkpoint.correct = engine.recordAnswer(progress, question, checkpoint.selected);
      checkpoint.passed ||= checkpoint.correct;
      checkpoint.checked = true;
    } else {
      const question = quiz.questions[quiz.index];
      if (quiz.checked[question.id]) return;
      engine.recordAnswer(progress, question, quiz.selections[question.id] || []);
      quiz.checked[question.id] = true;
      persistQuiz();
    }
    save();
    rerenderAtPosition('.answer-feedback');
  }

  function download(name, contents, type) {
    const blob = new Blob([contents], { type });
    if (type === 'application/json' && blob.size > engine.MAX_PROGRESS_BYTES) {
      toast('This backup is too large. Export your notes separately, then shorten older notes.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setFocus(active) {
    document.body.classList.toggle('focus-active', active);
    const button = document.getElementById('focus-toggle');
    button.setAttribute('aria-pressed', String(active));
    button.innerHTML = `${icon(active ? 'minimize-2' : 'scan')}<span>${active ? 'Leave focus' : 'Focus mode'}</span>`;
    refreshIcons();
  }

  async function toggleAudio() {
    if (audioBusy) return;
    if (audio.playing) { audio.stop(); updateAudioUI(); return; }
    audioBusy = true;
    try { await audio.start(document.getElementById('sound-select').value); }
    catch (error) { toast(error.message); }
    finally { audioBusy = false; updateAudioUI(); }
  }

  function updateAudioUI() {
    const button = document.getElementById('audio-toggle');
    button.setAttribute('aria-pressed', String(audio.playing));
    button.setAttribute('aria-label', audio.playing ? 'Pause focus sound' : 'Play focus sound');
    button.innerHTML = icon(audio.playing ? 'pause' : 'play');
    document.getElementById('sound-title').textContent = document.getElementById('sound-select').selectedOptions[0].textContent;
    document.getElementById('sound-state').textContent = audio.playing ? 'Playing locally · no vocals' : 'Original ambient audio';
    refreshIcons();
  }

  function creditFocus(now = Date.now()) {
    if (focusStartedAt !== null) {
      progress.focusMinutes += Math.max(0, (Math.min(now, focusDeadline || now) - focusStartedAt) / 60000);
      engine.touchDay(progress, now);
      focusStartedAt = null;
      save();
    }
  }

  function toggleFocusTimer() {
    if (focusDeadline) {
      focusSeconds = engine.remainingSeconds(focusDeadline);
      creditFocus();
      focusDeadline = null;
    } else {
      if (!focusSeconds) focusSeconds = Number(document.getElementById('focus-duration').value) * 60;
      focusStartedAt = Date.now();
      focusDeadline = focusStartedAt + focusSeconds * 1000;
    }
    updateTimerUI();
  }

  function updateTimerUI() {
    const seconds = focusDeadline ? engine.remainingSeconds(focusDeadline) : focusSeconds;
    document.getElementById('timer-display').textContent = formatTime(seconds);
    document.getElementById('timer-toggle').setAttribute('aria-label', `${focusDeadline ? 'Pause' : 'Start'} focus timer, ${formatTime(seconds)}`);
    document.getElementById('focus-duration').disabled = !!focusDeadline;
  }

  function drawAudio() {
    const values = audio.sample();
    focusDrawing.clearRect(0, 0, focusCanvas.width, focusCanvas.height);
    focusDrawing.strokeStyle = audio.playing ? '#47773c' : '#b9c8b2';
    focusDrawing.lineWidth = 1.4;
    focusDrawing.beginPath();
    for (let index = 0; index < 28; index += 1) {
      const horizontal = index * 3.3;
      const amplitude = audio.playing ? Math.max(1, Math.abs(values[index * 4] - 128) * 0.7) : 2 + Math.sin(index * 1.2) ** 2 * 4;
      focusDrawing.moveTo(horizontal, 15 - amplitude);
      focusDrawing.lineTo(horizontal, 15 + amplitude);
    }
    focusDrawing.stroke();
  }

  main.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const value = button.dataset.value;
    if (action === 'filter-stage') { stageFilter = value; render(); }
    else if (action === 'lesson-tab') { lessonTab = value; rerenderAtPosition(); }
    else if (action === 'bookmark') {
      const id = button.dataset.id;
      progress.bookmarks = progress.bookmarks.includes(id) ? progress.bookmarks.filter((item) => item !== id) : [...progress.bookmarks, id];
      save(); rerenderAtPosition();
    } else if (action === 'select-answer') chooseAnswer(Number(button.dataset.index), button.dataset.purpose);
    else if (action === 'check-answer') checkAnswer(button.dataset.purpose);
    else if (action === 'next-checkpoint') {
      const count = bank.filter((question) => question.lesson === checkpoint.lesson).length;
      checkpoint.index = (checkpoint.index + 1) % count;
      checkpoint.selected = []; checkpoint.checked = false;
      rerenderAtPosition();
    } else if (action === 'complete-lesson') {
      if (!checkpoint?.passed && !progress.completed.includes(viewId)) return;
      const wasComplete = progress.completed.includes(viewId);
      engine.completeLesson(progress, viewId);
      save(); rerenderAtPosition();
      toast(wasComplete ? 'This lesson is already complete.' : 'Lesson complete. One more concept in place.');
    } else if (action === 'practice-mode') { practiceMode = value; if (value === 'exam') practiceDomain = 'all'; render(); }
    else if (action === 'start-practice') startQuiz();
    else if (action === 'scenario-practice') startQuiz(button.dataset.scenario);
    else if (action === 'quiz-next' || action === 'quiz-prev' || action === 'quiz-jump') {
      const next = action === 'quiz-jump' ? Number(button.dataset.index) : quiz.index + (action === 'quiz-next' ? 1 : -1);
      if (next < 0 || next >= quiz.questions.length || (quiz.rehearsal && next > firstUnanswered())) return toast('Choose an answer before moving ahead.');
      quiz.index = next; persistQuiz(); render(); window.scrollTo(0, 0); main.focus({ preventScroll: true });
    }
    else if (action === 'flag-question') {
      const id = quiz.questions[quiz.index].id;
      quiz.flags = quiz.flags.includes(id) ? quiz.flags.filter((item) => item !== id) : [...quiz.flags, id];
      persistQuiz(); rerenderAtPosition();
    } else if (action === 'finish-quiz') requestFinish();
    else if (action === 'exit-quiz') confirm('Leave this practice session?', 'This discards the current session. Answers already checked in learning mode remain in your progress. A timed session is not scored unless you submit it.', () => { quiz = null; persistQuiz(); render(); }, 'Discard session');
    else if (action === 'new-quiz') { quiz = null; persistQuiz(); render(); window.scrollTo(0, 0); }
    else if (action === 'flip-card') { recallRevealed = !recallRevealed; rerenderAtPosition('#recall-face'); }
    else if (action === 'rate-card') {
      const lesson = recallQueue[recallIndex];
      progress.reviews[lesson.id] = engine.scheduleReview(progress.reviews[lesson.id], value);
      engine.touchDay(progress); save(); recallIndex += 1; recallRevealed = false; render(); document.getElementById('recall-face')?.focus({ preventScroll: true });
    } else if (action === 'recall-refresh') { recallQueue = null; recallIndex = 0; recallRevealed = false; render(); }
    else if (action === 'export-progress') download(`atlas-progress-${engine.localDay()}.json`, JSON.stringify(progress, null, 2), 'application/json');
    else if (action === 'import-progress') document.getElementById('import-progress').click();
    else if (action === 'export-notes') {
      const notes = content.lessons.filter((lesson) => progress.notes[lesson.id]?.trim() || progress.bookmarks.includes(lesson.id));
      download('atlas-notebook.md', `# My Claude study notebook\n\n${notes.map((lesson) => `## ${lesson.title}\n\n${progress.notes[lesson.id] || '(Bookmarked)'}\n`).join('\n')}`, 'text/markdown');
    } else if (action === 'reset-progress') confirm('Reset all study progress?', 'This removes completed lessons, answers, notes, bookmarks, recall schedules, and practice history from this browser. Export a backup first if you want to keep them.', () => {
      progress = engine.freshProgress(); quiz = null; recallQueue = null; recallIndex = 0; recallRevealed = false;
      practiceDomain = 'all'; practiceMode = 'learn'; practiceCount = 10; stageFilter = 'all'; notebookQuery = ''; checkpoint = null;
      focusDeadline = null; focusStartedAt = null; focusSeconds = Number(document.getElementById('focus-duration').value) * 60;
      persistQuiz(); save(); render(); updateTimerUI(); toast('Study progress reset.');
    }, 'Reset all progress');
    else if (action === 'library-tab') { libraryTab = value; if (location.hash === `#library/${value}`) render(); else location.hash = `#library/${value}`; }
    else if (action === 'open-lab') { if (location.hash === `#labs/${value}`) { labState = {}; render(); } else location.hash = `#labs/${value}`; }
    else if (action === 'loop-step') { labState.step = ((labState.step || 0) + 1) % 5; updateLab(); }
    else if (action === 'lab-reset') { labState = {}; updateLab(); }
    else if (action === 'policy-run') runPolicy();
    else if (action === 'validate-json') validateJson();
    else if (action === 'json-example') {
      const examples = { syntax: '{"total": 65, "line_items": [40, 25], "tax_id": null,}', semantic: '{\n  "total": 80,\n  "line_items": [40, 25],\n  "tax_id": null\n}', valid: '{\n  "total": 65,\n  "line_items": [40, 25],\n  "tax_id": null\n}' };
      document.getElementById('json-input').value = examples[value];
      labOutput('Ready to validate', 'The example is loaded. Parse, validate its schema, then check against the source.');
    } else if (action === 'architecture-answer') {
      const selected = Number(button.dataset.index);
      const task = Number(document.getElementById('architecture-case').value);
      const answers = [1, 2, 3, 0, 4];
      const reasons = ['Known steps with checks favor a fixed workflow.', 'The next step depends on observations, so bounded autonomy fits.', 'Distinct tools and contexts justify coordinated specialists.', 'A supplied paragraph and glossary need one grounded transformation.', 'Keep the standard path predictable and reserve autonomy for the exception.'];
      document.querySelectorAll('[data-action="architecture-answer"]').forEach((item) => item.classList.toggle('selected', item === button));
      labOutput(selected === answers[task] ? 'A proportionate architecture.' : 'Look again at the uncertainty.', reasons[task], selected !== answers[task]);
    } else if (action === 'move-cache') {
      const from = Number(button.dataset.index);
      const to = from + Number(button.dataset.direction);
      [labState.blocks[from], labState.blocks[to]] = [labState.blocks[to], labState.blocks[from]];
      updateLab();
    } else if (action === 'check-config') {
      const selections = [...document.querySelectorAll('[data-config-index]')].map((select) => Number(select.value));
      const correct = selections.filter((selection, index) => selection === index).length;
      labOutput(`${correct} / 5 correctly placed`, correct === 5 ? 'Team instructions, path rules, task skills, MCP definitions, and enforced settings each have a distinct job. Keep secrets outside committed configuration.' : 'The correct sequence is: project CLAUDE.md; path rules; skill; root .mcp.json; .claude/settings.json. Use the owning surface rather than relying on prose to configure a service.', correct !== 5);
    } else if (action === 'save-brief') {
      const brief = document.getElementById('brief-preview').textContent;
      progress.notes['prompt-brief'] = `${progress.notes['prompt-brief'] || ''}\n\nMy prompt brief:\n${brief}`.trim().slice(0, 20000);
      save(); toast('Brief saved to your notebook.');
    } else if (action === 'start-focus') {
      setFocus(true);
      if (!focusDeadline) toggleFocusTimer();
      toast('Focus session started. Audio stays optional: press play when ready.');
    }
  });

  main.addEventListener('input', (event) => {
    const target = event.target;
    if (target.id === 'lesson-note') { progress.notes[viewId] = target.value; save(); document.getElementById('note-status').textContent = storageProblem ? 'In memory only; export a backup' : 'Saved on this browser'; }
    else if (target.id === 'notebook-search') {
      const selection = target.selectionStart;
      notebookQuery = target.value; render();
      const replacement = document.getElementById('notebook-search');
      replacement.focus(); replacement.setSelectionRange?.(selection, selection);
    } else if (view === 'labs' && ['refund-amount', 'context-turns', 'segment-accuracy', 'brief-task', 'brief-audience', 'brief-evidence', 'brief-format', 'brief-missing'].includes(target.id)) updateLab();
  });

  main.addEventListener('change', (event) => {
    const target = event.target;
    if (target.id === 'practice-domain') practiceDomain = target.value;
    else if (target.id === 'practice-count') practiceCount = Number(target.value);
    else if (target.id === 'exam-date') { progress.examDate = target.value; save(); render(); }
    else if (target.matches('[data-match-index]')) {
      const purpose = target.dataset.purpose;
      const question = purpose === 'checkpoint' && checkpoint
        ? bank.filter((item) => item.lesson === checkpoint.lesson)[checkpoint.index]
        : quiz?.questions[quiz.index];
      if (!question || question.kind !== 'matching') return;
      if (purpose === 'checkpoint' ? checkpoint.checked : quiz.checked[question.id]) return;
      const previous = purpose === 'checkpoint' ? checkpoint.selected : quiz.selections[question.id];
      const selections = question.items.map((item, index) => previous?.[index] ?? -1);
      selections[Number(target.dataset.matchIndex)] = Number(target.value);
      if (purpose === 'checkpoint') checkpoint.selected = selections;
      else { quiz.selections[question.id] = selections; persistQuiz(); }
      rerenderAtPosition(`[data-match-index="${target.dataset.matchIndex}"][data-purpose="${purpose}"]`);
    } else if (view === 'labs' && ['verified-customer', 'enforce-policy', 'context-trim', 'context-summarize', 'context-pin'].includes(target.id)) updateLab();
    else if (target.id === 'architecture-case') {
      document.querySelectorAll('[data-action="architecture-answer"]').forEach((button) => button.classList.remove('selected'));
      labOutput('A new architecture decision', 'Which design is the simplest one that fits this task?');
    }
  });

  document.getElementById('track-select').addEventListener('change', (event) => {
    const nextTrack = event.target.value;
    const change = () => {
      progress.track = nextTrack;
      stageFilter = 'all'; practiceDomain = 'all'; recallQueue = null; recallIndex = 0; recallRevealed = false; quiz = null;
      persistQuiz(); save();
      if (location.hash === '#learn') route(); else location.hash = '#learn';
    };
    if (quiz && !quiz.finished) { event.target.value = progress.track; confirm('Switch certification track?', 'This discards the active practice session. Your previously saved learning progress stays available.', change, 'Switch track'); }
    else change();
  });

  function setDrawer(open, restoreFocus = false) {
    const sidebar = document.getElementById('sidebar');
    const mobile = window.innerWidth <= 800;
    sidebar.classList.toggle('open', mobile && open);
    sidebar.inert = mobile && !open;
    if (sidebar.inert) sidebar.setAttribute('aria-hidden', 'true'); else sidebar.removeAttribute('aria-hidden');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', String(mobile && open));
    if (mobile && open) sidebar.querySelector('.brand').focus();
    else if (restoreFocus) document.getElementById('menu-toggle').focus();
  }
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
    main.scrollIntoView({ block: 'start' });
  });
  document.getElementById('menu-toggle').addEventListener('click', () => setDrawer(!document.getElementById('sidebar').classList.contains('open'), true));
  window.matchMedia('(max-width:800px)').addEventListener('change', () => setDrawer(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById('sidebar').classList.contains('open')) setDrawer(false, true);
  });
  document.addEventListener('click', (event) => {
    if (window.innerWidth <= 800 && !event.target.closest('#sidebar, #menu-toggle')) setDrawer(false);
  });
  document.getElementById('focus-toggle').addEventListener('click', () => setFocus(!document.body.classList.contains('focus-active')));
  document.getElementById('confirm-cancel').addEventListener('click', () => { document.getElementById('confirm-dialog').close(); confirmAction = null; });
  document.getElementById('confirm-accept').addEventListener('click', () => { document.getElementById('confirm-dialog').close(); const action = confirmAction; confirmAction = null; action?.(); });
  document.getElementById('confirm-dialog').addEventListener('cancel', () => { confirmAction = null; });
  document.getElementById('search-toggle').addEventListener('click', () => { document.getElementById('search-dialog').showModal(); renderSearch(''); document.getElementById('global-search').focus(); });
  document.querySelector('[data-close-dialog]').addEventListener('click', () => document.getElementById('search-dialog').close());
  document.getElementById('global-search').addEventListener('input', (event) => renderSearch(event.target.value));
  document.getElementById('search-results').addEventListener('click', (event) => { if (event.target.closest('a')) document.getElementById('search-dialog').close(); });

  function renderSearch(query) {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const results = content.lessons.filter((lesson) => terms.every((term) => `${lesson.title} ${lesson.simple} ${lesson.deep} ${lesson.points.join(' ')}`.toLowerCase().includes(term))).slice(0, 12);
    document.getElementById('search-results').innerHTML = results.length ? results.map((lesson) => `<a class="search-result" href="#lesson/${lesson.id}"><strong>${escape(lesson.title)}</strong><span>${escape(content.stages[lesson.stage])} &middot; ${lesson.minutes} minutes &middot; ${lesson.domains[progress.track] ? 'In your track' : 'Related track'}</span></a>`).join('') : '<p class="muted" style="padding:22px 0">No matching concepts. Try a shorter phrase.</p>';
  }

  document.getElementById('audio-toggle').addEventListener('click', toggleAudio);
  document.getElementById('volume').addEventListener('input', (event) => audio.setVolume(Number(event.target.value) / 100));
  document.getElementById('sound-select').addEventListener('change', async (event) => {
    if (audioBusy) return;
    if (audio.playing) {
      audioBusy = true;
      try { await audio.start(event.target.value); } catch (error) { toast(error.message); }
      finally { audioBusy = false; }
    } else audio.preset = event.target.value;
    updateAudioUI();
  });
  document.getElementById('timer-toggle').addEventListener('click', toggleFocusTimer);
  document.getElementById('timer-reset').addEventListener('click', () => { creditFocus(); focusDeadline = null; focusSeconds = Number(document.getElementById('focus-duration').value) * 60; updateTimerUI(); });
  document.getElementById('focus-duration').addEventListener('change', (event) => { focusSeconds = Number(event.target.value) * 60; updateTimerUI(); });

  document.getElementById('import-progress').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > engine.MAX_PROGRESS_BYTES) throw new Error('Progress files must be smaller than 16 MB.');
      const imported = engine.normalizeProgress(JSON.parse(await file.text()));
      confirm('Replace this browser\'s progress?', 'The imported progress replaces existing notes, bookmarks, answers, and history. Export your current data first if needed.', () => {
        creditFocus();
        focusDeadline = null;
        focusStartedAt = null;
        focusSeconds = Number(document.getElementById('focus-duration').value) * 60;
        progress = imported; quiz = null; recallQueue = null; recallIndex = 0; recallRevealed = false; practiceDomain = 'all'; stageFilter = 'all';
        persistQuiz(); save(); render(); updateTimerUI(); toast('Progress imported.');
      }, 'Import progress');
    } catch (error) { toast(`Import not applied: ${error.message}`); }
    event.target.value = '';
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('pagehide', () => { creditFocus(); persistQuiz(); audio.stop(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) { focusDeadline = null; focusSeconds = Number(document.getElementById('focus-duration').value) * 60; updateTimerUI(); updateAudioUI(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  function tick() {
    if (focusDeadline && engine.remainingSeconds(focusDeadline) === 0) {
      creditFocus(focusDeadline); focusDeadline = null; focusSeconds = 0; audio.stop(); updateAudioUI(); toast('Focus session complete. Take a moment away from the screen.');
    }
    updateTimerUI();
    if (quiz && !quiz.finished && quiz.deadline) {
      const remaining = engine.remainingSeconds(quiz.deadline);
      if (!remaining) finishQuiz(true);
      else {
        const clock = document.querySelector('#quiz-clock span');
        if (clock) { clock.textContent = formatTime(remaining); clock.parentElement.classList.toggle('urgent', remaining < 300); }
      }
    }
  }
  setInterval(tick, 1000);
  setInterval(() => { if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) drawAudio(); }, 80);
  restoreQuiz();
  route();
  tick();
  drawAudio();
  if (storageProblem) toast(storageProblem);
  else if (quiz && !quiz.finished) toast('Your practice session is saved. Return to the practice room to continue.');
})();