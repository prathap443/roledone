import * as pdfjs from './vendor/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
self.onmessage=async event=>{
 let task;
 try{
  task=pdfjs.getDocument({data:new Uint8Array(event.data),isEvalSupported:false,useSystemFonts:false,cMapUrl:new URL('./vendor/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/pdfjs/wasm/',import.meta.url).href});
  task.onPassword=()=>{self.postMessage({error:'This PDF is password-protected. Save an unlocked copy and upload it again.'});task.destroy();};
  const pdf=await task.promise;
  if(pdf.numPages>30)throw new Error('This PDF has more than 30 pages. Upload only the CV pages.');
  const pages=[];let length=0,blank=0;
  for(let p=1;p<=pdf.numPages;p++){
   const page=await pdf.getPage(p);const content=await page.getTextContent();
   const lines=[];let line='',lastY=null;
   for(const item of content.items){if(!('str' in item))continue;const y=item.transform?.[5];if(lastY!==null && y!==undefined && Math.abs(y-lastY)>3 && line){lines.push(line.trim());line='';}line+=item.str+(item.hasEOL?'':' ');if(item.hasEOL){lines.push(line.trim());line='';}lastY=y;}
   if(line.trim())lines.push(line.trim());
   const text=lines.join('\n');if(!text.trim())blank++;length+=text.length;
   if(length>50000)throw new Error('The extracted text exceeds 50,000 characters. Upload a shorter CV.');
   pages.push(text);page.cleanup();
  }
  if(blank && blank<pdf.numPages)throw new Error('Some PDF pages have no readable text and may be scanned. Use a searchable PDF so no CV pages are missed, or paste the full text.');
  self.postMessage({text:pages.join('\n\n')});
 }catch(error){self.postMessage({error:error.name==='PasswordException'?'This PDF is password-protected. Save an unlocked copy and upload it again.':/pages|50,000|searchable PDF/.test(error.message)?error.message:'Could not read this PDF. It may be damaged. Export a fresh searchable PDF or paste the text.'});}
 finally{if(task)await task.destroy().catch(()=>{});}
};
