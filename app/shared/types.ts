export const MODELS = [
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', label: 'Economy', description: 'An efficient choice for everyday translation.', reasoning: 'none' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', label: 'Balanced', description: 'A balance of capability and cost.', reasoning: 'low' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', label: 'Advanced', description: 'For demanding documents and nuanced language.', reasoning: 'low' },
] as const;
export type ModelId = typeof MODELS[number]['id'];
export type Mode = 'text' | 'voice' | 'documents' | 'images';
export interface Language { code: string; name: string; native: string; rtl?: boolean }
export const LANGUAGES: Language[] = [
  ['en','English','English'],['es','Spanish','Español'],['fr','French','Français'],['de','German','Deutsch'],
  ['fa','Persian','فارسی','rtl'],['ar','Arabic','العربية','rtl'],['zh','Chinese','中文'],['ja','Japanese','日本語'],
  ['ko','Korean','한국어'],['pt','Portuguese','Português'],['it','Italian','Italiano'],['ru','Russian','Русский'],
  ['tr','Turkish','Türkçe'],['hi','Hindi','हिन्दी'],['ur','Urdu','اردو','rtl'],['he','Hebrew','עברית','rtl'],
  ['nl','Dutch','Nederlands'],['sv','Swedish','Svenska'],['da','Danish','Dansk'],['no','Norwegian','Norsk'],
  ['fi','Finnish','Suomi'],['pl','Polish','Polski'],['uk','Ukrainian','Українська'],['cs','Czech','Čeština'],
  ['el','Greek','Ελληνικά'],['ro','Romanian','Română'],['hu','Hungarian','Magyar'],['bg','Bulgarian','Български'],
  ['id','Indonesian','Bahasa Indonesia'],['ms','Malay','Bahasa Melayu'],['vi','Vietnamese','Tiếng Việt'],
  ['th','Thai','ไทย'],['bn','Bengali','বাংলা'],['ta','Tamil','தமிழ்'],['te','Telugu','తెలుగు'],
  ['sw','Swahili','Kiswahili'],['af','Afrikaans','Afrikaans'],['fil','Filipino','Filipino'],
].map(([code,name,native,rtl])=>({code,name,native,rtl:rtl==='rtl'}));
export interface TranslationOptions { source: string; target: string; model: ModelId }
export interface InputPart { type: 'input_text' | 'input_image' | 'input_file'; text?: string; image_url?: string; filename?: string; file_data?: string; detail?: 'high' }
export interface TranslationChunk { parts: InputPart[]; label: string; source?: string }
export interface Segment { id: string; text: string; status: 'pending' | 'streaming' | 'complete' | 'incomplete'; label?: string }
export type TranslationEvent =
  | { type: 'start'; total: number; source?: string; warnings: string[] }
  | { type: 'chunk'; index: number; label: string }
  | { type: 'delta'; index: number; text: string }
  | { type: 'chunk_done'; index: number }
  | { type: 'done'; total: number }
  | { type: 'error'; code: string; message: string; index?: number };
export interface Health { configured: boolean; mock: boolean; name: string }
export interface ModelStatus { id: ModelId; access: 'listed' | 'unavailable' | 'unknown' }
