export const sampleCV = `Alex Morgan | Data Engineer | Manchester
Built Azure Data Factory pipelines to ingest sales data into Azure Synapse.
Optimised SQL transformations, reducing processing time by 30%.
Developed Python validation checks and monitored daily data quality.
Used PySpark and Databricks to transform event data.
Partnered with analysts to define reporting requirements.
Maintained Git repositories and reviewed pull requests.`;
export const sampleJD = `Senior Data Engineer — Northstar Analytics
Manchester · Hybrid
Build reliable pipelines with Azure Data Factory, Azure Synapse, SQL, Python, PySpark and Databricks.
Manage infrastructure with Terraform and deploy changes using CI/CD.
Communicate technical trade-offs to stakeholders.`;
export const skills = [
 ['Azure Data Factory',['azure data factory','adf']],['Azure Synapse',['azure synapse','synapse']],['SQL',['sql']],['Python',['python']],['PySpark',['pyspark']],['Databricks',['databricks']],['Terraform',['terraform']],['CI/CD',['ci/cd','ci cd','continuous integration']],['Docker',['docker']],['AWS',['aws','amazon web services']],['Azure',['azure']],['Snowflake',['snowflake']],['dbt',['dbt']],['Kafka',['kafka']],['Airflow',['airflow']],['Kubernetes',['kubernetes']],['Git',['git']],['Java',['java']],['JavaScript',['javascript']],['React',['react']],['TypeScript',['typescript']],['PostgreSQL',['postgresql','postgres']],['Power BI',['power bi']],['Spark',['spark']],['Communication',['communicate','communication','stakeholders']]
];
const includes = (text, alias) => new RegExp('(^|[^a-z0-9])' + alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '($|[^a-z0-9])','i').test(text);
export function analyse(cv,jd) {
 const requirements = skills.filter(([,aliases])=>aliases.some(a=>includes(jd,a)));
 return requirements.map(([name,aliases])=>({name, evidence:cv.split(/\n|(?<=[.!?])\s+/).find(line=>aliases.some(a=>includes(line,a))) || null}));
}
export function feedback(answer) {
 const words = answer.trim().split(/\s+/).filter(Boolean).length;
 if (words < 15) return ['Add a specific example before reviewing your answer. Aim for a few complete sentences.'];
 const tips=[];
 if (!/situation|when|project|team|working|during/i.test(answer)) tips.push('Set the scene: what was happening and why did it matter?');
 if (!/\bI\b/i.test(answer)) tips.push('Clarify your personal contribution using “I”, alongside the team’s work.');
 if (!/result|reduc|improv|learn|deliver|\d|outcome/i.test(answer)) tips.push('Close with an observed outcome or what you learned. Only include metrics you can support.');
 if(words>300) tips.push('Try a shorter version: focus on the decision, your action, and the result.');
 return tips.length ? tips : ['Your answer includes useful structure cues. Practise explaining your trade-off and what you would do differently. This checklist does not assess technical correctness.'];
}
export function questions(rows) {
 const found=rows.filter(r=>r.evidence).map(r=>r.name), missing=rows.filter(r=>!r.evidence).map(r=>r.name);
 return [
  `Walk me through a project where you used ${found[0] || 'a core technical skill'}. What did you personally own?`,
  `How would you diagnose a slow ${found.includes('SQL')?'SQL transformation':'data pipeline'}? Explain your first three steps.`,
  `Describe a reliability trade-off you made${found[1]?' when working with '+found[1]:''}. What alternatives did you consider?`,
  missing.length ? `This role mentions ${missing[0]}. How would you approach a task requiring it, and where would you need support?` : 'Describe an unfamiliar technical problem and how you approached it.',
  'Tell me about a disagreement with a stakeholder. What did you do, and what changed?'
 ];
}

/**
 * Evidence Score: weighted coverage of the role's requirements by the CV.
 * must-have = weight 1, nice-to-have = 0.5, responsibility = 0.75.
 * evidence = 1, partial = 0.5, gap = 0. Returns null when there are no requirements.
 * This is a transparent coverage measure, not an ATS score or a hiring prediction.
 */
export function evidenceScore(requirements) {
 const weight = {must:1, nice:0.5, responsibility:0.75}, credit = {evidence:1, partial:0.5, gap:0};
 let total=0, earned=0;
 const counts = {evidence:0, partial:0, gap:0, must:0, mustEvidence:0};
 for (const r of requirements || []) {
  const status = r.status ?? (r.evidence ? 'evidence' : 'gap');
  const w = weight[r.kind] ?? 1, c = credit[status] ?? 0;
  total += w; earned += w*c; counts[status in credit ? status : 'gap']++;
  if ((r.kind ?? 'must') === 'must') { counts.must++; if (status === 'evidence') counts.mustEvidence++; }
 }
 if (!total) return null;
 const score = Math.round(100*earned/total);
 const band = score >= 80 ? 'strong' : score >= 60 ? 'good' : score >= 40 ? 'developing' : 'early';
 return {score, band, ...counts, total: (requirements||[]).length};
}
