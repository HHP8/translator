import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.ts';
import { createProvider, createMockProvider } from './provider.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
dotenv.config({ path:path.join(root,'.env.local'), quiet:true });
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
const mock = process.env.TRANSLATOR_MOCK === '1';
const provider = mock ? createMockProvider() : createProvider(process.env.OPENAI_API_KEY);
const server = createApp(provider,port,path.join(root,'dist/client')).listen(port,'127.0.0.1',()=>{
  console.log(`Translator${mock?' · TEST PROVIDER':''} is running at http://127.0.0.1:${port}`);
  console.log(`OpenAI configuration: ${provider.configured?'present':'missing'}. Translation content is not logged.`);
});
server.on('error', (error:NodeJS.ErrnoException) => { console.error(error.code==='EADDRINUSE' ? `Port ${port} is occupied. Close that server or set PORT to another local port.` : 'The local server could not start.'); process.exitCode=1; });
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{server.close();server.closeAllConnections();});
