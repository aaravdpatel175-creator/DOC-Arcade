/* DOC SHOOTER - 3D first-person shooter (Three.js r128) */
(() => {
'use strict';
const $ = id => document.getElementById(id);
if (typeof THREE === 'undefined') {
  document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#0df">Three.js failed to load. An internet connection is required (CDN). Reload when online.</div>';
  return;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------------- Save data ---------------- */
const SAVE_KEY = 'docshooter_v1';
const DEF_SET = { sound: true, vol: 0.6, quality: 'medium', sens: 1, color: '#00d4ff', qualityChosen: false };
let save = { unlocked: 1, best: {}, high: 0, settings: Object.assign({}, DEF_SET) };
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s) { save = Object.assign(save, s); save.settings = Object.assign({}, DEF_SET, s.settings || {}); }
} catch (e) {}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };
const S = () => save.settings;

/* ---------------- Missions ---------------- */
const MISSIONS = [
  { name: 'Training Ground', obj: 'Hit all 6 training robots', count: 6, waves: 1, kinds: ['static'], time: 0, shots: 0, mag: 12, speed: 0, scale: 1.15, arena: 30, obst: 6, armor: 0, accent: 0x00d4ff, sky: 0x040c1c },
  { name: 'Robot Outpost', obj: 'Destroy 8 patrolling robots', count: 8, waves: 1, kinds: ['walker'], time: 0, shots: 0, mag: 12, speed: 2, scale: 1, arena: 36, obst: 10, armor: 0, accent: 0x2f8bff, sky: 0x050a1e },
  { name: 'Neon City', obj: 'Destroy 12 targets before time runs out', count: 12, waves: 1, kinds: ['walker', 'drone'], time: 80, shots: 0, mag: 12, speed: 3, scale: 1, arena: 42, obst: 14, armor: 0, accent: 0xb44dff, sky: 0x0a0620 },
  { name: 'Precision Challenge', obj: 'Destroy 10 targets using only 18 shots', count: 10, waves: 1, kinds: ['walker', 'drone', 'static'], time: 0, shots: 18, mag: 6, speed: 2.6, scale: 0.8, arena: 40, obst: 12, armor: 0, accent: 0x00ffd0, sky: 0x03121a },
  { name: 'Final Arena', obj: 'Clear 3 waves (21 robots) before time runs out', count: 21, waves: 3, kinds: ['walker', 'drone', 'drone'], time: 140, shots: 0, mag: 15, speed: 4, scale: 0.9, arena: 46, obst: 16, armor: 0.35, accent: 0xff3b6b, sky: 0x12050e }
];

