import path from 'node:path';
import type { Readable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import mammoth from 'mammoth';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import yauzl from 'yauzl';
import { marked } from 'marked';
import { LANGUAGES, MODELS, type TranslationOptions, type TranslationChunk } from '../shared/types.ts';
import { AppError } from './errors.ts';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;
const MAX_DOCX_EXPANDED_BYTES = 80 * 1024 * 1024;
const MAX_PREPARED_PDF_BYTES = 32 * 1024 * 1024;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'];
export const AUDIO_EXTENSIONS = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm'];
export function parseOptions(body: Record<string, unknown>): TranslationOptions {
  const { source = 'auto', target, model } = body;
  if (typeof source !== 'string' || (source !== 'auto' && !LANGUAGES.some(l => l.code === source))) throw new AppError('invalid_language', 'Choose a supported source language.');
  if (typeof target !== 'string' || !LANGUAGES.some(l => l.code === target)) throw new AppError('invalid_language', 'Choose a target language before translating.');
  if (!MODELS.some(m => m.id === model)) throw new AppError('invalid_model', 'Choose a translation model from the model selector.');
  return { source, target, model: model as TranslationOptions['model'] };
}
export function splitMarkdown(text: string, limit = 8000): string[] {
  const chunks: string[] = []; let current = '';
  for (const token of marked.lexer(text)) {
    const raw = token.raw;
    if (raw.length > 24_000) throw new AppError('section_too_large', 'One paragraph, table, or code block is too large. Split it into smaller sections before translating.');
    if (current.length + raw.length > limit && current.trim()) { chunks.push(current); current = ''; }
    current += raw;
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}
function validateText(text: string): string {
  if (!text.trim()) throw new AppError('empty_input', 'Add some text to translate.');
  if (text.length > MAX_TEXT_CHARS) throw new AppError('input_too_large', 'Text is limited to 200,000 characters per translation.');
  if (text.includes('\0')) throw new AppError('binary_text', 'This file contains binary content, not readable text.');
  return text;
}
export interface PreparedInput { chunks: TranslationChunk[]; source?: string; warnings: string[] }
function fromText(text: string, warnings: string[] = []): PreparedInput {
  validateText(text);
  const parts = splitMarkdown(text);
  return { source: text, warnings, chunks: parts.map((source, i) => ({ source, parts: [{ type: 'input_text', text: source }], label: parts.length > 1 ? `Section ${i + 1}` : 'Translation' })) };
}
async function inspectDocx(buffer: Buffer, signal?: AbortSignal): Promise<{ buffer: Buffer; images: boolean }> {
  signal?.throwIfAborted();
  const checked = await new Promise<{ archive: JSZip; images: boolean }>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries:true, validateEntrySizes:true, strictFileNames:true }, (error, zip) => {
      if (error || !zip) { reject(new AppError('invalid_docx', 'This Word document is corrupt or unsupported.')); return; }
      const archive = new JSZip(); const names = new Set<string>();
      let declared = 0; let expanded = 0; let count = 0;
      let document = false; let contentTypes = false; let images = false; let settled = false;
      let active: Readable | null = null;
      const cleanup = () => { active?.destroy(); active = null; zip.close(); signal?.removeEventListener('abort', abort); };
      const fail = (reason = new AppError('invalid_docx', 'This Word document is corrupt, encrypted, ambiguous, or too large after decompression.')) => {
        if (settled) return; settled = true; cleanup(); reject(reason);
      };
      const abort = () => {
        if (settled) return; settled = true; cleanup(); reject(new DOMException('Document preparation cancelled.', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once:true });
      zip.on('error', () => fail());
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        if (signal?.aborted) { abort(); return; }
        const name = entry.fileName; const canonical = name.endsWith('/') ? name.slice(0,-1) : name;
        declared += entry.uncompressedSize; count++;
        if (!canonical || canonical.split('/').some(part => !part || part === '.' || part === '..') ||
            name.includes('\\') || name.includes('\0') || names.has(canonical) ||
            !Number.isSafeInteger(entry.uncompressedSize) || declared > MAX_DOCX_EXPANDED_BYTES || count > 10_000 ||
            (entry.generalPurposeBitFlag & 1) || ![0,8].includes(entry.compressionMethod) ||
            (name.endsWith('/') && entry.uncompressedSize !== 0)) { fail(); return; }
        names.add(canonical);
        document ||= name === 'word/document.xml'; contentTypes ||= name === '[Content_Types].xml';
        images ||= name.startsWith('word/media/');
        // Validate every entry, including unused parts. Metadata alone cannot bound inflation.
        zip.openReadStream(entry, (streamError, stream) => {
          if (settled) { stream?.destroy(); return; }
          if (streamError || !stream) { fail(); return; }
          active = stream; const chunks: Buffer[] = []; let entryBytes = 0;
          stream.on('error', () => fail());
          stream.on('data', (chunk: Buffer) => {
            if (settled) return;
            entryBytes += chunk.length; expanded += chunk.length;
            if (entryBytes > entry.uncompressedSize || expanded > MAX_DOCX_EXPANDED_BYTES) { fail(); return; }
            chunks.push(chunk);
          });
          stream.on('end', () => {
            active = null;
            if (settled) return;
            if (entryBytes !== entry.uncompressedSize) { fail(); return; }
            try {
              archive.file(name, Buffer.concat(chunks, entryBytes), { binary:true, createFolders:false, compression:'STORE' });
              zip.readEntry();
            } catch { fail(); }
          });
        });
      });
      zip.on('end', () => {
        if (settled) return;
        if (!document || !contentTypes) { fail(); return; }
        settled = true; cleanup(); resolve({ archive, images });
      });
      if (signal?.aborted) abort(); else zip.readEntry();
    });
  });
  signal?.throwIfAborted();
  // Mammoth consumes only validated names and bytes, avoiding ZIP parser differentials.
  const clean = await checked.archive.generateAsync({ type:'nodebuffer', compression:'STORE' });
  signal?.throwIfAborted();
  return { buffer:clean, images:checked.images };
}
export function imageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return null;
}
export function validateAudio(buffer: Buffer, name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(ext)) throw new AppError('unsupported_audio', 'Choose MP3, MP4, MPEG, MPGA, M4A, WAV, or WebM audio.');
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw new AppError('audio_too_large', 'Recordings must be nonempty and no larger than 25 MB.');
  const riff = buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WAVE';
  const mp4 = buffer.toString('ascii',4,8) === 'ftyp';
  const webm = buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  const mpeg = buffer.toString('ascii',0,3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) || buffer.subarray(0,3).equals(Buffer.from([0,0,1]));
  if (!(ext === '.wav' ? riff : ext === '.webm' ? webm : ['.mp4','.m4a'].includes(ext) ? mp4 : mpeg)) throw new AppError('invalid_audio', 'The recording does not match its file format.');
  return ext === '.wav' ? 'audio/wav' : ext === '.webm' ? 'audio/webm' : mp4 ? 'audio/mp4' : 'audio/mpeg';
}
export async function prepareInput(text?: string, file?: Express.Multer.File, mode?: string, signal?: AbortSignal): Promise<PreparedInput> {
  signal?.throwIfAborted();
  if (!file) return fromText(text || '');
  if (!file.buffer.length || file.size > MAX_DOCUMENT_BYTES) throw new AppError('file_too_large', 'Documents and images must be nonempty and no larger than 20 MB.');
  const ext = path.extname(file.originalname).toLowerCase();
  if (mode === 'images' && !IMAGE_EXTENSIONS.includes(ext)) throw new AppError('unsupported_file', 'Choose PNG, JPEG, or WebP for image translation.');
  if (mode === 'documents' && !DOCUMENT_EXTENSIONS.includes(ext)) throw new AppError('unsupported_file', 'Choose PDF, DOCX, TXT, or Markdown for document translation.');
  if (IMAGE_EXTENSIONS.includes(ext)) {
    const mime = imageMime(file.buffer);
    const expected = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    if (mime !== expected) throw new AppError('invalid_image', 'The image does not match its file format.');
    return { warnings: [], chunks: [{ label: 'Image', parts: [{ type:'input_image', image_url:`data:${mime};base64,${file.buffer.toString('base64')}`, detail:'high' }] }] };
  }
  if (ext === '.pdf') {
    if (!file.buffer.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new AppError('invalid_pdf', 'This is not a readable PDF.');
    let doc: PDFDocument;
    try { doc = await PDFDocument.load(file.buffer); } catch { throw new AppError('invalid_pdf', 'This PDF is encrypted, corrupt, or unsupported.'); }
    signal?.throwIfAborted();
    const pages = doc.getPageCount();
    if (!pages || pages > 50) throw new AppError('pdf_page_limit', 'PDFs must contain between 1 and 50 pages. Split longer documents first.');
    const chunks: TranslationChunk[] = []; let preparedBytes = 0;
    const prefix = 'data:application/pdf;base64,';
    for (let i = 0; i < pages; i++) {
      // Let socket-close/cancellation events run even for small PDFs.
      await nextTurn(); signal?.throwIfAborted();
      const part = await PDFDocument.create(); const [page] = await part.copyPages(doc, [i]);
      signal?.throwIfAborted(); part.addPage(page);
      const bytes = await part.save(); signal?.throwIfAborted();
      const encodedBytes = prefix.length + 4 * Math.ceil(bytes.length / 3);
      if (bytes.length > MAX_DOCUMENT_BYTES || preparedBytes + encodedBytes > MAX_PREPARED_PDF_BYTES)
        throw new AppError('pdf_prepared_limit', 'Prepared PDF pages exceed the processing budget (20 MB per page, 32 MB encoded total). Split this PDF into smaller documents.', 413);
      preparedBytes += encodedBytes;
      chunks.push({ label:'Page '+(i+1), parts:[{ type:'input_file', filename:'page-'+(i+1)+'.pdf', file_data:prefix+Buffer.from(bytes).toString('base64'), detail:'high' }] });
    }
    return { chunks, warnings:['PDF pages are translated individually. Original page layouts are not reconstructed; unreadable passages are marked.'] };
  }
  if (ext === '.docx') {
    const validated = await inspectDocx(file.buffer, signal);
    let html: Awaited<ReturnType<typeof mammoth.convertToHtml>>;
    try { html = await mammoth.convertToHtml({ buffer:validated.buffer }, { convertImage:mammoth.images.imgElement(async()=>({src:''})) }); } catch { throw new AppError('invalid_docx', 'This Word document could not be read.'); }
    signal?.throwIfAborted();
    const converter = new TurndownService({ headingStyle:'atx', codeBlockStyle:'fenced' }); converter.use(gfm); converter.remove('img');
    // Word tables often have no semantic header row. GFM's default converter
    // leaves those as raw HTML, so render them with an empty Markdown header.
    converter.addRule('wordTables',{filter:'table',replacement:(_content,node)=>{
      const nodes=Array.from(node.querySelectorAll('tr'));
      const rows=nodes.map(row=>Array.from(row.children).filter(cell=>['TD','TH'].includes(cell.tagName)).map(cell=>converter.turndown(cell.innerHTML).replace(/\n+/g,' ').replace(/\|/g,'\\|')));
      if(!rows.length)return '';
      const width=Math.max(...rows.map(row=>row.length));
      const hasHeader=Array.from(nodes[0].children).some(cell=>cell.tagName==='TH');
      const header=hasHeader?rows.shift()!:Array.from({length:width},()=> '');
      const line=(row:string[])=>'| '+Array.from({length:width},(_,i)=>row[i]||'').join(' | ')+' |';
      return '\n\n'+[line(header),line(Array.from({length:width},()=> '---')),...rows.map(line)].join('\n')+'\n\n';
    }});
    const source = converter.turndown(html.value);
    const warnings = html.messages.length ? ['Some Word formatting could not be extracted; review the readable translation.'] : [];
    if (validated.images) warnings.push('Embedded images are excluded. Upload them separately in Images to translate their text.');
    return fromText(source, warnings);
  }
  if (['.txt','.md','.markdown'].includes(ext)) {
    let source: string;
    try { source = new TextDecoder('utf-8', { fatal:true }).decode(file.buffer); } catch { throw new AppError('invalid_encoding', 'Save this text file as UTF-8 before uploading.'); }
    return fromText(source);
  }
  throw new AppError('unsupported_file', 'Supported files: PDF, DOCX, TXT, Markdown, PNG, JPEG, and WebP.');
}
