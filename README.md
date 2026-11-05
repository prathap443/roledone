# Rolewoven

**Real experience. A clearer story.**

A responsive career-studio prototype for UK data engineers, with a foundation that can expand to other tech roles. Working brand only; domain and trademark availability are not confirmed.

## Run locally

Requires Node.js 20.12 or newer. No install step is needed to run; `npm install` is only required to re-vendor the document parsers.

```sh
cp .env.example .env     # add ANTHROPIC_API_KEY to enable AI; leave blank for browser-only mode
npm start
```

Open http://localhost:3000 locally (Replit uses port 5000 via `.replit`). Set `PORT` to change it. The server prints whether AI is connected.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the AI evidence layer. Server-side only; never shipped to the browser. |
| `ANTHROPIC_MODEL` | Defaults to `claude-sonnet-5-5`. |
| `ROLEWOVEN_PROVIDER` | `anthropic`, `mock` (offline, rule-based, for development) or `off`. Defaults to `anthropic` when a key is set. |

```sh
npm run check
npm test
```

## What works

### AI evidence layer (when `ANTHROPIC_API_KEY` is set)

- **Role match** — the model extracts requirements from the job description and, for each one, quotes the CV line that supports it (or says none does). Every requirement must cite a verbatim JD span and every evidence quote a verbatim CV span; anything it cannot quote is discarded server-side.
- **CV studio** — proposes rewrites of lines already in the draft. The server rejects any proposal that introduces a number not present in the CV or draft, or that names a requirement the CV has no evidence for. Details that *would* strengthen a line but are not in the CV are returned as questions for the candidate, never written into the text. The user applies or dismisses each change.
- **Interview room** — structured STAR review of a practice answer: what is present, what is missing, strengths, improvements, and the follow-up a good interviewer would ask.
- Consent prompt before the first request; text is sent only when an AI button is pressed; the server does not store or log document bodies.
- Rate limiting, 256 KB body cap, 50,000-character field caps, Content-Security-Policy, and a 60 s upstream timeout.

- **Evidence Score** (0–100) — weighted coverage of the role's requirements: must-haves count fully, nice-to-haves half, partial mentions half credit. Shown with its breakdown; not an ATS score.
- **Gap Interview** — for each missing requirement, Claude asks two or three concrete questions; if the answers show real experience it drafts one bullet from the candidate's own words (numbers must come from the answers or CV; other missing skills cannot be smuggled in) and the user adds it to the draft. If not, it offers a truthful learning-goal line. Nothing is ever added without the user's own account of it.
- **Generated interview questions** — five questions written from the requirements and the CV at recruiter-screen, technical or senior-panel level, with "listen for" notes revealed after review.

### CV Scan (free)

Upload or paste a CV with no job description and get a 0–100 CV score with four explainable sub-scores computed in the browser (`dist/scan.js`): **Parse-ability** (contact details, standard headings, dates, bullets, length, single-column flow), **Impact** (share of achievement lines with a measurable outcome and a strong verb, minus weak openers), **Readability** (long sentences, passive voice, buzzwords) and **Role coverage** (mentions of a curated set of common requirements for the role family; Senior Data Engineer first). Each tile opens the rules and the CV lines behind the number. Claude writes the headline, strengths (each backed by a verbatim CV quote) and the three critical fixes; fixes are phrased "if you did this, show it", never "add this". Download as PDF via print.

### Plans (developer preview)

Free: scan, Evidence Score, and the full list of what is missing. Pro: suggestions, Gap Interview, CV studio and export, generated questions and answer review. Premium: follow-ups, multiple CV versions, DOCX/PDF export (not built yet). The active plan is a workspace setting for now; entitlement enforcement arrives with accounts and payments.

### Browser-only features (always available)

- Responsive desktop workspace and mobile bottom navigation.
- Paste CV/job text or import a TXT CV (500 KB file / 50,000-character text limit).
- Compare a curated skill vocabulary and show exact CV excerpts, with missing-mention states.
- Manually edit and export a TXT CV without fabricating metrics.
- Five role-informed interview question templates; answers and heuristic structure feedback.
- Add applications and change their status; remove records with confirmation.
- In-memory workspace by default. Optional localStorage persistence, JSON export, and confirmed data clearing.
- Fictional sample journey, accessible labels, keyboard focus, reduced-motion support.

## Explicit prototype limits

No accounts, payment collection, cloud database, verified skill assessment, ATS simulation, or callback prediction. Without an API key there is no AI and matching falls back to a fixed vocabulary. A textual mention is not verified evidence of ability. Negative statements can match keywords; users must review the excerpts. The skill vocabulary is intentionally limited. Interview feedback checks wording cues, not technical quality. Application statuses are self-reported.

The server has no authentication or per-user storage yet; the rate limiter is in-memory and per instance. Fonts load from Google Fonts; the app works with local fallbacks if unavailable. CV content is sent to the AI provider only when the user asks and consents. The prototype is not a native mobile app or an offline PWA.

## Replit

Upload/import this repository into a Node.js Replit project and use `npm start`. `.replit` maps port 3000 to the web preview. Add `ANTHROPIC_API_KEY` as a Replit Secret to enable AI. See [Replit handoff](docs/REPLIT.md) for the next implementation brief.

## Project map

- `dist/`: browser app and assets. `app.js` (shell/router), `state.js`, `ui.js`, `api.js`, `pages/*.js`, `core.js` (pure local matching), `import-cv.js` + workers (PDF/DOCX extraction).
- `server.mjs` + `server/`: dependency-free Node server. `api.mjs` (routes, limits), `ai.mjs` (prompts and structured-output contracts), `validate.mjs` (grounding checks), `providers/` (Anthropic adapter, offline mock).
- `tests/`: grounding validation, API behaviour with the mock provider, parser and matching checks (`npm test`).
- `docs/PRODUCT.md`: scope, acceptance criteria, and validation plan.
- `docs/ARCHITECTURE.md`: proposed production architecture and data model.
- `docs/BRAND.md`: identity and domain shortlist.
- `.openai/hosting.json`: private Sites deployment identity.

Keep secrets out of source control. Before accepting real customer uploads, implement and test authentication, per-user authorisation, deletion, file handling, and server-side AI validation.