/* ---------------- Audio (WebAudio synth, no files) ---------------- */
let AC = null, noiseBuf = null;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(f1, f2, dur, type, vol, delay) {
  if (!S().sound) return; const a = ac(); if (!a) return;
  const t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(Math.max(0.0001, vol * S().vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, fc) {
  if (!S().sound) return; const a = ac(); if (!a) return;
  if (!noiseBuf) { noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = a.currentTime, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuf; f.type = 'lowpass'; f.frequency.value = fc;
  g.gain.setValueAtTime(Math.max(0.0001, vol * S().vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(a.destination); s.start(t); s.stop(t + dur);
}
const sfx = {
  shoot() { tone(900, 110, 0.14, 'sawtooth', 0.22); noise(0.08, 0.18, 3500); },
  hit() { tone(1200, 600, 0.08, 'square', 0.18); },
  head() { tone(1600, 900, 0.12, 'square', 0.22); tone(800, 1700, 0.1, 'sine', 0.2, 0.05); },
  kill() { noise(0.35, 0.35, 900); tone(320, 60, 0.3, 'sawtooth', 0.22); },
  reload() { tone(300, 500, 0.06, 'square', 0.14); tone(520, 820, 0.06, 'square', 0.14, 0.75); },
  click() { tone(700, 950, 0.05, 'triangle', 0.15); },
  empty() { tone(200, 150, 0.05, 'square', 0.15); },
  win() { [440, 554, 659, 880].forEach((f, i) => tone(f, f, 0.25, 'triangle', 0.25, i * 0.12)); },
  lose() { tone(300, 70, 0.7, 'sawtooth', 0.28); }
};

/* ---------------- Renderer / scene ---------------- */
const canvas = $('game');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { document.body.innerHTML = '<div style="padding:40px;color:#0df;font-family:sans-serif">WebGL is not available in this browser.</div>'; return; }
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
const hemi = new THREE.HemisphereLight(0x6ab8ff, 0x080818, 0.8); scene.add(hemi);
const sun = new THREE.DirectionalLight(0x9fd0ff, 0.9); scene.add(sun); scene.add(sun.target);
const pl1 = new THREE.PointLight(0x00d4ff, 1.4, 60); const pl2 = new THREE.PointLight(0xff4fd8, 1.0, 60);
scene.add(pl1); scene.add(pl2);
const muzzleLight = new THREE.PointLight(0x66e0ff, 0, 9); camera.add(muzzleLight); muzzleLight.position.set(0.3, -0.2, -1);

/* Blaster (fictional) */
const gun = new THREE.Group(); camera.add(gun);
const gunGlow = new THREE.MeshBasicMaterial({ color: S().color });
const darkM = new THREE.MeshStandardMaterial({ color: 0x151c28, metalness: 0.9, roughness: 0.3 });
const midM = new THREE.MeshStandardMaterial({ color: 0x2a3547, metalness: 0.8, roughness: 0.4 });
function gpart(geo, mat, x, y, z, rx) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; gun.add(m); return m; }
gpart(new THREE.BoxGeometry(0.085, 0.1, 0.4), darkM, 0, 0, 0);
gpart(new THREE.CylinderGeometry(0.026, 0.03, 0.34, 10), midM, 0, 0.01, -0.34, Math.PI / 2);
gpart(new THREE.BoxGeometry(0.012, 0.014, 0.28), gunGlow, 0, 0.056, -0.02);
gpart(new THREE.BoxGeometry(0.07, 0.06, 0.12), midM, 0, 0.075, 0.05);
gpart(new THREE.BoxGeometry(0.06, 0.15, 0.07), darkM, 0, -0.12, 0.12, 0.25);
[-0.25, -0.34, -0.43].forEach(z => { const t = gpart(new THREE.TorusGeometry(0.036, 0.007, 6, 14), gunGlow, 0, 0.01, z); });
const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.01, -0.55); gun.add(muzzle);
const GUN_BASE = new THREE.Vector3(0.25, -0.23, -0.5);
gun.position.copy(GUN_BASE);
function setGunColor(hex) { gunGlow.color.set(hex); tracerColor.set(hex); }

/* ---------------- Particles (single Points object) ---------------- */
const PMAX = 600;
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pBase = new Float32Array(PMAX * 3), pVel = new Float32Array(PMAX * 3);
const pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX);
for (let i = 0; i < PMAX; i++) pPos[i * 3 + 1] = -999;
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pPoints = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.24, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
pPoints.frustumCulled = false; scene.add(pPoints);
let pCursor = 0, pQ = 0.7;
const _c = new THREE.Color();
function emit(p, n, color, spd, life) {
  n = Math.max(1, Math.round(n * pQ)); _c.set(color);
  for (let k = 0; k < n; k++) {
    const i = pCursor = (pCursor + 1) % PMAX, j = i * 3;
    pPos[j] = p.x; pPos[j + 1] = p.y; pPos[j + 2] = p.z;
    const a = Math.random() * 6.283, b = Math.random() * 2 - 1, r = Math.sqrt(1 - b * b), s = spd * rnd(0.4, 1);
    pVel[j] = Math.cos(a) * r * s; pVel[j + 1] = b * s + spd * 0.3; pVel[j + 2] = Math.sin(a) * r * s;
    pBase[j] = _c.r; pBase[j + 1] = _c.g; pBase[j + 2] = _c.b;
    pLife[i] = pMax[i] = life * rnd(0.6, 1);
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    const j = i * 3;
    if (pLife[i] > 0) {
      pLife[i] -= dt; pVel[j + 1] -= 9 * dt;
      pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
      if (pPos[j + 1] < 0.05) { pPos[j + 1] = 0.05; pVel[j + 1] *= -0.4; }
      const f = Math.max(0, pLife[i] / pMax[i]);
      pCol[j] = pBase[j] * f; pCol[j + 1] = pBase[j + 1] * f; pCol[j + 2] = pBase[j + 2] * f;
    } else if (pCol[j] || pCol[j + 1] || pCol[j + 2]) { pCol[j] = pCol[j + 1] = pCol[j + 2] = 0; pPos[j + 1] = -999; }
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

/* Tracers */
const tracerColor = new THREE.Color(S().color);
const tracers = []; let tIdx = 0;
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
  m.visible = false; scene.add(m); tracers.push({ m, life: 0 });
}
function tracer(from, to) {
  const t = tracers[tIdx++ % tracers.length], len = from.distanceTo(to);
  t.m.position.copy(from).lerp(to, 0.5); t.m.scale.set(1, 1, len); t.m.lookAt(to);
  t.m.material.color.copy(tracerColor); t.m.material.opacity = 1; t.m.visible = true; t.life = 0.1;
}

/* ---------------- World ---------------- */
let world = null, obstacles = [], shootables = [], targets = [], spinners = [];
let ARENA = 40, M = MISSIONS[0];
const sunDir = new THREE.Vector3();

function disposeObj(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); if (m.emissiveMap) m.emissiveMap.dispose(); m.dispose(); });
  });
}
function windowTex(col) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 64, 128);
  for (let r = 0; r < 16; r++) for (let k = 0; k < 8; k++) if (Math.random() < 0.45) {
    x.fillStyle = Math.random() < 0.18 ? '#ff4fd8' : col; x.globalAlpha = rnd(0.4, 1); x.fillRect(k * 8 + 1, r * 8 + 1, 5, 5);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function collides(x, z, r) {
  for (const o of obstacles) if (x > o.x - o.hw - r && x < o.x + o.hw + r && z > o.z - o.hd - r && z < o.z + o.hd + r) return true;
  return false;
}
function buildWorld(m) {
  if (world) { scene.remove(world); disposeObj(world); }
  world = new THREE.Group(); scene.add(world);
  obstacles = []; shootables = []; targets = []; spinners = [];
  M = m; ARENA = m.arena;
  const acc = m.accent, accHex = '#' + new THREE.Color(acc).getHexString();
  scene.background = new THREE.Color(m.sky); scene.fog = new THREE.Fog(m.sky, 25, ARENA * 2.6);
  pl1.color.setHex(acc); pl1.position.set(-ARENA * 0.5, 9, -ARENA * 0.3); pl2.position.set(ARENA * 0.5, 9, -ARENA * 0.5);
  sun.position.set(ARENA * 0.5, ARENA * 1.2, ARENA * 0.3); sun.target.position.set(0, 0, 0);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -ARENA * 1.1; sc.right = sc.top = ARENA * 1.1; sc.near = 1; sc.far = ARENA * 3; sc.updateProjectionMatrix();

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 4, ARENA * 4), new THREE.MeshStandardMaterial({ color: 0x070d18, metalness: 0.6, roughness: 0.55 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground); shootables.push(ground);
  const grid = new THREE.GridHelper(ARENA * 2, ARENA, acc, 0x0a2a4a); grid.position.y = 0.03;
  grid.material.transparent = true; grid.material.opacity = 0.45; world.add(grid);

  // energy walls
  const wm = new THREE.MeshBasicMaterial({ color: acc, transparent: true, opacity: 0.18, depthWrite: false });
  [[0, -ARENA, 0], [0, ARENA, 0], [-ARENA, 0, Math.PI / 2], [ARENA, 0, Math.PI / 2]].forEach(w => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2 + 1, 4, 0.4), wm);
    mesh.position.set(w[0], 2, w[1]); mesh.rotation.y = w[2]; world.add(mesh); shootables.push(mesh);
  });

  // skyline
  const base = windowTex(accHex), rimM = new THREE.MeshBasicMaterial({ color: acc });
  const n = 30;
  for (let i = 0; i < n; i++) {
    const ang = i / n * Math.PI * 2 + rnd(-0.05, 0.05), dist = ARENA * 1.15 + rnd(4, 18);
    const w = rnd(7, 13), d = rnd(7, 13), h = rnd(16, 55);
    const tex = base.clone(); tex.needsUpdate = true; tex.repeat.set(w / 5, h / 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a1220, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.4 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist); b.rotation.y = rnd(0, 3); world.add(b);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.35, d + 0.3), rimM); rim.position.set(0, h / 2, 0); b.add(rim);
  }
  base.dispose();

  // obstacles
  const om = new THREE.MeshStandardMaterial({ color: 0x142033, metalness: 0.7, roughness: 0.4 });
  const em = new THREE.LineBasicMaterial({ color: acc });
  for (let i = 0, tries = 0; i < m.obst && tries < 200; tries++) {
    const type = pick([[2.6, 2.6, 2.6], [1.3, 6, 1.3], [6, 1.6, 1]]);
    const x = rnd(-ARENA + 5, ARENA - 5), z = rnd(-ARENA + 5, ARENA - 5);
    if (Math.hypot(x, z - (ARENA - 8)) < 8) continue;
    if (obstacles.some(o => Math.hypot(o.x - x, o.z - z) < 7)) continue;
    const swap = type[0] > 5 && Math.random() < 0.5;
    const geo = new THREE.BoxGeometry(type[0], type[1], type[2]);
    const mesh = new THREE.Mesh(geo, om); mesh.position.set(x, type[1] / 2, z); if (swap) mesh.rotation.y = Math.PI / 2;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), em));
    world.add(mesh); shootables.push(mesh);
    obstacles.push({ x, z, hw: (swap ? type[2] : type[0]) / 2, hd: (swap ? type[0] : type[2]) / 2 });
    i++;
  }
  // holo rings
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(3 + i, 0.08, 8, 40), new THREE.MeshBasicMaterial({ color: acc }));
    r.position.set((i - 1) * ARENA * 0.55, 14 + i * 3, -ARENA - 4); world.add(r); spinners.push(r);
  }
  // stars
  const sp = new Float32Array(300 * 3);
  for (let i = 0; i < 300; i++) { const a = rnd(0, 6.28), e = rnd(0.15, 1.4), r = 300; sp[i * 3] = Math.cos(a) * Math.cos(e) * r; sp[i * 3 + 1] = Math.sin(e) * r * 0.8 + 20; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xaad8ff, size: 1.6, sizeAttenuation: false, fog: false }));
  stars.frustumCulled = false; world.add(stars);
  applyQuality();
}

