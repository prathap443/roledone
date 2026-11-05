importScripts('./vendor/mammoth/mammoth.browser.min.js');
self.onmessage=async event=>{
 try{
  // Reject oversized declared ZIP contents before decompression.
  const data=new DataView(event.data);let unpacked=0;
  for(let i=0;i+46<=data.byteLength;i++)if(data.getUint32(i,true)===0x02014b50){unpacked+=data.getUint32(i+24,true);if(unpacked>30*1024*1024)throw new Error('This Word file expands beyond the 30 MB reading limit. Save a copy without large images or paste the text.');i+=45+data.getUint16(i+28,true)+data.getUint16(i+30,true)+data.getUint16(i+32,true);}
  const result=await mammoth.extractRawText({arrayBuffer:event.data});
  self.postMessage({text:result.value});
 }catch(error){self.postMessage({error:/30 MB/.test(error.message)?error.message:'Could not read this Word document. It may be damaged or protected. Save a fresh .docx or PDF and try again.'});}
};
