export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 50000;
export function validateFile(file) {
 const extension = file.name.split('.').pop().toLowerCase();
 if (!['txt','pdf','docx'].includes(extension)) throw new Error(extension==='doc' ? 'This is an older Word .doc file. Save it as .docx or PDF, then try again.' : 'Choose a PDF, Word (.docx), or TXT file.');
 if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 10 MB. Save a smaller copy, or paste your CV text.');
 if (!file.size) throw new Error('This file is empty. Choose a file that contains your CV.');
 return extension;
}
export function cleanText(value) {
 const text=value.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/[\t ]+\n/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();
 if (!text) throw new Error('No readable text was found. If this is a scan or photo, use OCR to create a searchable PDF, or paste your CV text.');
 if (text.length > MAX_TEXT_LENGTH) throw new Error('The extracted text exceeds 50,000 characters. Upload a shorter CV or paste only the relevant sections.');
 if (text.includes('\u0000')) throw new Error('This does not look like a readable text file. Save it as UTF-8 TXT, PDF, or DOCX.');
 return text;
}
export async function extractCV(file) { return (await extractCVWithSource(file)).text; }
/** Extract text and, for .docx, keep the original bytes so edits can be written back into the user's own design. */
export async function extractCVWithSource(file) {
 const kind=validateFile(file);
 if(kind==='txt')return {text:cleanText(await file.text()),source:null};
 const original=await file.arrayBuffer();
 const source=kind==='docx'?{name:file.name,bytes:new Uint8Array(original.slice(0))}:null;
 const buffer=original;
 const bytes=new Uint8Array(buffer);
 if(kind==='pdf' && !new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-')) throw new Error('This file is not a valid PDF. Export a fresh PDF and try again.');
 if(kind==='docx' && (bytes[0]!==0x50 || bytes[1]!==0x4b)) throw new Error('This file is not a valid DOCX. Save it as a Word .docx file and try again.');
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL(kind==='pdf'?'pdf-import-worker.js':'docx-import-worker.js',import.meta.url),kind==='pdf'?{type:'module'}:{});
  const finish=(error,text)=>{clearTimeout(timer);worker.terminate();if(error)reject(new Error(error));else{try{resolve({text:cleanText(text),source});}catch(e){reject(e);}}};
  const timer=setTimeout(()=>finish('Reading this document took too long. Try exporting a simpler PDF or DOCX, or paste the text.'),30000);
  worker.onmessage=e=>finish(e.data.error,e.data.text);
  worker.onerror=e=>{e.preventDefault();finish('Could not start the document reader. Refresh the page and try again, or paste your CV text.');};
  worker.postMessage(buffer,[buffer]);
 });
}