/* ---------------- Targets ---------------- */
function spawnTarget(kind, hp) {
  const t = { kind, hp, max: hp, alive: true, dying: 0, flash: 0, sc: M.scale, t0: rnd(0, 6) };
  const g = new THREE.Group();
  const armored = hp > 1;
  t.body = new THREE.MeshStandardMaterial({ color: armored ? 0x3a1020 : 0x1d2b40, metalness: 0.85, roughness: 0.3, emissive: armored ? 0x330008 : 0x001428 });
  t.baseEm = t.body.emissive.getHex();
  t.glow = new THREE.MeshBasicMaterial({ color: armored ? 0xff2d55 : (kind === 'drone' ? 0xff4fd8 : 0xffb020) });
  const add = (geo, mat, x, y, z, part) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.userData = { t, part }; g.add(m); shootables.push(m); return m;
  };
  if (kind === 'drone') {
    add(new THREE.SphereGeometry(0.7, 14, 10), t.body, 0, 0, 0, 'body');
    add(new THREE.TorusGeometry(1, 0.07, 6, 20), t.glow, 0, 0, 0, 'body').rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.3, 10, 8), t.glow, 0, 0, 0.55, 'head');
    t.y0 = 2.6 + rnd(0, 2.6);
  } else {
    add(new THREE.BoxGeometry(1.1, 1.3, 0.7), t.body, 0, 1.75, 0, 'body');
    add(new THREE.BoxGeometry(0.5, 0.18, 0.1), t.glow, 0, 1.8, 0.36, 'body');
    add(new THREE.SphereGeometry(0.4, 12, 10), t.body, 0, 2.85, 0, 'head');
    add(new THREE.BoxGeometry(0.55, 0.14, 0.1), t.glow, 0, 2.9, 0.34, 'head');
    add(new THREE.BoxGeometry(0.25, 1, 0.3), t.body, -0.8, 1.7, 0, 'body');
    add(new THREE.BoxGeometry(0.25, 1, 0.3), t.body, 0.8, 1.7, 0, 'body');
    if (kind === 'walker') { add(new THREE.BoxGeometry(0.32, 1.15, 0.38), t.body, -0.3, 0.57, 0, 'body'); add(new THREE.BoxGeometry(0.32, 1.15, 0.38), t.body, 0.3, 0.57, 0, 'body'); }
    else add(new THREE.CylinderGeometry(0.45, 0.6, 1.15, 12), t.body, 0, 0.57, 0, 'body');
    t.y0 = 0;
  }
  // position
  let cx = 0, cz = 0;
  for (let k = 0; k < 40; k++) {
    cx = rnd(-ARENA + 9, ARENA - 9); cz = rnd(-ARENA + 9, ARENA - 20);
    if (!collides(cx, cz, 2.2)) break;
  }
  t.cx = cx; t.cz = cz; t.ang = rnd(0, 6.28);
  t.range = kind === 'static' ? 0 : rnd(4, 8); t.spd = kind === 'static' ? 0 : M.speed * rnd(0.8, 1.2);
  if (kind === 'static') t.range = 0;
  g.scale.setScalar(t.sc); g.position.set(cx, t.y0, cz);
  t.g = g; world.add(g); targets.push(t); return t;
}
function removeTarget(t) {
  world.remove(t.g); disposeObj(t.g);
  shootables = shootables.filter(o => o.userData.t !== t);
  const i = targets.indexOf(t); if (i >= 0) targets.splice(i, 1);
}
let worldTime = 0;
function updateTargets(dt) {
  worldTime += dt;
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i], g = t.g;
    if (t.dying > 0) {
      t.dying -= dt; g.scale.setScalar(Math.max(0.001, t.sc * t.dying / 0.35)); g.rotation.y += dt * 12;
      if (t.dying <= 0) removeTarget(t); continue;
    }
    if (t.range > 0) {
      const s = Math.sin(worldTime * t.spd / t.range + t.t0);
      g.position.x = t.cx + Math.cos(t.ang) * s * t.range; g.position.z = t.cz + Math.sin(t.ang) * s * t.range;
    }
    g.position.y = t.kind === 'drone' ? t.y0 + Math.sin(worldTime * 2 + t.t0) * 0.5 : t.y0;
    g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
    if (t.flash > 0) { t.flash -= dt; t.body.emissive.setHex(t.flash > 0 ? 0xffffff : t.baseEm); }
  }
  spinners.forEach((r, i) => { r.rotation.x += dt * (0.5 + i * 0.2); r.rotation.y += dt * 0.7; });
}

