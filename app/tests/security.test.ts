import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { createApp } from '../server/app.ts';
import { createMockProvider } from '../server/provider.ts';
import { prepareInput } from '../server/inputs.ts';

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
function file(buffer: Buffer, name: string): Express.Multer.File {
  return { buffer, originalname: name, size: buffer.length, mimetype: 'application/octet-stream', fieldname: 'file', encoding: '7bit', stream: null!, destination: '', filename: '', path: '' };
}
async function api() {
  const provider = createMockProvider();
  const calls = [vi.spyOn(provider, 'translate'), vi.spyOn(provider, 'transcribe'), vi.spyOn(provider, 'clientSecret').mockResolvedValue({ value: 'ephemeral-test-only', expires_at: 1 })];
  const server = createServer().listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  server.on('request', createApp(provider, port));
  return { url: 'http://127.0.0.1:' + port, calls };
}
function request(route: string): RequestInit {
  if (route.toLowerCase().includes('realtime')) return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'auto' }) };
  const body = new FormData();
  if (route.toLowerCase().includes('transcribe')) {
    const wav = Buffer.alloc(44); wav.write('RIFF'); wav.write('WAVE', 8);
    body.append('file', new Blob([wav]), 'sample.wav');
  } else {
    body.append('text', 'Synthetic hello'); body.append('target', 'es'); body.append('model', 'gpt-6-luna');
  }
  body.append('source', 'auto');
  return { method: 'POST', body };
}

describe('API origin security', () => {
  for (const route of ['/API/translate', '/aPi/transcribe/', '/ApI/realtime/client-secret']) {
    for (const originCase of ['foreign', 'missing', 'cross-site'] as const) {
      it('rejects ' + originCase + ' requests to ' + route + ' before provider work', async () => {
        const { url, calls } = await api();
        const init = request(route);
        const response = await fetch(url + route, { ...init, headers: { ...init.headers, Origin: originCase === 'foreign' ? 'https://attacker.invalid' : originCase === 'missing' ? '' : url, ...(originCase === 'cross-site' ? { 'Sec-Fetch-Site': 'cross-site' } : {}) } });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: expect.any(String) });
        for (const call of calls) expect(call).not.toHaveBeenCalled();
      });
    }
    it('preserves authorized requests to ' + route, async () => {
      const { url } = await api();
      const init = request(route);
      const response = await fetch(url + route, { ...init, headers: { ...init.headers, Origin: url } });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(route.toLowerCase().includes('translate') ? '"type":"done"' : route.toLowerCase().includes('transcribe') ? 'recorded speech test' : 'ephemeral-test-only');
    });
  }
  it('rejects compressed JSON with a safe unsupported-encoding response before provider work', async () => {
    const { url, calls } = await api();
    const response = await fetch(url + '/api/realtime/client-secret', {
      method:'POST', headers:{ Origin:url, 'Content-Type':'application/json', 'Content-Encoding':'gzip' },
      body:gzipSync(JSON.stringify({source:'auto'})),
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({code:'unsupported_encoding'});
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });
  it('keeps mixed-case API health private to its origin and uncached', async () => {
    const { url } = await api();
    const blocked = await fetch(url + '/API/health', { headers: { Origin: 'https://attacker.invalid' } });
    expect(blocked.status).toBe(403);
    const allowed = await fetch(url + '/API/health');
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('cache-control')).toBe('no-store');
    expect(await allowed.json()).toMatchObject({ name: 'Translator', mock: true });
  });
});

