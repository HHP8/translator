import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ExternalHyperlink } from 'docx';
import { marked, type Token, type Tokens } from 'marked';

function runs(tokens:Token[]|undefined, fallback=''): (TextRun|ExternalHyperlink)[] {
  if(!tokens?.length)return [new TextRun(fallback)];
  return tokens.flatMap<TextRun|ExternalHyperlink>(token=>{
    if(token.type==='strong')return [new TextRun({text:(token as Tokens.Strong).text,bold:true})];
    if(token.type==='em')return [new TextRun({text:(token as Tokens.Em).text,italics:true})];
    if(token.type==='codespan')return [new TextRun({text:(token as Tokens.Codespan).text,font:'Consolas'})];
    if(token.type==='link'){
      const link=token as Tokens.Link;return /^https?:\/\//i.test(link.href)?[new ExternalHyperlink({link:link.href,children:[new TextRun({text:link.text,style:'Hyperlink'})]})]:[new TextRun(link.text)];
    }
    if(token.type==='br')return [new TextRun({break:1})];
    return [new TextRun('text' in token?String(token.text):token.raw)];
  });
}
export function documentBlocks(markdown:string,rtl=false): (Paragraph|Table)[] {
  const output:(Paragraph|Table)[]=[];
  for(const token of marked.lexer(markdown)){
    if(token.type==='space')continue;
    if(token.type==='heading'){const heading=token as Tokens.Heading;output.push(new Paragraph({heading:[HeadingLevel.HEADING_1,HeadingLevel.HEADING_2,HeadingLevel.HEADING_3,HeadingLevel.HEADING_4,HeadingLevel.HEADING_5,HeadingLevel.HEADING_6][heading.depth-1],children:runs(heading.tokens,heading.text),bidirectional:rtl}));}
    else if(token.type==='table'){
      const table=token as Tokens.Table;const rows=[table.header,...table.rows];
      output.push(new Table({rows:rows.map((row,index)=>new TableRow({tableHeader:index===0,children:row.map(cell=>new TableCell({children:[new Paragraph({children:runs(cell.tokens,cell.text),bidirectional:rtl})]}))}))}));
    }else if(token.type==='list'){
      const list=token as Tokens.List;
      for(const [index,item]of list.items.entries()){
        const inline=item.tokens.filter(t=>t.type!=='list').flatMap(t=>'tokens'in t&&Array.isArray(t.tokens)?t.tokens:[]);
        const children=runs(inline,item.text);
        if(list.ordered)children.unshift(new TextRun(`${Number(list.start)+index}. `));
        output.push(new Paragraph({children,bidirectional:rtl,...(list.ordered?{}:{bullet:{level:0}})}));
        for(const nested of item.tokens.filter(t=>t.type==='list'))output.push(...documentBlocks(nested.raw,rtl));
      }
    }else if(token.type==='blockquote')output.push(...documentBlocks((token as Tokens.Blockquote).text,rtl));
    else if(token.type==='code'){for(const line of (token as Tokens.Code).text.split('\n'))output.push(new Paragraph({children:[new TextRun({text:line,font:'Consolas'})]}));}
    else{const text='text'in token?String(token.text):token.raw;output.push(new Paragraph({children:runs('tokens'in token?token.tokens as Token[]:undefined,text),bidirectional:rtl}));}
  }
  return output.length?output:[new Paragraph('')];
}
export function plainText(markdown:string):string {
  const lines:string[]=[];
  for(const token of marked.lexer(markdown)){
    if(token.type==='space')continue;
    if(token.type==='table'){const table=token as Tokens.Table;lines.push([table.header,...table.rows].map(row=>row.map(cell=>cell.text).join('\t')).join('\n'));}
    else if(token.type==='list'){const list=token as Tokens.List;lines.push(list.items.map((item,i)=>`${list.ordered?Number(list.start)+i+'.':'•'} ${item.text}`).join('\n'));}
    else if(token.type==='blockquote')lines.push(plainText((token as Tokens.Blockquote).text));
    else lines.push('text'in token?String(token.text):token.raw.trim());
  }
  return lines.join('\n\n');
}
export async function downloadTranslation(markdown:string,format:'txt'|'md'|'docx',rtl=false){
  let blob:Blob;
  if(format==='docx'){
    const document=new Document({numbering:{config:[{reference:'ordered',levels:[{level:0,format:'decimal',text:'%1.',start:1}]}]},sections:[{children:documentBlocks(markdown,rtl)}]});
    blob=await Packer.toBlob(document);
  }else blob=new Blob([format==='txt'?plainText(markdown):markdown],{type:format==='txt'?'text/plain;charset=utf-8':'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`translation.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