/* ---------------- Game state ---------------- */
const G = { mode: 'menu', device: null, mission: 0, paused: false, over: false, score: 0, kills: 0, shots: 0, hits: 0, combo: 0, time: 0,
  mag: 0, left: 0, reload: 0, fireCd: 0, wave: 0, spawned: 0, waveWait: 0, hintStage: 0 };
const P = { x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, bob: 0 };
const keys = {}; const joy = { x: 0, y: 0 }; let touchSprint = false, firing = false;
let kick = 0, flashT = 0;

/* ---------------- HUD helpers ---------------- */
const cache = {};
function setT(id, v) { if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function retrigger(el, cls) { el.classList.remove('on', 'kill'); void el.offsetWidth; el.classList.add('on'); if (cls) el.classList.add(cls); }
function toast(msg) { const t = $('toast'); t.textContent = msg; retrigger(t); }
function feed(msg) { const f = $('feed'); f.textContent = msg; retrigger(f); }
const fmt = s => { s = Math.max(0, Math.ceil(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const mult = () => 1 + Math.min(4, Math.floor(G.combo / 3));
function updateHud() {
  setT('hMission', 'MISSION ' + (G.mission + 1) + ' · ' + M.name.toUpperCase());
  setT('hObj', M.obj);
  setT('hProgTxt', 'PROGRESS ' + G.kills + '/' + M.count + (M.waves > 1 ? '  ·  WAVE ' + Math.max(1, G.wave) + '/' + M.waves : ''));
  $('hProg').style.width = (G.kills / M.count * 100) + '%';
  const left = M.time ? M.time - G.time : G.time;
  setT('hTime', fmt(M.time ? left : G.time)); setT('hTimeLbl', M.time ? 'TIME LEFT' : 'ELAPSED');
  $('hud').querySelector('.hud-tc').classList.toggle('low', !!M.time && left < 10);
  setT('hScore', String(G.score)); setT('hHigh', String(Math.max(save.high, G.score))); setT('hCombo', 'x' + mult());
  setT('hAmmo', G.reload > 0 ? 'RELOADING' : G.mag + ' / ' + M.mag);
  setT('hAmmoSub', M.shots ? 'SHOTS LEFT ' + G.left : 'ENERGY CELLS \u221E');
  $('hRel').style.width = G.reload > 0 ? ((1 - G.reload / 1.4) * 100) + '%' : '0%';
}
const HINTS = {
  laptop: ['Aim the crosshair at a robot and click to shoot. WASD to move.', 'Headshots (glowing head) score extra. Press R to reload.'],
  phone: ['Drag the screen to aim, tap FIRE to shoot. Use the joystick to move.', 'Headshots (glowing head) score extra. Tap \u27F3 to reload.']
};
function setHint(i) { const h = $('hint'); if (i < 0 || M !== MISSIONS[0]) { h.style.display = 'none'; return; } h.textContent = HINTS[G.device || 'laptop'][i]; h.style.display = 'block'; }

/* ---------------- Screens ---------------- */
const screens = Array.from(document.querySelectorAll('.screen'));
function show(id) { screens.forEach(s => s.classList.toggle('show', s.id === id)); }
function lockPointer() {
  if (G.device !== 'laptop') return;
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}
function unlockPointer() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {} }

/* ---------------- Flow ---------------- */
function spawnWave() {
  G.wave++;
  const n = M.count / M.waves;
  for (let i = 0; i < n; i++) spawnTarget(pick(M.kinds), (G.wave > 1 && Math.random() < M.armor) ? 3 : 1);
  G.spawned += n;
  if (M.waves > 1) toast('WAVE ' + G.wave + ' / ' + M.waves);
}
function startMission(i) {
  G.mission = i; buildWorld(MISSIONS[i]);
  Object.assign(G, { mode: 'play', paused: false, over: false, score: 0, kills: 0, shots: 0, hits: 0, combo: 0, time: 0,
    mag: M.mag, left: M.shots, reload: 0, fireCd: 0.3, wave: 0, spawned: 0, waveWait: 0 });
  P.x = 0; P.z = ARENA - 8; P.yaw = 0; P.pitch = 0; P.vx = P.vz = 0; firing = false; kick = 0;
  document.body.classList.add('playing'); $('hud').classList.remove('hidden'); gun.visible = true;
  show(null); spawnWave();
  if (M.waves === 1) toast('MISSION ' + (i + 1) + ' — ' + M.name.toUpperCase());
  setHint(0); G.hintStage = 0; updateHud(); lockPointer(); sfx.click();
}
function toMenu() {
  unlockPointer(); firing = false;
  G.mode = 'menu'; G.paused = false; G.over = false; G.time = 0;
  document.body.classList.remove('playing'); $('hud').classList.add('hidden'); gun.visible = false;
  buildWorld(MISSIONS[2]);
  for (let i = 0; i < 7; i++) spawnTarget(pick(['walker', 'drone']), 1);
  refreshMain(); show('sMain');
}
function pause() {
  if (G.mode !== 'play' || G.over || G.paused) return;
  G.paused = true; firing = false; unlockPointer(); show('sPause');
}
function resume() { if (G.mode !== 'play' || !G.paused) return; G.paused = false; show(null); lockPointer(); sfx.click(); }
function finish(win, reason) {
  if (G.over) return; G.over = true; firing = false; unlockPointer();
  if (win) {
    const timeBonus = M.time ? Math.max(0, Math.round(M.time - G.time)) * 10 : 0;
    const acc = G.shots ? G.hits / G.shots : 0, accBonus = Math.round(acc * 500), total = G.score + timeBonus + accBonus;
    const prev = save.best[G.mission] || 0, isBest = total > prev;
    if (isBest) save.best[G.mission] = total;
    save.high = Math.max(save.high, total);
    save.unlocked = Math.min(MISSIONS.length, Math.max(save.unlocked, G.mission + 2));
    persist(); sfx.win();
    setTimeout(() => showEnd(true, { timeBonus, accBonus, acc, total, isBest }), 900);
  } else { sfx.lose(); setTimeout(() => showEnd(false, { reason }), 700); }
}
function showEnd(win, r) {
  if (G.mode !== 'play' || !G.over) return;
  const last = G.mission === MISSIONS.length - 1;
  $('eTitle').textContent = win ? (last ? 'Campaign Complete' : 'Mission Complete') : 'Mission Failed';
  $('eSub').textContent = win ? (r.isBest ? 'NEW PERSONAL BEST!' : M.name) : r.reason;
  const rows = win ? [['Targets', G.kills + '/' + M.count], ['Accuracy', Math.round(r.acc * 100) + '%'], ['Mission Score', G.score], ['Time Bonus', r.timeBonus], ['Accuracy Bonus', r.accBonus], ['Best', save.best[G.mission]]]
    : [['Targets', G.kills + '/' + M.count], ['Shots Fired', G.shots], ['Score', G.score]];
  $('eStats').innerHTML = rows.map(a => '<div>' + a[0] + '<b>' + a[1] + '</b></div>').join('') + (win ? '<div class="tot">TOTAL<b>' + r.total + '</b></div>' : '');
  $('eNext').style.display = win && !last ? '' : 'none';
  show('sEnd');
}

/* ---------------- Shooting ---------------- */
const ray = new THREE.Raycaster(); ray.far = 160;
const CENTER = new THREE.Vector2(0, 0), mv = new THREE.Vector3(), endP = new THREE.Vector3();
function startReload() { if (G.reload > 0 || G.mag >= M.mag || G.mode !== 'play') return; G.reload = 1.4; sfx.reload(); }
function shoot() {
  if (G.mode !== 'play' || G.paused || G.over || G.fireCd > 0 || G.reload > 0) return;
  if (G.mag <= 0) { sfx.empty(); G.fireCd = 0.3; startReload(); return; }
  if (M.shots && G.left <= 0) return;
  G.mag--; G.shots++; if (M.shots) G.left--; G.fireCd = 0.16; kick = 1; flashT = 0.05; muzzleLight.intensity = 2.5; sfx.shoot();
  ray.setFromCamera(CENTER, camera);
  const hs = ray.intersectObjects(shootables, false);
  let hit = null;
  for (const h of hs) { const t = h.object.userData.t; if (t && !t.alive) continue; hit = h; break; }
  muzzle.getWorldPosition(mv);
  if (hit) endP.copy(hit.point); else ray.ray.at(120, endP);
  tracer(mv, endP);
  if (hit) {
    const u = hit.object.userData;
    if (u.t) damage(u.t, u.part, hit.point);
    else { emit(hit.point, 10, tracerColor, 4, 0.45); G.combo = 0; }
  } else G.combo = 0;
  if (G.hintStage === 0) { G.hintStage = 1; setHint(1); setTimeout(() => setHint(-1), 9000); }
  if (!G.over && M.shots && G.left <= 0 && G.kills < M.count) finish(false, 'Out of shots — ' + (M.count - G.kills) + ' targets remain');
  else if (G.mag <= 0 && !(M.shots && G.left <= 0)) startReload();
}
function damage(t, part, pt) {
  const head = part === 'head'; t.hp -= head ? 3 : 1; t.flash = 0.12; G.hits++; G.combo++;
  if (t.hp <= 0) {
    const pts = (head ? 150 : 100) * mult() * (t.max > 1 ? 2 : 1);
    G.score += pts; G.kills++; t.alive = false; t.dying = 0.35;
    emit(pt, 36, t.glow.color, 9, 0.9); emit(pt, 14, 0xffffff, 6, 0.5);
    sfx.kill(); if (head) sfx.head();
    retrigger($('hit'), 'kill'); feed('+' + pts + (head ? ' HEADSHOT' : '') + (mult() > 1 ? '  x' + mult() : ''));
    if (G.kills >= M.count) finish(true);
  } else {
    G.score += 25; sfx.hit(); emit(pt, 12, 0xffb020, 5, 0.45); retrigger($('hit')); feed('+25 ARMOR HIT');
  }
}

/* ---------------- Update loop ---------------- */
function updatePlay(dt) {
  if (G.over) return;
  const sens = 1;
  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
  let mz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + joy.y;
  const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
  const spd = ((keys.ShiftLeft || keys.ShiftRight || touchSprint) ? 10 : 6);
  const c = Math.cos(P.yaw), s = Math.sin(P.yaw);
  const tvx = (c * mx + s * mz) * spd, tvz = (-s * mx + c * mz) * spd, k = Math.min(1, dt * 12);
  P.vx += (tvx - P.vx) * k; P.vz += (tvz - P.vz) * k;
  const nx = P.x + P.vx * dt; if (!collides(nx, P.z, 0.5) && Math.abs(nx) < ARENA - 1.5) P.x = nx; else P.vx = 0;
  const nz = P.z + P.vz * dt; if (!collides(P.x, nz, 0.5) && Math.abs(nz) < ARENA - 1.5) P.z = nz; else P.vz = 0;
  const moving = Math.hypot(P.vx, P.vz);
  P.bob += dt * moving * 1.4;
  camera.position.set(P.x, 1.7 + Math.sin(P.bob) * 0.04 * Math.min(1, moving / 6), P.z);
  camera.rotation.set(P.pitch, P.yaw, 0);
  // gun animation
  kick = Math.max(0, kick - dt * 9);
  let ry = 0, rz = 0;
  if (G.reload > 0) { const p = 1 - G.reload / 1.4, w = Math.sin(p * Math.PI); ry = -w * 0.12; rz = w * 0.5; }
  gun.position.set(GUN_BASE.x + Math.sin(P.bob * 0.5) * 0.008, GUN_BASE.y + Math.sin(P.bob) * 0.008 + ry, GUN_BASE.z + kick * 0.06);
  gun.rotation.set(kick * 0.12, 0, rz);
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) muzzleLight.intensity = 0; }
  // timers
  G.fireCd -= dt; G.time += dt;
  if (G.reload > 0) { G.reload -= dt; if (G.reload <= 0) { G.reload = 0; G.mag = M.mag; } }
  if (firing) shoot();
  if (M.time && G.time >= M.time) finish(false, 'Time expired — ' + (M.count - G.kills) + ' targets remain');
  // waves
  if (G.waveWait > 0) { G.waveWait -= dt; if (G.waveWait <= 0) spawnWave(); }
  else if (M.waves > 1 && G.spawned < M.count && !G.over && !targets.some(t => t.alive)) { G.waveWait = 2.2; toast('WAVE CLEARED'); }
  updateHud();
}
let menuAng = 0;
function updateMenu(dt) {
  menuAng += dt * 0.12;
  const r = ARENA * 0.5;
  camera.position.set(Math.cos(menuAng) * r, 8, Math.sin(menuAng) * r);
  camera.lookAt(0, 3, 0);
}
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (G.mode === 'menu') { updateMenu(dt); updateTargets(dt); }
  else if (!G.paused) { updatePlay(dt); updateTargets(dt); }
  if (!G.paused) {
    updateParticles(dt);
    tracers.forEach(t => { if (t.life > 0) { t.life -= dt; t.m.material.opacity = Math.max(0, t.life / 0.1); if (t.life <= 0) t.m.visible = false; } });
  }
  renderer.render(scene, camera);
}

