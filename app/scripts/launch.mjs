import { spawn,spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
dotenv.config({path:path.join(root,'.env.local'),quiet:true});
const port=Number(process.env.PORT||5173);
if(!Number.isInteger(port)||port<1024||port>65535){console.error('PORT must be between 1024 and 65535.');process.exit(1);}
const [major, minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<6)){console.error('Node.js 22.6 or later is required.');process.exit(1);}
const url=`http://127.0.0.1:${port}`;
const probe=async()=>{try{const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(700)});return response.ok?await response.json():null;}catch{return null;}};
const listening=()=>new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});socket.setTimeout(700);socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});});
function openBrowser(){
  if(process.env.TRANSLATOR_NO_OPEN!=='1'){
    const child=process.platform==='win32'?spawn('cmd.exe',['/d','/c','start','',url],{windowsHide:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore'});
    child.on('error',()=>console.log(`Open ${url} in your browser.`));child.unref();
  }
  console.log(`Translator is ready at ${url}`);
}
try{
  const existing=await probe();
  if(existing?.name==='Translator'&&!existing.mock){openBrowser();}
  else{
    if(await listening())throw new Error(`Port ${port} is occupied by another service or a test provider. Close it or choose a different PORT.`);
    console.log('Building Translator…');
    const build=spawnSync(process.platform==='win32'?'cmd.exe':'npm',process.platform==='win32'?['/d','/c','npm.cmd run build']:['run','build'],{cwd:root,windowsHide:true,stdio:'inherit'});
    if(build.status!==0)throw new Error('The build failed. The local server was not started.');
    const logPath=path.join(root,'translator-server.log');const output=fs.openSync(logPath,'a');
    const child=spawn(process.execPath,['--import','tsx',path.join(root,'server/index.ts')],{cwd:root,env:{...process.env,TRANSLATOR_MOCK:'0'},detached:true,windowsHide:true,stdio:['ignore',output,output]});
    fs.closeSync(output);child.unref();child.on('error',()=>{});
    let ready=false;
    for(let i=0;i<60;i++){const state=await probe();if(state?.name==='Translator'&&!state.mock){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}
    if(!ready)throw new Error('The local server did not become ready. See app/translator-server.log for safe startup diagnostics.');
    fs.writeFileSync(path.join(root,'translator-server.pid'),String(child.pid));openBrowser();
  }
}catch(error){console.error(error instanceof Error?error.message:'Translator could not launch.');process.exitCode=1;}
