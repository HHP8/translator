import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDown, Check, MagnifyingGlass, X } from '@phosphor-icons/react';
import { LANGUAGES, MODELS, type ModelStatus } from '../shared/types.ts';

function useDismiss(open:boolean,onClose:()=>void){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))onClose();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[open,onClose]);
  return ref;
}
export function LanguagePicker({value,onChange,source=false,disabled=false}:{value:string;onChange:(value:string)=>void;source?:boolean;disabled?:boolean}){
  const [open,setOpen]=useState(false);const [query,setQuery]=useState('');const close=()=>setOpen(false);const ref=useDismiss(open,close);const trigger=useRef<HTMLButtonElement>(null);const search=useRef<HTMLInputElement>(null);
  const options=[...(source?[{code:'auto',name:'Detect language',native:'Automatic'}]:[]),...LANGUAGES].filter(l=>`${l.name} ${l.native} ${l.code}`.toLowerCase().includes(query.toLowerCase()));
  const label=value==='auto'?'Detect language':LANGUAGES.find(l=>l.code===value)?.name || 'Choose language';
  useEffect(()=>{if(open){setQuery('');search.current?.focus();}},[open]);
  function keyboard(e:React.KeyboardEvent){
    const nodes=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')||[]);const index=nodes.indexOf(document.activeElement as HTMLButtonElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();nodes[(index+(e.key==='ArrowDown'?1:-1)+nodes.length)%nodes.length]?.focus();}
    if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus();}
  }
  return <div className="picker language-picker" ref={ref} onKeyDown={keyboard}>
    <button ref={trigger} className={`language-trigger ${!value?'unselected':''}`} aria-label={`${source?'Source':'Target'} language: ${label}`} aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={()=>setOpen(!open)}>
      <span><span className="eyebrow">{source?'FROM':'TO'}</span><span>{label}</span></span><CaretDown size={14}/>
    </button>
    {open&&<div className="popover language-menu">
      <div className="search-field"><MagnifyingGlass size={17}/><input ref={search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a language" aria-label={`Search ${source?'source':'target'} languages`}/></div>
      <div className="language-options" role="listbox" aria-label={`${source?'Source':'Target'} languages`}>
        {options.map(l=><button key={l.code} role="option" aria-selected={value===l.code} onClick={()=>{onChange(l.code);setOpen(false);trigger.current?.focus();}}><span>{l.name}<small>{l.native}</small></span>{value===l.code&&<Check size={16}/>}</button>)}
        {!options.length&&<p className="menu-note">No languages found.</p>}
      </div>
    </div>}
  </div>;
}
export function ModelPicker({value,onChange,access,disabled}:{value:string;onChange:(value:string)=>void;access:ModelStatus[];disabled:boolean}){
  const [open,setOpen]=useState(false);const trigger=useRef<HTMLButtonElement>(null);const ref=useDismiss(open,()=>setOpen(false));const selected=MODELS.find(m=>m.id===value)!;
  return <div className="picker model-picker" ref={ref} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}}}>
    <button className="model-trigger" ref={trigger} aria-label={`Translation model: ${selected.name}`} aria-expanded={open} aria-haspopup="listbox" disabled={disabled} onClick={()=>setOpen(!open)}><span className="model-tag">{selected.label}</span><span>{selected.name}</span><CaretDown size={14}/></button>
    {open&&<div className="popover model-menu" role="listbox" aria-label="Translation models">
      <p className="menu-heading">TRANSLATION MODEL</p>
      {MODELS.map(model=>{const status=access.find(m=>m.id===model.id)?.access||'unknown';return <button key={model.id} role="option" aria-selected={value===model.id} disabled={status==='unavailable'} onClick={()=>{onChange(model.id);setOpen(false);trigger.current?.focus();}}><div><strong>{model.name}</strong><span className="model-tier">{model.label}</span><p>{model.description}</p><small>{status==='listed'?'Listed for your project':status==='unavailable'?'Not listed for your project':'Access not checked'}</small></div>{value===model.id&&<Check size={17}/>}</button>;})}
      <p className="menu-note">A listed model can still be subject to project limits.</p>
    </div>}
  </div>;
}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const dialog=useRef<HTMLDivElement>(null);const returnTo=useRef(document.activeElement as HTMLElement|null);
  useEffect(()=>{const previous=returnTo.current;const before=document.body.style.overflow;document.body.style.overflow='hidden';dialog.current?.querySelector<HTMLElement>('button')?.focus();return()=>{document.body.style.overflow=before;previous?.focus();};},[]);
  function keyboard(e:React.KeyboardEvent){
    if(e.key==='Escape')onClose();
    if(e.key==='Tab'){const nodes=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]')||[]);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  }
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={keyboard}><header><h2 id="settings-title">{title}</h2><button className="icon-button" aria-label="Close settings" onClick={onClose}><X size={20}/></button></header>{children}</div></div>;
}
