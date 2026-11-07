---
title: RAG vs fine-tuning vs long context — which one does your project need?
description: Three ways to get your own data into a model, when each one wins, and the question interviewers ask to see if you understand the difference.
date: 2026-11-05
tags: RAG, LLMs
level: Intermediate
---

## The question behind all three

A model knows what was in its training data up to a cutoff date. Your project needs it to know something else: your course notes, your company's policies, last week's logs, a customer's order history.

There are three ways to close that gap. They are not competitors; they solve different problems, and a good engineer can say which one fits before writing code.

## Long context: just paste it in

If the thing the model needs fits in the context window, put it there. Modern models take hundreds of thousands of tokens — hundreds of pages. A 40-page handbook, a whole codebase module, a year of meeting notes: paste it in the system prompt and ask.

**Wins when:** the corpus is small (under a few hundred pages), changes rarely, and every question might need any part of it.

**Costs:** every request re-reads the whole document. Without prompt caching that is expensive; with caching (mark the document block as cacheable, keep it byte-identical) it is cheap. Latency grows with input size.

**Watch for:** "lost in the middle" — models attend less to content buried deep in a long prompt. Put the most important material first or last, and ask the model to quote the lines it used so you can check.

## RAG: retrieve, then generate

Retrieval-Augmented Generation means: when a question arrives, search your corpus for the handful of passages most likely to answer it, put *only those* in the prompt, and generate.

The pipeline:

1. **Chunk** documents into passages (300–800 tokens, overlapping a little).
2. **Embed** each chunk — turn it into a vector with an embedding model — and store the vectors.
3. At query time, **embed the question**, find the nearest chunks (cosine similarity), and optionally **re-rank** them with a small cross-encoder.
4. **Generate** with the top chunks in the prompt, instructing the model to answer only from them and cite which chunk it used.

**Wins when:** the corpus is large (thousands of documents), changes often (add a document, embed it, done), or must be access-controlled per user (filter chunks by permission before retrieval).

**Costs:** an extra system to run — the vector store — and retrieval quality becomes your main problem. Most "the AI gave a wrong answer" bugs in RAG systems are "the right chunk was not retrieved".

**Watch for:** chunking that splits a table from its heading; questions whose answer spans two documents; pure vector search missing exact identifiers (combine it with keyword search — *hybrid retrieval*).

## Fine-tuning: change the weights

Fine-tuning continues training the model on your examples so its default behaviour changes. You supply hundreds to thousands of input→output pairs.

Here is the part students get wrong: **fine-tuning is poor at teaching facts.** A model fine-tuned on your handbook will not reliably recall its contents. What fine-tuning does well is *style and format*: always answer in this JSON shape, always use this tone, classify into these 40 labels the way our annotators do, speak this domain's jargon.

**Wins when:** you need consistent format or behaviour at scale, you have a good labelled dataset, and prompting alone cannot get the small model to do it — fine-tuning a small model to match a large one on a narrow task is the classic cost win.

**Costs:** a dataset to curate, a training run, an evaluation set, and a model you now own and must re-train when the base model improves.

## The decision in one table

| Need | Reach for |
|---|---|
| Model should know a small, stable document set | Long context (+ caching) |
| Model should know a large or changing corpus | RAG |
| Model should know per-user private data | RAG with permission filters |
| Model should *behave* a certain way (format, tone, labels) | Fine-tuning, after prompting fails |
| Small model should match a big one on a narrow task | Fine-tuning |
| Not sure yet | Long context first. It is the cheapest to try and to throw away. |

They combine. A production assistant often fine-tunes a small model for format, uses RAG for the knowledge, and caches a long system prompt. Pick the simplest that passes your evaluation set.

## The interview question

"We want the model to answer questions about our 5,000-page policy library. Would you fine-tune it?"

The answer they want is no — explain that fine-tuning does not reliably instil facts, that RAG is the fit for a large corpus, and then ask the follow-up that shows you have built one: "How often does the library change, and do different users see different policies?"

If you have built any of these, put the measurable outcome on your CV: "RAG pipeline over 12k support articles; retrieval hit-rate 91% on a 200-question test set" says far more than "worked with LLMs".
