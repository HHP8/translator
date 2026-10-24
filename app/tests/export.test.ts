import { describe,it,expect } from 'vitest';
import { Document,Packer } from 'docx';
import yauzl from 'yauzl';
import { documentBlocks,plainText } from '../src/export.ts';
async function xml(buffer:Buffer):Promise<string>{return new Promise((resolve,reject)=>{yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{if(error||!zip){reject(error);return;}zip.on('error',reject);zip.on('entry',entry=>{if(entry.fileName==='word/document.xml')zip.openReadStream(entry,(err,stream)=>{if(err||!stream){reject(err);return;}const chunks:Buffer[]=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{zip.close();resolve(Buffer.concat(chunks).toString('utf8'));});stream.on('error',reject);});else zip.readEntry();});zip.readEntry();});});}
describe('complete readable exports',()=>{
  const markdown='# عنوان\n\nسلام **دنیا**. Order A42, €12.50.\n\n3. First\n4. Second\n\n| Name | Value |\n| --- | --- |\n| Ada | 42 |\n\n```js\nconst id = "A42";\n```\n';
  it('creates a valid RTL DOCX with headings, original numbering, tables and code',async()=>{const document=new Document({sections:[{children:documentBlocks(markdown,true)}]});const result=await xml(await Packer.toBuffer(document));expect(result).toContain('عنوان');expect(result).toContain('Heading1');expect(result).toContain('<w:tbl>');expect(result).toContain('<w:bidi');expect(result).toContain('3. ');expect(result).toContain('4. ');expect(result).toContain('A42');expect(result).toContain('Consolas');expect(result).toContain('42');});
  it('keeps full Unicode, table cells, numbers, code and long output in TXT',()=>{const result=plainText(markdown);expect(result).toContain('عنوان');expect(result).toContain('3. First');expect(result).toContain('4. Second');expect(result).toContain('Ada\t42');expect(result).toContain('const id = "A42";');const long='Hello world. '.repeat(5000);expect(plainText(long)).toBe(long);});
});
