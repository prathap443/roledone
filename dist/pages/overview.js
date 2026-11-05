import { state, requirements } from '../state.js';
import { heading } from '../ui.js';
import { aiAvailable, providerLabel } from '../api.js';

const two = (n) => String(n).padStart(2, '0');

export function render() {
  const rows = requirements();
  const evidence = rows.filter((r) => r.status !== 'gap').length;
  const practised = Object.values(state.answers).filter((a) => a.trim()).length;
  return heading('MAKE YOUR NEXT MOVE COUNT', 'Your next chapter starts here.', 'A little clarity. A stronger story. A role that fits.', '<button class="primary" data-page="match">Start a role match <span>↗</span></button>') + `
<section class="hero"><div class="hero-copy"><div class="eyebrow">GOOD WORK DESERVES TO BE SEEN</div><h2>You have the experience.<br>Let’s find <em>the words.</em></h2><p>Connect what you’ve done with where you want to go. One thoughtful application at a time.</p><button class="primary lime" id="demo">Explore a sample journey <span>↗</span></button></div><div class="orbit" aria-hidden="true"><div class="orbit-ring"></div><div class="orbit-ring"></div><div class="orbit-ring"></div><div class="orbit-ring"></div><div class="orbit-core">↗</div><div class="orbit-chip chip-one"><span>✓</span> Your experience</div><div class="orbit-chip chip-two"><span>◎</span> Your next role</div><div class="orbit-chip chip-three"><span>✧</span> A story only you can tell</div></div></section>
<section class="metrics" aria-label="Your progress">
 <div class="metric"><div class="metric-top"><span>Requirements with evidence</span><span>◎</span></div><strong>${two(evidence)}</strong><small>${rows.length ? `of ${rows.length} ${state.requirements ? 'requirements found' : 'recognised terms'}` : 'Start with a role match'}</small></div>
 <div class="metric"><div class="metric-top"><span>Answers practised</span><span>◌</span></div><strong>${two(practised)}</strong><small>Your interview preparation</small></div>
 <div class="metric"><div class="metric-top"><span>Applications tracked</span><span>↗</span></div><strong>${two(state.applications.length)}</strong><small>Your next opportunities</small></div>
</section>
<div class="lower-grid">
 <section><div class="section-heading"><h2>A clearer path forward</h2><span>YOUR NEXT STEPS</span></div><div class="panel">
  <div class="journey-row"><span class="step-no">01</span><div><h3>Find the connection</h3><p>Compare your experience with a real job description.</p></div><button data-page="match" aria-label="Open role match">↗</button></div>
  <div class="journey-row"><span class="step-no">02</span><div><h3>Make your story stronger</h3><p>Shape your CV, keeping every claim yours.</p></div><button data-page="editor" aria-label="Open CV studio">↗</button></div>
  <div class="journey-row"><span class="step-no">03</span><div><h3>Walk in with preparation</h3><p>Practise the questions behind the job description.</p></div><button data-page="interview" aria-label="Open interview room">↗</button></div>
 </div></section>
 <section><div class="section-heading"><h2>A thought for your next move</h2><span>THE CAREER NOTE</span></div><div class="panel insight"><span class="small-caps">LESS POLISH. MORE PROOF.</span><h3>The strongest thing on your CV is something you actually did.</h3><p>Start with the problem. Show your contribution. Finish with an outcome you can explain.</p><button class="text-button" data-page="editor">Bring your experience into focus ↗</button></div></section>
</div>
<div class="bottom-note">◇ ${aiAvailable() ? `${providerLabel()} analysis is available. Your text is only sent when you ask for it, and never stored by Rolewoven.` : 'Your CV stays in this tab unless you choose to save it on this device. No AI requests are sent.'}</div>`;
}

export function bind({ loadSample }) {
  document.getElementById('demo')?.addEventListener('click', loadSample);
}
