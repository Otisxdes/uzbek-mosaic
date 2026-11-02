import * as THREE from './three.module.js';
const $=s=>document.querySelector(s),canvas=$('#scene');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});}catch(e){$('#error').hidden=false;throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,1,5000);camera.position.z=2200;
// Lights are balanced so a flat, front-facing tile shows its palette colour; bevels pick up light and shade.
scene.add(new THREE.HemisphereLight(0xffffff,0x8a96a8,1.35));
const key=new THREE.DirectionalLight(0xfff6ec,2.6);key.position.set(-.5,.62,1);scene.add(key);

// Soft studio environment for glossy glazes: bright panel up-left, mid-grey ahead, darker below.
{
  const env=new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,
    vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    // dark straight ahead (+z): flat faces reflect almost nothing, so dark glazes stay deep; tilted bevels catch the light
    fragmentShader:'varying vec3 p;void main(){vec3 d=normalize(p);float v=mix(.25,.95,smoothstep(-.6,.8,d.y))*(1.-.96*smoothstep(.5,.92,d.z));gl_FragColor=vec4(vec3(v),1.);}'})));
  const panel=new THREE.Mesh(new THREE.PlaneGeometry(30,18),new THREE.MeshBasicMaterial({color:new THREE.Color().setScalar(4),side:THREE.DoubleSide}));
  panel.position.set(-22,26,30);panel.lookAt(0,0,0);env.add(panel);
  scene.environment=new THREE.PMREMGenerator(renderer).fromScene(env,.03).texture;
}

// ── ornaments ──
// Each file is a list of [x, y, r, g, b] tiles around the shared centre (470.5, 819.25).
// scale: size relative to the medallion, as on the posters. tile: tile face relative to the 12.5 base.
// recolor: data palette → the glaze colours sampled from that poster. look: how the tile surface reads.
const ORNAMENTS=[
  {file:'tiles.json?v=poster-1',name:'Medallion',scale:1,tile:1.08,sky:'#70a3de',
   recolor:{'31,48,166':[8,44,168],'54,113,184':[26,84,188],'0,180,179':[22,186,208],'160,219,202':[150,216,222],
            '250,227,197':[238,233,219],'253,233,205':[242,238,226],'255,246,215':[247,244,234]},
   look:{roughness:.24,clearcoat:.9,env:1,jitter:.05,shadow:'#16306a',shadowOpacity:.34}},
  {file:'tiles-4.json?v=poster-1',name:'Lattice',scale:1.77,tile:1,sky:'#70c1de',grout:true,
   recolor:{'22,38,140':[6,30,124],'16,154,192':[8,150,189],'246,232,214':[244,231,215]},
   look:{roughness:.62,clearcoat:0,env:.35,jitter:.07,shadow:'#2a4e66',shadowOpacity:.22}},
  {file:'tiles-3.json?v=poster-9',name:'Girih',scale:1.142,tile:.97,sky:'#cfbfae',bed:'#ddbe9b',
   recolor:{},
   look:{roughness:.3,clearcoat:.55,env:.95,jitter:.035,shadow:'#4a2a14',shadowOpacity:.5}},
];
const sets=await Promise.all(ORNAMENTS.map(o=>fetch('./'+o.file).then(r=>{if(!r.ok)throw Error('Tile data unavailable');return r.json();})));
// Order every set top-to-bottom, so a tile's next home lies in a similar band of the composition.
sets.forEach(s=>s.sort((a,b)=>a[1]-b[1]||a[0]-b[0]));
const MAX=Math.max(...sets.map(s=>s.length));
const CX=470.5,CY=819.25;

// Shallow ceramic tile: flat square top, small rounded bevel that catches a restrained highlight.
const shape=new THREE.Shape();const size=12.5,r=.9;shape.moveTo(-size/2+r,-size/2);shape.lineTo(size/2-r,-size/2);shape.quadraticCurveTo(size/2,-size/2,size/2,-size/2+r);shape.lineTo(size/2,size/2-r);shape.quadraticCurveTo(size/2,size/2,size/2-r,size/2);shape.lineTo(-size/2+r,size/2);shape.quadraticCurveTo(-size/2,size/2,-size/2,size/2-r);shape.lineTo(-size/2,-size/2+r);shape.quadraticCurveTo(-size/2,-size/2,-size/2+r,-size/2);
const geometry=new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:true,bevelThickness:.95,bevelSize:.85,bevelSegments:3,steps:1,curveSegments:3});geometry.center();
const tileMaterial=new THREE.MeshPhysicalMaterial({roughness:.3,metalness:0,clearcoat:.5,clearcoatRoughness:.18});
// The environment only adds reflections; base colour comes from the two lights, so palettes stay true.
tileMaterial.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <lights_fragment_maps>',
  THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );',''));};
