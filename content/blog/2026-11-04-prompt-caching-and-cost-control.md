---
title: Prompt caching and cost control — how we cut an AI product's bill by two thirds
description: Real numbers from building Roledone. Where the tokens went, the four changes that fixed it, and how to measure before you optimise.
date: 2026-11-04
tags: LLMs, Engineering
level: Intermediate
---

## The bill arrives

Roledone sends a CV and a job advert to a model and asks for structured output: the requirements in the advert, the lines in the CV that evidence each one, and interview questions. During the first week of testing, the spend was running well ahead of what the usage justified. Nothing was broken. It was just paying full price for the same text over and over.

If you are building anything on an LLM API, you will hit this. Here is what we found and what we changed. The techniques apply to every provider.

## Step one: measure, do not guess

We added a usage ledger before touching anything else. Every API call logs: which feature made it, which model, input tokens, output tokens, cache-read tokens, and latency. A `GET /api/usage` endpoint totals them per feature.

Within an hour the picture was clear:

- **Input tokens dominated.** Output was under 15% of the bill. The CV plus the advert plus the tool definitions plus the system prompt was 6–9k tokens, sent on every call.
- **One feature made seven calls per user journey**, each re-sending the same CV.
- **Everything used the largest model**, including jobs like "turn this bullet into a question" that do not need it.

Without the ledger we would have "optimised" the wrong thing. Instrument first.

## Change 1: prompt caching

Providers let you mark a prefix of the prompt as cacheable. If the next request starts with the identical prefix, the cached part is read at a steep discount (on Anthropic's API, cache reads are a tenth of the normal input price).

The rules that make it work:

- **The prefix must be byte-identical.** Same system prompt, same tool definitions in the same order, same document text. One changed character above the cache marker and the whole cache misses.
- **Put the stable things first.** System prompt → tool definitions → the big document → *then* the part that changes (the question). We mark the system prompt and the CV block as cache breakpoints.
- **Send the same tool list on every call**, even if a given call only needs one tool. We used to send a trimmed list per endpoint; that alone defeated the cache.

After this, the second and later calls in a journey read ~80% of their input from cache. We verified it by checking `cache_read_input_tokens` in the response, not by trusting the docs.

## Change 2: model tiering

Not every call needs the strongest model. We split the work:

- **Quality tier** (large model): the requirement extraction and the CV suggestions — the output users read closely and act on.
- **Fast tier** (small model): interview questions, follow-up questions, scan summaries, structure detection — well-defined tasks with tight output schemas.

The small model is a fraction of the price and faster. On our test set the quality difference for the tiered tasks was nil, because the tasks are constrained by schema and the output is validated anyway.

## Change 3: reduce reasoning where it is not needed

Newer models let you set an effort level. For schema-filling tasks we set it low; the model answers directly instead of thinking at length. We added a fallback: if the provider rejects the parameter, retry without it, so a provider change never breaks production.

## Change 4: stop asking twice

Two calls were generating overlapping content. The interview questions were being requested when the user opened the interview page *and* regenerated if they came back. We now generate once, right after the match, and cache in the browser keyed on a hash of CV + advert. Same answer, zero extra calls.

## The result

Across the same test journey, the cost dropped by roughly two thirds. Input tokens barely changed — we still send the CV — but most of them are now cache reads, and most calls run on the small model.

## Validate everything the model returns

One more thing that saved money *and* quality: every claim the model makes about the CV is checked against the CV text. If the model says "the CV mentions Terraform" and quotes a line, the server confirms that line exists verbatim. If it does not, the claim is dropped. This catches hallucinations, and it also meant we could use the smaller model more aggressively, because the validation layer, not the model's reputation, guarantees correctness.

## The checklist

1. Log tokens per feature before optimising.
2. Order prompts stable-first and mark cache breakpoints.
3. Keep the cached prefix byte-identical — same tools, same order, every call.
4. Route constrained tasks to a small model; keep the large one for judgement.
5. Lower reasoning effort on schema-filling tasks.
6. Deduplicate calls; cache results keyed on input hashes.
7. Validate structured output against ground truth so you can trust cheaper models.

If you build a project this way and can say "I measured the cost per user and cut it from X to Y by caching and tiering", you have a story that lands in any AI engineering interview — and a line for your CV that carries a number.
