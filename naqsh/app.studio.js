import * as THREE from './three.module.js';
const $=s=>document.querySelector(s),canvas=$('#scene');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});}catch(e){$('#error').hidden=false;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xf4ebe2,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,1,5000);camera.position.z=2200;
scene.add(new THREE.HemisphereLight(0xffffff,0xa9a087,1.3));const light=new THREE.DirectionalLight(0xffffff,1.7);light.position.set(-400,650,1100);scene.add(light);

// Ornaments in the study. Each file is a list of [x, y, r, g, b] tiles in reference-image pixels.
// `tile` scales the tile face for ornaments drawn on a coarser grid; `swatches` feed the footer palette.
const ORNAMENTS=[
  {file:'tiles.json?v=palette-7',  name:'Square medallion',tile:1,  swatches:['#1f30a6','#00b4b3','#a0dbca','#fae3c5']},
  {file:'tiles-2.json?v=palette-7',name:'Star rosette',    tile:1,  swatches:['#1f30a6','#3671b8','#00b4b3','#fae3c5']},
  {file:'tiles-3.json?v=palette-7',name:'Girih panel',     tile:1.1,swatches:['#3c1407','#e7c6a2','#f6d6ae','#ead7c1']},
];
const sets=await Promise.all(ORNAMENTS.map(o=>fetch('./'+o.file).then(r=>{if(!r.ok)throw Error('Tile data unavailable');return r.json();})));
// Order every set top-to-bottom, so a tile's next home lies in a similar band of the composition.
sets.forEach(s=>s.sort((a,b)=>a[1]-b[1]||a[0]-b[0]));
const MAX=Math.max(...sets.map(s=>s.length));

// A bevelled extruded face catches light without flattening the square silhouette.
const shape=new THREE.Shape();const size=12.5,r=.7;shape.moveTo(-size/2+r,-size/2);shape.lineTo(size/2-r,-size/2);shape.quadraticCurveTo(size/2,-size/2,size/2,-size/2+r);shape.lineTo(size/2,size/2-r);shape.quadraticCurveTo(size/2,size/2,size/2-r,size/2);shape.lineTo(-size/2+r,size/2);shape.quadraticCurveTo(-size/2,size/2,-size/2,size/2-r);shape.lineTo(-size/2,-size/2+r);shape.quadraticCurveTo(-size/2,-size/2,-size/2+r,-size/2);
const geometry=new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:true,bevelThickness:.6,bevelSize:.5,bevelSegments:1,steps:1,curveSegments:2});geometry.center();
// Color-managed faces retain the reference shades; only bevels and sides darken.
const tileMaterial = new THREE.MeshBasicMaterial({toneMapped:false});
tileMaterial.onBeforeCompile = shader => {
  shader.vertexShader = 'varying float vTileShade;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vTileShade = 0.78 + 0.22 * abs(normal.z);');
  shader.fragmentShader = 'varying float vTileShade;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vTileShade;');
};
const mesh=new THREE.InstancedMesh(geometry,tileMaterial,MAX);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh);
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d'),g=ctx.createRadialGradient(32,32,3,32,32,31);g.addColorStop(0,'rgba(80,67,40,.29)');g.addColorStop(.4,'rgba(80,67,40,.17)');g.addColorStop(1,'rgba(80,67,40,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
const shadows=new THREE.InstancedMesh(new THREE.PlaneGeometry(32,32),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}),MAX);shadows.frustumCulled=false;scene.add(shadows);
const object=new THREE.Object3D();const rand=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};

// Where tile i sits in ornament k. Tiles beyond an ornament's count hide (scale 0) under one of its tiles.
function slot(k,i){const s=sets[k],t=s[i<s.length?i:i%s.length];return {x:t[0]-470.5,y:836-t[1],col:new THREE.Color().setRGB(t[2]/255,t[3]/255,t[4]/255,THREE.SRGBColorSpace),vis:i<s.length?ORNAMENTS[k].tile:0};}
let current=0;
const particles=Array.from({length:MAX},(_,i)=>{const s=slot(0,i);mesh.setColorAt(i,s.col);
  // x,y = home; sx,sy = anchor of its stream path (only changes while the tile rests, so flights never jump)
  return {x:s.x,y:s.y,sx:s.x,sy:s.y,fx:s.x,fy:s.y,hx:s.x,hy:s.y,col:s.col.clone(),from:s.col.clone(),to:s.col.clone(),
          scale:s.vis,fromScale:s.vis,toScale:s.vis,ox:0,oy:0,vx:0,vy:0,seed:rand(i),band:rand(i+97),delay:((836-s.y)/1672)*2.4+rand(i)*.65,
          zj:rand(i+31)*.6};});   // tiny fixed depth offset: overlapping tiles (girih diagonals) never z-fight
mesh.instanceColor.needsUpdate=true;

