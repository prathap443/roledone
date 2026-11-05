# Architecture and production path

## Current implementation

Static ES-module browser app, pure matching functions, CSS breakpoints, in-memory state, optional localStorage. A dependency-free Node static server makes local and Replit execution simple. Sites serves the same `dist/` assets privately. No backend secrets exist.

This prototype prioritises validation and portability. It is not the final architecture for handling customer documents.

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

## API boundary proposal

- `POST /documents` → upload reference / parsing job.
- `GET /documents/:id` → extracted text for confirmation.
- `POST /matches` → requirement-to-evidence mapping.
- `POST /cv-versions/:id/suggestions` → proposed edits, never automatic acceptance.
- `POST /practice-sessions` → grounded question set.
- `POST /applications` and `PATCH /applications/:id` → user-owned tracking.
- `DELETE /account` → documented account/document deletion workflow.

## Production quality gates

Authenticate and authorise every user-data request; enforce object ownership. Reject unsupported/oversized uploads and isolate parsing. Treat CV/JD text as untrusted content, never system instructions. Test that unrelated users cannot retrieve each other's files. Prevent unsupported numbers, employers, skills, or seniority claims in generated edits. Track source provenance and let users decline suggestions. Avoid logging document bodies or secrets. Add usage caps, timeouts, cancellation, idempotency, and provider error states. Evaluate on redacted consented examples across CV formats and writing styles. Record model/prompt versions for reproducibility.

## Measurement limits

Text matching is descriptive, not ATS behaviour. Answer checklists are not cognitive or personality assessments. Outcome data is confounded by employer, timing, role, geography, and candidate differences. No causal or probability claims without an appropriately designed and validated study.
