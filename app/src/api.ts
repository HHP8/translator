import type { TranslationEvent, TranslationOptions, Mode } from '../shared/types.ts';
export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url,init);
  const data = await response.json().catch(()=>({error:'The local server returned an unreadable response.'}));
  if(!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}
export async function translate(input: { text?: string; file?: File; mode?: Mode }, options: TranslationOptions, signal: AbortSignal, onEvent: (event:TranslationEvent)=>void): Promise<void> {
  const body = new FormData();
  for(const [key,value] of Object.entries(options)) body.append(key,value);
  if(input.text!==undefined) body.append('text',input.text);
  if(input.file) body.append('file',input.file);
  if(input.mode) body.append('mode',input.mode);
  const response = await fetch('/api/translate',{method:'POST',body,signal});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error || 'Translation could not start.');}
  if(!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('The server did not return a translation stream.');
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer=''; let complete=false;
  try {
    for(;;){
      signal.throwIfAborted();
      const {done,value}=await reader.read(); signal.throwIfAborted(); buffer+=decoder.decode(value,{stream:!done});
      let boundary:number;
      while((boundary=buffer.indexOf('\n\n'))!==-1){
        const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const data=block.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');
        if(!data)continue;
        let event:TranslationEvent;
        try{event=JSON.parse(data);}catch{throw new Error('The translation stream was interrupted by an invalid event.');}
        signal.throwIfAborted();onEvent(event);
        if(event.type==='error')throw new Error(event.message);
        if(event.type==='done')complete=true;
      }
      if(done)break;
    }
    if(!complete)throw new Error('The stream ended before completion. Partial output has been preserved.');
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
