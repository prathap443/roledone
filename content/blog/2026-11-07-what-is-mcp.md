---
title: What is MCP? The Model Context Protocol, explained for students
description: MCP is the USB-C of AI tools — one standard way for a model to reach files, databases and APIs. Here is how it works, with a server you can run in ten minutes.
date: 2026-11-07
tags: MCP, Agents
level: Beginner
---

## The problem MCP solves

A language model on its own can only do one thing: turn text into more text. The moment you want it to read a file, query a database, or create a Jira ticket, somebody has to write code that connects the model to that system.

Before MCP, every AI product wrote that glue code its own way. A plugin written for one assistant did not work in another. If you built a connector to your company's wiki, you built it again for the next tool.

The **Model Context Protocol (MCP)** is an open standard, published by Anthropic in late 2024 and now adopted across the industry, that fixes this. You write one *MCP server* that exposes your system. Any MCP-compatible client — a chat app, an IDE assistant, a coding agent — can use it.

The analogy people reach for is USB-C: one port, many devices. It is a fair one.

## The three things a server can offer

An MCP server advertises up to three kinds of capability:

- **Tools** — functions the model can call. `search_tickets(query)`, `run_sql(statement)`, `send_email(to, body)`. Each has a name, a description and a JSON schema for its inputs. This is the one you will use most.
- **Resources** — data the client can read, addressed by URI. `file:///docs/handbook.md`, `db://customers/123`. Think of them as GET endpoints the model can pull into its context.
- **Prompts** — reusable prompt templates the server offers the user, like "summarise this pull request".

Tools are *model-controlled* (the model decides to call them). Resources are *application-controlled* (the host decides what to attach). That distinction matters when you design one.

## How a call actually flows

1. The client starts the server (usually as a subprocess over stdio, or connects over HTTP).
2. The client asks `tools/list`. The server replies with every tool, its description and its input schema.
3. The client puts those tool definitions in the model's context.
4. The user asks something. The model decides a tool would help and emits a structured tool call: `{ "name": "search_tickets", "arguments": { "query": "login bug" } }`.
5. The client sends `tools/call` to the server, gets the result, and hands it back to the model as a message.
6. The model reads the result and either answers or calls another tool.

Everything on the wire is JSON-RPC 2.0. You almost never write that by hand; the SDKs do it.

## A server in forty lines

Here is a complete MCP server in TypeScript that exposes one tool. It uses the official SDK.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "campus-library", version: "1.0.0" });

server.tool(
  "find_books",
  "Search the campus library catalogue by title or author.",
  { query: z.string().describe("Words from the title or the author's name") },
  async ({ query }) => {
    const res = await fetch(`https://library.example.edu/api/search?q=${encodeURIComponent(query)}`);
    const books = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(books.slice(0, 10), null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

Run it with `node server.js`, add it to your client's MCP config, and ask "find me books on distributed systems". The model will call `find_books`, read the JSON, and answer.

The Python SDK (`mcp`) looks almost identical; `@server.tool()` decorates a function and the type hints become the schema.

## What makes a good tool

Models read your tool descriptions the way a new colleague reads your docs. The quality of the description decides whether the tool gets used correctly.

- **Describe when to use it, not just what it does.** "Search tickets. Use this before creating a ticket, to avoid duplicates." beats "Searches tickets."
- **Keep inputs few and typed.** A tool with twelve optional parameters gets called wrong.
- **Return text the model can reason over.** A tidy summary beats a 4 MB JSON dump. Truncate, and say that you did.
- **Make destructive actions explicit.** Name it `delete_ticket`, not `update_ticket(action="delete")`, so a client can ask the user to confirm.
- **Fail loudly.** Return an error message that says what went wrong and what would fix it. A silent empty result teaches the model nothing.

## Security, in one paragraph

An MCP server runs with whatever permissions you give it. A tool that runs shell commands is a tool that runs shell commands. Treat every tool result as untrusted input (a web page the model fetched can contain instructions aimed at the model — this is *prompt injection*), scope credentials narrowly, and keep anything destructive behind a confirmation in the client. If you are building a server for other people, read the authorisation section of the spec before shipping it over HTTP.

## Where to go next

- Build a server for something you actually use: your university's timetable, your notes folder, a Discord bot's database.
- Read the spec at modelcontextprotocol.io — it is short and readable.
- Then read our guide to [how agents use tools in a loop](/blog/how-ai-agents-work), which is the other half of the picture.

If you put an MCP server on your CV, describe what it connected and what it let people do. "Built an MCP server exposing our ticketing API as three tools, used daily by the support team" is a line an interviewer can ask about.
