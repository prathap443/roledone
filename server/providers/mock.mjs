// Deterministic offline provider for tests and local development without an API key.
// It reuses the browser's rule-based matcher so results are plausible but never "intelligent".
// It is only selected when ROLEDONE_PROVIDER=mock is set explicitly; /api/status reports it.

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
      if (tool.name === 'write_questions') {
        const ev = context.requirements.filter((r) => r.status === 'evidence'), gaps = context.requirements.filter((r) => r.status !== 'evidence');
        const q = (prompt, type, focus) => ({ prompt, type, focus, why: 'Mock rationale.', listen_for: ['Specific example', 'Your own contribution'] });
        const base = [
          q(`Walk me through how you used ${ev[0]?.name || 'your main tool'} on a recent project.`, 'depth', ev[0]?.name || ''),
          q(`What went wrong the last time you worked with ${ev[1]?.name || 'a pipeline'} and how did you fix it?`, 'depth', ev[1]?.name || ''),
          q(`This role needs ${gaps[0]?.name || 'a new tool'}. How would you get productive with it in your first month?`, 'gap', gaps[0]?.name || ''),
          q('Tell me about a time a stakeholder disagreed with your technical recommendation.', 'behavioural', ''),
          q('A nightly load fails at 3am and the business report is due at 8am. Talk me through your first hour.', 'scenario', ''),
        ];
        const count = context.count || 5;
        const questions = [...base];
        for (let i = questions.length; i < count; i++) questions.push(q(`Mock question ${i + 1}: describe a specific decision you made involving ${context.requirements[i % context.requirements.length]?.name || 'your stack'}.`, ['depth', 'gap', 'scenario', 'behavioural'][i % 4], ''));
        return { questions };
      }
      if (tool.name === 'ask_about_gap') {
        return { intro: `The advert asks for ${context.requirement.name}.`, questions: [`Have you used ${context.requirement.name} or an equivalent tool? Where?`, 'What did you build or change with it, and what was the outcome?'] };
      }
      if (tool.name === 'draft_bullet') {
        const joined = context.answers.filter((a) => !/^no\.?$/i.test(a.trim())).map((a) => a.replace(/\(no further detail[^)]*\)/i, '')).join(' ');
        if (!joined || (/\b(no|never|not really|haven't|have not)\b/i.test(joined) && joined.length < 80)) return { verdict: 'unsupported', bullet: '', explanation: 'Your answers do not describe hands-on experience.', learning_line: `Currently learning ${context.requirement.name}.` };
        const detail = context.answers.filter((a) => /^yes\b/i.test(a.trim())).map((a) => a.replace(/^yes\.?\s*/i, '').replace(/\(no further detail[^)]*\)/i, '').trim()).find(Boolean) || '';
        if (!detail && !/\bgovernment\b/i.test(context.cv)) return { verdict: 'needs_detail', bullet: '', explanation: 'A bare yes.', learning_line: '', placement_role_line: null, follow_up: `Which project did you use ${context.requirement.name} on, and what did you do with it?` };
        const roleLine = sentences(context.cv).find((l) => /\b(19[89]\d|20[0-4]\d)\b/.test(l) && l.split(/\s+/).length <= 16) || null;
        return { verdict: 'supported', bullet: `Used ${context.requirement.name}: ${detail || 'as shown in the CV'}`, explanation: 'Drafted from your answer.', learning_line: '', placement_role_line: roleLine, follow_up: '' };
      }
      if (tool.name === 'summarise_scan') {
        const ls = sentences(context.cv);
        return { headline: 'Mock summary: clear technical depth; a few bullets need outcomes.', target_role: 'Data Engineer',
          strengths: [{ text: 'Names the platforms actually used.', evidence: ls[1] || ls[0] }, { text: 'Fabricated evidence is dropped.', evidence: 'not in the cv' }],
          fixes: [{ text: 'If a bullet had a measurable outcome, add it.', why: 'Numbers are what a hiring manager remembers.', evidence: ls[2] || null }] };
      }
      if (tool.name === 'structure_cv') {
        const { structureCV } = await import('../../dist/structure.js');
        return structureCV(context.cv);
      }
      throw new Error(`mock provider: unknown tool ${tool.name}`);
    },
  };
}