const mesh=new THREE.InstancedMesh(geometry,tileMaterial,MAX);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh);

const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;const ctx=shadowCanvas.getContext('2d'),g=ctx.createRadialGradient(32,32,3,32,32,31);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.4,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
const shadowMaterial=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,opacity:.3,color:0x16306a});
const shadows=new THREE.InstancedMesh(new THREE.PlaneGeometry(32,32),shadowMaterial,MAX);shadows.frustumCulled=false;scene.add(shadows);

// Grout bed (lattice only): one speckled cell under each tile, so the bed follows the panel's silhouette.
// It fades out as tiles leave and back in once they are home.
const groutCanvas=document.createElement('canvas');groutCanvas.width=groutCanvas.height=64;{const c=groutCanvas.getContext('2d');c.fillStyle='#e0d8d0';c.fillRect(0,0,64,64);for(let i=0;i<900;i++){const v=170+Math.random()*80|0;c.fillStyle=`rgba(${v},${v+4},${v+10},.55)`;c.fillRect(Math.random()*64,Math.random()*64,1,1);}}
const groutTex=new THREE.CanvasTexture(groutCanvas);groutTex.colorSpace=THREE.SRGBColorSpace;groutTex.wrapS=groutTex.wrapT=THREE.RepeatWrapping;
const groutMaterial=new THREE.MeshBasicMaterial({map:groutTex,transparent:true,opacity:0,depthWrite:false});
const LATTICE=ORNAMENTS.findIndex(o=>o.grout);
let grout=null;
{
  const s=sets[LATTICE],sc=ORNAMENTS[LATTICE].scale;
  const xs=[...new Set(s.map(t=>t[0]))].sort((a,b)=>a-b),ys=[...new Set(s.map(t=>t[1]))].sort((a,b)=>a-b);
  const step=v=>{let m=1e9;for(let i=1;i<v.length;i++){const d=v[i]-v[i-1];if(d>1&&d<m)m=d;}return m;};
  const gx=step(xs)*sc+1.5,gy=step(ys)*sc+1.5;
  grout=new THREE.InstancedMesh(new THREE.PlaneGeometry(gx,gy),groutMaterial,s.length);grout.frustumCulled=false;
  const o=new THREE.Object3D();
  s.forEach((t,i)=>{o.position.set((t[0]-CX)*sc,(CY-t[1])*sc,-3.5);o.updateMatrix();grout.setMatrixAt(i,o.matrix);});
  scene.add(grout);
}

// Soft shadow beneath a whole panel (girih): lifts the assembled mosaic off the backdrop; fades while tiles fly.
const panelShadowCanvas=document.createElement('canvas');panelShadowCanvas.width=panelShadowCanvas.height=256;
{const c=panelShadowCanvas.getContext('2d');c.filter='blur(7px)';c.fillStyle='#000';c.fillRect(48,48,160,160);}
const panelShadowMaterial=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(panelShadowCanvas),transparent:true,depthWrite:false,opacity:0,color:0x4a2c16});
const panelShadow=new THREE.Mesh(new THREE.PlaneGeometry(1,1),panelShadowMaterial);panelShadow.visible=false;scene.add(panelShadow);
function fitPanelShadow(k){const s=sets[k],sc=ORNAMENTS[k].scale;let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(const t of s){x0=Math.min(x0,t[0]);x1=Math.max(x1,t[0]);y0=Math.min(y0,t[1]);y1=Math.max(y1,t[1]);}
  const w=(x1-x0+14)*sc,h=(y1-y0+14)*sc;panelShadow.scale.set(w*256/160,h*256/160,1);
  panelShadow.position.set(((x0+x1)/2-CX)*sc+10,(CY-(y0+y1)/2)*sc-14,-300);}