async function wordArchive() {
  return JSZip.loadAsync(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Ordinary document content')] }] })));
}
function understateEntry(buffer: Buffer, name: string) {
  const result = Buffer.from(buffer);
  for (let offset = 0; offset < result.length - 46; offset++) {
    if (result.readUInt32LE(offset) !== 0x02014b50) continue;
    const length = result.readUInt16LE(offset + 28);
    if (result.toString('utf8', offset + 46, offset + 46 + length) === name) {
      result.writeUInt32LE(1, offset + 24);
      return result;
    }
  }
  throw new Error('Synthetic ZIP entry missing');
}

describe('document security bounds', () => {
  it('rejects understated deflated XML before invoking Word conversion', async () => {
    const zip = await wordArchive();
    const forged = understateEntry(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'word/document.xml');
    const convert = vi.spyOn(mammoth, 'convertToHtml');
    await expect(prepareInput(undefined, file(forged, 'forged.docx'), 'documents')).rejects.toMatchObject({ code: 'invalid_docx' });
    expect(convert).not.toHaveBeenCalled();
  });
  it('validates unused archive entries before invoking Word conversion', async () => {
    const zip = await wordArchive();
    zip.file('word/media/unused.bin', Buffer.alloc(512 * 1024, 65));
    const forged = understateEntry(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'word/media/unused.bin');
    const convert = vi.spyOn(mammoth, 'convertToHtml');
    await expect(prepareInput(undefined, file(forged, 'forged.docx'), 'documents')).rejects.toMatchObject({ code: 'invalid_docx' });
    expect(convert).not.toHaveBeenCalled();
  });
  it('rejects aliased archive paths before invoking Word conversion', async () => {
    const zip = await wordArchive(); zip.file('word/./extra.xml', '<unused/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const convert = vi.spyOn(mammoth, 'convertToHtml');
    await expect(prepareInput(undefined, file(buffer, 'alias.docx'), 'documents')).rejects.toMatchObject({ code: 'invalid_docx' });
    expect(convert).not.toHaveBeenCalled();
  });
  it('rejects duplicate archive names before invoking Word conversion', async () => {
    const zip = await wordArchive(); zip.file('word/extra1.xml', '<first/>'); zip.file('word/extra2.xml', '<second/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const original = Buffer.from('word/extra2.xml'); const replacement = Buffer.from('word/extra1.xml');
    for (let offset = buffer.indexOf(original); offset !== -1; offset = buffer.indexOf(original, offset + original.length)) replacement.copy(buffer, offset);
    const convert = vi.spyOn(mammoth, 'convertToHtml');
    await expect(prepareInput(undefined, file(buffer, 'duplicate.docx'), 'documents')).rejects.toMatchObject({ code: 'invalid_docx' });
    expect(convert).not.toHaveBeenCalled();
  });
  it('preserves ordinary deflated Word documents after validation', async () => {
    const zip = await wordArchive();
    const prepared = await prepareInput(undefined, file(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), 'ordinary.docx'), 'documents');
    expect(prepared.source).toContain('Ordinary document content');
  });
  it('rejects aggregate prepared PDF expansion before retaining every page', async () => {
    const doc = await PDFDocument.create();
    const shared = doc.context.register(doc.context.stream(Buffer.alloc(1024 * 1024, 32)));
    for (let i = 0; i < 26; i++) doc.addPage().node.set(PDFName.of('Contents'), shared);
    const buffer = Buffer.from(await doc.save());
    expect(buffer.length).toBeLessThan(2 * 1024 * 1024);
    const outcome = await prepareInput(undefined, file(buffer, 'shared.pdf'), 'documents').then(() => 'accepted', error => error.code);
    expect(outcome).toBe('pdf_prepared_limit');
  });
  it('honors cancellation before parsing a selected document', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareInput(undefined, file(Buffer.from('%PDF-invalid'), 'cancelled.pdf'), 'documents', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('yields and honors cancellation during multi-page PDF preparation', async () => {
    const doc = await PDFDocument.create(); for (let i = 0; i < 8; i++) doc.addPage();
    const buffer = Buffer.from(await doc.save()); const controller = new AbortController();
    const pending = prepareInput(undefined, file(buffer, 'cancelled.pdf'), 'documents', controller.signal);
    const cancelled = nextTurn().then(() => controller.abort());
    expect(await pending.then(() => 'accepted', error => error.name)).toBe('AbortError');
    await cancelled;
  });
});
