
import { spawn } from 'node:child_process';
import path from 'node:path';
const BASE = process.cwd();
const HARNESS = path.join(BASE, 'tmp', 'occlusion', 'occlusion.html');
const PORT = 9555;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(BASE, 'tmp', 'occlusion', 'profile-dbg'), '--window-size=1280,800', '--hide-scrollbars', '--disable-gpu', '--no-first-run', '--force-device-scale-factor=1', 'file:///' + HARNESS.replace(/\\/g, '/')], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
async function target() { for (let i = 0; i < 100; i++) { try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const p = l.find(t => t.type === 'page' && t.url.includes('occlusion.html')); if (p) return p; } catch {} await sleep(150); } throw new Error('no target ' + log.slice(-400)); }
class Cdp { constructor(ws){this.ws=ws;this.id=0;this.p=new Map();}
  static async connect(u){const ws=new WebSocket(u);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});const c=new Cdp(ws);ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&c.p.has(m.id)){const{resolve,reject}=c.p.get(m.id);c.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result);}};return c;}
  send(method,params){const id=this.id+=1;return new Promise((res,rej)=>{this.p.set(id,{resolve:res,reject:rej});this.ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(this.p.has(id)){this.p.delete(id);rej(new Error('timeout '+method));}},30000);});}
  async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails).slice(0,500));return r.result&&r.result.value;}
}
const pg = await target();
const cdp = await Cdp.connect(pg.webSocketDebuggerUrl);
await cdp.send('Runtime.enable');
await cdp.eval('window.__mount()');
await sleep(800);
const info = await cdp.eval(`(function(){
  var pen = document.querySelector('.pighub-pen');
  var grass = document.querySelector('.pighub-grass');
  var clip = document.querySelector('.pighub-grass-clip');
  var fence = document.querySelector('.pighub-fence');
  var styles = document.querySelectorAll('style');
  return {
    styles: styles.length,
    cssText: styles.length ? styles[styles.length-1].textContent.length : 0,
    penHtmlLen: pen ? pen.innerHTML.length : -1,
    penHead: pen ? pen.innerHTML.slice(0, 400) : '',
    grassTag: grass ? grass.tagName : null,
    grassBox: grass ? (function(){var r=grass.getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,t:r.top};})() : null,
    clipBg: clip ? getComputedStyle(clip).backgroundColor : null,
    fenceCount: document.querySelectorAll('.pighub-fence').length,
    fenceShotBg: (function(){var s=document.querySelector('.pighub-fence-shot');return s?getComputedStyle(s).backgroundImage.slice(0,120):null;})(),
    fieldOut: (function(){var f=document.querySelector('.pighub-field-out');if(!f)return null;var cs=getComputedStyle(f);return {fill:cs.fill,opacity:cs.opacity};})(),
    meadow: !!document.querySelector('.pighub-grass svg'),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
cdp.close(); child.kill();