// Grout bed (girih): one plane under the panel in the reference's grout colour, so the joints between
// tiles read as grout, not as the backdrop; it fades with the tiles like the lattice bed.
const BED=ORNAMENTS.findIndex(o=>o.bed);
const bedMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(ORNAMENTS[BED].bed),transparent:true,opacity:0,depthWrite:false});
const bed=new THREE.Mesh(new THREE.PlaneGeometry(1,1),bedMaterial);bed.visible=false;
{const s=sets[BED],sc=ORNAMENTS[BED].scale;let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;   // to the outer tile centres: its edge stays hidden
  for(const t of s){x0=Math.min(x0,t[0]);x1=Math.max(x1,t[0]);y0=Math.min(y0,t[1]);y1=Math.max(y1,t[1]);}
  bed.scale.set((x1-x0)*sc,(y1-y0)*sc,1);bed.position.set(((x0+x1)/2-CX)*sc,(CY-(y0+y1)/2)*sc,-3.5);scene.add(bed);}
const object=new THREE.Object3D();const rand=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
// Where tile i sits in ornament k. Tiles beyond an ornament's count hide (scale 0) under one of its tiles.
// A tile may carry a 7th field, its size relative to the ornament's tile (the girih frame tiles are larger).
function slot(k,i){
  const o=ORNAMENTS[k],s=sets[k],t=s[i<s.length?i:i%s.length];
  const c=o.recolor[t.slice(2).join(',')]||t.slice(2);
  const j=1+(rand(i*7+k)-.5)*2*o.look.jitter;                       // natural glaze variation per tile
  return {rot:-(t[5]||0),x:(t[0]-CX)*o.scale,y:(CY-t[1])*o.scale,col:new THREE.Color().setRGB(Math.min(1,c[0]/255*j),Math.min(1,c[1]/255*j),Math.min(1,c[2]/255*j),THREE.SRGBColorSpace),vis:i<s.length?o.tile*o.scale*(t[6]||1):0};
}
let current=0,previous=0;
const particles=Array.from({length:MAX},(_,i)=>{const s=slot(0,i);mesh.setColorAt(i,s.col);
  // x,y = home; sx,sy = anchor of its stream path (only changes while the tile rests, so flights never jump)
  return {rot:s.rot,fromRot:s.rot,toRot:s.rot,x:s.x,y:s.y,sx:s.x,sy:s.y,fx:s.x,fy:s.y,hx:s.x,hy:s.y,col:s.col.clone(),from:s.col.clone(),to:s.col.clone(),
          scale:s.vis,fromScale:s.vis,toScale:s.vis,ox:0,oy:0,vx:0,vy:0,seed:rand(i),band:rand(i+97),delay:((836-s.y)/1672)*2.4+rand(i)*.65,
          zj:rand(i+31)*.6};});   // tiny fixed depth offset: overlapping tiles (girih diagonals) never z-fight
mesh.instanceColor.needsUpdate=true;

// Fixed poster: 1080 × 1346 px. The medallion spans 747 px (y 298–1045), so 1 world unit = 0.4927 px,
// and ornaments are centred at poster y ≈ 671. The whole poster scales to fit the window via --s.
const W=1080,H=1346,PX_PER_UNIT=747/1516*.965,ORN_Y=671;   // .965: tile faces reach past the data outline
const width=W,height=H,worldWidth=W/PX_PER_UNIT,worldHeight=H/PX_PER_UNIT;
{const cy=(H/2-ORN_Y)/PX_PER_UNIT;camera.left=-worldWidth/2;camera.right=worldWidth/2;camera.top=worldHeight/2+cy;camera.bottom=-worldHeight/2+cy;camera.updateProjectionMatrix();}
// Film grain like the printed posters: independent grey noise per device pixel, blended as overlay.
// Gaussian σ≈29 around mid-grey gives ±13 brightness levels (20% under on the poster colours, as measured on the references.
const grain=$('#grain');let grainSize='';
function drawGrain(s){
  const w=Math.round(W*s*devicePixelRatio),h=Math.round(H*s*devicePixelRatio),key=w+'x'+h;if(key===grainSize)return;grainSize=key;
  grain.width=w;grain.height=h;const g=grain.getContext('2d'),img=g.createImageData(w,h),d=img.data;
  for(let i=0;i<d.length;i+=4){const n=(Math.random()+Math.random()+Math.random()-1.5)*57.6+128;d[i]=d[i+1]=d[i+2]=n;d[i+3]=255;}
  g.putImageData(img,0,0);
}
function resize(){
  const s=Math.min(innerWidth/W,innerHeight/H);drawGrain(s);
  document.documentElement.style.setProperty('--s',s);
  renderer.setPixelRatio(Math.min(2.5,Math.max(1,devicePixelRatio*s)));renderer.setSize(W,H,false);
}
resize();addEventListener('resize',resize);
let time=0,last=performance.now();const speed=1;let pointer={x:99999,y:99999};
// ── manual states ──
// Each state is a moment on the 20-second choreography. Choosing one moves time there along the
// shorter way round the cycle and holds; while held, `spin` keeps the streams drifting.
const STATES=[{label:'assembled',t:0},{label:'unraveling',t:4.6},{label:'in flow',t:10},{label:'returning',t:14}];
const RATE=1.6; // choreography seconds per real second
let state=0,spin=0;
function setState(s){if(T)return;state=(s+STATES.length)%STATES.length;if(reduced.matches)time=STATES[state].t;sync();}
const smooth=(a,b,x)=>{const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*t*(t*(t*6-15)+10);};

