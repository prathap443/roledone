# Architecture and production path

## Current implementation

Static ES-module browser app (`dist/`), split into shell, state, API client and one module per page. A dependency-free Node server serves the assets and exposes a small JSON API (`/api/status`, `/api/match`, `/api/suggestions`, `/api/feedback`). The AI layer runs only on the server, behind a provider adapter (Anthropic Messages API with forced tool use for structured output; an offline mock for tests). The only secret is the provider key, read from the environment.

Grounding contract (enforced in `server/validate.mjs`, not just in prompts): every requirement cites a verbatim JD span; every evidence quote is a verbatim CV span; a proposed CV edit must anchor to an exact existing line, may not contain a number absent from the CV/draft, and may not introduce a requirement the CV lacks evidence for. Failures are dropped and counted in the response `meta`.

Not yet built: accounts, per-user storage, document retention, usage metering, payments. State is still in-tab with opt-in localStorage.

## Proposed next architecture

- TypeScript web client with reusable design tokens and responsive components; a React migration is optional once workflow validation warrants it.
- A server API for document handling, user access, analysis, metering, and exports.
- PostgreSQL records scoped by authenticated user ID.
- Private object storage for uploaded originals with explicit retention and deletion.
- A queued parsing/analysis worker for larger documents; visible job states and safe retries.
- AI calls only on the server; schema-validated output and an evidence ID required on every factual suggestion.
- Provider adapters so model/provider changes do not affect product-domain types.
- Replit can host the Node application during development; select production hosting after data and operational requirements are established.

## Domain entities

`User`, `CareerProfile`, `SourceDocument`, `EvidenceSpan`, `JobTarget`, `Requirement`, `RequirementMatch`, `CVVersion`, `SuggestedEdit`, `PracticeSession`, `PracticeAnswer`, `Application`, `OutcomeEvent`.

Each EvidenceSpan records document ID, text, offsets, and user confirmation. Each SuggestedEdit references source spans, original text, proposed text, rationale, unsupported details requiring clarification, and acceptance status. Version accepted edits rather than overwriting the source document. Applications reference the actual submitted CV version.

## API boundary

Implemented (stateless, text in / structured JSON out):

- `GET /api/status` → `{ai, provider, model}`.
- `POST /api/match {cv, jd}` → `{requirements:[{id,name,kind,source,evidence,status,note}], meta}`.
- `POST /api/suggestions {cv, draft, jd, requirements}` → `{suggestions:[{id,requirement,original,proposed,rationale,evidence[],unsupported[]}], meta}`.
- `POST /api/feedback {question, answer, cv?}` → `{feedback:{summary, star{…}, strengths[], improvements[], follow_up}, meta}`.

Proposed once accounts exist:

- `POST /documents` → upload reference / parsing job.
- `GET /documents/:id` → extracted text for confirmation.
- `POST /cv-versions/:id/suggestions` → proposed edits, never automatic acceptance.
- `POST /practice-sessions` → grounded question set.
- `POST /applications` and `PATCH /applications/:id` → user-owned tracking.
- `DELETE /account` → documented account/document deletion workflow.

## Production quality gates

Authenticate and authorise every user-data request; enforce object ownership. Reject unsupported/oversized uploads and isolate parsing. Treat CV/JD text as untrusted content, never system instructions. Test that unrelated users cannot retrieve each other's files. Prevent unsupported numbers, employers, skills, or seniority claims in generated edits. Track source provenance and let users decline suggestions. Avoid logging document bodies or secrets. Add usage caps, timeouts, cancellation, idempotency, and provider error states. Evaluate on redacted consented examples across CV formats and writing styles. Record model/prompt versions for reproducibility.

## Measurement limits

Text matching is descriptive, not ATS behaviour. Answer checklists are not cognitive or personality assessments. Outcome data is confounded by employer, timing, role, geography, and candidate differences. No causal or probability claims without an appropriately designed and validated study.
