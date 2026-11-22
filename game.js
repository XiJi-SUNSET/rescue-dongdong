(() => {
'use strict';
const $=id=>document.getElementById(id), UI={};
['menu','hud','dialog','help','guide','toast','stageLabel','remaining','jumpCount','routeProgress','stratum','waveMode','heightInfo','targetLabel','targetDot','targetTitle','targetDistance','targetHint','goalLabel','crosshair','aimInfo','aimTag','signalDot','signalText','comms','commsText','ownWave','aimWave','recWave','ownWaveRow','aimWaveRow','recWaveRow','ownWaveUnit','aimWaveUnit','recWaveUnit','bagIcon','bagName','sealInfo','saveNote','chapterTop','warp','assistPanel','assistHud','livesReadout','activeAssists','pauseMap','pauseMapCanvas','pauseMapMeta','pauseMapClock','pauseMapStage','pauseMapLegendWave','pauseMapLegendHole','pauseMapStrataBands','pauseMapStrataNow','pauseMapStrataNote','pauseMapRange','pauseMapLocal','pauseMapFull','pauseMapRangeScale','pauseResume','pauseMenu','guideScroll'].forEach(id=>UI[id]=$(id));
const ASSIST_KEY='rescue-dongdong-assists-v1',CONTROL_KEY='rescue-dongdong-controls-v1';
let assistSettings=Rescue.normalizeAssists();try{assistSettings=Rescue.normalizeAssists(JSON.parse(localStorage.getItem(ASSIST_KEY)));}catch{}
let controlMode='auto';try{const stored=JSON.parse(localStorage.getItem(CONTROL_KEY));if(stored&&['auto','keyboard','touch'].includes(stored.mode))controlMode=stored.mode;}catch{}
const coarsePointer=()=>window.matchMedia?.('(pointer: coarse)').matches||(navigator.maxTouchPoints>0&&window.matchMedia?.('(hover: none)').matches);
const resolveControlMode=()=>controlMode==='touch'||(controlMode==='auto'&&coarsePointer());
let touchMode=resolveControlMode(),touchControls=null;
document.body.classList.toggle('touch-mode',touchMode);
const SAVE_KEY='rescue-dongdong-save-v2';let scene,engine,player,pauseMapView=null,pauseMapTimer=0,lastFrame=0,dialogAction=null,dialogAlt=null,helpWasPaused=false,toastUntil=0,frameCount=0,muted=false,pauseMapRange='local',pauseMapContext=null;
const errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const finite=n=>Number.isFinite(n)&&n<1e9;
const sec=n=>finite(n)?Math.max(0,n).toFixed(1):'—';
let saved=null;try{const value=JSON.parse(localStorage.getItem(SAVE_KEY));if(value&&value.version===2&&Array.isArray(value.pos)&&value.pos.length===3&&value.pos.every(Number.isFinite)&&['training','single','silent','five'].includes(value.stage)&&Number.isFinite(value.jumps)&&value.jumps>=0&&value.jumps<2000)saved=value;}catch{}
$('continueBtn').hidden=!saved;if(saved)$('startBtn').innerHTML='开始新行动 <span>→</span>';
const km=n=>Number((n/1000).toFixed(3)).toString();
const bandName=f=>f==='blue'?'金刚岩':'纹白岩';
const bagName=f=>f==='blue'?'蓝袋':'红袋';
const bandLabel=f=>f==='blue'?'金刚岩':'纹白岩';
const bagLabel=f=>f==='blue'?'金刚岩 · 蓝袋':'纹白岩 · 红袋';
function enabledAssists(a){return [a.distanceScale!==1?'路程 ×'+a.distanceScale:'',a.maxLives>1?a.maxLives+' 点生命':'',a.snapAim?'轻吸附落点':'',a.autoFill?'自动填充':'',a.autoSwitch?'自动换袋':'',a.autoJump?'自动跳跃':''].filter(Boolean);}
function updateMenu(){
 const a=assistSettings,names=enabledAssists(a);
 $('menuDistance').innerHTML=km(16000*a.distanceScale)+'<small>km</small>';$('menuJumps').innerHTML=Math.ceil(320*a.distanceScale)+'<small>跳</small>';$('menuLives').innerHTML=a.maxLives+'<small>次</small>';
 $('assistStatus').textContent=names.length?names.length+' 项辅助':'未启用';$('assistStatus').classList.toggle('enabled',!!names.length);
 const modeNote=touchMode?'触屏操作 · 左手摇杆 / 右手转向':'鼠标与键盘 · 离线游玩';
 $('menuAssistNote').textContent=names.length?'老君的法宝（加强版） · '+names.join(' / ')+'\n'+modeNote+'\n新行动生效，继续存档沿用原设置。':'正常难度 · 所有辅助关闭\n'+modeNote;
 $('startBtn').innerHTML=(saved?'开始新行动':'开始游戏')+' <span>→</span>';
}
function readAssistForm(){return Rescue.normalizeAssists({distanceScale:Number($('assistDistance').value),maxLives:Number($('assistLives').value),snapAim:$('assistSnap').checked,autoFill:$('assistFill').checked,autoSwitch:$('assistSwitch').checked,autoJump:$('assistJump').checked});}
function previewAssists(){const a=readAssistForm(),count=enabledAssists(a).length;$('assistPreview').textContent=km(16000*a.distanceScale)+' km · 约 '+Math.ceil(320*a.distanceScale)+' 跳 · '+a.maxLives+' 点生命'+(count?' · '+count+' 项辅助启用':' · 正常难度');}
function fillAssistForm(a){$('controlMode').value=controlMode;$('assistDistance').value=String(a.distanceScale);$('assistLives').value=String(a.maxLives);$('assistSnap').checked=a.snapAim;$('assistFill').checked=a.autoFill;$('assistSwitch').checked=a.autoSwitch;$('assistJump').checked=a.autoJump;previewAssists();}
function setControlMode(mode,{store=false,announce=false}={}){
 if(!['auto','keyboard','touch'].includes(mode))return false;
 controlMode=mode;const wasTouch=touchMode;touchMode=resolveControlMode();
 document.body.classList.toggle('touch-mode',touchMode);touchControls?.setActive(touchMode);
 if(touchMode!==wasTouch&&viewActive&&inputActive()){
  if(touchMode){if(document.pointerLockElement)document.exitPointerLock();}
  else requestViewLock();
 }
 if(store){try{localStorage.setItem(CONTROL_KEY,JSON.stringify({mode}));}catch{}}
 if(announce&&touchMode!==wasTouch)toast(touchMode?'触屏操作已启用 · 推荐横屏':'键鼠操作已启用');
 updateMenu();return true;
}
function closeAssists(){UI.assistPanel.hidden=true;$('assistBtn').focus();}
function openAssists(){fillAssistForm(assistSettings);UI.assistPanel.hidden=false;$('closeAssists').focus();}
updateMenu();
const SFX_NAMES=['portal-open','jump-1','jump-2','land','meow-1','meow-2','meow-3','meow-4','meow-5'];
const audioSrc=name=>window.__rescueAudioSrc?window.__rescueAudioSrc(name):'assets/audio/'+name+'.mp3';
class Sound{
 constructor(){this.ctx=null;this.active=[];this.layers=new Set();this.jumpIndex=0;this.meowBag=[];this.lastMeow=0;this.serial=0;this.warm=[];this.warmed=false;}
 init(){if(!this.ctx){const A=window.AudioContext||window.webkitAudioContext;if(A){this.ctx=new A();this.master=this.ctx.createGain();this.master.gain.value=.15;this.master.connect(this.ctx.destination);}}if(this.ctx?.state==='suspended')this.ctx.resume().catch(()=>{});this.preload();}
 preload(){if(this.warmed)return;this.warmed=true;for(const name of SFX_NAMES){const clip=new Audio(audioSrc(name));clip.preload='auto';clip.volume=0;try{clip.load();}catch{}this.warm.push(clip);}}
 tone(freq,duration=.15,type='sine',volume=.4,delay=0){if(muted||!this.ctx)return;const o=this.ctx.createOscillator(),g=this.ctx.createGain(),t=this.ctx.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(volume,t+.012);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+duration+.02);}
 cue(type){const cues={portal:[294,440],fill:[125,96],jump:[210,510],go:[660,880],fail:[130,92],low:[370,277],repair:[294,588],win:[294,370,440,588]};(cues[type]||[220]).forEach((f,i)=>this.tone(f,type==='win'?.8:.3,'sine',.38,i*.08));}
 play(name,{volume=.6}={}){if(muted)return;const clip=new Audio(audioSrc(name));clip.volume=volume;this.layers.add(clip);clip.addEventListener('ended',()=>this.layers.delete(clip),{once:true});clip.play().catch(()=>{});return clip;}
 jump(){this.jumpIndex=this.jumpIndex%2+1;this.play('jump-'+this.jumpIndex,{volume:this.jumpIndex===1?.74:.50});}
 pickMeow(){if(!this.meowBag.length){const bag=[1,2,3,4,5];for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}// Avoid repeating the previous bag's last take at the seam.
  if(bag[bag.length-1]===this.lastMeow)[bag[0],bag[bag.length-1]]=[bag[bag.length-1],bag[0]];this.meowBag=bag;}this.lastMeow=this.meowBag.pop();return this.lastMeow;}
 meow(delay=0){const name='meow-'+this.pickMeow(),serial=this.serial;if(delay>0)setTimeout(()=>{if(serial===this.serial&&!muted)this.play(name,{volume:.84});},delay*1000);else this.play(name,{volume:.84});}
 land(){this.play('land',{volume:.42});this.meow(.06);}
 stopClip(){this.serial++;for(const clip of this.layers){try{clip.pause();}catch{}}this.layers.clear();}
 stop(){this.stopClip();}
}
const sound=new Sound();
const BGM_TRACKS={early:{name:'bgm-early',volume:.40},five:{name:'bgm-five',volume:.31}};
class Music{
 constructor(){this.tracks=new Map();this.levels=new Map();this.routes=new Map();this.fadeOuts=new Map();this.current=null;this.transition=null;this.muted=false;this.ducked=false;this.stopped=true;}
 track(key){if(!this.tracks.has(key)){const clip=new Audio(audioSrc(BGM_TRACKS[key].name));clip.loop=true;clip.preload='auto';clip.volume=0;this.tracks.set(key,clip);this.levels.set(key,0);}return this.tracks.get(key);}
 level(key){return this.levels.get(key)||0;}
 route(key){
  if(this.routes.has(key))return true;
  const ctx=sound.ctx;if(!ctx)return false;
  if(ctx.state==='suspended')ctx.resume().catch(()=>{});
  try{
   const clip=this.track(key);
   const source=ctx.createMediaElementSource(clip),gain=ctx.createGain();
   gain.gain.value=0;source.connect(gain);gain.connect(ctx.destination);
   clip.volume=1;this.routes.set(key,{source,gain});return true;
  }catch{return false;}
 }
 setLevel(key,value){
  const clip=this.tracks.get(key);if(!clip)return;
  const next=Math.max(0,Math.min(1,value)),route=this.routes.get(key);
  // iOS Safari ignores HTMLMediaElement.volume, so the mix lives on a Web Audio
  // gain whenever the context is available; raw element volume is the fallback.
  if(route&&sound.ctx){clip.volume=1;route.gain.gain.setTargetAtTime(next,sound.ctx.currentTime,.012);}
  else clip.volume=next;
  this.levels.set(key,next);
 }
 start(key){
  this.route(key);
  const clip=this.track(key);
  if(clip.paused)clip.play().catch(()=>{});
 }
 pause(key){const clip=this.tracks.get(key);if(!clip)return;try{clip.pause();}catch{}this.setLevel(key,0);}
 play(key,{fade=1.8}={}){
  if(!BGM_TRACKS[key])return;
  if(this.fadeOuts.size){for(const name of this.fadeOuts.keys())this.pause(name);this.fadeOuts.clear();}
  if(this.muted){this.current=key;this.stopped=false;this.transition=null;return;}
  const previous=this.stopped?null:this.current;
  this.current=key;this.stopped=false;
  if(previous===key){this.start(key);if(!this.transition)this.setLevel(key,this.duck()?BGM_TRACKS[key].volume*.28:BGM_TRACKS[key].volume);return;}
  const clip=this.track(key);this.route(key);clip.currentTime=0;this.setLevel(key,0);clip.play().catch(()=>{});
  this.transition={from:previous,to:key,time:0,duration:Math.max(.4,fade)};
  for(const [name,other] of this.tracks)if(name!==key&&name!==previous){try{other.pause();}catch{}this.setLevel(name,0);}
 }
 stop({fade=1.1}={}){
  this.stopped=true;this.current=null;this.transition=null;this.fadeOuts.clear();
  const audible=[...this.tracks.keys()].filter(name=>!this.tracks.get(name).paused||this.level(name)>0);
  if(this.muted||!audible.length){for(const [name,track] of this.tracks){try{track.pause();}catch{}this.setLevel(name,0);}return;}
  for(const name of audible)this.fadeOuts.set(name,{time:0,duration:Math.max(.2,fade),level:this.level(name)});
 }
 setMuted(value){
  this.muted=!!value;
  if(this.muted){for(const [name,track] of this.tracks){try{track.pause();}catch{}this.setLevel(name,0);}this.transition=null;this.fadeOuts.clear();return;}
  if(this.current&&!this.stopped)this.start(this.current);
 }
 duck(){return this.ducked;}
 update(dt,ducked=false){
  this.ducked=!!ducked;
  if(this.muted||this.tracks.size===0)return;
  if(this.fadeOuts.size){
   for(const [name,fadeOut] of [...this.fadeOuts]){
    fadeOut.time+=dt;
    const k=Math.min(1,fadeOut.time/fadeOut.duration);
    this.setLevel(name,fadeOut.level*Math.cos(k*Math.PI/2));
    if(k>=1){this.pause(name);this.fadeOuts.delete(name);}
   }
   return;
  }
  const transition=this.transition;
  if(transition){
   transition.time+=dt;
   const k=Math.min(1,transition.time/transition.duration),factor=this.ducked?.28:1;
   if(transition.to){const cfg=BGM_TRACKS[transition.to];const clip=this.track(transition.to);if(clip.paused&&!this.muted)clip.play().catch(()=>{});this.setLevel(transition.to,Math.sin(k*Math.PI/2)*cfg.volume*factor);}
   if(transition.from){const cfg=BGM_TRACKS[transition.from];this.setLevel(transition.from,Math.cos(k*Math.PI/2)*cfg.volume*factor);}
   if(k>=1){
    if(transition.from&&transition.from!==this.current)this.pause(transition.from);
    if(transition.to)this.setLevel(transition.to,BGM_TRACKS[transition.to].volume*(this.ducked?.28:1));
    this.transition=null;
   }
   return;
  }
  if(!this.current||this.stopped)return;
  const clip=this.track(this.current),target=BGM_TRACKS[this.current].volume*(this.ducked?.28:1);
  if(clip.paused)clip.play().catch(()=>{});
  const delta=target-this.level(this.current),step=dt*1.6;
  this.setLevel(this.current,this.level(this.current)+(Math.abs(delta)<=step?delta:Math.sign(delta)*step));
 }
}
const music=new Music();
function toast(text){UI.toast.textContent=text;UI.toast.classList.add('show');toastUntil=performance.now()+2200;}
// Comms feed: one transmission at a time, queued so rapid stage changes are
// read in order. Times are frozen while the mission is paused.
const comms={queue:[],active:null,until:0,pausedAt:0,hideTimer:0,recent:new Map()},commsEdges=new Map();
function commsClear(){
 comms.queue.length=0;comms.active=null;comms.until=0;comms.pausedAt=0;clearTimeout(comms.hideTimer);
 UI.comms.classList.remove('is-on');UI.comms.hidden=true;
}
function commsSay(text,{delay=0,hold=6200}={}){
 if(!text||!UI.comms)return;
 const now=performance.now();
 if(comms.active?.text===text||comms.queue.some(item=>item.text===text))return;
 const seen=comms.recent.get(text);if(seen!==undefined&&now-seen<9000)return;
 comms.queue.push({text,at:now+Math.max(0,delay)*1000,hold});
 if(comms.queue.length>3)comms.queue.shift();
}
function commsTick(now){
 if(!UI.comms||!engine)return;
 if(engine.paused){if(!comms.pausedAt)comms.pausedAt=now;return;}
 if(comms.pausedAt){const held=now-comms.pausedAt;comms.pausedAt=0;if(comms.active)comms.until+=held;for(const item of comms.queue)item.at+=held;}
 if(comms.active&&now>=comms.until){
  comms.active=null;UI.comms.classList.remove('is-on');
  clearTimeout(comms.hideTimer);
  comms.hideTimer=setTimeout(()=>{if(!comms.active)UI.comms.hidden=true;},260);
 }
 if(!comms.active&&comms.queue.length&&now>=comms.queue[0].at){
  const item=comms.queue.shift();
  comms.active=item;comms.until=now+item.hold;comms.recent.set(item.text,now);
  clearTimeout(comms.hideTimer);UI.commsText.textContent=item.text;UI.comms.hidden=false;
  void UI.comms.offsetWidth;
  UI.comms.classList.add('is-on');
 }
}
function commsEdge(key,active,text,options){
 const on=!!active;if(on&&!commsEdges.get(key))commsSay(text,options);commsEdges.set(key,on);
}
function playerSnapshot(){return {position:player.position.slice(),velocity:player.velocity.slice(),yaw:player.yaw,pitch:player.pitch,cavity:player.cavity,grounded:player.grounded,portal:player.portal?{...player.portal}:null,jumped:player._jumped,portalConsumed:player._portalConsumed};}
function restorePlayer(snapshot){
 const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(!snapshot||!vector(snapshot.position)||!vector(snapshot.velocity)||![snapshot.yaw,snapshot.pitch].every(Number.isFinite)||snapshot.cavity!==player.cavity)return false;
 const portal=snapshot.portal;if(portal&&(![portal.x,portal.y,portal.z,portal.radius].every(Number.isFinite)||portal.radius!==RescuePlayer.PHYSICS.portalRadius))return false;
 player.position=snapshot.position.slice();player.velocity=snapshot.velocity.slice();player.yaw=0;player.pitch=0;player.look(snapshot.yaw,snapshot.pitch);player.grounded=!!snapshot.grounded;player.portal=portal?{...portal}:null;player._jumped=!!snapshot.jumped;player._portalConsumed=!!snapshot.portalConsumed;player.clearInput();return true;
}
function persist(){if(engine.mode!=='campaign'||['menu','won'].includes(engine.state))return;try{const current=engine.exportSave(),physical=current.engineVersion>=6,checkpoint=physical?current:engine.checkpoint||current;saved={...checkpoint,lowUsed:engine.lowUsed||checkpoint.lowUsed,elapsed:engine.elapsed,failures:engine.failures,lives:engine.lives,scanHits:engine.scanHits,fillerType:engine.fillerType};if(physical)saved.localPlayer=playerSnapshot();localStorage.setItem(SAVE_KEY,JSON.stringify(saved));UI.saveNote.textContent='已记录行动状态 · 可随时暂停';}catch{UI.saveNote.textContent='浏览器未允许存档 · 请勿关闭本页';}}
function showDialog(kicker,title,text,primary,action,secondary='返回起点菜单',alt=toMenu){
 commsClear();music.stop({fade:1.1});releaseView();$('dialogKicker').textContent=kicker;$('dialogTitle').textContent=title;$('dialogText').textContent=text;$('dialogPrimary').innerHTML=primary+' <span>→</span>';$('dialogSecondary').textContent=secondary;dialogAction=action;dialogAlt=alt;UI.dialog.hidden=false;
}
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
let lastLandingAt=-Infinity,arrivalLandingPending=false;
function resetPlayer(fromExit=false){
 const starting=engine.mode!=='five'&&engine.jumps===0;
 player.reset({cavity:!starting,fromExit});engine.localPlayer=player;
 if(starting){
  const pose=scene.getStartPose();player.position=pose.position.slice();player.look(pose.yaw,pose.pitch);
  if(engine.rec){syncAim();if(engine.assists.snapAim&&engine.settleSnap())alignViewToRec();}
  return;
 }
 // Only the snap assist may turn the view onto the recommendation. Without
 // it the player keeps the route-forward heading chosen by the reset.
 if(engine.rec&&engine.assists.snapAim)alignViewToRec();
 syncAim();
 if(engine.rec&&engine.assists.snapAim&&engine.settleSnap())alignViewToRec();
}
let viewActive=false,mouseX=null,mouseY=null,wasLocked=false,lockPending=false,aimSettleTimer=0;
function releaseView(){viewActive=false;mouseX=mouseY=null;document.body.classList.remove('view-active');player?.clearInput();if(engine)engine.fast=false;if(aimSettleTimer){clearTimeout(aimSettleTimer);aimSettleTimer=0;}if(document.pointerLockElement)document.exitPointerLock();}
function enterView(){
 if(!inputActive())return;
 viewActive=true;mouseX=mouseY=null;document.body.classList.add('view-active');$('game').focus({preventScroll:true});if(!touchMode)requestViewLock();
}
function onEvent(event){
 switch(event.type){
 case 'start':lastLandingAt=-Infinity;arrivalLandingPending=false;commsEdges.clear();resetPlayer();break;
 case 'leg':resetPlayer(lastLandingAt===engine.time);persist();break;
 case 'five':persist();music.play('five',{fade:1.9});commsSay('五钟开始重启，波会从后方追上来。',{hold:6800});break;
 case 'go':sound.cue('go');break;
 case 'open':player.placePortal();sound.play('portal-open',{volume:.72});break;
 case 'portal':sound.cue('portal');break;
 case 'fill':sound.cue('fill');break;
 case 'packed':break;
 case 'land':lastLandingAt=engine.time;arrivalLandingPending=true;resetPlayer(true);break;
 case 'low':player.clearInput();sound.cue('low');commsSay('门在往下沉。鼠标中键，原地补洞。',{hold:6500});break;
 case 'repair':sound.cue('repair');break;
 case 'hint':toast(event.text);break;
 case 'scanHit':sound.cue('low');toast('扫描命中 · 生命剩余 '+engine.lives+' / '+engine.assists.maxLives);UI.warp.classList.remove('hit');void UI.warp.offsetWidth;UI.warp.classList.add('hit');persist();break;
 case 'fail':{arrivalLandingPending=false;sound.stop();sound.cue('fail');const exhausted=engine.lives<=0;$('dialogStats').textContent='已完成 '+engine.jumps+' 跳 · '+(exhausted?'生命耗尽':'行动已停止');showDialog('空洞暴露 / MISSION FAILED','任务失败——空洞暴露',event.reason,exhausted?'开始新行动':'重试这一跳',exhausted?()=>start(engine.mode):retry);break;}
 case 'win':arrivalLandingPending=false;sound.stop();sound.cue('win');if(engine.mode==='campaign'){try{localStorage.removeItem(SAVE_KEY);}catch{}saved=null;}$('dialogStats').textContent='实际 '+engine.jumps+' 跳 · '+Math.floor(engine.elapsed/60)+' 分 '+Math.floor(engine.elapsed%60)+' 秒 · 重试 '+engine.failures+' 次'+(enabledAssists(engine.assists).length?' · 辅助行动 / 受击 '+engine.scanHits+' 次':'');showDialog(engine.mode==='five'?'五钟试练完成':'行动完成 / MISSION COMPLETE','恭喜你，救到了冬冬。','最后一处空洞与淡蓝光团重合。冬冬已经安全了。行动到此结束，不需要撤离。','回到起点',toMenu,'再走一次五钟段',()=>start('five'));break;
 case 'silence':persist();sound.stop();commsSay('撼地钟停摆了。趁静默快走，开洞传送，不用封洞。',{hold:7200});break;
 case 'continue':break;
 case 'trainingDone':persist();commsSay('已经进入感应区域，稍等。',{delay:.4,hold:6200});break;
 case 'tutorialDone':arrivalLandingPending=false;sound.stop();$('dialogStats').textContent='1 km 安全教学完成 · 20 跳';showDialog('教学完成 / READY TO GO','移动和跳入，已经掌握了。','正式行动的前 1 km 同样没有探测。进入探测范围后，等待开洞信号，按 F 丢填充物，再及时跳入传送门。','开始完整行动',()=>start('campaign'),'试练五钟段',()=>start('five'));break;
 }
}
function start(mode='campaign',save=null){
 pauseMapRange='local';pauseMapContext=null;
 sound.init();sound.stop();arrivalLandingPending=false;commsClear();commsEdges.clear();resetPauseOverlay();UI.menu.hidden=true;UI.hud.hidden=false;UI.dialog.hidden=true;UI.help.hidden=true;UI.guide.hidden=true;UI.assistPanel.hidden=true;document.body.classList.add('playing');$('game').focus();engine.start(mode,save,assistSettings);engine.paused=false;music.play(engine.stage==='five'?'five':'early',{fade:mode==='five'?1.4:2.2});
 if(!save){const intro=mode==='tutorial'?'这里是安全区，没有探测。左键开洞，走近黑门，空格跳入；填充物先不用。':mode==='five'?'五钟段开始。波会从后面追上来，先跳三次找节奏。':'安全教学还有 '+km(engine.rules.training)+' km。先熟悉起跳和落地。';commsSay(intro,{delay:.9,hold:6600});}
 const rules=engine.rules;$('stationStart').textContent=km(rules.start)+' km';$('stationTraining').textContent=km(rules.trainingEnd);$('stationSilent').textContent=km(rules.silent);$('stationFive').textContent=km(rules.five);
 if(save?.engineVersion>=6&&!restorePlayer(save.localPlayer)&&['forming','portal','throwing','packed','jumping','low','falling'].includes(engine.state))player.placePortal();
 if(engine.state==='failed'){onEvent({type:'fail',reason:engine.lastReason||'生命已耗尽，请开始新行动。'});return;}
 persist();lastFrame=performance.now();enterView();
}
function retry(){const snapshot=playerSnapshot();UI.dialog.hidden=true;UI.help.hidden=true;UI.guide.hidden=true;resetPauseOverlay();arrivalLandingPending=false;commsClear();commsEdges.clear();sound.stop();engine.retry();engine.paused=false;music.play(engine.stage==='five'?'five':'early',{fade:1.2});document.body.classList.add('playing');if(engine.exportSave().engineVersion>=6)restorePlayer(snapshot);if(engine.state==='failed'){onEvent({type:'fail',reason:engine.lastReason||'行动已经失败，请开始新行动。'});return;}lastFrame=performance.now();enterView();}
function toMenu(){persist();sound.stop();music.stop({fade:.5});arrivalLandingPending=false;commsClear();commsEdges.clear();resetPauseOverlay();releaseView();engine.reset();resetPlayer();UI.dialog.hidden=true;UI.help.hidden=true;UI.guide.hidden=true;UI.assistPanel.hidden=true;UI.hud.hidden=true;UI.menu.hidden=false;document.body.classList.remove('playing');$('continueBtn').hidden=!saved;updateMenu();}
function resetPauseOverlay(){
 if(pauseMapTimer){clearTimeout(pauseMapTimer);pauseMapTimer=0;}
 if(UI.pauseMap){UI.pauseMap.classList.remove('is-visible');UI.pauseMap.hidden=true;}
 pauseMapView?.resetInput();
 if(scene)scene.setPause(false);
}
function renderPauseStrata(snapshot){
 const geology=snapshot.geology;
 if(!geology||!UI.pauseMapStrataBands)return;
 const bands=geology.bands.slice().sort((a,b)=>b.to-a.to);
 UI.pauseMapStrataBands.replaceChildren(...bands.map(b=>{
  const bar=document.createElement('i');
  bar.className='band '+b.filler+(b.id===geology.current?' current':'');
  bar.style.flexGrow=String(Math.max(1,b.to-b.from));
  bar.title=bandName(b.filler)+' '+km(b.to)+'–'+km(b.from)+' km';
  return bar;
 }));
 const mismatch=geology.carriedFiller!==geology.requiredFiller;
 UI.pauseMapStrataNow.textContent=bandLabel(geology.requiredFiller)+(mismatch?' · 需换袋':'');
 UI.pauseMapStrataBands.parentElement.classList.toggle('mismatch',mismatch);
 UI.pauseMapStrataNote.textContent=bands.map(b=>bandName(b.filler)+' '+km(b.to)+'–'+km(b.from)+' km').join(' · ')+(mismatch?' · 携带 '+bagName(geology.carriedFiller):'');
}
const pauseRangeDistance=n=>{const v=Number(n);return !Number.isFinite(v)||v<=0?'—':v>=1000?km(v)+' km':Math.round(v)+' m';};
function pauseMapMetaText(){
 const c=pauseMapContext;if(!c)return UI.pauseMapMeta?.textContent||'';
 const {snapshot,scatter,stage,geologyText,holes,restarting,transmitting,fiveOnline,fiveTotal,firstIn,countB}=c;
 if(snapshot.scan){
  if(scatter){
   const field=pauseMapRange==='field';
   return '没有倒计时在走。'+stage+geologyText+(restarting?' · 重启中 '+fiveOnline+' / '+fiveTotal:'')+(restarting||transmitting?' · 首道波前 '+sec(firstIn)+' s 后抵达':'')+' · 未封空洞 '+holes.length+' 处 · '+(field
    ?'全场 '+(snapshot.fieldWaves?.length||0)+' 道真实波前截面 · 球面取每钟下一道 · 视野半径 '+pauseRangeDistance(pauseMapView?.lastStats?.frameRadius)
    :(snapshot.shells.length||0)+' 个真实三维球面波 · 半径 '+snapshot.radius+' m')+'。'+(restarting?'重启前的波前不存在；':transmitting?'波前仍在传导，球面会逐渐增多；':field?'白色散点为每钟下一道球面，实线为玩家高度截面，':'画面取每钟下一道，弧线为玩家高度波前截面，')+'白点为未封空洞。';
  }
  return '没有倒计时在走。'+stage+geologyText+' · 未封空洞 '+holes.length+' 处 · '+(countB?'新洞已开':'新洞未开')+' · 全场 '+(snapshot.fieldWaves?.length||0)+' 道真实波前（局部 '+snapshot.waves.length+' 道）。';
 }
 return (snapshot.fieldPreview?'安全段不判定扫描。感知范围 '+(snapshot.field.radius>=1000?km(snapshot.field.radius)+' km':Math.round(snapshot.field.radius)+' m')+' 内仍有待命波前，进入扫描段后才开始判定。':'安全段没有扫描波。')+stage+geologyText+' · 未封空洞 '+holes.length+' 处 · 新洞'+(countB?'已开':'未开')+'。地图仍按真实空洞与岩层绘制，等待不会推进任何计时。';
}
function renderPauseMapRange(){
 if(!UI.pauseMap||!UI.pauseMapRange)return;
 const scatter=UI.pauseMap.classList.contains('scatter-mode');
 UI.pauseMapRange.hidden=!scatter;
 if(!scatter)return;
 const field=pauseMapRange==='field';
 UI.pauseMapLocal.setAttribute('aria-pressed',String(!field));
 UI.pauseMapFull.setAttribute('aria-pressed',String(field));
 const radius=field?pauseMapView?.lastStats?.frameRadius:pauseMapView?.lastStats?.surveyRadius;
 UI.pauseMapRangeScale.textContent=pauseRangeDistance(radius);
 UI.pauseMapRangeScale.title=(field?'全场视野半径 ':'局部调查半径 ')+pauseRangeDistance(radius);
 UI.pauseMapLegendWave.textContent=field?'全场波前 · 高度截面':'下一道波前 · 高度截面';
 UI.pauseMapMeta.textContent=pauseMapMetaText();
}
function setPauseMapRange(range){
 if(!UI.pauseMap||!pauseMapView)return;
 const next=range==='field'?'field':'local';
 if(pauseMapRange===next)return;
 pauseMapRange=next;
 pauseMapView.setRange(next);
 renderPauseMapRange();
}
function openPauseMap(){
 if(!UI.pauseMap||!UI.pauseMap.hidden)return;
 if(['menu','failed','won','tutorial-done'].includes(engine.state))return;
 if(pauseMapTimer){clearTimeout(pauseMapTimer);pauseMapTimer=0;}
 engine.paused=true;persist();sound.stop();releaseView();
 scene.setPause(true);
 UI.dialog.hidden=true;UI.help.hidden=true;UI.assistPanel.hidden=true;
 const scatterStage=engine.stage==='five';
 const snapshot=engine.pauseSnapshot({radius:scatterStage?190:80});
 const holes=snapshot.holes||[],count=kind=>holes.filter(hole=>hole.kind===kind).length;
 const names={training:'安全教学',single:'单钟扫描',silent:'扫描静默',five:'五钟区'},stage=names[engine.stage]||engine.stage;
 const scatter=scatterStage&&Array.isArray(snapshot.shells);
 const geology=snapshot.geology,geologyText=geology?' · 岩层 '+bandLabel(geology.requiredFiller):'';
 const fiveTotal=scatterStage?engine.world.bells.length:0,fiveOnline=scatterStage?engine.fiveOnline:0,restarting=scatterStage&&fiveOnline<fiveTotal,transmitting=scatterStage&&!restarting&&!engine.fiveWaveArrived;
 const firstContact=scatterStage?engine.nextScan(engine.pos):null,firstIn=firstContact?Math.max(0,firstContact.t-engine.time):Infinity;
 if(!scatter)pauseMapRange='local';
 pauseMapContext={snapshot,scatter,stage,geologyText,holes,restarting,transmitting,fiveOnline,fiveTotal,firstIn,countB:count('B')};
 UI.pauseMap.classList.toggle('scatter-mode',scatter);
 $('pauseMapTitle').textContent=scatter?(restarting?'五钟重启中。':transmitting?'五钟波前传导。':'五钟波场。'):'这一刻的扫描场。';
 $('pauseMapLegendWave').textContent=scatter?(pauseMapRange==='field'?'全场波前 · 高度截面':'下一道波前 · 高度截面'):snapshot.scan?'全场真实波前截面':snapshot.fieldPreview?'感知范围 · 待命波前':'本段无扫描波';
 $('pauseMapLegendHole').textContent=scatter?'未封空洞 · 白点':'新洞 / 来路';
 const wheelHint=UI.pauseMap.querySelector('.pause-map-hint .hint-wheel'),touchHint=UI.pauseMap.querySelector('.pause-map-hint .hint-touch');
 if(wheelHint)wheelHint.textContent=scatter?'滚轮缩放 · 拖动旋转 · 双击复位':'滚轮缩放 · 拖动平移 · 双击复位';
 if(touchHint)touchHint.textContent=scatter?'双指缩放 · 单指旋转 · 双击复位':'双指缩放 · 拖动平移 · 双击复位';
 UI.pauseMapMeta.textContent=pauseMapMetaText();
 UI.pauseMapClock.textContent='t = '+snapshot.time.toFixed(1)+' s';
 UI.pauseMapStage.textContent='STAGE / '+stage;
 renderPauseStrata(snapshot);
 const aim=engine.aim||{},facing=aim.valid&&aim.point?aim.point:engine.rec?.point;
 let focusYaw=0;
 if(facing){const dx=facing[0]-engine.pos[0],dz=facing[2]-engine.pos[2];if(Math.hypot(dx,dz)>1e-6)focusYaw=Math.atan2(dx,-dz);}
 UI.pauseMap.hidden=false;
 pauseMapView.resetInput();UI.pauseMap.classList.remove('dragging');
 pauseMapView.setRange(pauseMapRange,false);
 pauseMapView.view.zoom=1;pauseMapView.view.panX=0;pauseMapView.view.panY=0;pauseMapView.resetOrbit();
 pauseMapView.resize();
 pauseMapView.draw(snapshot,{position:engine.pos.slice(),yaw:focusYaw,airborne:!player.grounded});
 renderPauseMapRange();
 requestAnimationFrame(()=>{if(!UI.pauseMap.hidden)UI.pauseMap.classList.add('is-visible');});
}
function closePauseMap(){
 if(!UI.pauseMap||UI.pauseMap.hidden||pauseMapTimer)return;
 UI.pauseMap.classList.remove('is-visible');
 scene.setPause(false);
 pauseMapTimer=setTimeout(()=>{
  pauseMapTimer=0;UI.pauseMap.hidden=true;
  if(!['menu','failed','won','tutorial-done'].includes(engine.state)){engine.paused=false;lastFrame=performance.now();enterView();}
 },280);
}
function togglePause(force){
 if(['menu','failed','won','tutorial-done'].includes(engine.state))return;
 if(force===true){openPauseMap();return;}
 if(force===false){closePauseMap();return;}
 if(engine.paused)closePauseMap();else openPauseMap();
}
function toggleHelp(){
 if(!UI.help.hidden){UI.help.hidden=true;engine.paused=helpWasPaused;lastFrame=performance.now();enterView();return;}
 helpWasPaused=engine.paused;engine.paused=true;releaseView();UI.help.hidden=false;sound.stop();
}
let guideReturnFocus=null;
function trapDialogFocus(container,event){
 const nodes=[...container.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(node=>!node.disabled&&node.offsetParent!==null);
 if(!nodes.length)return;
 const first=nodes[0],last=nodes[nodes.length-1],current=document.activeElement;
 if(event.shiftKey&&(current===first||!container.contains(current))){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&(current===last||!container.contains(current))){event.preventDefault();first.focus();}
}
function openGuide(){
 if(!UI.guide.hidden||UI.menu.hidden)return;
 const active=document.activeElement;
 guideReturnFocus=active&&UI.menu.contains(active)&&typeof active.focus==='function'?active:$('guideBtn');
 releaseView();player.clearInput();engine.fast=false;
 UI.guide.hidden=false;UI.guideScroll.scrollTop=0;
 requestAnimationFrame(()=>$('closeGuide').focus({preventScroll:true}));
}
function closeGuide({restore=true}={}){
 if(UI.guide.hidden)return;
 UI.guide.hidden=true;
 const target=guideReturnFocus;guideReturnFocus=null;
 if(restore){const next=target&&target.isConnected&&typeof target.focus==='function'?target:$('guideBtn');next.focus({preventScroll:true});}
}
try{if(!window.THREE)throw new Error('本地 Three.js 未加载');if(!window.RescuePlayer)throw new Error('本地移动控制器未加载');if(!window.RescuePauseMap)throw new Error('暂停地图未加载');if(!window.RescueTouch)throw new Error('本地触屏控制器未加载');player=new RescuePlayer.Player();scene=new CaveScene($('scene'));engine=new Rescue.Engine({onEvent,externalJumpControl:true,holeRadius:RescuePlayer.PHYSICS.radius});engine.localPlayer=player;pauseMapView=new RescuePauseMap.PauseMapView(UI.pauseMapCanvas);
touchControls=new RescueTouch.TouchControls({getEngine:()=>engine,getPlayer:()=>player,canInput:()=>viewActive&&inputActive(),look:()=>syncAim(),settle:settleAim,stepDistance:d=>syncAim(engine.distance+d),fast:on=>{engine.fast=on;},focusGame:()=>$('game').focus({preventScroll:true})});touchControls.setActive(touchMode);}catch(error){$('fatal').hidden=false;$('fatalDetail').textContent=error.message;errors.push(error.message);return;}
$('startBtn').addEventListener('click',()=>{if(saved){$('dialogStats').textContent='现有记录：'+saved.jumps+' 跳';showDialog('新行动','从 '+km(16000*assistSettings.distanceScale)+' km 重新开始？','现有正式行动进度会被新的行动覆盖，并使用当前辅助设置。','重新开始',()=>start('campaign'),'保留记录，继续上次',()=>start('campaign',saved));}else start('campaign');});
$('continueBtn').addEventListener('click',()=>start('campaign',saved));$('fiveBtn').addEventListener('click',()=>start('five'));$('helpBtn').addEventListener('click',toggleHelp);$('closeHelp').addEventListener('click',toggleHelp);$('guideBtn').addEventListener('click',openGuide);$('closeGuide').addEventListener('click',()=>closeGuide());$('guideStart').addEventListener('click',()=>{closeGuide({restore:false});$('startBtn').click();});$('pauseBtn').addEventListener('click',()=>togglePause());$('dialogPrimary').addEventListener('click',()=>dialogAction?.());$('dialogSecondary').addEventListener('click',()=>dialogAlt?.());
UI.guide.addEventListener('pointerdown',event=>{if(event.target===UI.guide)closeGuide();});
$('pauseResume').addEventListener('click',()=>togglePause(false));$('pauseMenu').addEventListener('click',()=>{resetPauseOverlay();toMenu();});
UI.pauseMapLocal.addEventListener('click',()=>setPauseMapRange('local'));UI.pauseMapFull.addEventListener('click',()=>setPauseMapRange('field'));
$('soundBtn').addEventListener('click',()=>{muted=!muted;$('soundBtn').querySelector('span').textContent=muted?'关':'开';music.setMuted(muted);if(muted)sound.stop();else sound.init();});
$('assistBtn').addEventListener('click',openAssists);$('closeAssists').addEventListener('click',closeAssists);$('resetAssists').addEventListener('click',()=>fillAssistForm(Rescue.normalizeAssists()));
$('assistForm').addEventListener('change',previewAssists);$('assistForm').addEventListener('submit',event=>{event.preventDefault();const mode=$('controlMode').value,wasTouch=touchMode;assistSettings=readAssistForm();let stored=true;try{localStorage.setItem(ASSIST_KEY,JSON.stringify(assistSettings));localStorage.setItem(CONTROL_KEY,JSON.stringify({mode}));}catch{stored=false;}setControlMode(mode);closeAssists();toast(stored?(touchMode!==wasTouch?(touchMode?'已切换触屏操作 · 推荐横屏':'已切换键鼠操作'):'设置已保存 · 下次新行动生效'):'设置本次有效 · 浏览器未允许持久保存');});
const coarseMedia=window.matchMedia?.('(pointer: coarse)');coarseMedia?.addEventListener?.('change',()=>{if(controlMode==='auto')setControlMode('auto',{announce:true});});
UI.assistPanel.addEventListener('pointerdown',event=>{if(event.target===UI.assistPanel)closeAssists();});
$('redFiller').addEventListener('click',()=>engine.selectFiller('red'));$('blueFiller').addEventListener('click',()=>engine.selectFiller('blue'));
const canvas=$('scene');
const controlTarget=target=>target instanceof Element&&!!target.closest('button,input,select,textarea,a,[contenteditable]:not([contenteditable="false"]),[role="dialog"]');
const inputActive=()=>!engine.paused&&UI.pauseMap.hidden&&UI.menu.hidden&&UI.dialog.hidden&&UI.help.hidden&&UI.guide.hidden&&UI.assistPanel.hidden&&!UI.hud.hidden&&$('fatal').hidden&&!['menu','failed','won','tutorial-done'].includes(engine.state);
const gameplayInput=()=>viewActive&&inputActive()&&!controlTarget(document.activeElement);
// Mouse look and the wheel stay live while a HUD button owns keyboard focus.
const pointerInput=()=>viewActive&&inputActive()&&!touchMode;
function alignViewToRec(){
 if(!engine.rec)return;
 const basis=Rescue.basis(engine.pos),target=Rescue.unit(Rescue.sub(engine.rec.point,engine.pos));
 const yaw=Math.atan2(dot(target,basis.right),dot(target,basis.d)),pitch=Math.asin(Math.max(-1,Math.min(1,dot(target,basis.up))));
 const turn=Math.PI*2,dy=((yaw-player.yaw+Math.PI)%turn+turn)%turn-Math.PI;
 player.look(dy,pitch-player.pitch);
}
function syncAim(distance=engine.distance){
 // Wheel and the touch +/- buttons are explicit manual range input. They must
 // also cancel a pending mouse settle, or a distance chosen while pointed at
 // the recommendation would be overwritten ~130 ms later.
 if(aimSettleTimer&&Math.abs(distance-engine.distance)>1e-9){clearTimeout(aimSettleTimer);aimSettleTimer=0;}
 const basis=Rescue.basis(engine.pos),v=Rescue.direction(basis,player.yaw,player.pitch),d=engine.rec?Rescue.unit(Rescue.sub(engine.rec.point,engine.pos)):basis.d;
 let right=Rescue.unit([d[2],0,-d[0]]);if(Rescue.len(right)<.1)right=[0,0,1];
 const up=[d[1]*right[2]-d[2]*right[1],d[2]*right[0]-d[0]*right[2],d[0]*right[1]-d[1]*right[0]];
 engine.aim(Math.atan2(dot(v,right),dot(v,d)),Math.asin(Math.max(-1,Math.min(1,dot(v,up)))),distance);
}
function settleAim(){
 aimSettleTimer=0;
 if(!inputActive()||!engine.rec||!engine.assists.snapAim)return;
 if(engine.settleSnap())alignViewToRec();
}
function scheduleAimSettle(){
 if(!engine.assists.snapAim||!inputActive())return;
 clearTimeout(aimSettleTimer);aimSettleTimer=setTimeout(settleAim,130);
}
function viewLockFallback(){
 lockPending=false;
 if(viewActive&&inputActive()){mouseX=mouseY=null;toast('锁定不可用 · 移动鼠标即可转头，点击画面重试；按住右键可拖出画面继续转身。');}
}
function requestViewLock(){
 if(touchMode||!inputActive()||document.pointerLockElement===canvas||lockPending)return;
 if(typeof canvas.requestPointerLock!=='function'){viewLockFallback();return;}
 lockPending=true;
 try{const request=canvas.requestPointerLock();if(request?.catch)request.catch(viewLockFallback);}catch{viewLockFallback();}
}
function lockView(){
 if(touchMode||!inputActive())return;
 if(document.pointerLockElement===canvas){togglePause(true);return;}
 enterView();
}
$('lockBtn').addEventListener('click',lockView);
// Pointer Lock reliably supplies mousemove, including on browsers that suppress
// pointermove while locked. The unlocked path listens at document level so HUD
// hover cannot strand the view, and a right-drag keeps turning outside the window.
document.addEventListener('mousemove',event=>{
 const locked=document.pointerLockElement===canvas;
 if(touchMode||!pointerInput()){mouseX=mouseY=null;return;}
 const dx=locked?event.movementX:mouseX===null?0:event.clientX-mouseX;
 const dy=locked?event.movementY:mouseY===null?0:event.clientY-mouseY;
 mouseX=event.clientX;mouseY=event.clientY;
 player.look(dx*.0025,-dy*.0025);syncAim();scheduleAimSettle();
});
document.documentElement.addEventListener('mouseleave',()=>{mouseX=mouseY=null;});
let capturedPointer=null;
function releasePointerCapture(){if(capturedPointer!==null){try{canvas.releasePointerCapture(capturedPointer);}catch{}capturedPointer=null;}}
canvas.addEventListener('pointerup',releasePointerCapture);
canvas.addEventListener('pointercancel',releasePointerCapture);
canvas.addEventListener('pointerdown',event=>{
 if(touchMode||!viewActive||!inputActive())return;
 event.preventDefault();$('game').focus({preventScroll:true});
 // A click is a fresh user gesture: retry a failed lock without leaving the run.
 if(event.button!==2&&!document.pointerLockElement)requestViewLock();
 if(event.button===2&&!document.pointerLockElement){try{canvas.setPointerCapture(event.pointerId);capturedPointer=event.pointerId;}catch{}}
 if(event.button===0){sound.init();engine.open();}
 else if(event.button===1)engine.repair();
});
canvas.addEventListener('auxclick',event=>event.preventDefault());
// Window-level so the wheel still reaches the aim while jumping over the HUD.
window.addEventListener('wheel',event=>{
 if(touchMode||!pointerInput()||!Number.isFinite(event.deltaY)||event.deltaY===0)return;
 event.preventDefault();syncAim(engine.distance+(event.deltaY>0?-2:2));
},{passive:false,capture:true});
canvas.addEventListener('contextmenu',event=>event.preventDefault());
document.addEventListener('pointerlockerror',viewLockFallback);
document.addEventListener('pointerlockchange',()=>{
 const locked=document.pointerLockElement===canvas,lost=wasLocked&&!locked;
 wasLocked=locked;lockPending=false;mouseX=mouseY=null;$('lockBtn').textContent=locked?'暂停 / 释放 V':'锁定视角 V';
 // A request may settle after opening a dialog or leaving the game.
 if(locked&&(!inputActive()||touchMode)){releaseView();return;}
 if(lost&&viewActive&&inputActive()&&!touchMode)togglePause(true);
});
document.addEventListener('focusin',event=>{if(controlTarget(event.target)){player.clearInput();engine.fast=false;mouseX=mouseY=null;}});
window.addEventListener('keydown',event=>{
 if(event.ctrlKey||event.metaKey||event.altKey)return;
 if(!UI.assistPanel.hidden){
  if(event.code==='Escape'){event.preventDefault();closeAssists();}
  if(event.code==='Tab'){const nodes=[...UI.assistPanel.querySelectorAll('button,input,select')].filter(n=>!n.disabled),first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  return;
 }
 if(!UI.guide.hidden){
  if(event.code==='Escape'){event.preventDefault();closeGuide();}
  if(event.code==='Tab')trapDialogFocus(UI.guide,event);
  return;
 }
 if(event.code==='Escape'){event.preventDefault();if(!UI.help.hidden)toggleHelp();else if(!UI.pauseMap.hidden)togglePause(false);else togglePause(true);return;}
 if(controlTarget(event.target))return;
 if(event.code==='KeyH'){if(!UI.pauseMap.hidden)return;if(!event.repeat)toggleHelp();return;}
 if(engine.state==='failed'&&event.code==='KeyR'){retry();return;}
 if(!gameplayInput())return;
 if(event.code==='ShiftLeft'||event.code==='ShiftRight'){engine.fast=true;return;}
 if(['KeyW','KeyA','KeyS','KeyD','Space'].includes(event.code)){event.preventDefault();player.setKey(event.code,true);return;}
 if(event.repeat)return;
 if(event.code==='KeyF')engine.fill();else if(event.code==='KeyV')lockView();else if(event.code==='Digit1'||event.code==='Numpad1')engine.selectFiller('red');else if(event.code==='Digit2'||event.code==='Numpad2')engine.selectFiller('blue');
});
window.addEventListener('keyup',event=>{player.setKey(event.code,false);if(event.code.startsWith('Shift'))engine.fast=false;});
$('waitBtn').addEventListener('pointerdown',event=>{if(!inputActive())return;event.preventDefault();engine.fast=true;});window.addEventListener('pointerup',()=>{engine.fast=false;});
window.addEventListener('blur',()=>{releaseView();if(!UI.hud.hidden&&UI.dialog.hidden&&UI.help.hidden&&UI.guide.hidden)togglePause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!UI.hud.hidden&&UI.dialog.hidden&&UI.help.hidden&&UI.guide.hidden)togglePause(true);});
window.addEventListener('resize',()=>{scene.resize();if(pauseMapView&&!UI.pauseMap.hidden)pauseMapView.resize();});window.addEventListener('beforeunload',()=>{persist();sound.stop();});
for(let i=0;i<39;i++){const line=document.createElement('i');line.style.height='3px';$('signalMeter').appendChild(line);}
const meterLines=[...$('signalMeter').children];
function updateHUD(now){
 const e=engine,s=e.state==='ready'&&e.goIn>0?'wait':e.state,silent=e.noScan,training=e.stage==='training',five=e.stage==='five',aim=e.aim.valid?e.aim:null,rec=e.rec;
 const fiveTotal=five?e.world.bells.length:0,fiveOnline=five?e.fiveOnline:0,restarting=five&&fiveOnline<fiveTotal,transmitting=five&&!restarting&&!e.fiveWaveArrived,startup=restarting||transmitting,nextBell=five?e.fiveNextOnline:Infinity,firstContact=five?e.nextScan(e.pos):null,firstIn=firstContact?Math.max(0,firstContact.t-e.time):Infinity;
 const active=['ready','forming','portal','throwing','packed','jumping','falling'].includes(s),danger=s==='low'||(active&&!silent&&e.escape<1.5);
 UI.hud.classList.toggle('ready',active&&!danger);UI.hud.classList.toggle('danger',danger);
 UI.stageLabel.textContent=training?'安全教学 / 前 '+km(e.rules.training)+' km':five?(restarting?'第三段 / 五钟重启':transmitting?'第三段 / 波前传导':'第三段 / 五钟叠加'):silent?'第二段 / 扫描静默':'第一段 / 单钟扫描';
 UI.remaining.textContent=(e.remaining/1000).toFixed(2);UI.jumpCount.textContent=e.mode==='tutorial'?e.jumps+' / 20 教学跳':e.mode==='five'?(e.jumps-e.rules.fiveStartJumps)+' 跳 · 试练':String(e.jumps).padStart(3,'0')+' / '+e.rules.referenceJumps+' 参考跳';UI.routeProgress.style.width=Math.max(0,Math.min(100,100-e.remaining/e.rules.start*100)).toFixed(2)+'%';
 const aids=enabledAssists(e.assists);UI.assistHud.hidden=!aids.length;UI.livesReadout.textContent='生命 '+e.lives+' / '+e.assists.maxLives;UI.activeAssists.textContent=aids.filter(n=>!n.includes('生命')).join(' · ');
 UI.stratum.textContent=bandLabel(e.requiredFiller);UI.waveMode.textContent=training?'尚未进入探测范围':five?(restarting?'重启中 '+fiveOnline+' / '+fiveTotal+' · 波前未至':transmitting?'5 个源头 · 首波传导中':'5 个源头 · 10 s 周期'):silent?'扫描已静默':'1 个源头 · 20 s 周期';
 UI.heightInfo.textContent=aim?'开洞高度 '+((aim.point[1]-e.pos[1])>=0?'+':'')+(aim.point[1]-e.pos[1]).toFixed(1)+' m':'搜索三维落点';
 const blue=e.fillerType==='blue',wrong=!silent&&e.fillerType!==e.requiredFiller;
 UI.bagIcon.classList.toggle('blue',blue);UI.bagName.textContent=bagLabel(blue?'blue':'red')+(wrong?' · 需换袋':'');UI.bagIcon.parentElement.classList.toggle('wrong-filler',wrong);
 $('redFiller').classList.toggle('selected',!blue);$('blueFiller').classList.toggle('selected',blue);$('redFiller').setAttribute('aria-pressed',String(!blue));$('blueFiller').setAttribute('aria-pressed',String(blue));$('redFiller').disabled=$('blueFiller').disabled=e.paused||!['wait','ready','forming','portal'].includes(s)||e.assists.autoSwitch;
 UI.sealInfo.textContent=silent?'此段不用填充物，开门后直接跳':e.sealBlocked?'仍在旧洞内 · 离开后才能封闭':finite(e.sealAt)&&e.sealAt>e.time?'旧洞封闭倒计时 '+sec(e.sealAt-e.time)+' s':finite(e.sealAt)?'旧洞已封闭':'落地 1 秒后封洞，跳后继续计时';
 const green=rec&&e.time>=rec.go&&e.time<rec.nextB;UI.targetDot.style.background=green?'var(--green)':'var(--red)';
 UI.targetTitle.textContent='推荐新洞 B';UI.targetDistance.textContent=rec?rec.distance.toFixed(1)+' m':'— m';UI.targetHint.textContent=rec?(silent?'0.0 s · 随时开洞':sec(rec.go-e.time)+' s'+(green?' · 可以开洞':' 后可开洞')):'没有连续安全窗口';UI.targetHint.style.color=green?'var(--green)':'';
 UI.crosshair.classList.toggle('snapped',!!aim?.snapped);
 UI.aimInfo.textContent=aim?'实际 '+aim.distance.toFixed(1)+' m'+(!rec?' · 自由瞄准 / 暂无路线建议':e.assists.snapAim?(aim.snapped?' · 已吸附推荐':' · 靠近推荐可吸附'):aim.deviation>1?' · 偏离推荐 '+aim.deviation.toFixed(1)+' m':' · 对准推荐'):e.aim.point?'实际 '+e.aim.distance.toFixed(1)+' m · 此落点无安全窗':'无连续安全落点';
 const aimGreen=aim&&e.time>=aim.go&&e.time<aim.nextB;
 // The two HUD numbers are the real next wave contact for the cursor point and
 // for the planner's recommended point. No scan in this stage -> no countdown.
 const waveEta=point=>{if(!point)return Infinity;const hit=e.nextScan(point);return hit?Math.max(0,hit.t-e.time):Infinity;};
 const ownEta=waveEta(e.pos),aimEta=aim?waveEta(aim.point):Infinity,recEta=rec?waveEta(rec.point):Infinity;
 UI.ownWave.textContent=finite(ownEta)?sec(ownEta):'—';UI.aimWave.textContent=finite(aimEta)?sec(aimEta):'—';UI.recWave.textContent=finite(recEta)?sec(recEta):'—';UI.ownWaveUnit.style.visibility=finite(ownEta)?'visible':'hidden';UI.aimWaveUnit.style.visibility=finite(aimEta)?'visible':'hidden';UI.recWaveUnit.style.visibility=finite(recEta)?'visible':'hidden';
 UI.ownWaveRow.classList.toggle('soon',finite(ownEta)&&ownEta<1.5);UI.aimWaveRow.classList.toggle('soon',finite(aimEta)&&aimEta<1.5);UI.recWaveRow.classList.toggle('soon',finite(recEta)&&recEta<1.5);
 UI.aimWaveRow.classList.toggle('safe',!!aimGreen);UI.recWaveRow.classList.toggle('safe',!!green);
 UI.signalText.textContent=s==='low'?'门低了 · 立即补洞':e.noPlan?'未找到连续安全落点':training?'安全教学 · 没有探测':silent?'没有扫描':restarting?'五钟重启中 · '+fiveOnline+'/'+fiveTotal:transmitting?'波前传导中 · 约 '+sec(firstIn)+' s':aimGreen?'安全窗口已打开':'等待安全开洞时机';UI.signalDot.style.background=danger?'var(--red)':startup?'var(--hud-amber)':aimGreen?'var(--green)':'var(--hud-sym-faint)';
 commsEdge('filler',!training&&wrong,'岩层换了，按 1 / 2 换对应的袋子。');
 commsEdge('noPlan',!training&&!silent&&e.noPlan,e.noPlanReason==='deadline'?'最近的波贴上来了，先退开，别开洞。':'前面没有安全落点，先等一个窗口。');
 commsEdge('approach',e.mode==='campaign'&&training&&e.remaining<=e.rules.trainingEnd+150,'跳跃三次后准备进入感应范围。',{hold:8000});
 $('waitBtn').style.visibility=five||silent?'hidden':'visible';
 touchControls?.update(e,{signal:UI.signalText.textContent,distance:Math.round(e.distance)+' m',filler:UI.bagName.textContent,meta:(finite(recEta)?'推荐 '+sec(recEta)+' s':'推荐 —')+' · '+Math.round(e.distance)+' m'+(finite(e.sealAt)&&e.sealAt>e.time?' · 封洞 '+sec(e.sealAt-e.time)+' s':''),openReady:e.noScan||green,danger,fastAvailable:!(five||silent)});
 const marks=scene.getMarkers();
 if(marks?.target){const w=UI.targetLabel.offsetWidth,h=UI.targetLabel.offsetHeight;UI.targetLabel.style.left=Math.max(w/2+8,Math.min(innerWidth-w/2-8,marks.target.x))+'px';UI.targetLabel.style.top=Math.max(8,Math.min(innerHeight-h-8,marks.target.y+27))+'px';UI.targetLabel.style.visibility=marks.target.visible?'visible':'hidden';}
 if(aim&&['wait','ready'].includes(e.state)){
  UI.aimTag.hidden=false;
  const w=UI.aimTag.offsetWidth,h=UI.aimTag.offsetHeight;
  const reticle=UI.crosshair.getBoundingClientRect();
  const eyeX=reticle.left+reticle.width/2,eyeY=reticle.top+reticle.height/2;
  const left=Math.max(8,Math.min(innerWidth-w-8,eyeX+27));
  const preferred=Math.max(h/2+8,Math.min(innerHeight-h/2-8,eyeY-8));
  const obstacles=[];
  if(marks?.target?.visible)obstacles.push(UI.targetLabel.getBoundingClientRect());
  if(touchMode){
   for(const el of [$('touchStatus'),document.querySelector('.touch-dock')]){
    if(el&&el.getClientRects().length){const r=el.getBoundingClientRect();
     if(r.width>2&&r.height>2)obstacles.push(r);}
   }
  }
  const hits=top=>{
   const box={left,right:left+w,top:top-h/2,bottom:top+h/2};
   return obstacles.some(t=>box.left<t.right+6&&box.right>t.left-6&&box.top<t.bottom+6&&box.bottom>t.top-6);
  };
  let top=preferred;
  if(hits(top)){
   const min=h/2+8,max=innerHeight-h/2-8;
   const candidates=[min,max];
   for(const t of obstacles)candidates.push(t.top-8-h/2,t.bottom+8+h/2);
   candidates.sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred));
   for(const c of candidates)if(c>=min&&c<=max&&!hits(c)){top=c;break;}
  }
  UI.aimTag.style.left=left+'px';
  UI.aimTag.style.top=top+'px';
  UI.aimTag.dataset.state=aimGreen?'open':'wait';
  UI.aimTag.textContent='Ø1.0 m · '+aim.distance.toFixed(1)+' m';
 }else UI.aimTag.hidden=true;
 // 500 m is physical remaining distance, independent of route-shortening assists.
 const goalNear=e.remaining<=500;
 UI.goalLabel.hidden=e.state==='menu'||UI.hud.hidden||!marks?.goal?.visible;
 UI.goalLabel.classList.toggle('near',goalNear);
 UI.goalLabel.style.setProperty('--goal-caption-opacity',Math.max(0,Math.min(1,(500-e.remaining)/80)).toFixed(3));
 const goalBlend=Math.max(0,Math.min(1,(500-e.remaining)/100));
 UI.goalLabel.style.setProperty('--goal-dot-opacity',(1-goalBlend*goalBlend*(3-2*goalBlend)).toFixed(3));
 if(marks?.goal){UI.goalLabel.style.left=marks.goal.x+'px';UI.goalLabel.style.top=marks.goal.y+'px';UI.goalLabel.style.setProperty('--goal-caption-left',Math.max(14,marks.goal.captionOffsetX||14)+'px');}
 UI.goalLabel.style.setProperty('--goal-caption-top','-8px');
 if(goalNear&&!UI.goalLabel.hidden){
  const caption=UI.goalLabel.querySelector('.goal-caption'),rect=caption.getBoundingClientRect();
  let top=rect.top,bottom=rect.bottom;
  const reserved=[$('crosshair'),UI.aimInfo,UI.targetLabel].filter(el=>el&&!el.hidden&&getComputedStyle(el).visibility!=='hidden').map(el=>el.getBoundingClientRect()).sort((a,b)=>a.top-b.top);
  for(const r of reserved){if(rect.left<r.right+6&&rect.right>r.left-6&&top<r.bottom+6&&bottom>r.top-6){const move=r.bottom+8-top;top+=move;bottom+=move;}}
  UI.goalLabel.style.setProperty('--goal-caption-top',(-8+top-rect.top)+'px');
 }
 if(frameCount%4===0)meterLines.forEach((line,i)=>{const pulse=silent?.12:(.3+Math.pow(Math.max(0,Math.sin(i*.56-e.time*3)),4)*.7);line.style.height=(2+pulse*(10+12*Math.sin(i*2.91)**2))+'px';line.style.background=green?'#c9f2ff':'#6f95a8';});
}
const walkStates=new Set(['wait','ready','forming','portal','throwing','packed','interlude']);
function advance(dt){
 if(engine.paused)return;
 let remaining=dt;
 while(remaining>1e-8){
  const h=Math.min(remaining,1/120),previousRec=engine.rec;remaining-=h;engine.tick(h);if(engine.rec!==previousRec)syncAim();
  const s=engine.state,automatic=engine.assists.autoJump;
  const canEnter=automatic?(s==='packed'&&engine.packedFillerType===engine.requiredFiller||s==='portal'&&engine.noScan):s==='portal'||s==='packed';
  const wasGrounded=player.grounded,wasJumped=player._jumped;
  const result=player.step(h,{enabled:!engine.paused&&walkStates.has(s),portalActive:['portal','throwing','packed'].includes(s),canEnter,autoJump:automatic});
  // One-shots follow the body, not the route clock: every takeoff gets the jump
  // sample, every floor contact gets land + meow, including plain Space jumps.
  if(wasGrounded&&!player.grounded&&player._jumped)sound.jump();
  if(!wasGrounded&&player.grounded){
   if(arrivalLandingPending){arrivalLandingPending=false;sound.land();}
   else if(wasJumped)sound.land();
  }
  if(result.entered)engine.jump(engine.jumpKey(),.04);
 }
}
function frame(now){
 const dt=lastFrame?Math.min(.1,(now-lastFrame)/1000):1/60;lastFrame=now;frameCount++;
 try{advance(dt);scene.update(engine,dt,{menu:engine.state==='menu'});music.update(dt,engine.paused);if(!UI.hud.hidden){updateHUD(now);commsTick(now);}if(now>toastUntil)UI.toast.classList.remove('show');}catch(error){errors.push(error.message);console.error(error);engine.paused=true;releaseView();$('fatal').hidden=false;$('fatalDetail').textContent=error.message;return;}
 requestAnimationFrame(frame);
}
window.__rescue={get engine(){return engine;},get scene(){return scene;},get player(){return player;},get sound(){return sound;},get arrivalLandingPending(){return arrivalLandingPending;},get touch(){return touchControls;},get pauseMapView(){return pauseMapView;},get controlMode(){return controlMode;},get touchMode(){return touchMode;},setControlMode(mode,options){return setControlMode(mode,options);},advance,get errors(){return errors;},get frames(){return frameCount;},get assistSettings(){return {...assistSettings};},start,retry,toMenu,pause:togglePause,openPauseMap,closePauseMap,openGuide,closeGuide,
get guide(){return {visible:!!UI.guide&&!UI.guide.hidden,scrollTop:UI.guideScroll?.scrollTop??0,scrollHeight:UI.guideScroll?.scrollHeight??0,clientHeight:UI.guideScroll?.clientHeight??0,active:document.activeElement?.id||'',sheet:UI.guide?.querySelector('.guide-sheet')?.getBoundingClientRect()||null,startHidden:$('startBtn').hidden,menuHidden:UI.menu.hidden};},
get pauseMapSnapshot(){return engine.pauseSnapshot({radius:80});},
get pauseMapState(){return {visible:!!UI.pauseMap&&!UI.pauseMap.hidden,shown:!!UI.pauseMap&&UI.pauseMap.classList.contains('is-visible'),scatter:!!UI.pauseMap&&UI.pauseMap.classList.contains('scatter-mode'),range:pauseMapView?.range||'local',rangeHidden:UI.pauseMapRange?.hidden??true,rangeLocal:UI.pauseMapLocal?.getAttribute('aria-pressed'),rangeFull:UI.pauseMapFull?.getAttribute('aria-pressed'),rangeScale:UI.pauseMapRangeScale?.textContent||'',paused:engine.paused,scenePaused:!!scene.pauseActive,blend:scene.pauseBlend,fov:scene.camera?.fov,clock:UI.pauseMapClock?.textContent,stage:UI.pauseMapStage?.textContent,meta:UI.pauseMapMeta?.textContent,map:pauseMapView?.lastStats||null,canvas:UI.pauseMapCanvas?{width:UI.pauseMapCanvas.width,height:UI.pauseMapCanvas.height}:null};},
setMuted(value){muted=!!value;music.setMuted(muted);if(muted)sound.stop();},disableVoice(){sound.stop();},get music(){return {current:music.current,stopped:music.stopped,muted:music.muted,ducked:music.ducked,transition:music.transition?{...music.transition}:null,stopping:[...music.fadeOuts.keys()],levels:Object.fromEntries(music.levels),ctx:sound.ctx?.state||null,routed:[...music.routes.keys()],tracks:Object.fromEntries([...music.tracks].map(([key,clip])=>{const source=clip.currentSrc||clip.src||'',route=music.routes.get(key);return [key,{paused:clip.paused,time:clip.currentTime,duration:clip.duration,volume:clip.volume,loop:clip.loop,gain:route?route.gain.gain.value:null,src:source.startsWith('data:')?'data:audio/mpeg;base64,':decodeURIComponent(source.split('/').pop()||'')}];}))};},say(text,options){commsSay(text,options);},clearComms(){commsClear();},get comms(){return {active:comms.active?{...comms.active}:null,queue:comms.queue.map(item=>({...item})),visible:!UI.comms.hidden&&UI.comms.classList.contains('is-on'),text:UI.commsText.textContent,edges:[...commsEdges.entries()]};},stats(){return {state:engine.state,stage:engine.stage,jumps:engine.jumps,remaining:engine.remaining,assists:engine.assists,lives:engine.lives,scanHits:engine.scanHits,fillerType:engine.fillerType,rules:engine.rules,player:{position:player.position.slice(),eye:player.eye,yaw:player.yaw,pitch:player.pitch,grounded:player.grounded,portal:player.portal},goIn:engine.goIn,escape:engine.escape,rec:engine.rec,aim:{...engine.aim},frames:frameCount,render:scene.stats(),errors:errors.slice()};}};
requestAnimationFrame(frame);
})();