// ── ornament switching: a game of Tetris ──
// The old ornament clears line by line from the bottom (each row blinks, then vanishes). The new one
// is cut into four-tile pieces that drop in from above the poster, shuffle sideways and turn in
// quarter-steps on the way down, then lock into place — bottom rows first, so the ornament stacks up.
// If the tiles are mid-flow when an ornament is chosen, they first return home, then the game plays.
const CLEAR=1.3,BLINK=.44,BUILD=3.4,FALL=2600,LOCK=.5;   // seconds; FALL in world units per second
let want=0,T=null; // T: {wait} until the tiles rest, then {on,t,pieces,end,clearDone}
// typical distance between neighbouring tiles of each ornament (data px), to find a piece's neighbours
const PITCH=sets.map(s=>{const c=40,G=new Map(),key=(x,y)=>x+','+y;
  s.forEach(t=>{const k=key(Math.floor(t[0]/c),Math.floor(t[1]/c));(G.get(k)||G.set(k,[]).get(k)).push(t);});
  const d=[];for(let n=0;n<s.length;n+=5){const t=s[n],gx=Math.floor(t[0]/c),gy=Math.floor(t[1]/c);let m=1e9;
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(const u of G.get(key(gx+a,gy+b))||[]){const e=Math.hypot(u[0]-t[0],u[1]-t[1]);if(e>.5&&e<m)m=e;}
    if(m<1e9)d.push(m);}
  d.sort((a,b)=>a-b);return d[d.length>>1]||12.5;});