let width=innerWidth,height=innerHeight,worldWidth=0,worldHeight=0,center=0;
function resize(){width=innerWidth;height=innerHeight;renderer.setSize(width,height);worldHeight=1672/(width<760?.68:.85);worldWidth=worldHeight*width/height;center=width<760?0:worldWidth*.06;camera.left=-worldWidth/2;camera.right=worldWidth/2;camera.top=worldHeight/2;camera.bottom=-worldHeight/2;camera.updateProjectionMatrix();}resize();addEventListener('resize',resize);
let playing=!reduced.matches,time=0,speed=1,resetting=false,last=performance.now();let pointer={x:99999,y:99999};
// ── manual states ──
// Each state is a moment on the 20-second choreography. Choosing one moves time there along the
// shorter way round the cycle (Unraveling → Assembled rewinds; In flow → Assembled returns) and holds.
// While held, `spin` keeps the streams drifting so a held state never freezes.
const STATES=[{label:'Assembled',t:0},{label:'Unraveling',t:4.6},{label:'In flow',t:10},{label:'Returning',t:14}];
const RATE=1.6; // choreography seconds per real second at 1× speed
let state=0,spin=0;
function setState(s){state=(s+STATES.length)%STATES.length;playing=true;resetting=false;if(reduced.matches)time=STATES[state].t;sync();}
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*t*(t*(t*6-15)+10);};

// ── ornament switching ──
// The change happens while tiles are in flight: homes, colours and visibility ease from one
// ornament to the next over MORPH seconds of animation time, so no tile ever jumps.
const MORPH=1.6,FLOW_START=9.1;
let morph=null; // {k, t}
function select(k){
  k=(k+ORNAMENTS.length)%ORNAMENTS.length;if(k===current&&!morph)return;
  current=k;
  particles.forEach((p,i)=>{const s=slot(k,i);p.fx=p.x;p.fy=p.y;p.hx=s.x;p.hy=s.y;p.from.copy(p.col);p.to.copy(s.col);p.fromScale=p.scale;p.toScale=s.vis;});
  morph={t:0};
  // the tiles travel to the flow, swap there, then head back to whichever state is selected
  if(reduced.matches)finishMorph();else{playing=true;resetting=false;}
  syncOrnament();sync();
}
function finishMorph(){particles.forEach((p,i)=>{p.x=p.hx;p.y=p.hy;p.col.copy(p.to);p.scale=p.toScale;mesh.setColorAt(i,p.col);});mesh.instanceColor.needsUpdate=true;morph=null;}
function syncOrnament(){
  $('#ornamentIndex').textContent=String(current+1).padStart(2,'0');
  $('#ornamentName').textContent=ORNAMENTS[current].name.toUpperCase();
  document.querySelectorAll('#ornamentDots button').forEach((b,i)=>{b.classList.toggle('selected',i===current);b.setAttribute('aria-pressed',i===current);});
  $('#count').textContent=`${sets[current].length.toLocaleString()} INDIVIDUAL CERAMIC TILES`;
  document.querySelectorAll('.palette i').forEach((el,i)=>{el.style.background=ORNAMENTS[current].swatches[i];});
}
$('#ornamentTotal').textContent='/ '+String(ORNAMENTS.length).padStart(2,'0');
$('#ornamentDots').innerHTML=ORNAMENTS.map((o,i)=>`<button aria-label="${o.name}" title="${o.name}"></button>`).join('');
document.querySelectorAll('#ornamentDots button').forEach((b,i)=>b.onclick=()=>select(i));
$('#prevOrnament').onclick=()=>select(current-1);$('#nextOrnament').onclick=()=>select(current+1);
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==='ArrowRight')select(current+1);else if(e.key==='ArrowLeft')select(current-1);else if(e.key>='1'&&e.key<=String(STATES.length))setState(+e.key-1);});
syncOrnament();

