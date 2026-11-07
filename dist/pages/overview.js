import { state, requirements } from '../state.js';
import { evidenceScore } from '../core.js';
import { plan, PLANS } from '../plans.js';
import { heading } from '../ui.js';
import { aiAvailable, providerLabel, featuredJobs } from '../api.js';
import { jobCard, bindScan } from './jobs.js';
import { $, $$ } from '../ui.js';

let featured = null; // cached for the session

const two = (n) => String(n).padStart(2, '0');

export function render() {
  const rows = requirements();
  const score = evidenceScore(rows);
  const practised = Object.values(state.answers).filter((a) => a.trim()).length;
  return heading('MAKE YOUR NEXT MOVE COUNT', 'Your next chapter starts here.', 'A little clarity. A stronger story. A role that fits.', '<button class="primary" data-page="scan">Scan my CV <span>↗</span></button>') + `
<section class="hero"><div class="hero-copy"><div class="eyebrow">GOOD WORK DESERVES TO BE SEEN</div><h2>You have the experience.<br>Let’s find <em>the words.</em></h2><p>Connect what you’ve done with where you want to go. One thoughtful application at a time.</p><button class="primary lime" id="demo">Explore a sample journey <span>↗</span></button></div><div class="orbit" aria-hidden="true"><div class="orbit-ring"></div><div class="orbit-ring"></div><div class="orbit-ring"></div><div class="orbit-ring"></div><div class="orbit-core">↗</div><div class="orbit-chip chip-one"><span>✓</span> Your experience</div><div class="orbit-chip chip-two"><span>◎</span> Your next role</div><div class="orbit-chip chip-three"><span>✧</span> A story only you can tell</div></div></section>
<section class="metrics" aria-label="Your progress">
 <div class="metric"><div class="metric-top"><span>${score ? 'Evidence Score' : 'CV score'}</span><span>◎</span></div><strong>${score ? score.score : state.scan ? state.scan.score : '—'}</strong><small>${score ? `${score.gap} missing · ${score.partial} partial` : state.scan ? `CV scan · ${PLANS[plan()].label} plan` : 'Scan your CV to get a score'}</small></div>
 <div class="metric"><div class="metric-top"><span>Answers practised</span><span>◌</span></div><strong>${two(practised)}</strong><small>Your interview preparation</small></div>
 <div class="metric"><div class="metric-top"><span>Applications tracked</span><span>↗</span></div><strong>${two(state.applications.length)}</strong><small>Your next opportunities</small></div>
</section>
<section class="featured" id="featured"><div class="section-heading"><h2>Featured roles</h2><span><button class="text-button" data-page="jobs">Search all roles ↗</button></span></div><div class="carousel-wrap"><button class="carousel-nav prev" id="car-prev" aria-label="Previous roles">‹</button><div class="carousel" id="carousel">${featured ? featured.map((j) => jobCard(j, { compact: true })).join('') : '<div class="job-card compact skeleton"></div><div class="job-card compact skeleton"></div><div class="job-card compact skeleton"></div><div class="job-card compact skeleton"></div>'}</div><button class="carousel-nav next" id="car-next" aria-label="Next roles">›</button></div></section>
<div class="lower-grid">
 <section><div class="section-heading"><h2>A clearer path forward</h2><span>YOUR NEXT STEPS</span></div><div class="panel">
  <div class="journey-row"><span class="step-no">00</span><div><h3>See how your CV reads</h3><p>A scored report in seconds: structure, impact, readability, coverage.</p></div><button data-page="scan" aria-label="Open CV scan">↗</button></div>
  <div class="journey-row"><span class="step-no">01</span><div><h3>Find the connection</h3><p>Compare your experience with a real job description.</p></div><button data-page="match" aria-label="Open role match">↗</button></div>
  <div class="journey-row"><span class="step-no">02</span><div><h3>Make your story stronger</h3><p>Shape your CV, keeping every claim yours.</p></div><button data-page="editor" aria-label="Open CV studio">↗</button></div>
  <div class="journey-row"><span class="step-no">03</span><div><h3>Walk in with preparation</h3><p>Practise the questions behind the job description.</p></div><button data-page="interview" aria-label="Open interview room">↗</button></div>
 </div></section>
 <section><div class="section-heading"><h2>A thought for your next move</h2><span>THE CAREER NOTE</span></div><div class="panel insight"><span class="small-caps">LESS POLISH. MORE PROOF.</span><h3>The strongest thing on your CV is something you actually did.</h3><p>Start with the problem. Show your contribution. Finish with an outcome you can explain.</p><button class="text-button" data-page="editor">Bring your experience into focus ↗</button></div></section>
</div>
<div class="bottom-note">◇ ${aiAvailable() ? `${providerLabel()} analysis is available. Your text is only sent when you ask for it, and never stored by Roledone.` : 'Your CV stays in this tab unless you choose to save it on this device. No AI requests are sent.'}</div>`;
}

export function bind({ loadSample, navigate, rebind }) {
  document.getElementById('demo')?.addEventListener('click', loadSample);
  const paint = () => {
    const c = $('#carousel'); if (!c) return;
    c.innerHTML = featured.length ? featured.map((j) => jobCard(j, { compact: true })).join('') : '<p class="hint">No roles to show right now. <button class="text-button" data-page="jobs">Search roles</button></p>';
    rebind(c); bindScan(featured, navigate);
  };
  if (featured) paint();
  else featuredJobs().then((r) => { featured = r.jobs || []; paint(); }).catch(() => { featured = []; paint(); });
  const step = () => Math.max(260, ($('#carousel')?.clientWidth || 900) * 0.6);
  $('#car-prev').onclick = () => $('#carousel').scrollBy({ left: -step(), behavior: 'smooth' });
  $('#car-next').onclick = () => $('#carousel').scrollBy({ left: step(), behavior: 'smooth' });
}