particles.forEach(p=>{p.pc=-1;p.ca=-1;});
function assign(k){
  previous=current;current=k;
  particles.forEach((p,i)=>{const s=slot(k,i);p.fx=p.x;p.fy=p.y;p.hx=s.x;p.hy=s.y;p.from.copy(p.col);p.to.copy(s.col);p.fromScale=p.scale;p.toScale=s.vis;p.fromRot=p.rot;p.toRot=s.rot;});
}
function finishMorph(){particles.forEach((p,i)=>{p.x=p.hx;p.y=p.hy;p.col.copy(p.to);p.scale=p.toScale;p.rot=p.toRot;p.pc=-1;p.ca=-1;mesh.setColorAt(i,p.col);});mesh.instanceColor.needsUpdate=true;}
function setSky(k){document.body.style.setProperty('--sky',ORNAMENTS[k].sky);document.body.style.setProperty('--haze',ORNAMENTS[k].haze||'#c1d2df');}
// Group the new ornament's tiles into (mostly) four-tile pieces, growing each from the lowest free tile.
function buildPieces(k){
  const g=PITCH[k]*ORNAMENTS[k].scale,ids=[],G=new Map(),taken=new Uint8Array(MAX),pieces=[];
  particles.forEach((p,i)=>{if(p.toScale>0)ids.push(i);});
  ids.sort((a,b)=>particles[a].hy-particles[b].hy||particles[a].hx-particles[b].hx);
  const cx=i=>Math.round(particles[i].hx/g),cy=i=>Math.round(particles[i].hy/g);
  ids.forEach(i=>{const k2=cx(i)+','+cy(i);(G.get(k2)||G.set(k2,[]).get(k2)).push(i);});
  for(const i0 of ids){if(taken[i0])continue;const m=[i0];taken[i0]=1;
    while(m.length<4){let best=-1,bd=1e9;
      for(const j of m){const pj=particles[j],x=cx(j),y=cy(j);
        for(let a=-2;a<=2;a++)for(let b=-2;b<=2;b++)for(const n of G.get((x+a)+','+(y+b))||[]){if(taken[n])continue;
          const pn=particles[n],d=Math.hypot(pn.hx-pj.hx,pn.hy-pj.hy);if(d>g*1.3)continue;
          const sc=d+(pn.hy-particles[i0].hy)*.35+rand(n*3+k)*g*.8;if(sc<bd){bd=sc;best=n;}}}
      if(best<0)break;m.push(best);taken[best]=1;}
    pieces.push(m);}
  return {pieces,g};
}
function beginTetris(){
  const old=current;assign(want);setSky(want);
  // line clear: rows of the old ornament go bottom-up
  const go=PITCH[old]*ORNAMENTS[old].scale;let y0=1e9,y1=-1e9;
  particles.forEach(p=>{if(p.fromScale>0){y0=Math.min(y0,p.fy);y1=Math.max(y1,p.fy);}});
  particles.forEach(p=>{p.pc=-1;p.ca=p.fromScale>0?Math.round((p.fy-y0)/go)*go/((y1-y0)||1)*CLEAR:-1;});
  // the new ornament's pieces: land bottom-first, fall at constant speed from above the poster
  const {pieces,g}=buildPieces(want),top=camera.top+2*g;let lo=1e9,hi=-1e9;
  const P=pieces.map((m,n)=>{let sx=0,sy=0,b=1e9,ce=0;for(const i of m){const p=particles[i];sx+=p.hx;sy+=p.hy;b=Math.min(b,p.hy);ce=Math.max(ce,p.ca>=0?p.ca+BLINK:0);p.pc=n;}
    lo=Math.min(lo,b);hi=Math.max(hi,b);
    return {cx:sx/m.length,cy:sy/m.length,b,ce,g,dist:top-b,lat:Math.round((rand(n*5+1)-.5)*6.99),rot:Math.floor(rand(n*7+2)*4)};});
  let shift=0;
  P.forEach((pc,n)=>{pc.la=BUILD*(pc.b-lo)/((hi-lo)||1)+rand(n*11+3)*.18;pc.da=pc.la-pc.dist/FALL;shift=Math.max(shift,pc.ce-pc.da);});
  let end=0;P.forEach(pc=>{pc.la+=shift;pc.da+=shift;end=Math.max(end,pc.la);});
  T={on:true,t:0,pieces:P,end:Math.max(end,CLEAR+BLINK)+LOCK+.1,clearDone:CLEAR+BLINK};
}
function select(k){
  k=(k+ORNAMENTS.length)%ORNAMENTS.length;if(k===want)return;want=k;sync();
  if(reduced.matches){jump(k);return;}
  state=0;if(!T)T={wait:true};
}
function jump(k){want=k;T=null;if(k!==current)assign(k);finishMorph();setSky(k);sync();}
// Pose of tile p at game time tt → Q
const Q={x:0,y:0,z:0,rot:0,scale:0,flash:0,col:null},WHITE=new THREE.Color(1,1,1),tint=new THREE.Color();
function tetrisPose(p,tt){
  const pc=p.pc>=0?T.pieces[p.pc]:null;
  if(!pc||tt<pc.da){   // still the old ornament: rest, then blink and vanish with its row
    Q.x=p.fx;Q.y=p.fy;Q.z=0;Q.rot=p.fromRot;Q.col=p.from;Q.flash=0;Q.scale=p.fromScale;
    if(p.ca>=0&&tt>=p.ca){const u=(tt-p.ca)/BLINK;Q.flash=u<.7&&Math.floor(u*8)%2?.12:.85;Q.scale*=1-smooth(.62,1,u);}
    return;}
  Q.col=p.to;
  if(tt<pc.la){        // falling: steps sideways and turns in quarter-steps, snapped to the tile grid
    const f=(tt-pc.da)/(pc.la-pc.da),cl=THREE.MathUtils.clamp,
      lat=Math.sign(pc.lat)*Math.ceil(Math.abs(pc.lat)*(1-cl((f-.06)/.6,0,1))-1e-6),
      a=Math.ceil(pc.rot*(1-cl((f-.12)/.6,0,1))-1e-6)*Math.PI/2,ca=Math.cos(a),sa=Math.sin(a),
      lx=p.hx-pc.cx,ly=p.hy-pc.cy,dy=Math.ceil(pc.dist*(1-f)/pc.g)*pc.g;
    Q.x=pc.cx+lat*pc.g+lx*ca-ly*sa;Q.y=pc.cy+dy+lx*sa+ly*ca;Q.z=40;Q.rot=p.toRot+a;Q.scale=p.toScale;Q.flash=0;
    return;}
  const u=Math.min(1,(tt-pc.la)/LOCK),e=(1-u)*(1-u);   // locked: a small pop and flash
  Q.x=p.hx;Q.y=p.hy;Q.z=0;Q.rot=p.toRot;Q.scale=p.toScale*(1+.14*e);Q.flash=.5*e;
}