/* ---------------- Quality / resize ---------------- */
function applyQuality() {
  const q = S().quality, dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(dpr, q === 'high' ? 2 : 1.5));
  renderer.shadowMap.enabled = q !== 'low'; sun.castShadow = q !== 'low';
  const size = q === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  pQ = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.fov = w / h < 1 ? 95 : 75; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

/* ---------------- Input: keyboard + mouse ---------------- */
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'];
document.addEventListener('keydown', e => {
  if (G.mode === 'play' && GAME_KEYS.includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (G.mode !== 'play' || G.over) return;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Escape' || e.code === 'KeyP') { if (G.paused) resume(); else pause(); }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('mousemove', e => {
  if (G.mode !== 'play' || G.paused || G.over || document.pointerLockElement !== canvas) return;
  const f = 0.0022 * S().sens;
  P.yaw -= e.movementX * f; P.pitch = clamp(P.pitch - e.movementY * f, -1.45, 1.45);
});
document.addEventListener('mousedown', e => {
  if (G.device !== 'laptop' || G.mode !== 'play' || G.paused || G.over || e.button !== 0) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  firing = true; ac();
});
document.addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && G.mode === 'play' && !G.paused && !G.over && G.device === 'laptop') pause();
});
window.addEventListener('blur', () => { firing = false; for (const k in keys) keys[k] = false; pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { firing = false; pause(); } });
document.addEventListener('touchmove', e => { if (G.mode === 'play' && !G.paused) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => e.preventDefault());

/* ---------------- Input: touch (pointer events) ---------------- */
const joyEl = $('joy'), knob = $('knob'), lookEl = $('look');
let joyId = null, joyC = { x: 0, y: 0, r: 65 }, lookId = null, lx = 0, ly = 0;
function moveJoy(e) {
  let dx = (e.clientX - joyC.x) / joyC.r, dy = (e.clientY - joyC.y) / joyC.r; const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  joy.x = Math.abs(dx) < 0.1 ? 0 : dx; joy.y = Math.abs(dy) < 0.1 ? 0 : dy; touchSprint = l > 0.95;
  knob.style.transform = 'translate(' + (dx * joyC.r * 0.55) + 'px,' + (dy * joyC.r * 0.55) + 'px)';
}
function endJoy() { joyId = null; joy.x = joy.y = 0; touchSprint = false; knob.style.transform = ''; }
joyEl.addEventListener('pointerdown', e => {
  e.preventDefault(); ac(); joyId = e.pointerId; joyEl.setPointerCapture(e.pointerId);
  const r = joyEl.getBoundingClientRect(); joyC = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; moveJoy(e);
});
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joyId) moveJoy(e); });
['pointerup', 'pointercancel'].forEach(n => joyEl.addEventListener(n, e => { if (e.pointerId === joyId) endJoy(); }));
lookEl.addEventListener('pointerdown', e => { e.preventDefault(); ac(); lookId = e.pointerId; lookEl.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; });
lookEl.addEventListener('pointermove', e => {
  if (e.pointerId !== lookId || G.mode !== 'play' || G.paused || G.over) return;
  const f = 0.0045 * S().sens; P.yaw -= (e.clientX - lx) * f; P.pitch = clamp(P.pitch - (e.clientY - ly) * f, -1.45, 1.45); lx = e.clientX; ly = e.clientY;
});
['pointerup', 'pointercancel'].forEach(n => lookEl.addEventListener(n, e => { if (e.pointerId === lookId) lookId = null; }));
const fireBtn = $('fire'); let fireId = null;
fireBtn.addEventListener('pointerdown', e => { e.preventDefault(); ac(); fireId = e.pointerId; fireBtn.setPointerCapture(e.pointerId); firing = true; });
['pointerup', 'pointercancel'].forEach(n => fireBtn.addEventListener(n, e => { if (e.pointerId === fireId) { firing = false; fireId = null; } }));
$('reloadBtn').addEventListener('pointerdown', e => { e.preventDefault(); startReload(); });
$('pauseBtn').addEventListener('pointerdown', e => { e.preventDefault(); pause(); });

