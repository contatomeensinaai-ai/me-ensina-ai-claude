import {accessSync,constants,statSync,realpathSync,openSync,closeSync} from 'node:fs';
import {mkdir,readdir,rmdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {launcherDataDirectory,codexCandidates,nodeFileName,browserCommand,isMainModule} from './platform.mjs';

function executable(path){try{accessSync(path,process.platform==='win32'?constants.F_OK:constants.X_OK);return statSync(path).isFile()?realpathSync(path):null;}catch{return null;}}
export async function discoverCodex({env=process.env,home=homedir(),platform=process.platform,applications=platform==='darwin'?['/Applications',join(home,'Applications')]:[]}={}){
 for(const candidate of codexCandidates({env,home,platform})){const found=executable(candidate);if(found)return found;}
 if(env.MEAI_CODEX_BIN)return null;
 for(const folder of applications){
  let names;try{names=await readdir(folder);}catch{continue;}
  for(const name of names.filter(name=>/^codex(?:[ ._-].*)?\.app$/i.test(name)).sort()){
   const resources=join(folder,name,'Contents','Resources');
   for(const nested of ['', 'bin', 'app.asar.unpacked', 'app.asar.unpacked/bin'])for(const binary of ['codex','codex-aarch64-apple-darwin','codex-arm64-apple-darwin','codex-x86_64-apple-darwin']){
    const found=executable(join(resources,nested,binary));if(found)return found;
   }
  }
 }
 return null;
}
export async function editorHealth({port=5201,fetchImpl=fetch}={}){try{const response=await fetchImpl(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1500)});const data=await response.json();return response.ok&&data.app==='me-ensina-ai-editor'?data:null;}catch{return null;}}
async function portOccupied(port){return new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(true);});});}
export async function prepareEditor({root,node,spawnProcess=spawn,env=process.env}){
 const index=join(root,'editor','dist','index.html');
 try{if(statSync(index).isFile())return;}catch{}
 const setup=join(root,'setup-editor.mjs');
 try{if(!statSync(setup).isFile())throw new Error();}catch{throw new Error('Release sem editor compilado ou setup-editor.mjs.');}
 const lock=join(root,'.setup-in-progress');
 try{await mkdir(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('Outra preparação do editor está em andamento. Aguarde terminar antes de tentar novamente.');throw error;}
 try{
 console.log('Preparando o editor pela primeira vez. Dependências serão obtidas das fontes fixadas pela release.');
 await new Promise((resolve,reject)=>{
  const child=spawnProcess(node,[setup],{cwd:root,env,stdio:'inherit',shell:false});
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(`A preparação do editor falhou (${signal||code}).`)));
 });
 try{if(statSync(index).isFile())return;}catch{}
 throw new Error('A preparação terminou sem produzir editor/dist/index.html.');
 }finally{await rmdir(lock);}
}
export async function launchEditor({packageDirectory,env=process.env,home=homedir(),port=5201,spawnProcess=spawn,prepare=prepareEditor,probe=editorHealth,occupied=portOccupied,discover=discoverCodex,wait=ms=>new Promise(r=>setTimeout(r,ms)),openBrowser=true}={}){
 const url=`http://127.0.0.1:${port}/`,existing=await probe({port});
 if(existing)return{url,reused:true,codexAvailable:Boolean(existing.codexAvailable)};
 if(await occupied(port))throw new Error(`A porta ${port} está ocupada. Nenhum processo foi encerrado.`);
 if(!isAbsolute(packageDirectory||''))throw new Error('A pasta da release precisa ser absoluta.');
 const root=realpathSync(packageDirectory),node=join(root,'bin',nodeFileName(process.platform)),server=join(root,'runtime','server.mjs');
 if(!executable(node)||!statSync(server).isFile())throw new Error('Release incompleta.');
 await prepare({root,node,spawnProcess,env});
 const data=launcherDataDirectory(env,home);
 if(!isAbsolute(data))throw new Error('MEAI_DATA_DIR precisa ser absoluto.');
 await mkdir(join(data,'logs'),{recursive:true,mode:0o700});
 const codex=await discover({env,home});
 const childEnv={...env,MEAI_DATA_DIR:data};if(codex)childEnv.MEAI_CODEX_BIN=codex;else delete childEnv.MEAI_CODEX_BIN;
 const output=openSync(join(data,'logs','launcher-runtime.log'),'a',0o600);
 try{const child=spawnProcess(node,[server,'--port',String(port)],{cwd:root,env:childEnv,detached:true,stdio:['ignore',output,output],shell:false,windowsHide:true});child.on?.('error',()=>{});child.unref?.();}finally{closeSync(output);}
 for(let count=0;count<40;count++){
  await wait(250);const health=await probe({port});
  if(health){if(openBrowser){const command=browserCommand(url,env);const browser=spawnProcess(command.command,command.args,{stdio:'ignore',detached:true,shell:false});browser.on?.('error',()=>{});browser.unref?.();}return{url,reused:false,codexAvailable:Boolean(health.codexAvailable)};}
 }
 throw new Error('O editor não respondeu. A edição existente não foi alterada; consulte o log local do launcher.');
}
if(isMainModule(import.meta.url,process.argv[1])){
 const args=process.argv.slice(2);const valid=args[0]==='--package-dir'&&args[1]&&((args.length===2)||(args.length===3&&args[2]==='--no-open'));
 if(!valid){console.error('Use --package-dir CAMINHO [--no-open]');process.exitCode=1;}
 else launchEditor({packageDirectory:args[1],openBrowser:!args.includes('--no-open')}).then(result=>{console.log(`Editor disponível: ${result.url}`);console.log(result.codexAvailable?'Codex CLI localizado; funções de IA ainda dependem da sua conta.':'Editor funciona sem Codex CLI. Funções de IA ficam indisponíveis até localizar uma CLI compatível.');}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