// Carousel: ‹ Name › — arrows (and ← → keys) step through the ornaments, wrapping round.
$('#prev').onclick=()=>select(want-1);$('#next').onclick=()=>select(want+1);
function sync(){ $('#name').textContent=ORNAMENTS[want].name; }
addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;if(e.key==='ArrowRight')select(want+1);else if(e.key==='ArrowLeft')select(want-1);else if(e.key>='1'&&e.key<=String(STATES.length))setState(+e.key-1);});
// pointer → world, through the poster's scale
canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();pointer.x=((e.clientX-r.left)/r.width-.5)*worldWidth;pointer.y=(.5-(e.clientY-r.top)/r.height)*worldHeight+(camera.top+camera.bottom)/2;});canvas.addEventListener('pointerleave',()=>pointer.x=99999);canvas.addEventListener('pointerup',e=>{if(e.pointerType!=='mouse')pointer.x=99999;});canvas.addEventListener('click',()=>setState(state+1));
// ?o=<n> opens straight on ornament n, assembled (for reviewing one ornament)
{const o=new URLSearchParams(location.search).get('o');if(o)jump((+o%ORNAMENTS.length+ORNAMENTS.length)%ORNAMENTS.length);}
reduced.addEventListener('change',()=>{if(reduced.matches){time=STATES[state].t;if(T)jump(want);sync();}});sync();

