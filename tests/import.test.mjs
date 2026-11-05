import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFile,cleanText,extractCV,MAX_FILE_BYTES} from '../dist/import-cv.js';
test('accept PDF, DOCX and TXT up to 10 MB including uppercase extensions',()=>{
 for(const name of ['cv.PDF','cv.docx','cv.txt'])assert.ok(validateFile({name,size:MAX_FILE_BYTES}));
});
test('file type and size errors give distinct actionable messages',()=>{
 assert.throws(()=>validateFile({name:'cv.doc',size:100}),/older Word/);
 assert.throws(()=>validateFile({name:'cv.png',size:100}),/Choose a PDF/);
 assert.throws(()=>validateFile({name:'cv.pdf',size:MAX_FILE_BYTES+1}),/larger than 10 MB/);
 assert.throws(()=>validateFile({name:'cv.txt',size:0}),/empty/);
});
test('normalise text without discarding Unicode or lines',()=>assert.equal(cleanText('\uFEFFJosé\r\nSQL developer\r\n'),'José\nSQL developer'));
test('reject empty, binary and overly long extracted content',()=>{
 assert.throws(()=>cleanText('  '),/OCR/);
 assert.throws(()=>cleanText('x'.repeat(50001)),/50,000/);
 assert.throws(()=>cleanText('binary\0file'),/UTF-8/);
});
test('TXT upload above the old 500KB limit is allowed if resulting text fits',async()=>{
 const file=new File([' '.repeat(510000)+'SQL developer'],'cv.TXT');
 assert.equal(await extractCV(file),'SQL developer');
});
test('reject misleading PDF and DOCX extensions before starting a reader',async()=>{
 await assert.rejects(extractCV(new File(['not a PDF'],'cv.pdf')),/not a valid PDF/);
 await assert.rejects(extractCV(new File(['not a DOCX'],'cv.docx')),/not a valid DOCX/);
});
