import test from 'node:test';
import assert from 'node:assert/strict';
import {analyse,feedback,questions,sampleCV,sampleJD} from '../dist/core.js';
test('evidence is an exact source excerpt; missing tools stay missing',()=>{
 const rows=analyse(sampleCV,sampleJD);
 assert.equal(rows.find(r=>r.name==='Terraform').evidence,null);
 assert.equal(rows.find(r=>r.name==='CI/CD').evidence,null);
 for(const r of rows.filter(r=>r.evidence))assert.ok(sampleCV.includes(r.evidence));
 assert.ok(rows.find(r=>r.name==='SQL').evidence);
});
test('aliases are supported and substring false positives are excluded',()=>{
 assert.ok(analyse('Built ADF pipelines.','Azure Data Factory')[0].evidence);
 assert.equal(analyse('I use JavaScript.','Java')[0].evidence,null);
 assert.equal(analyse('I use GitHub.','Git')[0].evidence,null);
});
test('unknown requirements are not assigned invented scores',()=>assert.deepEqual(analyse('Example CV','UnlistedSpecialTechnology'),[]));
test('empty answers receive an actionable prompt',()=>assert.match(feedback('')[0],/specific example/));
test('role questions include an explicit experience gap',()=>{
 const qs=questions(analyse(sampleCV,sampleJD));
 assert.equal(qs.length,5);assert.match(qs[3],/Terraform/);
});
