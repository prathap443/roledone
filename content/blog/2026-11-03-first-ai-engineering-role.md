---
title: Getting your first AI or data engineering role — what hiring managers look for in 2026
description: The job titles, the skills that actually get screened for, the portfolio that beats a certificate, and how to write a CV line a recruiter can verify.
date: 2026-11-03
tags: Careers, AI
level: Beginner
---

## Three titles, one spectrum

Most junior roles touching AI fall into three families, and the adverts overlap more than the names suggest:

- **Data Engineer** — pipelines, warehouses, lakehouses. SQL, Python, Spark, one cloud (Azure, AWS or GCP), orchestration (Airflow, Data Factory, dbt). The bread and butter of every company with data. The most openings, and the most forgiving entry point.
- **Machine Learning Engineer** — turning models into systems. Python, PyTorch, feature pipelines, evaluation, deployment, monitoring. Fewer junior roles; most come via a data engineering or software engineering route.
- **AI Engineer** (the newest title) — building products on top of LLM APIs. Prompting, tool use and agents, RAG, evaluation, cost control, plus plain web engineering. Demand grew fastest here in the last two years, and many adverts accept software engineers who have shipped one serious LLM project.

Read the advert's *requirements*, not its title. "AI Engineer" roles that are really data roles, and vice versa, are common.

## What gets screened for

Recruiters and hiring managers screen CVs in seconds. For these roles the first pass looks for:

1. **SQL and Python**, named, with evidence of use — not a list, a line that shows something built.
2. **One cloud platform**, and the specific services (Databricks, Azure Data Factory, BigQuery, S3 + Glue). Generic "cloud" means nothing.
3. **Something shipped.** A pipeline that ran daily, a model that served real requests, an agent people used. Coursework rarely counts unless it ran against real data for real users.
4. **Version control and testing.** Git is assumed; a mention of CI or tests sets you apart at junior level.
5. **For AI Engineer roles specifically:** evidence you understand tool use/agents, RAG, and evaluation — the engineering around the model, not just calling it.

Notice what is missing: the list of twenty frameworks, the Coursera certificates, the "passionate about AI" opener. Those do not hurt, but they do not get screened for.

## A portfolio that beats a certificate

One finished project, documented, beats five certificates. Finished means: it runs, someone else could run it, and it has a README with a measurable outcome.

Good projects for each path:

- **Data Engineer:** an end-to-end pipeline — ingest a public API daily, land it in a lakehouse (Delta on a free Databricks tier works), model it with dbt, publish one dashboard. Schedule it. Let it run for a month. Now you have "ran a daily pipeline for 30 days with zero failed runs".
- **ML Engineer:** take a public dataset, train a model, and *serve* it — an API with input validation, logging and a basic monitor for drift. The serving is the part employers care about.
- **AI Engineer:** build an agent with three tools over a real system (see our guide to [how agents work](/blog/how-ai-agents-work)), or an MCP server for something you use (see [What is MCP](/blog/what-is-mcp)). Add an evaluation set of twenty cases and report the pass rate.

Put the repo link on the CV. Put the outcome in the bullet.

## Write bullets a recruiter can verify

The single biggest CV failure we see at Roledone is bullets that make claims without evidence. "Experienced in building scalable data pipelines" is unfalsifiable. Compare:

> Built a daily ingestion pipeline (Python, Azure Data Factory, Delta Lake) for 14 public datasets; ran 30 days without a failed load; cut manual refresh time from 2 hours a week to zero.

Every clause can be checked or asked about. It names tools the screener is looking for. It has a number. It describes *your* contribution.

A formula that works: **what you built, with what, for whom, and what changed.** If you cannot fill in "what changed", say what scale it ran at instead.

## The interview

Junior technical interviews for these roles are predictable:

- **SQL live.** Joins, aggregations, window functions. Practise until a `ROW_NUMBER() OVER (PARTITION BY …)` is automatic.
- **Python.** Read a file, transform it, handle the edge cases. Clean code matters more than clever code.
- **System questions.** "How would you build a pipeline that…", "the model gives wrong answers — what do you check?" They want to hear you reason, ask clarifying questions and name trade-offs.
- **Your project.** Every line on your CV is fair game. If it is on the CV, be ready to talk about it for ten minutes.

For AI Engineer roles add: "explain RAG", "what is a tool call", "how would you evaluate this", "how would you keep the cost down". Our other guides cover each of those.

## A plan for the next eight weeks

1. **Weeks 1–2:** pick one path and one project. Set it up end to end, ugly.
2. **Weeks 3–5:** make it real. Scheduling, tests, a README with numbers.
3. **Week 6:** rewrite your CV around it. Every bullet verifiable.
4. **Weeks 7–8:** apply to ten roles whose requirements you mostly meet, and for each one, compare the advert to your CV and fix the gaps you can actually evidence.

That last step is what Roledone does: paste the advert, see which requirements your CV evidences and which it does not, and practise the interview questions hiding in the job description. Start with the [free scan](/#scan).