// Surface look eases towards the ornament on show (it switches while tiles are mid-air).
const look={...ORNAMENTS[0].look},shadowCol=new THREE.Color(look.shadow),targetCol=new THREE.Color();
let groutW=0,bedW=0;
function frame(now){requestAnimationFrame(frame);const dt=Math.min((now-last)/1000,.033);last=now;const active=!document.hidden;
if(active){
  // while an ornament swap is pending, bring every tile home first
  const target=T?STATES[0].t:STATES[state].t;
  let d=target-time;if(d>10)d-=20;if(d<=-10)d+=20;          // shorter way round; a tie goes forward
  const step=dt*speed*RATE;
  if(Math.abs(d)>step)time=(time+Math.sign(d)*step+20)%20;else{time=target;if(!reduced.matches)spin+=dt*speed*.48;}
  if(T&&T.wait&&time===target){if(want===current)T=null;else beginTetris();}
  else if(T&&T.on){T.t+=dt*speed;
    if(T.t>=T.end){finishMorph();T=null;if(want!==current)T={wait:true};}}
}
const tt=T&&T.on?T.t:-1;
const shown=tt>=0&&tt<T.clearDone*.6?previous:current, L=ORNAMENTS[shown].look, e=1-Math.exp(-dt*4);
look.roughness+=(L.roughness-look.roughness)*e;look.clearcoat+=(L.clearcoat-look.clearcoat)*e;look.env+=(L.env-look.env)*e;look.shadowOpacity+=(L.shadowOpacity-look.shadowOpacity)*e;
tileMaterial.roughness=look.roughness;tileMaterial.clearcoat=look.clearcoat;tileMaterial.envMapIntensity=look.env;
shadowCol.lerp(targetCol.set(L.shadow),e);shadowMaterial.color.copy(shadowCol);shadowMaterial.opacity=look.shadowOpacity;
const assembled=tt>=0?(tt<T.clearDone?1-smooth(0,T.clearDone,tt):smooth(T.end-.9,T.end,tt)):time<10?1-smooth(1.9,3.6,time):smooth(15.5,18.5,time);
{const ps=ORNAMENTS[shown].panelShadow||0;if(ps&&panelShadow.userData.k!==shown){fitPanelShadow(shown);panelShadow.userData.k=shown;}
  panelShadowMaterial.opacity+=(ps*assembled-panelShadowMaterial.opacity)*e;panelShadow.visible=panelShadowMaterial.opacity>.003;}
groutW+=((ORNAMENTS[shown].grout?1:0)-groutW)*e;groutMaterial.opacity=groutW*assembled;grout.visible=groutMaterial.opacity>.003;
bedW+=((ORNAMENTS[shown].bed?1:0)-bedW)*e;bedMaterial.opacity=bedW*assembled;bed.visible=bedMaterial.opacity>.003;

const resting=time<1.9;
particles.forEach((p,i)=>{
let tx,ty,z0,rx=0,ry=0,rz,sc,amount=0,srot;
if(tt>=0){tetrisPose(p,tt);tx=Q.x;ty=Q.y;z0=Q.z;rz=srot=Q.rot;sc=Q.scale;mesh.setColorAt(i,tint.copy(Q.col).lerp(WHITE,Q.flash));}
else{
if(resting&&!T&&(p.sx!==p.x||p.sy!==p.y)){p.sx=p.x;p.sy=p.y;p.delay=((836-p.y)/1672)*2.4+rand(i)*.65;}
const release=smooth(2+p.delay,6+p.delay,time);const settle=smooth(11+p.delay*.6,16+p.delay*.6,time);amount=release*(1-settle);const theta=p.sy/1672*6.283+(p.sx>0?Math.PI:0)+p.seed*.55+(time-3)*.48+spin;const radius=280+Math.abs(p.sx)*.7+p.band*85;const streamX=Math.cos(theta)*radius+Math.sin(theta*2)*100;const streamY=Math.sin(theta)*radius*.85+Math.cos(theta*.7)*170;tx=p.x*(1-amount)+streamX*amount;ty=p.y*(1-amount)+streamY*amount;
z0=amount*(35+65*Math.sin(theta));rx=amount*.45*Math.sin(theta);ry=amount*.5*Math.cos(theta);rz=amount*(theta+p.seed*3)+p.rot;sc=p.scale;srot=p.rot*(1-amount);}
if(active){let fx=0,fy=0;if(!reduced.matches){const dx=tx-pointer.x,dy=ty-pointer.y,d=Math.hypot(dx,dy);if(d<180){const f=(1-d/180)**2*95;fx=dx/(d||1)*f;fy=dy/(d||1)*f;}}const st=dt*60;p.vx+=(fx-p.ox)*.07*st;p.vy+=(fy-p.oy)*.07*st;p.vx*=Math.exp(-8*dt);p.vy*=Math.exp(-8*dt);p.ox+=p.vx*st;p.oy+=p.vy*st;}
const z=z0+Math.hypot(p.ox,p.oy)*.3;object.position.set(tx+p.ox,ty+p.oy,z+p.zj);object.rotation.set(rx,ry,rz);object.scale.setScalar(sc);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);
// shadows sit far behind every tile and shrink in flight, so overlapping sprites never haze over the tiles
object.position.set(tx+p.ox+3.2+z*.06,ty+p.oy-4.2-z*.08,-200);object.rotation.set(0,0,srot);object.scale.setScalar((.72+Math.abs(z)*.009)*(1-.45*amount)*sc);object.updateMatrix();shadows.setMatrixAt(i,object.matrix);});
if(tt>=0)mesh.instanceColor.needsUpdate=true;
mesh.instanceMatrix.needsUpdate=true;shadows.instanceMatrix.needsUpdate=true;renderer.render(scene,camera);
}requestAnimationFrame(frame);
window.mosaic={get state(){return {time,state:STATES[state].label,count:sets[current].length,ornament:ORNAMENTS[current].name,morphing:!!T,tetris:T&&T.on?{t:T.t,end:T.end,pieces:T.pieces.length}:null,reduced:reduced.matches};},select,setState,
  seek(t){if(T&&T.on)T.t=t;},   // jump the ornament transition to t seconds (for reviewing it)
  // colour check: rendered RGB at a CSS-pixel position (tiles only; the page background is CSS)
  // full-resolution capture of the canvas (for comparing against references)
  snapshot(){for(let k=0;k<3;k++)frame(performance.now());return canvas.toDataURL('image/png');},
  sample(x,y){renderer.render(scene,camera);const gl=renderer.getContext(),d=new Uint8Array(4),pr=renderer.getPixelRatio();gl.readPixels(Math.round(x*pr),Math.round((height-y)*pr),1,1,gl.RGBA,gl.UNSIGNED_BYTE,d);return [...d];}};
