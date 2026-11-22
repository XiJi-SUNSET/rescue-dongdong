import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(path.join(root, name), 'utf8');
const output = path.join(root, '营救东东-手机单文件版.html');

const cssFiles = ['style.css', 'pause-map.css', 'touch.css'];
const jsFiles = [
  'vendor/three.min.js',
  'engine.js',
  'player.js',
  'scene.js',
  'pause-map.js',
  'touch.js',
  'fireworks.js'
];

let html = read('index.html');
let replaced = 0;

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`缺少待替换内容：${label}`);
  if (source.indexOf(from, index + from.length) >= 0) throw new Error(`待替换内容重复：${label}`);
  replaced += 1;
  return source.slice(0, index) + to + source.slice(index + from.length);
}

for (const file of cssFiles) {
  const css = read(file).replace(/<\/style/gi, '<\\/style');
  html = replaceOnce(
    html,
    `<link rel="stylesheet" href="${file}">`,
    `<style data-source="${file}">\n${css}\n</style>`,
    file
  );
}

const logo = 'data:image/png;base64,' + readFileSync(path.join(root, 'assets/mission-logo.png')).toString('base64');
const logoCount = (html.match(/assets\/mission-logo\.png/g) || []).length;
if (logoCount !== 2) throw new Error(`Logo 引用数量异常：${logoCount}`);
html = html.replaceAll('assets/mission-logo.png', logo);
replaced += logoCount;

const avatar = 'data:image/png;base64,' + readFileSync(path.join(root, 'assets/message-avatar.png')).toString('base64');
const avatarCount = (html.match(/assets\/message-avatar\.png/g) || []).length;
if (avatarCount !== 1) throw new Error(`通讯头像引用数量异常：${avatarCount}`);
html = html.replaceAll('assets/message-avatar.png', avatar);
replaced += avatarCount;

const audioDirectory = path.join(root, 'assets/audio');
const audioNames = readdirSync(audioDirectory).filter(name => name.endsWith('.mp3')).sort();
if (!audioNames.length) throw new Error('没有找到音效文件');
const audioMap = {};
for (const file of audioNames) {
  audioMap[file.replace(/\.mp3$/, '')] =
    'data:audio/mpeg;base64,' + readFileSync(path.join(audioDirectory, file)).toString('base64');
}
const audioScript = [
  '<script data-source="audio-map">',
  `window.__RESCUE_AUDIO__=Object.freeze(${JSON.stringify(audioMap)});`,
  'window.__rescueAudioSrc=function(name){return window.__RESCUE_AUDIO__[name]||("assets/audio/"+name+".mp3");};',
  '</script>'
].join('\n');

const bootScript = `<script data-source="single-file-boot">
(function(){
  const errors=[];
  addEventListener('error',event=>{
    if(event.target&&event.target!==window&&event.target.tagName)return;
    errors.push(String(event.message||event.error||event));
  });
  addEventListener('unhandledrejection',event=>errors.push('Promise: '+String(event.reason)));
  const ready=()=>window.__rescue&&window.__rescue.frames>2;
  addEventListener('load',()=>{
    const fatal=document.getElementById('fatal');
    let shown=false;
    const timer=setInterval(()=>{
      if(!ready())return;
      clearInterval(timer);
      if(shown)fatal.hidden=true;
    },500);
    setTimeout(()=>{
      if(ready()||!fatal||!fatal.hidden)return;
      const detail=document.getElementById('fatalDetail');
      shown=true;
      fatal.hidden=false;
      detail.textContent=(
        window.THREE&&window.RescuePlayer&&window.RescuePauseMap&&window.RescueTouch
          ? '脚本已加载，但三维场景还没有产生画面。请确认浏览器启用了硬件加速与 WebGL，并用系统浏览器（Chrome、Safari 或 Edge）打开本文件。仍在加载时可继续等待。'
          : '游戏脚本没有完整执行。请用系统浏览器（Chrome、Safari 或 Edge）直接打开本文件，不要使用聊天软件的内置预览。'
      )+(errors.length?'\\n\\n'+errors.join('\\n'):'');
    },7000);
  });
})();
</script>`;

for (const file of jsFiles) {
  const js = read(file).replace(/<\/script/gi, '<\\/script');
  html = replaceOnce(
    html,
    `<script src="${file}"></script>`,
    `<script data-source="${file}">\n${js}\n</script>`,
    file
  );
}

let game = read('game.js').replace(/<\/script/gi, '<\\/script');
html = replaceOnce(
  html,
  '<script src="game.js"></script>',
  `${audioScript}\n<script data-source="game.js">\n${game}\n</script>`,
  'game.js'
);

const fallbackStyle = `<style data-source="single-file-fallback">
#fatal{position:fixed;inset:0;z-index:999;display:flex;flex-direction:column;justify-content:center;padding:12%;background:#192b36;color:#d3e0df;font:14px/1.8 "Microsoft YaHei","PingFang SC",sans-serif}
#fatal h2{font-size:22px;font-weight:500;letter-spacing:2px;margin:0 0 14px}
#fatal pre{white-space:pre-wrap;font-size:12px;color:#cb9d91}
.single-file-noscript{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:9%;background:#192b36;color:#e5e4d9;font:14px/2 "Microsoft YaHei","PingFang SC",sans-serif;text-align:center}
</style>`;
html = replaceOnce(html, '</head>', `${fallbackStyle}\n</head>`, 'head close');

const noscript = `<noscript><div class="single-file-noscript">这份游戏需要 JavaScript。<br>请用系统浏览器（Chrome、Safari 或 Edge）直接打开本文件。</div></noscript>`;
html = replaceOnce(html, '<body>', `<body>\n${noscript}\n${bootScript}`, 'body open');

const externalReference = /<(?:script|link|img)\b[^>]*(?:src|href)="(?!data:)([^"]+)"/i.exec(html);
if (externalReference) throw new Error(`仍然存在外部资源引用：${externalReference[1]}`);
if (!html.includes('data:image/png;base64,')) throw new Error('Logo 未内嵌');
if (!html.includes('data:audio/mpeg;base64,')) throw new Error('音效未内嵌');

writeFileSync(output, html);
const bytes = Buffer.byteLength(html);
console.log(`Built ${output}`);
console.log(`Inlined ${logoCount} logos, ${avatarCount} avatar, ${audioNames.length} sounds, ${jsFiles.length + 1} scripts, ${cssFiles.length} stylesheets`);
console.log(`Size: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
