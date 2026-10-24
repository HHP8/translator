import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { MODELS, LANGUAGES, type TranslationEvent } from '../shared/types.ts';
import { parseOptions, prepareInput, validateAudio } from './inputs.ts';
import { AppError, safeError } from './errors.ts';
import type { Provider } from './provider.ts';

export function createApp(provider: Provider, port = 5173, staticRoot?: string) {
  const app = express(); app.disable('x-powered-by');
  const origins = new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host || ![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) { res.status(403).json({ error:'Invalid local host.' }); return; }
    res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://api.openai.com; frame-src 'self' blob:; object-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    next();
  });
  // Mount security checks through the same router matching as the protected API.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control','no-store');
    const origin = req.headers.origin;
    if ((origin && !origins.has(origin)) || (req.method !== 'GET' && !origin) || req.headers['sec-fetch-site'] === 'cross-site') { res.status(403).json({ error:'This API accepts same-origin local requests only.' }); return; }
    next();
  });
  app.use(express.json({ limit:'1mb', inflate:false }));
  const upload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:25*1024*1024, files:1, fields:8, fieldSize:1024*1024, parts:10 } });
  app.get('/api/health', (_req,res) => res.json({ configured:provider.configured, mock:provider.mock, name:'Translator' }));
  let modelCache: { expires:number; ids:string[] } | null = null;
  app.get('/api/models', async (_req,res) => {
    if (!provider.configured) { res.json({ models:MODELS.map(m=>({id:m.id,access:'unknown'})), configured:false }); return; }
    try {
      if (!modelCache || modelCache.expires < Date.now()) modelCache = { ids:await provider.models(), expires:Date.now()+600_000 };
      res.json({ configured:true, models:MODELS.map(m=>({id:m.id,access:modelCache!.ids.includes(m.id)?'listed':'unavailable'})) });
    } catch (error) { const safe = safeError(error); res.status(safe.status).json({ error:safe.message, code:safe.code, models:MODELS.map(m=>({id:m.id,access:'unknown'})) }); }
  });
  app.post('/api/translate', upload.single('file'), async (req,res) => {
    const controller = new AbortController(); res.on('close', () => controller.abort());
    let started = false; let index = 0;
    const send = (event:TranslationEvent) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    try {
      if (!provider.configured) throw new AppError('not_configured','OpenAI is not configured. Check Settings.',503);
      const options = parseOptions(req.body);
      if (modelCache && !modelCache.ids.includes(options.model)) throw new AppError('model_access','The selected model is not listed for your project. Choose another model explicitly.',403);
      const input = await prepareInput(typeof req.body.text === 'string' ? req.body.text : undefined, req.file, req.body.mode, controller.signal);
      if (controller.signal.aborted) return;
      res.status(200).set({ 'Content-Type':'text/event-stream; charset=utf-8', 'Cache-Control':'no-store', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' }); res.flushHeaders(); started = true;
      send({ type:'start', total:input.chunks.length, source:input.source, warnings:input.warnings });
      for (index=0; index<input.chunks.length; index++) {
        if (controller.signal.aborted) break;
        const chunk = input.chunks[index]; send({type:'chunk',index,label:chunk.label});
        for await (const delta of provider.translate(chunk,options,controller.signal)) send({type:'delta',index,text:delta});
        if (controller.signal.aborted) break;
        send({type:'chunk_done',index});
      }
      if (!controller.signal.aborted) send({type:'done',total:input.chunks.length});
    } catch (error) {
      const safe = safeError(error);
      if (!res.destroyed) { if (started) send({type:'error',code:safe.code,message:safe.message,index}); else res.status(safe.status).json({error:safe.message,code:safe.code}); }
    } finally { if (!res.destroyed) res.end(); }
  });
  app.post('/api/transcribe',upload.single('file'),async(req,res)=>{
    const controller = new AbortController(); res.on('close',()=>controller.abort());
    try {
      if (!req.file) throw new AppError('missing_audio','Choose a recording to transcribe.');
      const source = req.body.source || 'auto';
      if (source !== 'auto' && !LANGUAGES.some(l=>l.code===source)) throw new AppError('invalid_language','Choose a supported source language.');
      const mime = validateAudio(req.file.buffer,req.file.originalname);
      const text = await provider.transcribe(req.file.buffer,req.file.originalname,mime,source,controller.signal);
      if (!res.destroyed) res.json({text});
    } catch(error) { const safe = safeError(error); if(!res.destroyed) res.status(safe.status).json({error:safe.message,code:safe.code}); }
  });
  app.post('/api/realtime/client-secret',async(req,res)=>{
    try {
      const source = req.body.source || 'auto';
      if (source !== 'auto' && !LANGUAGES.some(l=>l.code===source)) throw new AppError('invalid_language','Choose a supported source language.');
      res.json(await provider.clientSecret(source));
    } catch(error) { const safe=safeError(error); res.status(safe.status).json({error:safe.message,code:safe.code}); }
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API endpoint.'}));
  if (staticRoot) { app.use(express.static(staticRoot)); app.get('/{*path}',(_req,res)=>res.sendFile(path.join(staticRoot,'index.html'))); }
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    if(res.headersSent){res.end();return;}
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'encoding.unsupported') {
      res.status(415).json({error:'Compressed JSON request bodies are not supported.',code:'unsupported_encoding'}); return;
    }
    const safe = error instanceof multer.MulterError ? new AppError('upload_limit','The upload exceeds its size or field limits. Choose a smaller file.',413) : safeError(error);
    res.status(safe.status).json({error:safe.message,code:safe.code});
  });
  return app;
}
