(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasI18n = api;
})(globalThis, function () {
  'use strict';
  const languages = ['en', 'hu', 'es'];
  const originals = new WeakMap();
  const compiled = new WeakMap();

  function dictionary(locale) {
    if (!compiled.has(locale)) {
      compiled.set(locale, {
        uppercase: new Map(Object.entries(locale.ui || {}).map(([source, target]) => [source.toUpperCase(), target.toLocaleUpperCase(locale.language)])),
        patterns: (locale.patterns || []).map(([template, replacement]) => ({
          expression: new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\d+)\\\}/g, '(.+?)')}$`, 'u'),
          replacement,
          specificity: template.replace(/\{\d+\}/g, '').length,
        })).sort((left, right) => right.specificity - left.specificity),
      });
    }
    return compiled.get(locale);
  }

  function translate(value, locale) {
    if (typeof value !== 'string' || !locale) return value;
    const key = value.trim();
    let translated = locale.ui?.[key];
    if (!translated && key === key.toUpperCase() && /[A-Z]/.test(key)) {
      translated = dictionary(locale).uppercase.get(key);
    }
    if (!translated) {
      for (const { expression, replacement } of dictionary(locale).patterns) {
        const match = key.match(expression);
        if (match) {
          translated = replacement.replace(/\{(\d+)\}/g, (token, index) => translate(match[Number(index) + 1] ?? token, locale));
          break;
        }
      }
    }
    if (!translated) return value;
    return `${value.slice(0, value.length - value.trimStart().length)}${translated}${value.slice(value.trimEnd().length)}`;
  }

  function localizeContent(base, locale) {
    if (!locale) return base;
    return {
      ...base,
      stages: base.stages.map((stage) => translate(stage, locale)),
      tracks: Object.fromEntries(Object.entries(base.tracks).map(([id, track]) => [id, {
        ...track, name: translate(track.name, locale), description: translate(track.description, locale),
        domains: track.domains.map((domain) => ({ ...domain, name: translate(domain.name, locale) })),
      }])),
      sources: Object.fromEntries(Object.entries(base.sources).map(([id, source]) => [id, {
        ...source, note: locale.sources?.[id] || source.note,
      }])),
      lessons: base.lessons.map((lesson) => {
        const text = locale.lessons?.[lesson.id];
        if (!text) return lesson;
        return {
          ...lesson, ...text,
          signals: [
            ...(text.terms || []).map((term) => ({ text: term, kind: 'term' })),
            ...lesson.signals.filter((signal) => signal.kind === 'code'),
          ],
        };
      }),
      corrections: base.corrections.map((item, index) => ({ ...item, ...(locale.corrections?.[index] || {}) })),
      glossary: base.glossary.map((item, index) => locale.glossary?.[index] ? [...locale.glossary[index], item[2]] : item),
      supplementMap: base.supplementMap.map(([number, topic, lesson]) => [number, locale.supplement?.[Number(number) - 1] || topic, lesson]),
    };
  }

  function localizeQuestions(bank, locale) {
    if (!locale) return bank;
    return bank.map((question) => {
      const entry = locale.questions?.[question.id];
      return entry ? { ...question, stem: entry[0], options: entry[1], rationale: entry[2], ...(entry[3] ? { items: entry[3] } : {}) } : question;
    });
  }

  function apply(root, locale) {
    if (!root) return;
    const document = root.ownerDocument || root;
    const ignore = 'script,style,code,pre,textarea,[data-user-content],.notebook-entry>p,#language-select';
    const walker = document.createTreeWalker(root, 4);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement || node.parentElement.closest(ignore) || !node.nodeValue.trim()) continue;
      const previous = originals.get(node);
      const source = previous?.translated === node.nodeValue ? previous.source : node.nodeValue;
      const translated = translate(source, locale);
      originals.set(node, { source, translated });
      if (node.nodeValue !== translated) node.nodeValue = translated;
    }
    const elements = root.querySelectorAll('[aria-label],[title],[placeholder],[alt]');
    for (const element of elements) {
      const previous = originals.get(element) || {};
      for (const name of ['aria-label', 'title', 'placeholder', 'alt']) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name);
        const source = previous[name]?.translated === current ? previous[name].source : current;
        const translated = translate(source, locale);
        previous[name] = { source, translated };
        if (current !== translated) element.setAttribute(name, translated);
      }
      originals.set(element, previous);
    }
  }

  return { languages, translate, localizeContent, localizeQuestions, apply };
});