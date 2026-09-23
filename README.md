# Atlas

**Same ideas. A different path.**

A playful companion for learning Claude architecture: small lessons, hands-on experiments, a few good questions, and a quieter place to think.

[Explore Atlas](https://bladeszasza.github.io/claude-atlas/) or open [index.html](index.html) directly. All study features run in the browser.

## Study Flow

1. Start on the Architect Foundations trail, or take a detour through the developer, everyday-use, and architecture side trails.
2. Begin with the first incomplete lesson. Each lesson moves from a simple explanation and mental model to a worked example, implementation nuance, and recall checkpoint.
3. Use the scenario labs to manipulate a concept. They run deterministic local simulations, not live Claude requests.
4. Test understanding in the practice room. Learning mode reveals explanations after submission; timed mode withholds answers until the session ends.
5. Return to Daily Recall for scheduled retrieval practice and record explanations in your own words.

## Included

- 48 lessons, with 30 objective anchors along the Architect Foundations trail.
- Original quick checks and six original case studies, with explanations and direct source links.
- Architect rehearsal: four cases, 60 single-answer questions, 120 minutes, and an answer before advancing. The case draw changes the domain mix.
- Nine interactive labs: agent loop, architecture selection, refund policy, JSON validation, context budget, caching prefix, configuration scope, prompt brief, and confidence segmentation.
- Bookmarks, notes, first-attempt accuracy, per-domain results, study streaks, a target-date planner, progress import/export, and resumable practice.
- Four original local soundscapes, adjustable volume, a focus timer, distraction-reduced reading, and an external Brain.fm link.
- Local fonts and photography, reduced-motion support, responsive layouts, and keyboard-operable controls.

## The Reading Shelf

Atlas is an independent community study companion. The original courses and documentation are the places to go for the full material:

- [Anthropic Academy](https://anthropic.skilljar.com/), including [Claude 101](https://anthropic.skilljar.com/claude-101), [AI Fluency](https://anthropic.skilljar.com/ai-fluency-framework-foundations), [Building with the Claude API](https://anthropic.skilljar.com/claude-with-the-anthropic-api), [Claude Code in Action](https://anthropic.skilljar.com/claude-code-in-action), [Introduction to MCP](https://anthropic.skilljar.com/introduction-to-model-context-protocol), and [Introduction to Agent Skills](https://anthropic.skilljar.com/introduction-to-agent-skills).
- [Claude API documentation](https://platform.claude.com/docs/en/intro), [Claude Code documentation](https://code.claude.com/docs/en/overview), [MCP specification](https://modelcontextprotocol.io/), and [Anthropic Cookbooks](https://github.com/anthropics/claude-cookbooks).
- [Tim Warner's Claude Architect](https://github.com/timothywarner-org/claude-architect) and [Paul Larionov's Claude Certified Architect](https://github.com/paullarionov/claude-certified-architect).
- [Matthew Purcell](https://www.linkedin.com/in/purcellmatthew/), whose independent practice sets helped shape the topic selection.
- [Udemy practice exams](https://www.udemy.com/course/anthropic-claude-certified-architect-3-full-practice-exams/) and the [IBM Learning access route](https://ibm-learning.udemy.com/course/anthropic-claude-certified-architect-3-full-practice-exams/). Course access follows the provider's terms.

The in-app field guide links every credited resource, including the public exam guide, certification terms, and exam policy. Version notes distinguish the registered exam guide's wording from current product behavior.

## Exam Brief

The registered Architect guide v0.2 (June 30, 2026) specifies 60 single-answer questions, four scenarios from six, and 120 minutes. Delivery is through [Pearson VUE](https://www.pearsonvue.com/us/en/anthropic.html). Check the [certification portal](https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification) for current details.

Practice results are raw accuracy; the official passing score of 720 is scaled. Use Atlas to prepare outside the exam session. Course materials and exam questions remain at their original sources; the lessons and case studies here are independently written.

## Audio And Data

Four original Web Audio soundscapes begin only when you press Play. Keep the volume comfortable. [Brain.fm](https://www.brain.fm/) opens as a separate service.

Progress stays in browser local storage. Export a backup before clearing site data, moving devices, or switching from the local file to the hosted site. Imports replace the record after confirmation. The public site uses GitHub Pages for delivery; external resources have their own access and privacy policies.

Sources open external websites only when followed. The image, fonts, scripts, and sound generation are local.

## Development And Verification

Run these commands from this directory:

```sh
npm ci
npm run build
npm test
npm run verify
npm run verify:http
npm run check:public
```

`build` bundles Lucide and Ajv, copies local fonts, and creates the allowlisted `_site` artifact. Browser verification uses Playwright Chromium; run `npx playwright install chromium` once if needed. The HTTP check serves the built artifact at a project subpath and closes its server afterward.

Tests validate keys, track/domain/source links, objective coverage, exact multiple-response grading, matching order, bounded selection, first-attempt scoring, progress normalization, recall scheduling, and deadline calculations. Browser verification covers learning, all labs, timed expiry, reload recovery, notes escaping, import/export, active-timer imports, cross-track reset, matching checkpoints, keyboard focus, audio signal, and narrow layouts. Screenshots are written to the ignored `test-results/` directory.

## Files

- [content.js](content.js): lessons, tracks, source notes, glossary, and objective mappings.
- [questions.js](questions.js): independent practice questions and rationales.
- [scenarios.js](scenarios.js): six original Architect case studies.
- [engine.js](engine.js): pure grading, scheduling, statistics, and progress normalization.
- [app.js](app.js): browser views, interactions, persistence, and labs.
- [audio.js](audio.js): original optional audio synthesis.
- [styles.css](styles.css): responsive layouts and local fonts.

Third-party licenses stay alongside bundled assets. Photography: [Simon Berger / Unsplash](https://unsplash.com/photos/aerial-photography-of-mountain-range-MJAoiige14E). Fonts: [Fontsource](https://fontsource.org/), DM Sans and Space Grotesk. Icons: [Lucide](https://lucide.dev/). Schema validation: [Ajv](https://ajv.js.org/).