$('#states').innerHTML=STATES.map((s,i)=>`<button aria-pressed="false" title="${s.label} (${i+1})"><span class="n">${String(i+1).padStart(2,'0')}</span><span class="l">${s.label}</span></button>`).join('');
document.querySelectorAll('#states button').forEach((b,i)=>b.onclick=()=>setState(i));
function sync(){ $('#play').textContent=playing?'Ⅱ':'▶';$('#play').setAttribute('aria-label',playing?'Pause animation':'Play animation');document.querySelectorAll('#states button').forEach((b,i)=>{b.classList.toggle('selected',i===state);b.setAttribute('aria-pressed',i===state);});}
$('#play').onclick=()=>{playing=!playing;resetting=false;sync();};$('#reset').onclick=()=>{time=0;state=0;playing=true;resetting=true;pointer.x=99999;if(morph)finishMorph();sync();};$('#speed').oninput=e=>{speed=+e.target.value;$('#speedValue').textContent=`${speed}×`;};
canvas.addEventListener('pointermove',e=>{pointer.x=(e.clientX/width-.5)*worldWidth-center;pointer.y=(.5-e.clientY/height)*worldHeight;});canvas.addEventListener('pointerleave',()=>pointer.x=99999);canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse')pointer.x=99999;});canvas.addEventListener('click',()=>setState(state+1));$('#info').onclick=()=>$('#about').showModal();$('#close').onclick=()=>$('#about').close();reduced.addEventListener('change',()=>{if(reduced.matches){time=STATES[state].t;if(morph)finishMorph();sync();}});sync();
let displayedPhase='';
function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.033);last=now;const active=playing&&!document.hidden;
if(active){
  // while an ornament swap is pending, pass through the flow first
  const target=morph?STATES[2].t:STATES[state].t;
  let d=target-time;if(d>10)d-=20;if(d<=-10)d+=20;          // shorter way round; a tie goes forward
  const step=dt*speed*RATE;
  if(Math.abs(d)>step){time=(time+Math.sign(d)*step+20)%20;resetting=false;}else{time=target;if(!reduced.matches)spin+=dt*speed*.48;}
}
const label=time<2?'01 — ASSEMBLED':time<7?'02 — UNRAVELING':time<12?'03 — IN FLOW':time<17.5?'04 — RETURNING':'01 — ASSEMBLED';if(label!==displayedPhase){$('#phase').textContent=label;displayedPhase=label;}$('#progress').style.width=`${time/20*100}%`;
// advance the morph once every tile is airborne (or immediately if the switch came during the return)
let q=-1;if(morph&&active&&time>=FLOW_START&&time<17.9){morph.t+=dt*speed/MORPH;q=smooth(0,1,morph.t);}
const resting=time<1.9;
particles.forEach((p,i)=>{
if(q>=0){p.x=p.fx+(p.hx-p.fx)*q;p.y=p.fy+(p.hy-p.fy)*q;p.col.lerpColors(p.from,p.to,q);mesh.setColorAt(i,p.col);p.scale=p.fromScale+(p.toScale-p.fromScale)*q;}
if(resting&&!morph&&(p.sx!==p.x||p.sy!==p.y)){p.sx=p.x;p.sy=p.y;p.delay=((836-p.y)/1672)*2.4+rand(i)*.65;}
const release=smooth(2+p.delay,6+p.delay,time);const settle=smooth(11+p.delay*.6,16+p.delay*.6,time);const amount=release*(1-settle);const theta=p.sy/1672*6.283+(p.sx>0?Math.PI:0)+p.seed*.55+(time-3)*.48+spin;const radius=280+Math.abs(p.sx)*.7+p.band*85;const streamX=Math.cos(theta)*radius+Math.sin(theta*2)*100;const streamY=Math.sin(theta)*radius*.85+Math.cos(theta*.7)*170;const tx=p.x*(1-amount)+streamX*amount;const ty=p.y*(1-amount)+streamY*amount;
if(active||resetting){let fx=0,fy=0;if(!reduced.matches&&!resetting){const dx=tx-pointer.x,dy=ty-pointer.y,d=Math.hypot(dx,dy);if(d<180){const f=(1-d/180)**2*95;fx=dx/(d||1)*f;fy=dy/(d||1)*f;}}const step=dt*60;p.vx+=(fx-p.ox)*.07*step;p.vy+=(fy-p.oy)*.07*step;p.vx*=Math.exp(-8*dt);p.vy*=Math.exp(-8*dt);p.ox+=p.vx*step;p.oy+=p.vy*step;}
const z=amount*(35+65*Math.sin(theta))+Math.hypot(p.ox,p.oy)*.3;object.position.set(tx+p.ox+center,ty+p.oy,z+p.zj);object.rotation.set(amount*.45*Math.sin(theta),amount*.5*Math.cos(theta),amount*(theta+p.seed*3));object.scale.setScalar(p.scale);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);// shadows sit far behind every tile (tiles dip to z≈-30 at the bottom of the stream) and shrink in flight,
// so overlapping shadow sprites never haze over the tiles
object.position.set(tx+p.ox+center+4+z*.06,ty+p.oy-6-z*.08,-200);object.rotation.set(0,0,0);object.scale.setScalar((1+Math.abs(z)*.009)*(1-.45*amount)*p.scale);object.updateMatrix();shadows.setMatrixAt(i,object.matrix);});
if(q>=0){mesh.instanceColor.needsUpdate=true;if(morph.t>=1)morph=null;}
mesh.instanceMatrix.needsUpdate=true;shadows.instanceMatrix.needsUpdate=true;renderer.render(scene,camera);
}requestAnimationFrame(frame);
window.mosaic={get state(){return {time,playing,state:STATES[state].label,count:sets[current].length,ornament:current,morphing:!!morph,reduced:reduced.matches};},select,setState};
