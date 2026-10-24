import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Translate, TextT, Microphone, FileText, ImageSquare, SlidersHorizontal, ArrowsLeftRight, ArrowRight, Copy, Check, DownloadSimple, X, UploadSimple, Stop, CircleNotch, ArrowUpRight, ShieldCheck, GlobeHemisphereWest, WarningCircle, Trash } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LANGUAGES, MODELS, type Mode, type Health, type ModelStatus, type ModelId, type Segment, type TranslationOptions, type TranslationEvent } from '../shared/types.ts';
import { LanguagePicker, ModelPicker, Modal } from './components.tsx';
import { apiJson, translate } from './api.ts';
import { LiveCapture } from './live.ts';
import { PhraseQueue, TranscriptLedger, type TranscriptTurn } from './live-core.ts';
import './app.css';

type Status='idle'|'processing'|'complete'|'incomplete';
interface Workspace { text:string;file:File|null;segments:Segment[];turns:TranscriptTurn[];warnings:string[];error:string;status:Status;total:number;completed:number;resultOptions:TranslationOptions|null }
const empty=():Workspace=>({text:'',file:null,segments:[],turns:[],warnings:[],error:'',status:'idle',total:0,completed:0,resultOptions:null});
const TAB_INFO=[{id:'text',label:'Text',icon:TextT},{id:'voice',label:'Live Voice',icon:Microphone},{id:'documents',label:'Documents',icon:FileText},{id:'images',label:'Images',icon:ImageSquare}] as const;
const HEADINGS={text:['Text translation','Your words, in another language.'],voice:['Live translation','Speak naturally. Follow along in another language.'],documents:['Document translation','Keep the meaning. Carry the structure across.'],images:['Image translation','Read between languages, wherever you find them.']};
const PREFS_KEY='translator.preferences';
function preferences():TranslationOptions {
  const fallback:TranslationOptions={source:'auto',target:'',model:'gpt-6.1-sol'};
  try{const saved=JSON.parse(localStorage.getItem(PREFS_KEY)||'null');if(!saved)return fallback;return {source:saved.source==='auto'||LANGUAGES.some(l=>l.code===saved.source)?saved.source:'auto',target:LANGUAGES.some(l=>l.code===saved.target)?saved.target:'',model:MODELS.some(m=>m.id===saved.model)?saved.model:'gpt-6.1-sol'};}catch{return fallback;}
}
function Markdown({text}:{text:string}){return <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{a:({children,href})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>{text}</ReactMarkdown>;}

export function App(){
  const [mode,setMode]=useState<Mode>('text');const [options,setOptions]=useState(preferences);
  const [spaces,setSpaces]=useState<Record<Mode,Workspace>>({text:empty(),voice:empty(),documents:empty(),images:empty()});
  const [health,setHealth]=useState<Health|null>(null);const [access,setAccess]=useState<ModelStatus[]>([]);const [connectionError,setConnectionError]=useState('');const [checking,setChecking]=useState(false);
  const [settings,setSettings]=useState(false);const [busy,setBusy]=useState(false);const [connecting,setConnecting]=useState(false);const [capturing,setCapturing]=useState(false);const [finishing,setFinishing]=useState(false);const [queued,setQueued]=useState(0);const [level,setLevel]=useState(0);
  const [dragging,setDragging]=useState(false);const [copied,setCopied]=useState(false);const [exporting,setExporting]=useState(false);const [downloadOpen,setDownloadOpen]=useState(false);const [preview,setPreview]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);const audioInput=useRef<HTMLInputElement>(null);const downloadRef=useRef<HTMLDivElement>(null);
  const request=useRef<AbortController|null>(null);const jobEpoch=useRef(0);const sessionEpoch=useRef(0);const live=useRef<LiveCapture|null>(null);const queue=useRef<PhraseQueue|null>(null);const mounted=useRef(true);
  const ws=spaces[mode];const voiceBusy=connecting||capturing||finishing;const locked=busy||voiceBusy;
  const ordered=mode==='voice'&&!ws.file?ws.turns.flatMap(turn=>{const segment=ws.segments.find(s=>s.id===turn.id);return segment?[segment]:[];}):ws.segments;
  const output=ordered.filter(s=>s.text).map(s=>s.text).join('\n\n');
  const target=LANGUAGES.find(l=>l.code===(ws.resultOptions?.target||options.target));
  const rtl=target?.rtl||false;const sourceRtl=LANGUAGES.find(l=>l.code===options.source)?.rtl;
  const wordCount=ws.text.trim()?ws.text.trim().split(/\s+/).length:0;
  const setWorkspace=(key:Mode,update:Partial<Workspace>|((old:Workspace)=>Workspace))=>setSpaces(old=>({...old,[key]:typeof update==='function'?update(old[key]):{...old[key],...update}}));
  const update=(patch:Partial<Workspace>|((old:Workspace)=>Workspace))=>setWorkspace(mode,patch);
  const changeOption=(key:keyof TranslationOptions,value:string)=>setOptions(old=>({...old,[key]:value}));

  useEffect(()=>{try{localStorage.setItem(PREFS_KEY,JSON.stringify(options));}catch{/* Preferences are optional. */}},[options]);
  async function checkConnection(){setChecking(true);setConnectionError('');try{const state=await apiJson<Health>('/api/health');if(!mounted.current)return;setHealth(state);const models=await apiJson<{models:ModelStatus[]}>('/api/models');if(mounted.current)setAccess(models.models);}catch(error){if(mounted.current)setConnectionError(error instanceof Error?error.message:'The local server is unavailable.');}finally{if(mounted.current)setChecking(false);}}
  useEffect(()=>{mounted.current=true;void checkConnection();const close=()=>{live.current?.forceClose();queue.current?.cancel();request.current?.abort();};window.addEventListener('pagehide',close);return()=>{mounted.current=false;close();window.removeEventListener('pagehide',close);};},[]);
  useEffect(()=>{if(!ws.file){setPreview('');return;}const url=URL.createObjectURL(ws.file);setPreview(url);return()=>URL.revokeObjectURL(url);},[ws.file]);
  useEffect(()=>{if(!downloadOpen)return;const close=(event:PointerEvent)=>{if(!downloadRef.current?.contains(event.target as Node))setDownloadOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[downloadOpen]);
  const incomplete=ws.status==='incomplete'||ordered.some(s=>s.status==='incomplete');
  function requireReady(){if(!options.target){update({error:'Choose a target language first.'});return false;}if(!health?.configured){update({error:'OpenAI is not configured. Open Settings to check the local connection.'});return false;}if(access.find(m=>m.id===options.model)?.access==='unavailable'){update({error:'This model is not listed for your project. Choose another model explicitly.'});return false;}return true;}
  function eventUpdate(key:Mode,event:TranslationEvent,epoch:number){
    if(jobEpoch.current!==epoch)return;
    setWorkspace(key,old=>{
      if(event.type==='start')return {...old,total:event.total,warnings:event.warnings,...(event.source?{text:event.source}:{}),segments:Array.from({length:event.total},(_,i)=>({id:String(i),text:'',status:'pending' as const}))};
      if(event.type==='chunk')return {...old,segments:old.segments.map((s,i)=>i===event.index?{...s,status:'streaming',label:event.label}:s)};
      if(event.type==='delta')return {...old,segments:old.segments.map((s,i)=>i===event.index?{...s,text:s.text+event.text}:s)};
      if(event.type==='chunk_done')return {...old,completed:old.completed+1,segments:old.segments.map((s,i)=>i===event.index?{...s,status:'complete'}:s)};
      if(event.type==='done')return {...old,status:'complete'};
      if(event.type==='error')return {...old,status:'incomplete',error:event.message,segments:old.segments.map(s=>s.status==='complete'?s:{...s,status:'incomplete'})};
      return old;
    });
  }
  async function runTranslation(){
    if(locked||!requireReady())return;
    const key=mode;const epoch=++jobEpoch.current;const controller=new AbortController();request.current=controller;setBusy(true);setCopied(false);
    setWorkspace(key,{segments:[],warnings:[],error:'',status:'processing',total:0,completed:0,resultOptions:{...options}});
    try{
      let text=ws.text;
      if(key==='voice'&&ws.file){
        const body=new FormData();body.append('file',ws.file);body.append('source',options.source);
        const transcript=await apiJson<{text:string}>('/api/transcribe',{method:'POST',body,signal:controller.signal});text=transcript.text;if(jobEpoch.current===epoch)setWorkspace(key,{text});
      }
      await translate(key==='text'||key==='voice'?{text,mode:key}:{file:ws.file!,mode:key},options,controller.signal,event=>eventUpdate(key,event,epoch));
    }catch(error){if(jobEpoch.current===epoch)setWorkspace(key,old=>({...old,status:'incomplete',error:error instanceof DOMException&&error.name==='AbortError'?'Cancelled. Unfinished sections remain incomplete.':error instanceof Error?error.message:'The translation could not finish.',segments:old.segments.map(s=>s.status==='complete'?s:{...s,status:'incomplete'})}));}
    finally{if(jobEpoch.current===epoch){setBusy(false);request.current=null;}}
  }
  function cancel(){
    jobEpoch.current++;request.current?.abort();request.current=null;setBusy(false);queue.current?.cancel();live.current?.forceClose();live.current=null;queue.current=null;sessionEpoch.current++;
    setCapturing(false);setConnecting(false);setFinishing(false);setQueued(0);setLevel(0);
    update(old=>({...old,status:'incomplete',error:'Cancelled. Your received text is preserved.',segments:old.segments.map(s=>s.status==='complete'?s:{...s,status:'incomplete'})}));
  }
  function clear(){cancel();jobEpoch.current++;setBusy(false);update(empty());setCopied(false);setDownloadOpen(false);if(fileInput.current)fileInput.current.value='';if(audioInput.current)audioInput.current.value='';}
  function selectFile(file:File,audio=false){
    const name=file.name.toLowerCase();const allowed=audio?/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/:mode==='images'?/\.(png|jpe?g|webp)$/:/\.(pdf|docx|txt|md|markdown)$/;
    if(!allowed.test(name)){update({error:audio?'Choose MP3, MP4, MPEG, MPGA, M4A, WAV, or WebM.':mode==='images'?'Choose PNG, JPEG, or WebP.':'Choose PDF, DOCX, TXT, or Markdown.'});return;}
    if(file.size>(audio?25:20)*1024*1024||file.size===0){update({error:`Choose a nonempty file no larger than ${audio?25:20} MB.`});return;}
    update({...empty(),file});
  }
  function upload(e:ChangeEvent<HTMLInputElement>,audio=false){if(e.target.files?.[0])selectFile(e.target.files[0],audio);e.target.value='';}
  function drop(e:DragEvent){e.preventDefault();setDragging(false);if(locked)return;if(e.dataTransfer.files.length!==1){update({error:'Upload one file at a time.'});return;}selectFile(e.dataTransfer.files[0],mode==='voice');}
  useEffect(()=>{if(mode!=='images'||locked)return;const paste=(event:ClipboardEvent)=>{const items=Array.from(event.clipboardData?.items||[]);const item=items.find(i=>i.type.startsWith('image/'));const file=item?.getAsFile();if(file){event.preventDefault();selectFile(file);}};document.addEventListener('paste',paste);return()=>document.removeEventListener('paste',paste);},[mode,locked]);

  async function stopLive(){
    const session=sessionEpoch.current;const capture=live.current;const currentQueue=queue.current;if(!capture)return;
    setCapturing(false);setConnecting(false);setFinishing(true);
    const finalized=await capture.stop();
    if(!finalized)setWorkspace('voice',{error:'The last phrase did not finalize before disconnection. Draft transcript text has been preserved.'});
    await currentQueue?.drain();
    if(sessionEpoch.current===session){live.current=null;queue.current=null;setFinishing(false);setQueued(0);setWorkspace('voice',old=>({...old,status:!finalized||old.error||old.segments.some(s=>s.status==='incomplete')?'incomplete':old.segments.length?'complete':'idle'}));}
  }
  async function startLive(){
    if(locked||!requireReady())return;
    const session=++sessionEpoch.current;setWorkspace('voice',{...empty(),status:'processing',resultOptions:{...options}});setConnecting(true);setCopied(false);
    const updateSegment=(id:string,patch:Partial<Segment>|((s:Segment)=>Segment))=>setWorkspace('voice',old=>({...old,segments:old.segments.map(s=>s.id===id?typeof patch==='function'?patch(s):{...s,...patch}:s)}));
    const jobs=new PhraseQueue(async(id,text,signal)=>{
      if(sessionEpoch.current!==session)return;updateSegment(id,{status:'streaming'});
      try{await translate({text,mode:'voice'},options,signal,event=>{
        if(sessionEpoch.current!==session)return;
        if(event.type==='delta')updateSegment(id,s=>({...s,text:s.text+event.text}));
        if(event.type==='done')updateSegment(id,{status:'complete'});
        if(event.type==='error')throw new Error(event.message);
      });}catch(error){updateSegment(id,{status:'incomplete'});if(sessionEpoch.current===session){setWorkspace('voice',{error:error instanceof Error?error.message:'A phrase could not be translated.',status:'incomplete'});void stopLive();}throw error;}
    },count=>{if(sessionEpoch.current===session){setQueued(count);if(count>10){setWorkspace('voice',{error:'Translation is falling behind. Microphone capture stopped; received phrases are finishing.'});void stopLive();}}},ids=>{if(sessionEpoch.current===session)setWorkspace('voice',old=>({...old,segments:old.segments.map(s=>ids.includes(s.id)?{...s,status:'incomplete'}:s)}));});
    queue.current=jobs;
    const ledger=new TranscriptLedger(turns=>{if(sessionEpoch.current===session)setWorkspace('voice',{turns});},(id,text)=>{
      if(sessionEpoch.current!==session)return;
      setWorkspace('voice',old=>({...old,segments:[...old.segments,{id,text:'',status:'pending'}]}));jobs.push(id,text);
    });
    const capture=new LiveCapture({onEvent:event=>{if(sessionEpoch.current===session)ledger.handle(event);},onLevel:value=>{if(sessionEpoch.current===session)setLevel(value);},onError:message=>{if(sessionEpoch.current===session){setWorkspace('voice',{error:message,status:'incomplete'});void stopLive();}}});live.current=capture;
    try{await capture.start(options.source);if(sessionEpoch.current===session&&live.current===capture){setCapturing(true);setConnecting(false);}}
    catch(error){if(sessionEpoch.current===session){const message=error instanceof DOMException&&error.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser to use Live Voice.':error instanceof DOMException&&error.name==='NotFoundError'?'No microphone was found. Connect one or upload a recording.':error instanceof Error?error.message:'The microphone could not start.';setWorkspace('voice',{error:message,status:'incomplete'});setConnecting(false);setCapturing(false);live.current=null;}}
  }
  async function copy(){try{await navigator.clipboard.writeText(output);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{update({error:'Clipboard access was denied. Select the translation and copy it manually.'});}}
  async function exportResult(format:'txt'|'md'|'docx'){setDownloadOpen(false);setExporting(true);try{const text=incomplete?`[INCOMPLETE TRANSLATION — some sections did not finish]\n\n${ordered.map(s=>s.status==='complete'?s.text:`${s.text}\n\n[Incomplete ${s.label||'section'}]`).join('\n\n')}`:output;const {downloadTranslation}=await import('./export.ts');await downloadTranslation(text,format,rtl);}catch{update({error:'The download could not be generated. You can still copy your translation.'});}finally{setExporting(false);}}
  const statusLabel=connecting?'Connecting microphone':capturing?(queued>2?'Translation delayed':'Listening live'):finishing?'Finishing phrases':busy?(ws.total>1?`Translating ${Math.min(ws.completed+1,ws.total)} of ${ws.total}`:mode==='voice'&&!ws.text?'Transcribing recording':'Translating'):incomplete?'Incomplete':ws.status==='complete'?'Translation complete':'Ready when you are';
  const canTranslate=!!options.target&&!!health?.configured&&!locked&&(mode==='text'?!!ws.text.trim():!!ws.file);

  return <div className="app-shell">
    {health?.mock&&<div className="test-banner">Test provider · translations are fixtures. No paid API calls are made.</div>}
    <header className="app-header"><a href="/" className="brand" aria-label="Translator home"><Translate size={22} weight="bold"/><span>Translator</span><span className="local-label">LOCAL</span></a>
      <nav className="mode-tabs" aria-label="Input mode">{TAB_INFO.map(tab=><button key={tab.id} aria-current={mode===tab.id?'page':undefined} className={mode===tab.id?'active':''} disabled={locked} onClick={()=>setMode(tab.id)}><tab.icon size={16}/><span>{tab.label}</span></button>)}</nav>
      <button className="settings-button" onClick={()=>setSettings(true)}><SlidersHorizontal size={16}/><span>Settings</span></button>
    </header>
    <main className={`main-content mode-${mode}`}>
      <div className="title-row"><div><h1>{HEADINGS[mode][0]}</h1><p className="subtitle">{HEADINGS[mode][1]}</p></div><span className={`connection-badge ${health?.configured?'configured':''}`}><span className="status-dot"/>{health?.mock?'Test provider':health?.configured?'OpenAI configured':health?'Setup needed':'Connecting'}</span></div>
      <div className="toolbar"><div className="languages"><LanguagePicker value={options.source} source onChange={v=>changeOption('source',v)} disabled={locked}/><button className="swap-button" title={options.source==='auto'?'Choose a source language to swap':'Swap languages'} aria-label="Swap languages" disabled={locked||!options.target||options.source==='auto'} onClick={()=>setOptions(old=>({...old,source:old.target,target:old.source}))}><ArrowsLeftRight size={19}/></button><LanguagePicker value={options.target} onChange={v=>changeOption('target',v)} disabled={locked}/></div><ModelPicker value={options.model} onChange={v=>changeOption('model',v as ModelId)} access={access} disabled={locked}/></div>
      {mode==='voice'&&<div className="voice-controls"><div className="microphone-state"><Microphone size={17}/><div><strong>{capturing?'Listening live':connecting?'Connecting':finishing?'Finishing':'Microphone'}</strong><span>Default input · live transcription</span></div><meter aria-label="Microphone level" min={0} max={1} value={level}/></div><div className="voice-actions"><button className="quiet-button" disabled={locked} onClick={()=>audioInput.current?.click()}><UploadSimple size={16}/>Upload recording</button><button className={capturing||connecting?'stop-button':'primary-button'} disabled={busy||finishing||!!ws.file||(!options.target&&!capturing&&!connecting)||!health?.configured} onClick={()=>capturing||connecting?void stopLive():void startLive()}>{connecting?<CircleNotch className="spin" size={16}/>:capturing?<Stop weight="fill" size={14}/>:<Microphone size={17}/>}<span>{capturing||connecting?'Stop':'Start listening'}</span></button></div></div>}
      {connectionError&&<div className="notice error" role="status"><WarningCircle size={17}/><span>{connectionError}</span><button onClick={()=>void checkConnection()}>Check again</button></div>}
      {ws.error&&<div className="notice error" role="alert"><WarningCircle size={17}/><span>{ws.error}</span><button className="icon-button" aria-label="Dismiss message" onClick={()=>update({error:''})}><X size={15}/></button></div>}
      {ws.warnings.map((warning,index)=><div className="notice" key={index}><span>{warning}</span></div>)}
      <div className={`translation-workspace ${dragging?'dragging':''}`} onDragOver={e=>{if(mode!=='text'){e.preventDefault();setDragging(true);}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={mode!=='text'?drop:undefined}>
        <section className="source-panel" aria-label="Original content"><div className="panel-heading"><span className="eyebrow">{mode==='voice'?'TRANSCRIPT':'ORIGINAL'}</span><div className="panel-tools">{(ws.text||ws.file||ws.turns.length>0)&&<button className="icon-button" aria-label="Clear this workspace" title="Clear" disabled={locked} onClick={clear}><Trash size={16}/></button>}<span className="panel-language">{options.source==='auto'?'Auto':LANGUAGES.find(l=>l.code===options.source)?.name}</span></div></div>
          {mode==='text'?<textarea className="source-text" value={ws.text} onChange={e=>update({text:e.target.value})} placeholder={"Type or paste the text\nyou’d like to translate."} aria-label="Text to translate" dir={sourceRtl?'rtl':'auto'} readOnly={locked} maxLength={200_000} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void runTranslation();}}}/>:mode==='voice'&&!ws.file?<div className="transcript-body" dir="auto">{ws.turns.length?ws.turns.map(turn=><p key={turn.id} className={!turn.final?'draft':''} dir="auto">{turn.text||'Finishing phrase…'}{!turn.final&&<small>Draft</small>}</p>):<div className="voice-empty"><Microphone size={27} weight="light"/><p>{capturing?'Your words will appear here.':'A conversation starts\nwith a few words.'}</p><span>{capturing?'Speak into your microphone.':options.target?'Press Start listening when you’re ready.':'Choose a target language to begin.'}</span></div>}</div>:<>
            {ws.file?<><div className="file-card"><FileText size={24}/><div><strong>{ws.file.name}</strong><span>{(ws.file.size/1024/1024).toFixed(2)} MB · {mode==='voice'?'Recording':mode==='images'?'Image':'Document'}</span></div><button className="icon-button" aria-label="Remove file" disabled={locked} onClick={clear}><X size={17}/></button></div>
              {mode==='images'&&preview?<img className="image-preview" src={preview} alt="Original uploaded image"/>:ws.text?<div className="document-preview" dir="auto"><Markdown text={ws.text}/></div>:mode==='documents'&&ws.file.name.toLowerCase().endsWith('.pdf')&&preview?<object className="pdf-preview" data={preview} type="application/pdf"><a href={preview} target="_blank" rel="noreferrer">Open original PDF</a></object>:<div className="selected-file-note"><p>{mode==='voice'?'The original transcript will appear here.':'The extracted source text will appear here.'}</p><span>Translate when you’re ready.</span></div>}
            </>:<button className="upload-area" disabled={locked} onClick={()=>fileInput.current?.click()}><span className="upload-icon">{mode==='images'?<ImageSquare size={30} weight="light"/>:<FileText size={30} weight="light"/>}</span><strong>{mode==='images'?'Drop an image here':'Drop a document here'}</strong><span>or <span className="underlined">choose a file</span></span><small>{mode==='images'?'PNG, JPEG, WebP · up to 20 MB\nYou can also paste an image.':'PDF, DOCX, TXT, Markdown · up to 20 MB\nScanned PDFs are welcome. Up to 50 pages.'}</small></button>}
          </>}
          <div className="source-foot"><span>{mode==='text'?`${wordCount.toLocaleString()} ${wordCount===1?'word':'words'}`:mode==='voice'?'Original speech':ws.file?'Original file':'One file at a time'}</span>{mode==='text'?<kbd>Ctrl ↵</kbd>:mode==='images'&&!ws.file?<span>Ctrl V to paste</span>:ws.file?<button className="text-button" disabled={locked} onClick={()=>mode==='voice'?audioInput.current?.click():fileInput.current?.click()}>Change file</button>:null}</div>
        </section>
        <section className="target-panel" aria-label="Translated content"><div className="panel-heading"><span className="eyebrow">TRANSLATION{target&&<span className="target-name"> · {target.name}</span>}</span><div className="panel-tools"><button className="icon-button" aria-label="Copy translation" title={copied?'Copied':'Copy'} disabled={!output} onClick={()=>void copy()}>{copied?<Check size={17}/>:<Copy size={17}/>}</button><div className="download-picker" ref={downloadRef}><button className="icon-button" aria-label="Download translation" title="Download" disabled={!output||exporting||locked} aria-expanded={downloadOpen} aria-haspopup="menu" onClick={()=>setDownloadOpen(!downloadOpen)}><DownloadSimple size={17}/></button>{downloadOpen&&<div className="popover download-menu" role="menu" onKeyDown={e=>{if(e.key==='Escape')setDownloadOpen(false);}}>{(['txt','md','docx'] as const).map(format=><button key={format} role="menuitem" onClick={()=>void exportResult(format)}><span>{format==='txt'?'Plain text':format==='md'?'Markdown':'Word document'}</span><small>.{format}</small></button>)}</div>}</div></div></div>
          <div className={`translation-body ${!output?'is-empty':''}`} dir={rtl?'rtl':'auto'}>{output?<>{ordered.map(segment=>segment.text||segment.status==='incomplete'?<div className={`translation-segment ${segment.status==='incomplete'?'unfinished':''}`} key={segment.id}>{ws.total>1&&mode!=='voice'&&<span className="section-label">{segment.label}</span>}<Markdown text={segment.text}/>{segment.status==='incomplete'&&<span className="incomplete-label">Incomplete section</span>}</div>:null)}{locked&&<span className="stream-cursor" aria-hidden="true"/>}</>:<div className="translation-empty"><p>{capturing?'Listening. Translating.':'Your translation\nwill appear here.'}</p><span>{busy||connecting||finishing?'A little patience. We’re working on it.':!options.target?'Choose a target language to begin.':'Meaning, carried across.'}</span></div>}</div>
          <div className="target-foot"><span>{incomplete?'Partial output preserved':ws.resultOptions?MODELS.find(m=>m.id===ws.resultOptions?.model)?.name:'Powered by OpenAI'}</span>{ws.status==='complete'&&<span className="completed-mark"><Check size={13}/>Complete</span>}</div>
        </section>
      </div>
      <div className="action-row"><div className={`session-status ${incomplete?'status-warning':locked?'status-working':''}`} role="status" aria-live="polite">{locked?<CircleNotch size={14} className="spin"/>:<span className="status-dot"/>}<span>{statusLabel}</span>{capturing&&queued>0&&<small>{queued} {queued===1?'phrase':'phrases'} in progress</small>}</div><div className="main-actions">{locked&&<button className="quiet-button" onClick={cancel}><X size={15}/>Cancel</button>}{mode==='voice'&&!ws.file?null:<button className="primary-button translate-button" disabled={!canTranslate} onClick={()=>void runTranslation()}>{busy?<CircleNotch size={17} className="spin"/>:<Translate size={18}/>}<span>{busy?'Translating':ws.status==='incomplete'?'Retry translation':mode==='voice'?'Translate recording':'Translate'}</span>{!busy&&<ArrowRight size={16}/>}</button>}</div></div>
      <footer className="app-footer"><span><ShieldCheck size={15}/>A local session. Only your preferences are saved.</span><span>Content is sent to OpenAI for processing.</span></footer>
      <input ref={fileInput} type="file" className="hidden-input" aria-label={mode==='images'?'Upload image':'Upload document'} accept={mode==='images'?'.png,.jpg,.jpeg,.webp':'.pdf,.docx,.txt,.md,.markdown'} onChange={upload}/><input ref={audioInput} type="file" className="hidden-input" aria-label="Upload audio recording" accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm" onChange={e=>upload(e,true)}/>
    </main>
    {settings&&<Modal title="Settings" onClose={()=>setSettings(false)}><div className="settings-section"><div className="settings-icon"><GlobeHemisphereWest size={22}/></div><div><h3>OpenAI connection</h3><p>{health?.mock?'This server uses a test provider. Results are fixtures.':health?.configured?'Your API key is configured on the local server.':'No API key is configured on the local server.'}</p><button className="quiet-button outlined" disabled={checking} onClick={()=>void checkConnection()}>{checking?<CircleNotch className="spin" size={15}/>:<Check size={15}/>}Check connection</button>{connectionError&&<p className="settings-error">{connectionError}</p>}</div></div><div className="settings-divider"/><div className="settings-section"><div className="settings-icon"><ShieldCheck size={22}/></div><div><h3>Just this session</h3><p>Text, documents, images, and recordings stay out of local history. Closing or refreshing the app clears them. Only language and model preferences are saved.</p><p>Your content is sent to OpenAI to translate. Provider processing follows your OpenAI project’s data settings.</p><button className="text-button" disabled={locked} onClick={()=>{setOptions({source:'auto',target:'',model:'gpt-6.1-sol'});}}>Reset preferences</button></div></div><div className="settings-divider"/><div className="settings-section"><div className="settings-icon"><Microphone size={22}/></div><div><h3>Speech models</h3><p>Live: gpt-live-transcribe<br/>Recordings: gpt-transcribe</p><p>Finalized phrases use the translation model you select. The app writes the translation; it does not speak replies.</p></div></div><a className="documentation-link" href="https://developers.openai.com/api/docs/models" target="_blank" rel="noopener noreferrer">OpenAI model documentation<ArrowUpRight size={15}/></a></Modal>}
  </div>;
}
