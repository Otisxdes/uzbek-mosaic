/*
 * Uzbek mosaic — ~3,500 independent ceramic tiles.
 *
 * Tiles: every tile was detected in the reference image (see tiles.js). Its front face is
 * textured with *its own* patch of the photograph, so the assembled state reproduces the
 * reference exactly (glaze, marbling, highlights) while each square still moves on its own.
 *
 * Motion (after the reference video): tiles are carried by a smooth, analytic vortex flow,
 * so neighbours travel together — the grid bends into arcs and spiral sheets instead of
 * exploding into noise. A front peels the ornament progressively; later the tiles are called
 * back (centre first) along curved, partly unwinding paths and settle via a spring.
 *
 * Everything is a pure function of (tile, cycle seed, time). Springs on top add inertia and
 * the pointer response.
 */
(() => {
  'use strict';

  const DATA = window.MOSAIC;
  const N = DATA.tiles.length;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ───────────────────────── helpers ─────────────────────────
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
  const lerp = (a, b, t) => a + (b - a) * t;
  function hash(i, s) {
    let h = Math.imul(i + 1, 374761393) ^ Math.imul(s + 1, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  // smooth 0..1 field: nearby tiles get nearby values, so regions behave as coherent sheets
  const field = (x, y, s) =>
    0.5 + 0.125 * (Math.sin(x * 0.085 + s * 1.3) + Math.sin(y * 0.07 + s * 2.1) +
                   Math.sin((x + y) * 0.06 + s * 0.7) + Math.sin((x - y) * 0.05 + s * 3.3));

  // ───────────────────────── tiles ─────────────────────────
  const PITCH = DATA.pitch, PATCH = DATA.size;           // image px
  const hx = new Float32Array(N), hy = new Float32Array(N);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let i = 0; i < N; i++) {
    const t = DATA.tiles[i];
    minX = Math.min(minX, t[0]); maxX = Math.max(maxX, t[0]); minY = Math.min(minY, t[1]); maxY = Math.max(maxY, t[1]);
  }
  const imgCX = (minX + maxX) / 2, imgCY = (minY + maxY) / 2;
  for (let i = 0; i < N; i++) {
    hx[i] = (DATA.tiles[i][0] - imgCX) / PITCH;
    hy[i] = -(DATA.tiles[i][1] - imgCY) / PITCH;
  }
  const contentW = (maxX - minX) / PITCH + 3, contentH = (maxY - minY) / PITCH + 3;
  let rMaxHome = 0;
  for (let i = 0; i < N; i++) rMaxHome = Math.max(rMaxHome, Math.hypot(hx[i], hy[i]));
  const hA = new Float32Array(N), hB = new Float32Array(N), hC = new Float32Array(N), hD = new Float32Array(N), hE = new Float32Array(N);
  for (let i = 0; i < N; i++) { hA[i] = hash(i, 1); hB[i] = hash(i, 2); hC[i] = hash(i, 3); hD[i] = hash(i, 4); hE[i] = hash(i, 5); }

  // ───────────────────────── renderer / scene ─────────────────────────
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOV = 18;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 3000);

  const SIZE = PATCH / PITCH;                 // world size of a tile face (≈1)
  const THICK = 0.34, Z0 = THICK / 2;
  const geo = new THREE.BoxGeometry(SIZE, SIZE, THICK);

  // per-instance: uv rect of the tile's own patch + glaze colour for the sides
  const aUV = new Float32Array(N * 4), aCol = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const [x, y, r, g, b] = DATA.tiles[i];
    aUV[i * 4] = (x - PATCH / 2) / DATA.w;
    aUV[i * 4 + 1] = 1 - (y + PATCH / 2) / DATA.h;          // texture is flipped on upload
    aUV[i * 4 + 2] = PATCH / DATA.w;
    aUV[i * 4 + 3] = PATCH / DATA.h;
    aCol[i * 3] = r / 255; aCol[i * 3 + 1] = g / 255; aCol[i * 3 + 2] = b / 255;
  }
  geo.setAttribute('aUV', new THREE.InstancedBufferAttribute(aUV, 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3));

  const LIGHT = new THREE.Vector3(-0.2, 0.32, 1).normalize();
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.NoColorSpace;        // sample raw sRGB so a flat face shows the exact photo pixel
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.minFilter = THREE.LinearMipmapLinearFilter;

  // Shading is normalised so a tile lying flat shows the photograph untouched; tilted tiles
  // pick up real light, a soft glaze highlight and darker edges.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uL: { value: LIGHT } },
    vertexShader: /* glsl */`
      attribute vec4 aUV; attribute vec3 aCol;
      varying vec2 vUv; varying vec3 vN; varying vec3 vCol; varying float vFront; varying vec3 vV;
      void main() {
        mat4 m = modelMatrix * instanceMatrix;
        vec4 wp = m * vec4(position, 1.0);
        vN = normalize(mat3(m) * normal);
        vFront = normal.z;
        vUv = aUV.xy + uv * aUV.zw;
        vCol = aCol;
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uL;
      varying vec2 vUv; varying vec3 vN; varying vec3 vCol; varying float vFront; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        vec3 base = vFront > 0.5 ? texture2D(uMap, vUv).rgb : vCol * 0.74;
        float shade = (0.62 + 0.38 * max(dot(n, uL), 0.0)) / (0.62 + 0.38 * uL.z);
        float tilt = 1.0 - smoothstep(0.985, 1.0, n.z);
        float spec = pow(max(dot(n, normalize(uL + normalize(vV))), 0.0), 48.0) * 0.22 * tilt;
        gl_FragColor = vec4(base * shade + spec, 1.0);
      }`,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true; mesh.frustumCulled = false;
  scene.add(mesh);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.14, depthWrite: false }));
  ground.position.z = -0.002; ground.receiveShadow = true;
  scene.add(ground);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  let visW = 70, visH = 120, minVis = 70, R = 12;
  function resize() {
    const w = innerWidth, h = innerHeight, aspect = w / h;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    visH = Math.max(contentH * 1.14, (contentW * 1.1) / aspect);
    visW = visH * aspect; minVis = Math.min(visW, visH);
    const dist = (visH / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    camera.aspect = aspect; camera.position.set(0, -contentH * 0.03, dist); camera.updateProjectionMatrix();
    R = clamp(0.1 * minVis, 6, 13);
    const span = Math.max(visW, visH) * 0.8, sc = sun.shadow.camera;
    sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.near = 1; sc.far = dist * 3; sc.updateProjectionMatrix();
    const size = w < 700 ? 2048 : 4096;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    sun.position.copy(LIGHT).multiplyScalar(dist * 1.2);
  }
  addEventListener('resize', resize);
  resize();

  // ───────────────────────── choreography ─────────────────────────
  const REST = 2.6;                           // assembled pause between cycles
  const S = { playing: !reduceMotion, mode: 'auto', speed: 1, T: 0, nextStart: reduceMotion ? Infinity : 2.2, cycle: null, count: 0, engaged: !reduceMotion };

  const rel = new Float32Array(N), ret = new Float32Array(N), retRank = new Float32Array(N);
  const beta = new Float32Array(N), loose = new Float32Array(N), depth = new Float32Array(N);
  const keyBuf = new Float32Array(N), proj = new Float32Array(N), relRank = new Float32Array(N);
  const order = new Uint16Array(N);
  function rank(keys, out) {
    for (let i = 0; i < N; i++) order[i] = i;
    order.sort((a, b) => keys[a] - keys[b]);
    for (let r = 0; r < N; r++) out[order[r]] = r / (N - 1);
  }

  function startCycle(intensity, origin) {
    const seed = S.count++;
    const ts = 1 / (0.5 + 0.5 * intensity);
    const c = {
      seed, t0: S.T, I: intensity, dir: seed % 2 ? -1 : 1, resetting: false,
      tRel: 7.0 * ts, tRet0: 10.5 * ts, tRet: 6.0 * ts, dOut: 3.2 * ts, accel: 1.6 * ts,
      c0x: origin ? origin.x * 0.6 : (hash(seed, 11) - 0.5) * contentW * 0.1,
      c0y: origin ? origin.y * 0.6 : (hash(seed, 12) - 0.5) * contentH * 0.06,
    };
    const a2 = hash(seed, 13) * Math.PI * 2;
    c.c2x = c.c0x + Math.cos(a2) * minVis * 0.1; c.c2y = c.c0y + Math.sin(a2) * minVis * 0.1;
    c.drA = hash(seed, 14) * 6.28; c.drB = hash(seed, 15) * 6.28;

    // release order: a front (first cycle peels from the top-left like the video) with coherent islands
    const ang = -Math.PI / 2 + 0.38 + seed * 2.399963;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < N; i++) {
      const v = origin ? Math.hypot(hx[i] - origin.x, hy[i] - origin.y) : hx[i] * dx + hy[i] * dy;
      proj[i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    for (let i = 0; i < N; i++) {
      proj[i] = (proj[i] - lo) / (hi - lo || 1);
      keyBuf[i] = 0.62 * proj[i] + 0.26 * field(hx[i], hy[i], seed) + 0.12 * hash(i, 100 + seed);
    }
    rank(keyBuf, relRank);
    for (let i = 0; i < N; i++) rel[i] = c.tRel * Math.pow(relRank[i], 1.1);

    // return order: centre first, biased against the release direction
    for (let i = 0; i < N; i++)
      keyBuf[i] = 0.5 * (Math.hypot(hx[i], hy[i]) / rMaxHome) + 0.3 * (1 - proj[i]) + 0.2 * field(hx[i], hy[i], seed + 31);
    rank(keyBuf, retRank);
    for (let i = 0; i < N; i++) ret[i] = Math.max(c.tRet0 + c.tRet * retRank[i], rel[i] + 2.6 * ts);
    c.end = c.tRet0 + c.tRet + c.dOut;

    // per-tile flow parameters, all spatially smooth except "loose" (individual stragglers)
    for (let i = 0; i < N; i++) {
      const f = (field(hx[i], hy[i], seed + 7) - 0.5) * 2;           // -1..1
      beta[i] = clamp(f * 1.25 + 0.1, -1, 1);                    // <0 → core ball, >0 → outer ring
      loose[i] = hB[i] < 0.2 ? 1 : 0.1;
      depth[i] = field(hx[i], hy[i], seed + 19);
    }
    S.cycle = c;
    return c;
  }

  // Where tile i would be after s "units" of flow — two nested vortices with differential
  // rotation (inner turns faster → the grid shears into spiral arms) and radial breathing.
  const F = { x: 0, y: 0, rot: 0 };
  function flow(i, s, c, tau) {
    const sig = 1 - Math.exp(-s / 2.2);
    const Om = 1.0 * c.I, rc = 0.28 * minVis, Rring = (0.36 + 0.04 * c.I) * minVis;
    let dx = hx[i] - c.c0x, dy = hy[i] - c.c0y;
    const r = Math.hypot(dx, dy) + 1e-6;
    const a1 = c.dir * Om * s / (1 + Math.pow(r / rc, 1.15));
    // regions either gather into a dense core or are carried out onto a wide orbiting ring
    const b = beta[i];
    const target = b < 0 ? r * (0.2 + 0.32 * (1 + b)) : Rring * (0.78 + 0.4 * b);
    const r1 = lerp(r, target, sig);
    const k = r1 / r, ca = Math.cos(a1), sa = Math.sin(a1);
    let x = c.c0x + (dx * ca - dy * sa) * k, y = c.c0y + (dx * sa + dy * ca) * k;
    // second, weaker counter-vortex
    dx = x - c.c2x; dy = y - c.c2y;
    const r2 = Math.hypot(dx, dy);
    const a2 = -c.dir * 0.4 * Om * s * sig / (1 + Math.pow(r2 / (rc * 0.6), 1.4));
    const cb = Math.cos(a2), sb = Math.sin(a2);
    x = c.c2x + dx * cb - dy * sb; y = c.c2y + dx * sb + dy * cb;
    // landscape screens: let the swirl use the width, like the video uses its frame
    const ex = 1 + (clamp(visW / visH, 0.6, 1.8) - 1) * 0.55 * sig;
    x = c.c0x + (x - c.c0x) * ex;
    // whole system drifts slowly, plus per-tile looseness so edges fray into single tiles
    const L = (0.3 + 2.6 * loose[i]) * sig;
    x += sig * minVis * 0.04 * Math.sin(0.21 * tau + c.drA) + L * Math.sin(0.9 * tau + hC[i] * 6.28 + hy[i] * 0.05);
    y += sig * minVis * 0.03 * Math.sin(0.17 * tau + c.drB) + L * Math.cos(0.8 * tau + hD[i] * 6.28 + hx[i] * 0.05);
    // keep the whole system framed (soft wall at the viewport edges)
    const bx = visW * 0.47, by = visH * 0.44, cy0 = camera.position.y;
    x = bx * Math.tanh(x / bx); y = cy0 + by * Math.tanh((y - cy0) / by);
    F.x = x; F.y = y; F.rot = a1 + a2;
    return sig;
  }

  // ───────────────────────── pointer ─────────────────────────
  const P = { x: 0, y: 0, active: false, vx: 0, vy: 0, lastX: 0, lastY: 0, lastT: 0 };
  let shock = null;
  const toWorld = (e) => ({
    x: ((e.clientX / innerWidth) * 2 - 1) * visW / 2,
    y: -((e.clientY / innerHeight) * 2 - 1) * visH / 2 + camera.position.y,
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S.engaged) return;
    const w = toWorld(e), t = performance.now() / 1000, dt = Math.max(t - P.lastT, 1 / 240);
    if (P.active) {
      P.vx = lerp(P.vx, clamp((w.x - P.lastX) / dt, -120, 120), 0.35);
      P.vy = lerp(P.vy, clamp((w.y - P.lastY) / dt, -120, 120), 0.35);
    }
    P.x = P.lastX = w.x; P.y = P.lastY = w.y; P.lastT = t; P.active = true;
  });
  const leave = () => { P.active = false; P.vx = P.vy = 0; };
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointercancel', leave);
  canvas.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') leave(); });
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.engaged) return;
    const w = toWorld(e);
    P.x = P.lastX = w.x; P.y = P.lastY = w.y; P.lastT = performance.now() / 1000; P.active = true;
    shock = { x: w.x, y: w.y };
    if (!S.cycle) { if (!S.playing) setPlaying(true); startCycle(1.45, w); }
  });

  // ───────────────────────── per-frame update ─────────────────────────
  // spring that follows the choreographed target (inertia), and a second spring for pointer offsets
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const qx = new Float32Array(N), qy = new Float32Array(N), qz = new Float32Array(N);
  const ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  for (let i = 0; i < N; i++) { px[i] = hx[i]; py[i] = hy[i]; pz[i] = Z0; }
  const W_FOLLOW = 15, K_PTR = 26, C_PTR = 4.6, PUSH = 120;
  const m = mesh.instanceMatrix.array;

  function update(dt) {
    const c = S.cycle, tau = c ? S.T - c.t0 : 0;
    const pOn = P.active && S.engaged, R2 = R * R;
    const decay = Math.exp(-dt * 6); P.vx *= decay; P.vy *= decay;
    const sh = shock; shock = null;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;

    for (let i = 0; i < N; i++) {
      let tx = hx[i], ty = hy[i], tz = Z0, rx = 0, ry = 0, rz = 0, wEff = 0;

      if (c) {
        const u = tau - rel[i];
        const back = (tau - ret[i]) / c.dOut;
        if (u > -0.8 && back < 1) {
          // anticipation: tiles lift and tremble just before they let go
          const loosen = u < 0 ? smooth(1 + u / 0.8) : 1 - smooth(u / 0.6);
          tz += loosen * 0.8;
          if (u < 0) {
            rz += Math.sin(tau * 37 + hD[i] * 6.28) * 0.06 * loosen;
            tx += Math.sin(tau * 31 + hE[i] * 6.28) * 0.05 * loosen;
          }
          if (u > 0) {
            const w = back <= 0 ? 1 : 1 - smoother(back);
            const a = c.accel;
            let s = (u < a ? (u * u) / (2 * a) : u - a / 2) * c.I;
            s *= 0.3 + 0.7 * w;                                   // partly unwind on the way home → curved return
            const sig = flow(i, s, c, tau);
            const ddx = F.x - hx[i], ddy = F.y - hy[i];
            const bow = (hA[i] - 0.5) * 0.6 * 4 * w * (1 - w);
            tx = hx[i] + ddx * w - ddy * bow;
            ty = hy[i] + ddy * w + ddx * bow;
            const e = sig * w; wEff = w;
            tz += e * (7 * depth[i] + 2.5 * hC[i]);
            rz = e * (0.3 * F.rot + 0.35 * Math.sin(0.7 * tau + hE[i] * 6.28));
            rx = e * 0.5 * Math.sin(0.8 * tau + hA[i] * 6.28 + hy[i] * 0.04);
            ry = e * 0.5 * Math.sin(0.7 * tau + hB[i] * 6.28 + hx[i] * 0.04);
          }
        }
      }

      for (let k = 0; k < steps; k++) {
        // critically damped follow of the target
        qx[i] += (W_FOLLOW * W_FOLLOW * (tx - px[i]) - 2 * W_FOLLOW * qx[i]) * h;
        qy[i] += (W_FOLLOW * W_FOLLOW * (ty - py[i]) - 2 * W_FOLLOW * qy[i]) * h;
        qz[i] += (W_FOLLOW * W_FOLLOW * (tz - pz[i]) - 2 * W_FOLLOW * qz[i]) * h;
        px[i] += qx[i] * h; py[i] += qy[i] * h; pz[i] += qz[i] * h;

        // pointer offset spring (slightly under-damped → organic)
        let ax = -K_PTR * ox[i] - C_PTR * vx[i], ay = -K_PTR * oy[i] - C_PTR * vy[i], az = -K_PTR * oz[i] - C_PTR * vz[i];
        if (pOn) {
          const dx = px[i] + ox[i] - P.x, dy = py[i] + oy[i] - P.y, d2 = dx * dx + dy * dy;
          if (d2 < R2) {
            const d = Math.sqrt(d2) + 1e-4;
            let f = 1 - d / R; f *= f;
            const str = PUSH * (0.5 + 0.5 * (1 - wEff)) * f;
            ax += (dx / d) * str - (dy / d) * str * 0.3 + P.vx * f * 0.8;
            ay += (dy / d) * str + (dx / d) * str * 0.3 + P.vy * f * 0.8;
            az += f * 22;
          }
        }
        vx[i] += ax * h; vy[i] += ay * h; vz[i] += az * h;
        ox[i] += vx[i] * h; oy[i] += vy[i] * h; oz[i] += vz[i] * h;
      }
      if (sh) {
        const dx = px[i] + ox[i] - sh.x, dy = py[i] + oy[i] - sh.y, d = Math.hypot(dx, dy) + 1e-3, f = Math.exp(-d / 16);
        vx[i] += (dx / d) * 48 * f; vy[i] += (dy / d) * 48 * f; vz[i] += 30 * f;
      }
      if (oz[i] < -Z0 * 0.5) { oz[i] = -Z0 * 0.5; vz[i] = 0; }

      const x = px[i] + ox[i], y = py[i] + oy[i], z = pz[i] + oz[i];
      const ca = Math.cos(rx), sa = Math.sin(rx), cb = Math.cos(ry), sb = Math.sin(ry), cg = Math.cos(rz), sg = Math.sin(rz);
      const j = i * 16;                                            // Rz·Ry·Rx, column-major
      m[j] = cg * cb;                m[j + 1] = sg * cb;                m[j + 2] = -sb;      m[j + 3] = 0;
      m[j + 4] = cg * sb * sa - sg * ca; m[j + 5] = sg * sb * sa + cg * ca; m[j + 6] = cb * sa; m[j + 7] = 0;
      m[j + 8] = cg * sb * ca + sg * sa; m[j + 9] = sg * sb * ca - cg * sa; m[j + 10] = cb * ca; m[j + 11] = 0;
      m[j + 12] = x; m[j + 13] = y; m[j + 14] = z; m[j + 15] = 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ───────────────────────── controls ─────────────────────────
  const $ = (id) => document.getElementById(id);
  const elPlay = $('play'), elAuto = $('mAuto'), elInt = $('mInt'), elSpeed = $('speed'), elSpeedOut = $('speedOut'), elReset = $('reset');

  function setPlaying(v) {
    S.playing = v; if (v) S.engaged = true;
    elPlay.setAttribute('aria-pressed', String(v));
    elPlay.textContent = v ? 'Pause' : 'Play';
  }
  function setMode(mode) {
    S.mode = mode; S.engaged = true;
    elAuto.setAttribute('aria-pressed', String(mode === 'auto'));
    elInt.setAttribute('aria-pressed', String(mode === 'interactive'));
    S.nextStart = mode === 'auto' && !S.cycle ? S.T + 1.0 : Infinity;
  }
  // Reset = call every tile home now, along its normal return path (no jump, no scene reset)
  function doReset() {
    const c = S.cycle;
    if (!c) { S.nextStart = S.mode === 'auto' ? S.T + REST : Infinity; return; }
    const tau = S.T - c.t0, ts = 1 / (0.5 + 0.5 * c.I);
    for (let i = 0; i < N; i++) {
      if (rel[i] > tau) rel[i] = Infinity;                            // not released yet: stay
      else if (ret[i] > tau) ret[i] = tau + 0.05 + 1.4 * retRank[i] * ts;
    }
    c.end = Math.min(c.end, tau + 0.05 + 1.4 * ts + c.dOut);
    c.resetting = true;
    S.nextStart = Infinity;
  }
  elPlay.addEventListener('click', () => setPlaying(!S.playing));
  elAuto.addEventListener('click', () => setMode('auto'));
  elInt.addEventListener('click', () => setMode('interactive'));
  elReset.addEventListener('click', doReset);
  elSpeed.addEventListener('input', () => { S.speed = +elSpeed.value; elSpeedOut.textContent = S.speed.toFixed(1) + '×'; });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
    else if (e.key === 'r' || e.key === 'R') doReset();
    else if (e.key === 'm' || e.key === 'M') setMode(S.mode === 'auto' ? 'interactive' : 'auto');
  });
  setPlaying(S.playing);

  // ───────────────────────── loop ─────────────────────────
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const c = S.cycle;
    if (S.playing) S.T += dt * S.speed;
    else if (c && c.resetting) S.T += dt;                            // a reset still plays out while paused

    if (!S.cycle && S.mode === 'auto' && S.T >= S.nextStart) startCycle(1);
    if (S.cycle && S.T - S.cycle.t0 >= S.cycle.end) {
      S.cycle = null;
      S.nextStart = S.mode === 'auto' ? S.T + REST : Infinity;
    }
    update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // Test hook: ?seek=<seconds into the first cycle>&pause=1 — the follow spring is pre-settled
  const q = new URLSearchParams(location.search);
  window.__mosaic = { S, P, startCycle, doReset, setMode, setPlaying, N, mesh, hx, hy, Z0 };

  const img = new Image();
  img.onload = () => {
    tex.image = img; tex.needsUpdate = true;
    if (q.has('seek')) {
      S.T = 0; S.nextStart = Infinity; startCycle(1);
      S.T = parseFloat(q.get('seek')) || 0;
      if (q.get('pause') === '1') setPlaying(false);
      S.engaged = true;
      for (let k = 0; k < 40; k++) update(1 / 60);
    }
    requestAnimationFrame((t) => { last = t; frame(t); });
  };
  img.src = window.MOSAIC_IMAGE;
})();
