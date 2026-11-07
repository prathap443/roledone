import http from 'node:http';
import { createHandler } from './server/api.mjs';
import { createAI } from './server/ai.mjs';
import { providerFromEnv } from './server/providers/index.mjs';
import { createUsage } from './server/usage.mjs';
import { jobsFromEnv } from './server/jobs.mjs';
import { loadPosts, createBlog } from './server/blog.mjs';
import { billingFromEnv, authFromEnv } from './server/billing.mjs';

// Load .env for local development only; Replit and production use real environment variables.
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const usage = createUsage();
const provider = providerFromEnv(process.env, { usage }); // throws loudly on a misconfigured provider
const ai = createAI(provider);
const billing = billingFromEnv(); // throws loudly if Stripe is half-configured
const auth = authFromEnv();       // throws loudly if Supabase is half-configured
const port = Number(process.env.PORT || 3000);

const jobs = jobsFromEnv(process.env);
const blog = createBlog({ posts: await loadPosts(new URL('./content/blog', import.meta.url).pathname), siteUrl: process.env.APP_URL || 'https://roledone.com' });
console.log(`Jobs: ${jobs.source} · Blog: ${blog.posts.length} posts`);
http.createServer(createHandler({ ai, usage, billing, auth, jobs, blog })).listen(port, '0.0.0.0', () => {
  const status = ai.status();
  console.log(`Roledone: http://localhost:${port}`);
  console.log(status.ai ? `AI: ${status.provider} (quality: ${status.model}, fast: ${status.fastModel})` : 'AI: not configured — browser-only mode. Set ANTHROPIC_API_KEY to enable.');
  console.log(auth ? `Auth: Supabase (${auth.publicConfig.url})` : 'Auth: off (no accounts; subscriptions are per device)');
  console.log(billing ? `Billing: Stripe ${billing.mode} (plans: ${Object.keys(billing.stripe.prices).join(', ')}); default plan ${status.defaultPlan}` : `Billing: off; default plan ${status.defaultPlan}`);
});
