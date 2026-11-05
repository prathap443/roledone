# Rolewoven

**Real experience. A clearer story.**

A responsive career-studio prototype for UK data engineers, with a foundation that can expand to other tech roles. Working brand only; domain and trademark availability are not confirmed.

## Run locally

Requires Node.js 20 or newer. No package dependencies or installation step.

```sh
npm start
```

Open http://localhost:3000. Set `PORT` to change the port.

```sh
npm run check
npm test
```

## What works

- Responsive desktop workspace and mobile bottom navigation.
- Paste CV/job text or import a TXT CV (500 KB file / 50,000-character text limit).
- Compare a curated skill vocabulary and show exact CV excerpts, with missing-mention states.
- Manually edit and export a TXT CV without fabricating metrics.
- Five role-informed interview question templates; answers and heuristic structure feedback.
- Add applications and change their status; remove records with confirmation.
- In-memory workspace by default. Optional localStorage persistence, JSON export, and confirmed data clearing.
- Fictional sample journey, accessible labels, keyboard focus, reduced-motion support.

## Explicit prototype limits

No AI provider, accounts, payment collection, PDF/DOCX parser, cloud database, verified skill assessment, ATS simulation, or callback prediction. A textual mention is not verified evidence of ability. Negative statements can match keywords; users must review the excerpts. The skill vocabulary is intentionally limited. Interview feedback checks wording cues, not technical quality. Application statuses are self-reported.

The server is a development static server, not a production authentication or API server. Fonts load from Google Fonts; the app works with local fallbacks if unavailable. No CV content is sent to an AI service. The prototype is not a native mobile app or an offline PWA.

## Replit

Upload/import this repository into a Node.js Replit project and use `npm start`. `.replit` maps port 3000 to the web preview. There are no secrets to configure for this prototype. See [Replit handoff](docs/REPLIT.md) for the next implementation brief.

## Project map

- `dist/`: browser app and assets, ready for static hosting.
- `dist/core.js`: pure comparison and feedback functions.
- `server.mjs`: dependency-free local/Replit static server.
- `tests/`: meaningful checks for evidence preservation and false positives.
- `docs/PRODUCT.md`: scope, acceptance criteria, and validation plan.
- `docs/ARCHITECTURE.md`: proposed production architecture and data model.
- `docs/BRAND.md`: identity and domain shortlist.
- `.openai/hosting.json`: private Sites deployment identity.

Keep secrets out of source control. Before accepting real customer uploads, implement and test authentication, per-user authorisation, deletion, file handling, and server-side AI validation.