/* ---------------- Menus ---------------- */
function setDevice(d) {
  G.device = d; document.body.dataset.device = d; ac(); sfx.click();
  if (d === 'phone' && !S().qualityChosen) { S().quality = 'low'; }
  syncSettings(); applyQuality(); toMenu();
}
function refreshMain() {
  $('mainSub').textContent = G.device === 'phone' ? 'Touch Mode' : 'Keyboard + Mouse Mode';
  $('mainStats').textContent = 'High Score ' + save.high + '  ·  Missions unlocked ' + save.unlocked + '/' + MISSIONS.length;
}
function buildMissionList() {
  const l = $('missionList'); l.innerHTML = '';
  MISSIONS.forEach((m, i) => {
    const b = document.createElement('button'); b.className = 'mcard'; b.disabled = i + 1 > save.unlocked;
    const best = save.best[i];
    b.innerHTML = '<div class="n">' + (i + 1) + '</div><div class="t"><b>' + m.name + '</b><span>' + m.obj + '</span></div><div class="s">' +
      (b.disabled ? '&#128274; LOCKED' : best ? 'BEST<br>' + best : 'NEW') + '</div>';
    b.addEventListener('click', () => startMission(i));
    l.appendChild(b);
  });
}
let settingsFrom = 'sMain';
const SWATCHES = ['#00d4ff', '#2f8bff', '#b44dff', '#00ffa6', '#ff3b6b', '#ffb020'];
function syncSettings() {
  $('setSound').textContent = S().sound ? 'ON' : 'OFF'; $('setVol').value = S().vol; $('setQuality').value = S().quality;
  $('setSens').value = S().sens; $('setColor').value = S().color; setGunColor(S().color);
  document.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.dataset.c === S().color));
}
SWATCHES.forEach(c => {
  const s = document.createElement('div'); s.className = 'sw'; s.dataset.c = c; s.style.background = c; s.style.color = c;
  s.addEventListener('click', () => { S().color = c; persist(); syncSettings(); sfx.click(); }); $('swatches').appendChild(s);
});
const click = (id, fn) => $(id).addEventListener('click', () => { ac(); sfx.click(); fn(); });
click('btnLaptop', () => setDevice('laptop'));
click('btnPhone', () => setDevice('phone'));
click('btnPlay', () => { buildMissionList(); show('sMissions'); });
click('missionsBack', () => show('sMain'));
click('btnSettings', () => { settingsFrom = 'sMain'; show('sSettings'); });
click('btnControls', () => show('sControls'));
click('controlsBack', () => show('sMain'));
click('btnDevice', () => show('sDevice'));
click('btnReset', () => {
  if (confirm('Restart the campaign? All mission progress and scores will be erased.')) {
    save.unlocked = 1; save.best = {}; save.high = 0; persist(); refreshMain();
  }
});
click('settingsBack', () => show(settingsFrom));
click('setSound', () => { S().sound = !S().sound; persist(); syncSettings(); sfx.click(); });
$('setVol').addEventListener('input', e => { S().vol = +e.target.value; persist(); });
$('setVol').addEventListener('change', () => sfx.shoot());
$('setSens').addEventListener('input', e => { S().sens = +e.target.value; persist(); });
$('setQuality').addEventListener('change', e => { S().quality = e.target.value; S().qualityChosen = true; persist(); applyQuality(); });
$('setColor').addEventListener('input', e => { S().color = e.target.value; persist(); syncSettings(); });
click('setFs', () => {
  try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) {}
});
click('pResume', resume);
click('pRestart', () => startMission(G.mission));
click('pSettings', () => { settingsFrom = 'sPause'; show('sSettings'); });
click('pMenu', toMenu);
click('eNext', () => startMission(Math.min(MISSIONS.length - 1, G.mission + 1)));
click('eRetry', () => startMission(G.mission));
click('eMenu', toMenu);

/* ---------------- Boot ---------------- */
gun.visible = false; syncSettings(); applyQuality(); resize();
buildWorld(MISSIONS[2]);
for (let i = 0; i < 7; i++) spawnTarget(pick(['walker', 'drone']), 1);
requestAnimationFrame(loop);
})();
