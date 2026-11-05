// Deterministic offline provider for tests and local development without an API key.
// It reuses the browser's rule-based matcher so results are plausible but never "intelligent".
// It is only selected when ROLEWOVEN_PROVIDER=mock is set explicitly; /api/status reports it.

import { analyse } from '../../dist/core.js';

const sentences = (text) => text.split(/\n|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

export function createMockProvider() {
  return {
    name: 'mock',
    model: 'rule-based',
    async complete({ tool, context }) {
      if (tool.name === 'report_match') {
        const rows = analyse(context.cv, context.jd);
        const jdLines = sentences(context.jd);
        return {
          requirements: rows.map((r) => ({
            name: r.name,
            kind: 'must',
            source: jdLines.find((l) => l.toLowerCase().includes(r.name.toLowerCase().split(' ')[0])) || jdLines[0],
            evidence: r.evidence,
            status: r.evidence ? 'evidence' : 'gap',
            note: r.evidence ? 'Your CV mentions this term.' : 'No mention found in your CV text.',
          })),
        };
      }
      if (tool.name === 'propose_edits') {
        const lines = sentences(context.draft).filter((l) => /^(worked|helped|responsible|involved)/i.test(l)).slice(0, 3);
        return {
          suggestions: lines.map((l) => ({
            requirement: '',
            original: l,
            proposed: l.replace(/^(worked on|helped with|responsible for|involved in)\s*/i, 'Delivered '),
            rationale: 'Lead with the action you took rather than a passive phrase.',
            evidence: [l],
            unsupported: ['Scale of the work (records, users, or frequency) — add only if you can support it.'],
          })),
        };
      }
      if (tool.name === 'review_answer') {
        const a = context.answer;
        const has = (re) => re.test(a);
        return {
          summary: 'Rule-based structure check (mock provider).',
          star: {
            situation: { present: has(/situation|when|project|during/i), note: 'Set the scene briefly.' },
            task: { present: has(/task|goal|needed|responsible/i), note: 'State what you were asked to achieve.' },
            action: { present: has(/\bI\b/), note: 'Use "I" for your own contribution.' },
            result: { present: has(/result|reduc|improv|\d/i), note: 'Close with an observed outcome.' },
          },
          strengths: a.length > 100 ? ['Enough detail to discuss in an interview.'] : [],
          improvements: ['Name the trade-off you considered.'],
          follow_up: 'What would you do differently next time?',
        };
      }
      throw new Error(`mock provider: unknown tool ${tool.name}`);
    },
  };
}
