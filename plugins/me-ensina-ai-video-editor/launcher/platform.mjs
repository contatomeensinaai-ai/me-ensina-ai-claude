import {win32,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
export const pathApi=platform=>platform==='win32'?win32:posix;
export const nodeFileName=platform=>platform==='win32'?'node.exe':'node';
export function launcherDataDirectory(env,home,platform=process.platform){
 const path=pathApi(platform);
 const target=env.MEAI_DATA_DIR||(platform==='win32'?path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'Me Ensina AI'):path.join(home,'Library','Application Support','Me Ensina AI'));
 if(!path.isAbsolute(target)||(platform==='win32'&&!/^[a-z]:[\\/]/i.test(target)))throw Error('MEAI_DATA_DIR precisa ser um caminho absoluto local.');
 return path.resolve(target);
}
export function codexCandidates({env=process.env,home='',platform=process.platform}={}){
 const path=pathApi(platform),windows=platform==='win32';
 if(env.MEAI_CODEX_BIN)return path.isAbsolute(env.MEAI_CODEX_BIN)&&(!windows||/^[a-z]:[\\/].*\.exe$/i.test(env.MEAI_CODEX_BIN))?[env.MEAI_CODEX_BIN]:[];
 const search=Object.entries(env).find(([key])=>key.toUpperCase()==='PATH')?.[1]||'';
 const candidates=search.split(windows?';':':').filter(folder=>path.isAbsolute(folder)).map(folder=>path.join(folder,windows?'codex.exe':'codex'));
 if(windows){
  const roots=[env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs','Codex'),env.ProgramFiles&&path.join(env.ProgramFiles,'Codex')].filter(Boolean);
  for(const root of roots)for(const nested of ['resources','resources/bin','resources/app.asar.unpacked/bin'])for(const exe of ['codex.exe','codex-x86_64-pc-windows-msvc.exe'])candidates.push(path.join(root,...nested.split('/'),exe));
 }else for(const folder of ['/Applications',path.join(home,'Applications')])for(const nested of ['', 'bin','app.asar.unpacked','app.asar.unpacked/bin'])for(const exe of ['codex','codex-aarch64-apple-darwin','codex-x86_64-apple-darwin'])candidates.push(path.join(folder,'Codex.app','Contents','Resources',nested,exe));
 return [...new Set(candidates)];
}
export function browserCommand(url,env=process.env,platform=process.platform){
 if(!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url))throw Error('URL local inválida.');
 if(platform==='win32')return {command:win32.join(env.SystemRoot||'C:\\Windows','System32','rundll32.exe'),args:['url.dll,FileProtocolHandler',url]};
 return {command:'/usr/bin/open',args:[url]};
}

export function isMainModule(url,argument,platform=process.platform){
 if(!argument)return false;
 if(platform==='win32'){
  const parsed=new URL(url);if(parsed.protocol!=='file:')return false;
  const fromUrl=decodeURIComponent(parsed.pathname).replace(/^\/(?=[a-z]:)/i,'').replace(/\//g,'\\');
  return win32.resolve(argument).toLowerCase()===win32.resolve(fromUrl).toLowerCase();
 }
 return posix.resolve(argument)===fileURLToPath(url);
}
