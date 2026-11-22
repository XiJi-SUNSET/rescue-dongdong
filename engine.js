/* Pure deterministic simulation; shared by the browser and the Node verification suite. */
(function(root){
'use strict';
const INF=1e12, EPS=1e-7;
const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,s)=>a.map(v=>v*s), len=a=>Math.hypot(...a), unit=a=>mul(a,1/(len(a)||1));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const mod=(a,b)=>(a%b+b)%b, clone=a=>JSON.parse(JSON.stringify(a));
// Aim assist is magnetic, not absolute: a finished look gesture inside this
// cone acquires the recommendation; any new drag releases it.
const SNAP_CAPTURE=7*Math.PI/180, SNAP_ALIGN=0.01;
const WORLD={speed:10,period:10,bells:[{p:[-100,-40,0],phase:9.144966666810449},{p:[106,55,232],phase:6.139885008151582},{p:[400,90,326],phase:2.0779863249481867},{p:[74,-70,-257],phase:4.552022634147379},{p:[382,25,-294],phase:4.341932473123139}]};
// Three 0.2 s input reactions + 0.3/0.2/0.4 s actions. Seal includes 0.4 s margin.
// action is the minimum time the recommendation must stay usable after it opens.
const TIMING={reaction:.2,readyGrace:.8,land:1.7,seal:1.9,action:.5,waveGuard:.03};
const ASSIST_DEFAULTS=Object.freeze({distanceScale:1,snapAim:false,maxLives:1,autoFill:false,autoSwitch:false,autoJump:false});
const ASSIST_REACTION=.14;
// Fixed chapter-entry calibration for 1.4 m spheres (not per-leg phase changes).
// The old zero offset placed the starting sphere inside source 4's wave.
const FIVE_OFFSETS={1:-.4,.5:2.5,.25:1.5,.1:3.5};
function normalizeAssists(obj){
 const input=obj&&typeof obj==='object'&&!Array.isArray(obj)?obj:{};
 const out={...ASSIST_DEFAULTS};
 if([1,.5,.25,.1].includes(input.distanceScale))out.distanceScale=input.distanceScale;
 if([1,3,5,10].includes(input.maxLives))out.maxLives=input.maxLives;
 for(const key of ['snapAim','autoFill','autoSwitch','autoJump'])out[key]=input[key]===true;
 return out;
}
function rulesFor(s){return {start:16000*s,training:1000*s,trainingEnd:15000*s,blueStart:10000*s,silent:6000*s,five:1500*s,referenceJumps:Math.ceil(320*s),fiveStartJumps:Math.ceil(20*s)+Math.ceil(180*s)+Math.ceil(90*s)};}
// A bell with activeAt has no physical history before that instant. The phase
// stays the periodic grid origin, so relative phases and routes do not move.
function activationCycle(b,period){return Number.isFinite(b.activeAt)?Math.ceil((b.activeAt-b.phase-EPS)/period):-Infinity;}
// Legacy centre-arrival helpers remain available. Collision/planning use the sphere helpers below.
function arrivals(p,t,world=WORLD){return world.bells.map((b,i)=>{const base=b.phase+len(sub(p,b.p))/world.speed;const n=Math.max(Math.ceil((t-base+EPS)/world.period),activationCycle(b,world.period));return {t:base+n*world.period,i};}).sort((a,b)=>a.t-b.t);}
function nextHit(p,t,world=WORLD){return arrivals(p,t,world)[0]?.t??INF;}
function waveWindow(p,i,cycle,world=WORLD,radius=1.4){
 const b=world.bells[i],distance=len(sub(p,b.p)),emitted=b.phase+cycle*world.period;
 return {i,cycle,enter:emitted+Math.max(0,distance-radius)/world.speed,exit:emitted+(distance+radius)/world.speed};
}
// Inclusive wave contact, half-open hole lifetime [openedAt, sealedAt).
function waveWindows(p,start,end=start,world=WORLD,radius=1.4){
 if(!world||end<start)return [];
 const out=[];
 world.bells.forEach((b,i)=>{
  const base=waveWindow(p,i,0,world,radius);
  const first=Math.max(Math.ceil((start-base.exit-EPS)/world.period),activationCycle(b,world.period));
  const last=Math.floor((end-base.enter+EPS)/world.period);
  for(let n=first;n<=last;n++)out.push({...waveWindow(p,i,n,world,radius),t:Math.max(start,base.enter+n*world.period)});
 });
 return out.sort((a,b)=>a.t-b.t||a.i-b.i);
}
function nextIntersection(p,t,world=WORLD,radius=1.4){
 if(!world)return null;
 let best=null;
 world.bells.forEach((b,i)=>{
  const base=waveWindow(p,i,0,world,radius),n=Math.max(Math.ceil((t-base.exit-EPS)/world.period),activationCycle(b,world.period));
  const w=waveWindow(p,i,n,world,radius);w.t=Math.max(t,w.enter);
  if(!best||w.t<best.t)best=w;
 });
 return best;
}
function isClear(p,start,end,world=WORLD,radius=1.4){
 if(!world||end<start)return true;
 for(let i=0;i<world.bells.length;i++){
  const b=world.bells[i],base=waveWindow(p,i,0,world,radius);
  const first=Math.max(Math.ceil((start-base.exit-EPS)/world.period),activationCycle(b,world.period));
  const last=Math.floor((end-base.enter+EPS)/world.period);
  if(first<=last)return false;
 }
 return true;
}
function nextEntry(p,t,world,radius){return nextIntersection(p,t,world,radius)?.t??INF;}
function basis(p){const d=unit(mul(p,-1));let right=unit([d[2],0,-d[0]]);if(len(right)<.01)right=[1,0,0];const up=[d[1]*right[2]-d[2]*right[1],d[2]*right[0]-d[0]*right[2],d[0]*right[1]-d[1]*right[0]];return {d,right,up};}
function direction(b,yaw,pitch){return add(add(mul(b.d,Math.cos(yaw)*Math.cos(pitch)),mul(b.right,Math.sin(yaw)*Math.cos(pitch))),mul(b.up,Math.sin(pitch)));}
function makeRays(ys,ps,ds){const rays=[];for(const y of ys)for(const p of ps)for(const d of ds){const yaw=y*Math.PI/180,pitch=p*Math.PI/180;rays.push([Math.cos(yaw)*Math.cos(pitch),Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),d]);}return rays;}
const RAYS=makeRays([-85,-75,-65,-55,-45,-25,0,25,45,55,65,75,85],[-65,-55,-45,-25,0,25,45,55,65],[30,38,46,50,54,58]);
const QUICK_RAYS=makeRays([-65,-35,0,35,65],[-40,0,40],[46,58]);
// Two-hop advice fans. The near fan keeps the suggestion goalward; the wide fan
// exists only to escape a closing front sideways when the near fan is sealed.
const FAN_NEAR={yaws:Array.from({length:17},(_,i)=>-40+i*5),pitches:[-30,-20,-10,0,10,20,30],lengths:[58,50,42,34,26,18]};
const FAN_WIDE={yaws:Array.from({length:17},(_,i)=>-160+i*20),pitches:[-45,-30,-15,0,15,30,45],lengths:[58,46,34,22,12]};
class Planner{
 constructor(world=WORLD,terminalLead=TIMING.reaction,holeRadius=1.4){this.world=world;this.terminalLead=terminalLead;this.holeRadius=holeRadius;this.safeLead=TIMING.reaction+TIMING.seal;this.chainClearance=TIMING.land+.25+TIMING.reaction+TIMING.seal+TIMING.waveGuard;this.calls=0;this.retimes=0;this.lastMs=0;this.expanded=0;}
 pointChoices(a,point,now,deadline){
  const progress=len(a)-len(point),target=len(point)<.1,out=[];
  const end=deadline-this.safeLead;if(end<now+.18)return out;
  // Three oscillation periods hold several safe gaps; older windows only add
  // search cost once a restart pushes the first contact far into the future.
  const horizon=Math.min(end,now+this.world.period*3);
  const times=[now+.25,...waveWindows(point,now,horizon,this.world,this.holeRadius).map(w=>w.exit+.015).slice(0,16)];
  for(const go of times){
   if(go<now+.18||go>end||!isClear(point,go,go,this.world,this.holeRadius))continue;
   const nextB=nextEntry(point,go,this.world,this.holeRadius),window=deadline-go;
   const action=Math.min(nextB,end)-go;
   if(!target&&(nextB-go<this.chainClearance||action<TIMING.action))continue;
   if(target&&nextB-go<this.terminalLead+TIMING.waveGuard)continue;
   const score=progress*.07+Math.min(window,4)*.2+Math.min(nextB-go,10)*.8+(nextB-deadline)*.5-(go-now)*.08-Math.abs(point[1])*.0006+(target?100:0);
   out.push({point,go,nextB,deadline,window,action,distance:len(sub(point,a)),score,target});
  }
  return out;
 }
 // A point is usable only when no front will touch it during the complete
 // open -> fill -> jump -> seal chain. If a front is already inside that lead,
 // wait until it has swept past and check the next gap.
 safeDeparture(point,now,deadline,lead,earliest=now+.25){
  if(!Number.isFinite(lead))lead=this.safeLead;
  const latest=deadline-lead;if(latest<earliest)return null;
  let t=earliest;
  for(let i=0;i<24&&t<=latest;i++){
   const w=nextIntersection(point,t,this.world,this.holeRadius);
   if(!w)return {go:t,nextB:INF};
   if(w.t-t>lead+TIMING.waveGuard)return {go:t,nextB:w.t};
   t=w.exit+.01;
  }
  return null;
 }
 // 0-58 m is selectable in game, so the search samples the whole range inside
 // a cone aimed at the goal. Lateral rays remain available for dodging fronts.
 goalCandidates(a,now,deadline){
  const distance=len(a),out=[],b=basis(a);
  if(distance<=58+EPS)out.push([0,0,0]);
  const yaws=[-40,-20,0,20,40],pitches=[-30,-15,0,15,30],lengths=[58,50,42,34,26,18,10];
  for(const y of yaws){
   const cy=Math.cos(y*Math.PI/180),sy=Math.sin(y*Math.PI/180);
   for(const p of pitches){
    const cp=Math.cos(p*Math.PI/180),sp=Math.sin(p*Math.PI/180);
    for(const d of lengths){
     const point=[a[0]+(b.d[0]*cy*cp+b.right[0]*sy*cp+b.up[0]*sp)*d,a[1]+(b.d[1]*cy*cp+b.right[1]*sy*cp+b.up[1]*sp)*d,a[2]+(b.d[2]*cy*cp+b.right[2]*sy*cp+b.up[2]*sp)*d];
     if(distance-len(point)<2&&len(point)>=.1)continue;
     out.push(point);
    }
   }
  }
  const choices=[];
  for(const point of out){
   const dep=this.safeDeparture(point,now,deadline);if(!dep)continue;
   const target=len(point)<.1,window=dep.nextB-dep.go;
   if(target&&window<this.terminalLead+TIMING.waveGuard)continue;
   if(!target&&window<this.chainClearance)continue;
   choices.push({point,go:dep.go,nextB:dep.nextB,deadline,window,action:Math.min(dep.nextB,deadline-this.safeLead)-dep.go,distance:len(sub(point,a)),score:len(point),target});
  }
  return choices;
 }
 fanRank(c,now){return len(c.point)+(c.go-now)*1.5-Math.min(c.window,8)*3;}
 landingFan(a,now,deadline,grid){
  const b=basis(a),out=[];
  const push=(point,distance)=>{
   const target=len(point)<.1,dep=this.safeDeparture(point,now,deadline);if(!dep)return;
   const window=dep.nextB-dep.go;
   if(target){if(window<this.terminalLead+TIMING.waveGuard)return;}
   else if(window<this.chainClearance)return;
   out.push({point,go:dep.go,nextB:dep.nextB,deadline,window,action:Math.min(dep.nextB,deadline-this.safeLead)-dep.go,distance,score:len(point),target});
  };
  if(len(a)<=58+EPS)push([0,0,0],len(a));
  for(const yaw of grid.yaws){
   const cy=Math.cos(yaw*Math.PI/180),sy=Math.sin(yaw*Math.PI/180);
   for(const pitch of grid.pitches){
    const cp=Math.cos(pitch*Math.PI/180),sp=Math.sin(pitch*Math.PI/180);
    for(const d of grid.lengths){
     push([a[0]+(b.d[0]*cy*cp+b.right[0]*sy*cp+b.up[0]*sp)*d,a[1]+(b.d[1]*cy*cp+b.right[1]*sy*cp+b.up[1]*sp)*d,a[2]+(b.d[2]*cy*cp+b.right[2]*sy*cp+b.up[2]*sp)*d],d);
    }
   }
  }
  return out.sort((x,y)=>this.fanRank(x,now)-this.fanRank(y,now));
 }
 // One safe landing is not enough for a recommendation: the player must also
 // have a safe landing after it. The best such pair wins; the goal counts as a
 // terminal second landing, and one safe hop is kept as a last-resort escape.
 twoHop(a,now,deadline){
  this.calls++;
  let first=this.landingFan(a,now,deadline,FAN_NEAR);
  if(!first.length)first=this.landingFan(a,now,deadline,FAN_WIDE);
  let best=null,fallback=null;
  for(let i=0;i<first.length&&i<24;i++){
   const c1=first[i];
   if(!fallback)fallback=[c1];
   if(c1.target)return [c1];
   const landTime=c1.go+TIMING.land;
   let seconds=this.landingFan(c1.point,landTime,c1.nextB,FAN_NEAR).slice(0,6);
   if(!seconds.length&&i<8)seconds=this.landingFan(c1.point,landTime,c1.nextB,FAN_WIDE).slice(0,6);
   for(const c2 of seconds){
    const rank=this.fanRank(c1,now)+.85*this.fanRank(c2,landTime);
    if(!best||rank<best.rank)best={rank,path:[c1,c2]};
   }
  }
  return best?best.path:fallback;
 }
 candidates(a,now,deadline,quick=false){
  const distance=len(a), b=basis(a), out=[],points=[];
  if(distance<=58+EPS)points.push([0,0,0]);
  for(const ray of quick?QUICK_RAYS:RAYS){
   if(ray[3]>distance+16)continue;const d=Math.min(ray[3],distance),point=[];
   for(let i=0;i<3;i++)point.push(a[i]+(b.d[i]*ray[0]+b.right[i]*ray[1]+b.up[i]*ray[2])*d);
   points.push(point);
  }
  for(const point of points){if(distance-len(point)<2&&len(point)>=.1)continue;out.push(...this.pointChoices(a,point,now,deadline));}
  out.sort((a,b)=>b.score-a.score);return out;
 }
 // No front threatens the straight corridor: walk it greedily at full jump
 // range. This is the common case right after a restart, so it must not pay
 // for a wave-field search.
 straightRoute(a,now,deadline){
  let point=a.slice(),time=now,due=deadline,path=[];
  for(let depth=0;depth<110;depth++){
   const distance=len(point),target=distance<=58+EPS,next=target?[0,0,0]:mul(unit(point),distance-58);
   const dep=this.safeDeparture(next,time,due);if(!dep)return null;
   const window=dep.nextB-dep.go;
   if(target){if(window<this.terminalLead+TIMING.waveGuard)return null;}
   else if(window<this.chainClearance)return null;
   const choice={point:next,go:dep.go,nextB:dep.nextB,deadline:due,window,action:Math.min(dep.nextB,due-this.safeLead)-dep.go,distance:len(sub(next,point)),score:len(next),target};
   path.push(choice);if(target)return path;
   point=next;time=dep.go+TIMING.land;due=dep.nextB;
  }
  return null;
 }
 // The geometry of a cached route is still usable after its first departure
 // window expires. Re-time every hop against the live fronts instead of
 // searching the whole cave again just because the clock moved.
 retimeRoute(route,a,now,deadline){
  if(!route||!route.length)return null;
  let point=a,time=now,due=deadline,out=[];
  for(const c of route){
   if(len(sub(c.point,point))>58+EPS)return null;
   const target=len(c.point)<.1,dep=this.safeDeparture(c.point,time,due);
   if(!dep)return null;
   const window=dep.nextB-dep.go;
   if(target){if(window<this.terminalLead+TIMING.waveGuard)return null;}
   else if(window<this.chainClearance)return null;
   out.push({...c,go:dep.go,nextB:dep.nextB,deadline:due,window,action:Math.min(dep.nextB,due-this.safeLead)-dep.go,distance:len(sub(c.point,point))});
   if(target){this.retimes++;return out;}
   point=c.point;time=dep.go+TIMING.land;due=dep.nextB;
  }
  return null;
 }
 route(a,now,deadline){
  const begin=typeof performance==='object'?performance.now():Date.now();this.calls++;this.expanded=0;
  const direct=this.straightRoute(a,now,deadline);
  if(direct){this.lastMs=(typeof performance==='object'?performance.now():Date.now())-begin;return direct;}
  let beam=[{point:a,time:now,deadline,path:[]}],result=null;
  search:for(let depth=0;depth<110;depth++){
   const pool=[];
   for(const n of beam){
    this.expanded++;
    for(const c of this.goalCandidates(n.point,n.time,n.deadline)){
     const path=n.path.concat([c]);
     if(c.target){result=path;break search;}
     // Waiting is real time: a point that only opens much later is worth less
     // than a slightly longer jump available now. A wide safe gap matters just
     // as much: a node that seals with almost no slack has no room for the next
     // reaction, and greedy progress alone walks into that dead end.
     pool.push({point:c.point,time:c.go+TIMING.land,deadline:c.nextB,path,rank:len(c.point)+(c.go-n.time)*1.5-Math.min(c.window,8)*3});
    }
   }
   pool.sort((a,b)=>a.rank-b.rank);const seen=new Set();beam=[];
   for(const n of pool){const key=n.point.map(v=>Math.round(v/10)).join(',')+','+Math.round(mod(n.time,this.world.period)*4);if(seen.has(key))continue;seen.add(key);beam.push(n);if(beam.length>=18)break;}
   if(!beam.length)break;
  }
  this.lastMs=(typeof performance==='object'?performance.now():Date.now())-begin;return result;
 }
 recommend(a,now,deadline){const route=this.route(a,now,deadline);return route?route[0]:null;}
 validRoute(route,a,now,deadline){
  if(!route||!route.length)return false;
  for(const c of route){
   if(len(sub(c.point,a))>58+EPS||c.go<now-EPS)return false;
   if(c.go+this.safeLead>deadline+EPS||!isClear(a,now,c.go+this.safeLead,this.world,this.holeRadius))return false;
   if(!isClear(c.point,c.go,c.nextB-.001,this.world,this.holeRadius))return false;
   if(Math.abs(nextEntry(c.point,c.go,this.world,this.holeRadius)-c.nextB)>.001)return false;
   if(!c.target&&c.nextB-c.go<this.chainClearance-EPS)return false;
   if(c.target&&c.nextB-c.go<this.terminalLead+TIMING.waveGuard-EPS)return false;
   now=c.go+TIMING.land;a=c.point;deadline=c.nextB;
  }
  return !!route[route.length-1].target;
 }
}
class Engine{
 constructor(options={}){
  this.baseWorld=clone(options.world||WORLD);this.world=clone(this.baseWorld);
  this.holeRadius=Number.isFinite(options.holeRadius)&&options.holeRadius>=0?options.holeRadius:1.4;
  this.planner=new Planner(this.world,options.externalJumpControl?TIMING.land:TIMING.reaction,this.holeRadius);
  this.random=options.random||Math.random;this.onEvent=options.onEvent||(()=>{});this.externalJumpControl=!!options.externalJumpControl;
  this.aim=this.aim.bind(this);this.reset();
 }
 emit(type,data={}){this.onEvent({type,...data});}
 clearAim(){Object.assign(this.aim,{valid:false,point:null,distance:0,go:INF,nextB:INF,window:0,deviation:0,snapped:false});}
 reset(){
  this.assists=normalizeAssists();this.rules=rulesFor(1);this.lives=1;this.scanHits=0;this.fillerType='red';this.packedFillerType=null;
  this.damageKeys=new Set();this.fivePhaseOffset=0;this.singleEpoch=null;this.singleWorld=null;
  this.mode='campaign';this.state='menu';this.time=0;this.elapsed=0;this.jumps=0;this.failures=0;this.pos=[this.rules.start,0,0];
  this.target=null;this.rec=null;this.lowUsed=false;this.pending=[];this.stage='training';this.paused=false;this.yaw=0;this.pitch=0;this.distance=50;this.snapHeld=false;
  this.noPlan=false;this.noPlanReason='';this.lastReason='';this.fast=false;this.lastPlanAt=-INF;this.routePlan=[];this.waveEpoch=null;this.fiveFirstContactAt=INF;this.checkpoint=null;
  this.world=clone(this.baseWorld);this.planner.world=this.world;this.aDeadline=INF;this.singleNext=INF;this.aOpenedAt=0;this.aClosed=false;this.clearTimers();this.clearAim();
 }
 clearAuto(){this.autoAt=INF;this.autoAction=null;}
 clearTimers(){this.sealAt=INF;this.sealBlocked=false;this.transitionAt=INF;this.packAt=INF;this.jumpAt=INF;this.lowEnd=INF;this.lowWarned=false;this.activeLow=false;this.packedFillerType=null;this.clearAuto();}
 start(mode='campaign',save=null,assists=ASSIST_DEFAULTS){
  this.reset();this.mode=mode;this.assists=normalizeAssists(save?save.assists:assists);this.rules=rulesFor(mode==='tutorial'?1:this.assists.distanceScale);
  this.lives=this.assists.maxLives;this.pos=[mode==='tutorial'?16000:this.rules.start,0,0];this.fillerType=this.requiredFiller;
  if(save){
   this.pos=save.pos.slice();this.jumps=save.jumps;this.lowUsed=!!save.lowUsed;this.elapsed=save.elapsed||0;this.stage=save.stage;this.failures=save.failures||0;
   this.time=save.time||0;this.pending=clone(save.pending||[]);this.routePlan=clone(save.routePlan||[]);
   this.lives=Number.isInteger(save.lives)?Math.max(0,Math.min(this.assists.maxLives,save.lives)):this.assists.maxLives;
   this.scanHits=Number.isSafeInteger(save.scanHits)&&save.scanHits>=0?save.scanHits:0;
   this.fillerType=['red','blue'].includes(save.fillerType)?save.fillerType:this.requiredFiller;
   this.fivePhaseOffset=Number.isFinite(save.fivePhaseOffset)?save.fivePhaseOffset:0;
   this.singleEpoch=save.singleEpoch??null;this.singleWorld=save.singleWorld?clone(save.singleWorld):null;
   if(save.world){this.world=clone(save.world);this.waveEpoch=save.waveEpoch??(this.stage==='five'?0:null);}
   this.fiveFirstContactAt=Number.isFinite(save.fiveFirstContactAt)?save.fiveFirstContactAt:this.stage==='five'?this.time:INF;
   this.damageKeys=new Set(save.damageKeys||[]);
  }else if(mode==='five'){this.pos=[this.rules.five,0,0];this.jumps=this.rules.fiveStartJumps;this.stage='five';}
  if(save&&!(save.engineVersion>=5)&&this.stage==='single'&&this.remaining>this.rules.trainingEnd+EPS&&mode!=='five')this.stage='training';
  this.state='wait';this.aOpenedAt=save?.aOpenedAt??this.time;
  const trainingBoundary=this.stage==='training'&&this.remaining<=this.rules.trainingEnd+EPS;
  if(trainingBoundary&&mode!=='tutorial')this.stage='single';
  if(this.stage==='single')this.enterSingle(save);
  if(this.stage==='five'&&this.waveEpoch===null)this.initializeFive();
  this.planner.world=this.scanWorld||this.world;
  if(this.noScan){this.pending=[];this.routePlan=[];}
  if(trainingBoundary&&mode==='tutorial'){this.state='tutorial-done';this.rec=null;this.clearAim();}
  else this.setupLeg();
  // Version 6 stores physical state, not a time-rewinding safe-leg substitution.
  if(save?.engineVersion>=6&&save.state&&save.state!=='menu'){
   for(const key of ['state','aOpenedAt','aClosed','sealAt','sealBlocked','transitionAt','packAt','jumpAt','lowEnd','lowWarned','openedAt','leftAt','packedFillerType','yaw','pitch','distance','lastReason','autoAt','autoAction'])if(save[key]!==undefined)this[key]=save[key];
   this.target=save.target?clone(save.target):null;
   this.rec=save.rec?clone(save.rec):this.rec;
   this.routePlan=clone(save.routePlan||[]);this.noPlan=!this.rec;this.refreshDeadlines();if(!save.rec&&this.rec&&['wait','ready'].includes(this.state))this.distance=this.rec.distance;this.aimTarget();
  }
  if(this.lives===0)this.state='failed';
  this.checkpoint=this.exportSave();this.emit('start',{mode});
 }
 exportSave(){
  const data={version:2,engineVersion:6,mode:this.mode,pos:this.pos.slice(),jumps:this.jumps,stage:this.stage,elapsed:this.elapsed,time:this.time,aDeadline:this.aDeadline,singleNext:this.singleNext,pending:clone(this.pending),routePlan:clone(this.routePlan),world:clone(this.world),waveEpoch:this.waveEpoch,singleWorld:clone(this.singleWorld),singleEpoch:this.singleEpoch,fiveFirstContactAt:this.fiveFirstContactAt,damageKeys:[...this.damageKeys],target:clone(this.target),rec:clone(this.rec),lowUsed:this.lowUsed,failures:this.failures,assists:clone(this.assists),rules:clone(this.rules),lives:this.lives,scanHits:this.scanHits,fillerType:this.fillerType,fivePhaseOffset:this.fivePhaseOffset};
  for(const key of ['state','aOpenedAt','aClosed','sealAt','sealBlocked','transitionAt','packAt','jumpAt','lowEnd','lowWarned','openedAt','leftAt','packedFillerType','yaw','pitch','distance','lastReason','autoAt','autoAction'])if(this[key]!==undefined)data[key]=this[key];
  return data;
 }
 enterSingle(save=null){
  if(!this.singleWorld){
   this.singleEpoch=this.time;
   const p=this.baseWorld.bells[0].p.slice();
   // Old saves only knew the absolute A-centre deadline. Preserve that phase,
   // not a newly granted ten seconds; new chapter entries get one initial epoch.
   const legacy=save&&Number.isFinite(save.aDeadline)&&save.aDeadline<INF;
   const centre=legacy?save.aDeadline:this.time+10;
   this.singleWorld={speed:10,period:20,bells:[{p,phase:centre-len(sub(this.pos,p))/10}]};
  }
  this.world=this.singleWorld;this.planner.world=this.world;
 }
 initializeFive(){
  this.waveEpoch=this.time;this.fivePhaseOffset=FIVE_OFFSETS[this.assists.distanceScale];this.world=clone(this.baseWorld);
  this.world.bells.forEach((b,i)=>{
   b.phase+=this.waveEpoch+this.fivePhaseOffset;
   // The original bell is first. Each newly installed bell waits one full
   // oscillation before its first emission, so the restart is audible as a
   // sequence instead of five fronts already sitting in the cave.
   b.activeAt=b.phase+(i>0?this.world.period:0);
  });
  this.planner.world=this.world;
  this.fiveFirstContactAt=nextIntersection(this.pos,this.time,this.world,this.holeRadius)?.t??INF;
 }
 enterFive(){this.stage='five';if(this.waveEpoch===null)this.initializeFive();this.routePlan=[];this.distance=50;this.setupLeg();this.emit('five');}
 get fiveOnline(){return this.stage==='five'?this.world.bells.filter(b=>!Number.isFinite(b.activeAt)||b.activeAt<=this.time+EPS).length:0;}
 get fiveNextOnline(){if(this.stage!=='five')return INF;let next=INF;for(const b of this.world.bells)if(Number.isFinite(b.activeAt)&&b.activeAt>this.time+EPS)next=Math.min(next,b.activeAt);return next;}
 get fiveWaveArrived(){return this.stage==='five'&&Number.isFinite(this.fiveFirstContactAt)&&this.time+EPS>=this.fiveFirstContactAt;}
 get scanWorld(){return this.noScan?null:this.stage==='single'?this.singleWorld:this.stage==='five'?this.world:null;}
 scanWindows(point,start=this.time,end=start){return waveWindows(point,start,end,this.scanWorld,this.holeRadius);}
 nextScan(point,from=this.time){return nextIntersection(point,from,this.scanWorld,this.holeRadius);}
 refreshDeadlines(){
  this.aDeadline=this.aClosed?INF:(this.nextScan(this.pos)?.t??INF);this.singleNext=this.aDeadline;
  if(this.target)this.target.nextB=this.nextScan(this.target.point)?.t??INF;
 }
 planFive(){
  const begin=typeof performance==='object'?performance.now():Date.now();
  this.routePlan=this.planner.twoHop(this.pos,this.time,this.aDeadline)||[];
  this.planner.lastMs=(typeof performance==='object'?performance.now():Date.now())-begin;
  this.lastPlanAt=this.time;this.rec=this.routePlan[0]||null;this.noPlan=!this.rec;
  this.noPlanReason=this.noPlan?(this.aDeadline-this.time<this.planner.safeLead-EPS?'deadline':'window'):'';
 }
 planSingle(keepDistance=false){
  const d=Math.min(50,Math.max(25,this.remaining-this.rules.silent)),point=mul(unit(this.pos),Math.max(0,this.remaining-d));
  const keep=keepDistance&&Number.isFinite(this.distance);
  this.distance=keep?Math.max(0,Math.min(58,this.distance)):d;
  let choices=this.planner.pointChoices(this.pos,point,this.time,this.aDeadline).sort((a,b)=>b.score-a.score);
  if(!choices.length){
   // No window on the straight-ahead landing: search the live 3D ray fan
   // instead, still judged against the current wave state and deadline.
   choices=this.planner.candidates(this.pos,this.time,this.aDeadline,true)
    .filter(c=>c.target||(c.distance>=18&&len(c.point)<len(this.pos)-.5)).sort((a,b)=>b.score-a.score);
   if(choices.length&&!keep)this.distance=Math.max(0,Math.min(58,choices[0].distance));
  }
  this.rec=choices[0]||null;this.noPlan=!this.rec;
  this.noPlanReason=this.noPlan?(this.aDeadline-this.time<this.planner.safeLead-EPS?'deadline':'window'):'';
 }
 setupLeg(keepDistance=false,freshPlan=false){
  this.state='wait';this.target=null;this.clearTimers();this.aClosed=false;
  if(this.stage==='single')this.enterSingle();this.refreshDeadlines();
  if(this.assists.autoSwitch)this.fillerType=this.requiredFiller;
  if(this.stage==='five'){
   this.planFive(freshPlan);
   if(!Number.isFinite(this.distance))this.distance=50;
   this.distance=Math.max(0,Math.min(58,this.distance));
  }else if(this.noScan){
   const boundary=this.stage==='training'?this.rules.trainingEnd:this.rules.five;
   // The boundary waypoint must stay a real forward jump. Without a minimum
   // lead it shrinks to centimetres as the player lands on the chapter edge,
   // and a zero-length recommendation puts its rings around the camera.
   const d=Math.min(50,Math.max(8,this.remaining-boundary));
   if(!keepDistance||!Number.isFinite(this.distance))this.distance=d;
   this.distance=Math.max(0,Math.min(58,this.distance));
   const point=mul(unit(this.pos),Math.max(0,this.remaining-d));
   this.rec={point,go:this.time,nextB:INF,deadline:INF,window:INF,distance:d};
   this.pending=[];this.noPlan=false;this.noPlanReason='';
  }else this.planSingle(keepDistance);
  this.snapHeld=false;this.yaw=0;this.pitch=0;this.aimTarget();this.checkpoint=this.exportSave();this.emit('leg');
 }
 aim(yaw,pitch,distance){
  if(this.paused||!['wait','ready'].includes(this.state)||![yaw,pitch,distance].every(Number.isFinite))return;
  this.yaw=yaw;this.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,pitch));this.distance=Math.max(0,Math.min(58,distance));
  this.snapHeld=false;this.aimTarget();
 }
 // Called after a look gesture ends, never on every drag sample: pointing near
 // the recommendation acquires it, while an ongoing drag stays fully manual.
 settleSnap(){
  if(!this.assists.snapAim||!this.rec||!['wait','ready'].includes(this.state))return false;
  if(len(sub(this.rec.point,this.pos))<.1)return false;
  // aimTarget builds the ray in the recommendation's frame, so yaw/pitch zero
  // already points at rec and the angular miss is cos(yaw)*cos(pitch).
  const angle=Math.acos(Math.max(-1,Math.min(1,Math.cos(this.yaw)*Math.cos(this.pitch))));
  if(angle>SNAP_CAPTURE)return false;
  this.yaw=0;this.pitch=0;this.distance=this.rec.distance;this.snapHeld=true;this.aimTarget();return true;
 }
 aimTarget(){
  const reference=this.rec?.point,b=basis(this.pos);
  const d=reference?unit(sub(reference,this.pos)):b.d;
  let right=unit([d[2],0,-d[0]]);if(len(right)<.1)right=[0,0,1];
  const up=[d[1]*right[2]-d[2]*right[1],d[2]*right[0]-d[0]*right[2],d[0]*right[1]-d[1]*right[0]];
  const aligned=!!reference&&Math.acos(Math.max(-1,Math.min(1,Math.cos(this.yaw)*Math.cos(this.pitch))))<SNAP_ALIGN;
  if(this.snapHeld&&!aligned)this.snapHeld=false;
  const snapped=this.assists.snapAim&&aligned&&this.snapHeld;
  if(snapped)this.distance=this.rec.distance;
  const ray=direction({d,right,up},this.yaw,this.pitch),point=add(this.pos,mul(ray,this.distance));
  const deviation=reference?len(sub(point,reference)):0;
  let go=INF,nextB=this.nextScan(point)?.t??INF;
  if(this.noScan)go=this.time;
  else if(reference&&deviation<.001){go=this.rec.go;nextB=this.rec.nextB;}
  else {const choices=this.planner.pointChoices(this.pos,point,this.time,this.aDeadline).sort((a,b)=>b.score-a.score);if(choices.length){go=choices[0].go;nextB=choices[0].nextB;}}
  // valid means a physical target, NOT that the advisor found a safe route.
  Object.assign(this.aim,{valid:this.distance>EPS&&this.distance<=58+EPS&&point.every(Number.isFinite),point,go,nextB,distance:len(sub(point,this.pos)),window:Math.max(0,this.aDeadline-go),deviation,snapped});
 }
 open(){
  if(this.paused)return;
  if(!['wait','ready'].includes(this.state)){this.emit('hint',{text:'当前动作尚未结束，不能重复开门。'});return;}
  if(!this.aim.valid||!this.aim.point||this.aim.distance<=EPS||this.aim.distance>58+EPS){this.emit('hint',{text:'请选择 58 米内的有效开洞位置。'});return;}
  this.target={point:this.aim.point.slice(),go:this.time,openedAt:this.time,nextB:this.aim.nextB,distance:this.aim.distance,window:this.aim.window,deviation:this.aim.deviation};
  this.state='forming';this.transitionAt=this.time+.3;this.openedAt=this.time;this.emit('open');
  // No grace: a front already inside the newly created sphere detects it now.
  if(!this.processScans())return;
  if(!this.externalJumpControl&&this.stage==='five'&&len(this.target.point)<.1){this.jumps++;this.pos=[0,0,0];this.win();}
 }
 get noScan(){return this.stage==='training'||this.stage==='silent';}
 // Bags follow the rock the route is currently crossing, not the story stage:
 // outer red 16-10 km, blue 10-6 km, inner red 6-0 km (all scale together).
 get requiredFiller(){return this.remaining>this.rules.blueStart+EPS?'red':this.remaining>this.rules.silent+EPS?'blue':'red';}
 get geology(){
  const r=this.rules,remaining=this.remaining;
  const bands=[
   {id:'outer-red',filler:'red',from:r.blueStart,to:r.start},
   {id:'blue',filler:'blue',from:r.silent,to:r.blueStart},
   {id:'inner-red',filler:'red',from:0,to:r.silent}
  ];
  const current=remaining>r.blueStart+EPS?'outer-red':remaining>r.silent+EPS?'blue':'inner-red';
  return {bands,current,requiredFiller:this.requiredFiller,carriedFiller:this.fillerType};
 }
 selectFiller(type){
  if(this.paused||!['wait','ready','forming','portal','packed','low'].includes(this.state)||!['red','blue'].includes(type))return false;
  this.fillerType=type;this.syncAutomation();return true;
 }
 syncAutomation(){
  if(this.paused)return;
  let action=null;
  if(this.state==='portal'&&!this.noScan&&this.assists.autoFill){if(this.assists.autoSwitch)this.fillerType=this.requiredFiller;if(this.fillerType===this.requiredFiller)action='fill';}
  if(!this.externalJumpControl&&this.assists.autoJump&&(this.state==='portal'&&this.noScan||this.state==='packed'&&this.packedFillerType===this.requiredFiller))action='jump';
  if(action!==this.autoAction){this.clearAuto();if(action){this.autoAction=action;this.autoAt=this.time+ASSIST_REACTION;}}
 }
 fill(){
  if(this.paused)return;
  if(this.state!=='portal'){this.emit('hint',{text:this.state==='forming'?'小黑正在开门，稍等。':'门打开后才能丢填充物。'});return;}
  if(this.noScan){this.emit('hint',{text:this.stage==='training'?'尚未进入探测范围，不必丢填充物，直接跳。':'扫描静默，不必丢填充物，直接跳。'});return;}
  if(this.assists.autoSwitch)this.fillerType=this.requiredFiller;
  if(this.fillerType!==this.requiredFiller){const blue=this.requiredFiller==='blue';this.emit('hint',{text:`此处是${blue?'金刚岩':'纹白岩'}，需要${blue?'蓝袋':'红袋'}填充物，请按 ${blue?'2':'1'} 切换。`});return;}
  this.clearAuto();this.packedFillerType=this.fillerType;this.state='throwing';this.packAt=this.time+.2;this.sealAt=this.packAt+1;this.sealBlocked=false;this.emit('fill');
 }
 jump(key='ArrowUp',travelTime=.4){
  if(this.paused)return;
  if(!['portal','packed','throwing'].includes(this.state)){this.emit('hint',{text:'等传送门打开，再跳入门。'});return;}
  if(key!==this.jumpKey()){this.emit('hint',{text:'朝门的方向跳：请按 '+({ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[this.jumpKey()])});return;}
  if(this.state==='throwing'){this.emit('hint',{text:'填充物正在落下。'});return;}
  this.clearAuto();this.leftAt=this.time;this.state='jumping';this.jumpAt=this.time+Math.max(.04,Math.min(.4,Number.isFinite(travelTime)?travelTime:.4));this.processClosures();this.emit('jump');
 }
 jumpKey(){if(this.yaw>.12)return 'ArrowRight';if(this.yaw<-.12)return 'ArrowLeft';return this.pitch<-.16?'ArrowDown':'ArrowUp';}
 repair(){if(this.paused||this.state!=='low')return;this.state='falling';this.transitionAt=this.time+1;this.emit('repair');}
 fail(reason){if(['failed','won','menu'].includes(this.state))return;this.clearAuto();this.state='failed';this.lastReason=reason;this.failures++;this.emit('fail',{reason});}
 win(){this.clearAuto();this.state='won';this.emit('win');}
 retry(){
  // A retry is a physical-state reload, never a clock/phase/life rollback. With
  // no lives left only an explicitly new run can resume play.
  const save=this.exportSave();this.start(this.mode,save);this.emit('retry');
 }
 land(){
  if(!this.noScan&&!this.aClosed)this.pending.push({point:this.pos.slice(),openedAt:this.aOpenedAt,sealAt:this.sealAt});
  // Every landing starts a new leg from the actual point the player reached.
  // Keep only the remaining cached path when the landing really was the
  // recommendation; never re-label an off-route landing as the old plan.
  if(this.stage==='five'){
   if(this.routePlan[0]&&len(sub(this.routePlan[0].point,this.target.point))<.001)this.routePlan.shift();
   else this.routePlan=[];
  }
  this.pos=this.target.point.slice();this.aOpenedAt=this.target.openedAt;this.aClosed=false;this.jumps++;this.emit('land');
  if(this.stage==='five'&&len(this.pos)<.1){this.win();return;}
  if(this.stage==='training'&&this.remaining<=this.rules.trainingEnd+EPS){
   if(this.mode==='tutorial'){
    this.state='tutorial-done';this.target=null;this.rec=null;this.clearTimers();this.clearAim();this.checkpoint=this.exportSave();this.emit('tutorialDone');
   }else {this.stage='single';this.enterSingle();this.setupLeg();this.emit('trainingDone');}
   return;
  }
  if(this.stage==='single'&&this.remaining<=this.rules.silent+.1){this.stage='silent';this.state='interlude';this.target=null;this.transitionAt=this.time+5;this.pending=[];this.refreshDeadlines();this.checkpoint=this.exportSave();this.emit('silence');return;}
  if(this.stage==='silent'&&this.remaining<=this.rules.five+.1){this.pending=[];this.enterFive();this.checkpoint=this.exportSave();return;}
  this.setupLeg(true,true);
 }
 get inA(){return ['wait','ready','forming','portal','throwing','packed'].includes(this.state);}
 processClosures(){
  this.pending=this.pending.filter(p=>p.sealAt>this.time+EPS);
  if(!this.aClosed&&this.sealAt<=this.time+EPS){
   if(this.inA){if(!this.sealBlocked){this.sealBlocked=true;this.emit('hint',{text:'仍在旧洞内，填充被阻塞；离开后才能封闭，扫描暴露持续。'});}}
   else {this.aClosed=true;this.sealBlocked=false;this.emit('sealed',{point:this.pos.slice()});}
  }
 }
 activeHoles(){
  if(!this.scanWorld)return [];
  const holes=this.pending.map(p=>({...p,kind:'old'}));
  if(!this.aClosed)holes.push({point:this.pos,openedAt:this.aOpenedAt,kind:'A'});
  if(this.target)holes.push({point:this.target.point,openedAt:this.target.openedAt??this.openedAt??this.time,kind:'B'});
  return holes;
 }
 // Physical hole inventory for the pause map. Unlike activeHoles() this is not
 // gated on an active scan world: the safe chapter still has real holes, it just
 // has no waves to judge them against. Untracked first-chamber space is not
 // reported as a hole until the player has actually jumped and left one behind.
 worldHoles(){
  const holes=this.pending.filter(p=>p.sealAt>this.time+EPS).map(p=>({point:p.point.slice(),radius:this.holeRadius,kind:'old',openedAt:p.openedAt,sealAt:p.sealAt}));
  const hasA=(Number(this.jumps)||0)>0||this.stage!=='training';
  if(hasA&&!this.aClosed)holes.push({point:this.pos.slice(),radius:this.holeRadius,kind:'A',openedAt:this.aOpenedAt});
  if(this.target)holes.push({point:this.target.point.slice(),radius:this.holeRadius,kind:'B',openedAt:this.target.openedAt??this.openedAt??this.time});
  return holes;
 }
 fieldStandbyWorld(){
  if(this.singleWorld)return this.singleWorld;
  const bell=this.baseWorld.bells[0];
  return {speed:10,period:20,bells:[{p:bell.p.slice(),phase:bell.phase}]};
 }
 // Frozen snapshot for the paused 2D render. Wave shells are returned as exact
 // radii at this.time; the map intersects those spheres with its horizontal
 // plane. Sealed holes are already absent from worldHoles().
 pauseSnapshot({radius=80,planeY=this.pos[1],fieldRadius=this.rules.trainingEnd}={}){
  const scan=this.scanWorld,centre=this.pos;
  // The sensing field is a fixed disc around the goal, not a bubble around
  // the player. It keeps its fronts while the player is still training outside.
  const fieldCentre=[0,0,0],field=Math.max(radius,Number.isFinite(fieldRadius)?fieldRadius:this.rules.trainingEnd);
  const fieldScan=scan||(this.stage==='training'?this.fieldStandbyWorld():null);
  const waves=[];
  if(scan)scan.bells.forEach((b,i)=>{
   const dy=planeY-b.p[1],horizontal=Math.hypot(b.p[0]-centre[0],b.p[2]-centre[2]);
   const lower=Math.hypot(dy,Math.max(0,horizontal-radius));
   const upper=Math.hypot(dy,horizontal+radius);
   const newest=Math.floor((this.time-b.phase)/scan.period),oldest=Math.max(activationCycle(b,scan.period),newest-1000);
   for(let cycle=newest;cycle>=oldest;cycle--){
    const r=scan.speed*(this.time-(b.phase+cycle*scan.period));
    if(r>upper)break;
    if(r>=lower)waves.push({bell:i,cycle,source:b.p.slice(),radius:r,planeRadius:Math.sqrt(Math.max(0,r*r-dy*dy))});
   }
  });
  // Whole-field cross-sections: every front whose horizontal circle crosses
  // the sensing-field disc around the goal, not just the local survey bubble.
  // Radii are still exact at this.time; no live front is synthesised.
  const fieldWaves=[];
  if(fieldScan)fieldScan.bells.forEach((b,i)=>{
   const dg=Math.hypot(b.p[0]-fieldCentre[0],b.p[2]-fieldCentre[2]),dy=planeY-b.p[1];
   const near=Math.max(0,dg-field),far=dg+field;
   const lower=Math.hypot(dy,near),upper=Math.hypot(dy,far);
   const spacing=Math.max(.001,fieldScan.speed*fieldScan.period),newest=Math.floor((this.time-b.phase)/fieldScan.period);
   const oldest=Math.max(activationCycle(b,fieldScan.period),newest-Math.ceil(upper/spacing)-2);
   for(let cycle=newest;cycle>=oldest;cycle--){
    const r=fieldScan.speed*(this.time-(b.phase+cycle*fieldScan.period));
    if(r<lower)continue;
    if(r>upper)break;
    const planeRadius=Math.sqrt(Math.max(0,r*r-dy*dy));
    if(planeRadius<near-EPS)continue;
    fieldWaves.push({bell:i,cycle,source:b.p.slice(),radius:r,planeRadius});
   }
  });
  // Third stage: every real spherical front that cuts the 3D survey sphere.
  // The 2D plane cross-sections above stay untouched for the other chapters.
  const shells=[];
  if(scan&&this.stage==='five')scan.bells.forEach((b,i)=>{
   const d=Math.hypot(b.p[0]-centre[0],b.p[1]-centre[1],b.p[2]-centre[2]);
   const lower=Math.max(0,d-radius),upper=d+radius,newest=Math.floor((this.time-b.phase)/scan.period),oldest=Math.max(activationCycle(b,scan.period),newest-1000);
   for(let cycle=newest;cycle>=oldest;cycle--){
    const r=scan.speed*(this.time-(b.phase+cycle*scan.period));
    if(r>upper)break;
    if(r>=lower)shells.push({bell:i,cycle,source:b.p.slice(),radius:r,distance:d});
   }
  });
  return {
   time:this.time,stage:this.stage,state:this.state,planeY,radius,
   centre:centre.slice(),holeRadius:this.holeRadius,
   scan:scan?{speed:scan.speed,period:scan.period,bells:scan.bells.map(b=>({p:b.p.slice(),phase:b.phase,activeAt:Number.isFinite(b.activeAt)?b.activeAt:null}))}:null,
   holes:this.worldHoles(),
   goal:{point:[0,0,0],distance:this.remaining},
   rec:this.rec?{point:this.rec.point.slice(),go:this.rec.go,nextB:this.rec.nextB,distance:this.rec.distance}:null,
   geology:this.geology,
   field:{point:fieldCentre.slice(),radius:field},
   fieldRadius:field,
   fieldPreview:Boolean(fieldScan&&!scan),
   waves,fieldWaves,shells
  };
 }
 waveKey(w){return `${this.stage}:${w.i}:${w.cycle}`;}
 processScans(){
  if(this.noScan)return true;
  this.processClosures();
  for(const hole of this.activeHoles()){
   if(hole.openedAt>this.time+EPS)continue;
   for(const w of this.scanWindows(hole.point)){
    const key=this.waveKey(w);if(this.damageKeys.has(key))continue;
    this.damageKeys.add(key);this.scanHits++;this.lives=Math.max(0,this.lives-1);
    const reason=hole.kind==='old'?'来路没有封住：扫描波发现了旧洞 A。':hole.kind==='B'?'扫描波与新洞 B 相交。':'扫描波与当前洞 A 相交。';
    this.emit('scanHit',{lives:this.lives,reason,point:hole.point.slice(),source:w.i,cycle:w.cycle,enter:w.enter,exit:w.exit});
    if(this.lives===0){this.fail(reason);return false;}
   }
  }
  this.refreshDeadlines();return true;
 }
 nextPhysicalEvent(){
  let next=INF;const world=this.scanWorld;if(!world)return next;
  for(const hole of this.activeHoles())world.bells.forEach((b,i)=>{
   const base=waveWindow(hole.point,i,0,world,this.holeRadius),first=activationCycle(b,world.period);
   const n=Math.max(Math.floor((this.time-base.enter+EPS)/world.period)+1,first);
   const exitCycle=Math.max(Math.floor((this.time-base.exit-EPS*2)/world.period)+1,first);
   next=Math.min(next,base.enter+n*world.period,base.exit+exitCycle*world.period+EPS*4);
  });
  return next;
 }
 processEvents(){
  if(!this.processScans())return;
  if(this.state==='interlude'){if(this.time+EPS>=this.transitionAt){this.setupLeg();this.emit('continue');}return;}
  if(['wait','ready'].includes(this.state)&&!this.noScan&&((this.rec&&this.time>this.rec.go+TIMING.readyGrace+EPS)||(!this.rec&&this.time>this.lastPlanAt+1))){
   // Preserve the physical aim when advice expires. Replanning must not steer a
   // manual shot; the magnetic assist re-acquires only on the next input.
   const oldPoint=this.aim.point?.slice();this.snapHeld=false;
   if(this.stage==='five')this.planFive(true);else {this.planSingle();this.lastPlanAt=this.time;}
   if(oldPoint)this.retainAim(oldPoint);else this.aimTarget();this.state='wait';
  }
  if(this.state==='wait'&&this.aim.valid&&this.aim.go<INF&&this.time+EPS>=this.aim.go){this.state='ready';this.emit('go',{window:this.aim.window});}
  if(this.state==='forming'&&this.time+EPS>=this.transitionAt){this.state='portal';this.emit('portal');}
  if(this.state==='throwing'&&this.time+EPS>=this.packAt){this.state='packed';this.emit('packed');}
  if(this.state==='jumping'&&this.time+EPS>=this.jumpAt){
   const protectedWindow=Math.min(this.aClosed?INF:this.aDeadline,this.target.nextB)-this.time;
   let low=!this.noScan&&!this.lowUsed&&len(this.target.point)>58&&protectedWindow>=2.5+EPS&&this.random()<.01;
   if(low&&this.stage==='five'){
    let suffix=this.routePlan[0]&&len(sub(this.routePlan[0].point,this.target.point))<.001?this.routePlan.slice(1):[];
    if(!this.planner.validRoute(suffix,this.target.point,this.time+2.5,this.target.nextB))suffix=this.planner.route(this.target.point,this.time+2.5,this.target.nextB);
    if(suffix&&suffix.length)this.routePlan=[this.target,...suffix];else low=false;
   }
   if(low){this.lowUsed=true;this.state='low';this.lowEnd=this.time+1.5;this.emit('low');}else this.land();
  }
  if(this.state==='low'&&!this.lowWarned&&this.time+EPS>=this.lowEnd){this.lowWarned=true;this.emit('hint',{text:'补洞已延误，新洞仍暴露在扫描中；请尽快补洞。'});}
  if(this.state==='falling'&&this.time+EPS>=this.transitionAt)this.land();
  this.syncAutomation();
  if(this.autoAt<=this.time+EPS){const action=this.autoAction;this.clearAuto();if(action==='fill')this.fill();else if(action==='jump')this.jump(this.jumpKey());}
 }
 retainAim(point){
  const ray=unit(sub(point,this.pos)),d=this.rec?unit(sub(this.rec.point,this.pos)):basis(this.pos).d;
  let right=unit([d[2],0,-d[0]]);if(len(right)<.1)right=[0,0,1];
  const up=[d[1]*right[2]-d[2]*right[1],d[2]*right[0]-d[0]*right[2],d[0]*right[1]-d[1]*right[0]];
  this.yaw=Math.atan2(dot(ray,right),dot(ray,d));this.pitch=Math.asin(Math.max(-1,Math.min(1,dot(ray,up))));this.distance=len(sub(point,this.pos));this.snapHeld=false;this.aimTarget();
 }
 tick(dt){
  if(this.paused||!Number.isFinite(dt)||dt<=0||['menu','failed','won','tutorial-done'].includes(this.state))return;
  this.syncAutomation();
  if(this.fast&&this.stage!=='five'&&this.state==='wait'&&this.aim.valid&&this.aim.go<INF&&this.aim.go-this.time>4.1)dt=Math.min(dt*8,this.aim.go-this.time-4.05);
  const end=this.time+dt;this.processEvents();
  // Integrate every physical intersection and closure, including dropped frames.
  while(this.time<end-EPS&&!this.paused&&!['failed','won','tutorial-done'].includes(this.state)){
   const events=[end,this.nextPhysicalEvent(),this.sealAt,...this.pending.map(p=>p.sealAt)];
   if(this.state==='interlude')events.push(this.transitionAt);
   else {
    if(this.state==='wait'&&this.aim.valid&&this.aim.go<INF)events.push(this.aim.go);
    if(['wait','ready'].includes(this.state)&&!this.noScan&&this.rec)events.push(this.rec.go+TIMING.readyGrace+EPS*4);
    if(['forming','falling'].includes(this.state))events.push(this.transitionAt);
    if(this.state==='throwing')events.push(this.packAt);
    if(this.state==='jumping')events.push(this.jumpAt);
    if(this.state==='low'&&!this.lowWarned)events.push(this.lowEnd);
    if(this.autoAction)events.push(this.autoAt);
   }
   const next=Math.min(...events.filter(t=>t>this.time+EPS)),step=next-this.time;
   this.time=next;this.elapsed+=step;this.processEvents();
  }
 }
 get remaining(){return len(this.pos);}
 get goIn(){return this.aim.valid?Math.max(0,this.aim.go-this.time):INF;}
 get escape(){return Math.max(0,this.aDeadline-this.time);}
}
const API={Engine,Planner,WORLD,TIMING,ASSIST_DEFAULTS,normalizeAssists,arrivals,nextHit,waveWindow,waveWindows,nextIntersection,isClear,add,sub,mul,len,unit,basis,direction};
if(typeof module==='object'&&module.exports)module.exports=API;else root.Rescue=API;
})(typeof window==='object'?window:globalThis);
