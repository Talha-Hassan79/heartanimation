/**
 * Heart Animation — 3D Three.js version
 *
 * Architecture:
 *  1. Static heart — 9 000 pts sampled on a 3-D heart-of-revolution surface
 *  2. Emitted particles — 2 500 sparks that fly outward from the rotating heart
 *  3. Background stars  — 500 faint distant dots
 *  Post-processing: UnrealBloomPass for physically-based glow
 *  Controls: OrbitControls (drag to orbit, scroll to zoom)
 */

import * as THREE from 'three';
import { OrbitControls }   from 'three/addons/controls/OrbitControls.js';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const CFG = {
  heartN:   9000,   // static surface particles
  emitN:    2500,   // flying emitted sparks
  starN:     500,   // background star count
  heartS:     12,   // heart formula → scene-unit scale
  emitDur:   2.4,   // emitted particle lifetime (seconds)
  emitSpd:    55,   // emitted particle base speed (units/s)
  rotSpeed:  0.28,  // heart Y-rotation speed (rad/s)
};

// ─────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('c'),
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ─────────────────────────────────────────────────────────────
// Scene & Camera
// ─────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020818);
scene.fog = new THREE.FogExp2(0x020818, 0.00052);

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.5, 2000
);
camera.position.set(0, 0, 480);

// ─────────────────────────────────────────────────────────────
// OrbitControls — user can drag to orbit / scroll to zoom
// ─────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;
controls.enablePan      = false;
controls.minDistance    = 140;
controls.maxDistance    = 950;
controls.rotateSpeed    = 0.55;

// ─────────────────────────────────────────────────────────────
// Post-processing — bloom gives particles the "glowing" look
// ─────────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,   // strength
  0.55,  // radius
  0.12   // luminance threshold
);
composer.addPass(bloom);

// ─────────────────────────────────────────────────────────────
// Resize handler
// ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────
// Heart surface math
// 3-D heart = classic 2-D heart curve rotated around Y-axis
//   x(u,v) = r(u)·cos(v)
//   y(u,v) = y_curve(u)
//   z(u,v) = r(u)·sin(v) · 0.60   ← slight Z-compression for realism
//
// u ∈ [0, π]   → traces the heart profile from divot (top) to tip (bottom)
// v ∈ [0, 2π]  → rotates around Y
// ─────────────────────────────────────────────────────────────
const HS = CFG.heartS;

function heartPt(u, v) {
  const r  = 16 * Math.pow(Math.sin(u), 3);
  const yv = 13*Math.cos(u) - 5*Math.cos(2*u) - 2*Math.cos(3*u) - Math.cos(4*u);
  return new THREE.Vector3(
    HS * r * Math.cos(v),
    HS * yv,
    HS * r * Math.sin(v) * 0.60
  );
}

function randHPt() {
  return heartPt(Math.random() * Math.PI, Math.random() * Math.PI * 2);
}

// ─────────────────────────────────────────────────────────────
// Custom particle shaders
// Per-particle attributes: aSize, aColor, aAlpha
// Fragment: bright white core that bleeds into the particle color,
//           with smooth circular falloff — bloom does the rest.
// ─────────────────────────────────────────────────────────────
const VERT = /* glsl */`
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aAlpha;
  varying   vec3  vColor;
  varying   float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // perspective-correct point size
    gl_PointSize = aSize * (400.0 / -mv.z);
    gl_Position  = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float glow = 1.0 - smoothstep(0.05, 0.50, dist);
    float core = 1.0 - smoothstep(0.00, 0.18, dist);
    // white-hot core → particle colour at edges
    vec3  col  = mix(vColor, vec3(1.0, 0.90, 0.95), core * 0.90);
    float a    = (glow * 0.60 + core * 0.95) * vAlpha;
    gl_FragColor = vec4(col, a);
  }
`;

function makeMat() {
  return new THREE.ShaderMaterial({
    vertexShader:   VERT,
    fragmentShader: FRAG,
    blending:       THREE.AdditiveBlending,
    transparent:    true,
    depthWrite:     false,
  });
}

// ─────────────────────────────────────────────────────────────
// BufferGeometry factory
// ─────────────────────────────────────────────────────────────
function makeGeo(n, dynamic = false) {
  const usage = dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(usage));
  geo.setAttribute('aColor',
    new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(usage));
  geo.setAttribute('aSize',
    new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(usage));
  geo.setAttribute('aAlpha',
    new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(usage));
  return geo;
}

// Shared colour object to avoid GC churn
const _col = new THREE.Color();
function writeColor(arr, i, h, s, l) {
  _col.setHSL(h, s, l);
  arr[i*3]   = _col.r;
  arr[i*3+1] = _col.g;
  arr[i*3+2] = _col.b;
}

// ═════════════════════════════════════════════════════════════
// 1. STATIC HEART PARTICLES
// ═════════════════════════════════════════════════════════════
const heartGeo = makeGeo(CFG.heartN);
const hPos = heartGeo.attributes.position.array;
const hCol = heartGeo.attributes.aColor.array;
const hSiz = heartGeo.attributes.aSize.array;
const hAlp = heartGeo.attributes.aAlpha.array;

for (let i = 0; i < CFG.heartN; i++) {
  const u = Math.random() * Math.PI;
  const v = Math.random() * Math.PI * 2;
  const p = heartPt(u, v);

  // Small positional jitter so it looks like a cloud, not a shell
  hPos[i*3]   = p.x + (Math.random() - 0.5) * 3.5;
  hPos[i*3+1] = p.y + (Math.random() - 0.5) * 3.5;
  hPos[i*3+2] = p.z + (Math.random() - 0.5) * 3.5;

  // Colour gradient: deep magenta at the tip → hot pink at the bumps
  // yRaw = −15 (tip) … +12 (bumps); normalise to t ∈ [0,1]
  const yRaw = 13*Math.cos(u) - 5*Math.cos(2*u) - 2*Math.cos(3*u) - Math.cos(4*u);
  const t = Math.max(0, Math.min(1, (yRaw + 15) / 27));
  writeColor(hCol, i,
    0.82 + t * 0.10,   // hue   0.82 (magenta) → 0.92 (hot-pink)
    1.0,
    0.46 + t * 0.24    // light 0.46 → 0.70 (brighter at bumps)
  );

  hSiz[i] = 2.2 + Math.random() * 5.0;
  hAlp[i] = 0.50 + Math.random() * 0.50;
}

// Group lets us rotate + scale the heart as one unit
const heartGroup = new THREE.Group();
heartGroup.add(new THREE.Points(heartGeo, makeMat()));
heartGroup.rotation.y = 0.45;   // start with a slight angle to reveal 3-D depth
scene.add(heartGroup);

// ═════════════════════════════════════════════════════════════
// 2. EMITTED / FLYING PARTICLES
// Circular spawn-index buffer — always overwrites the oldest slot
// ═════════════════════════════════════════════════════════════
const emitGeo = makeGeo(CFG.emitN, true);
const ePos = emitGeo.attributes.position.array;
const eCol = emitGeo.attributes.aColor.array;
const eSiz = emitGeo.attributes.aSize.array;
const eAlp = emitGeo.attributes.aAlpha.array;

const pool = Array.from({ length: CFG.emitN }, () => ({
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  age: 0, dur: CFG.emitDur,
  baseSize: 4, hue: 0.9,
  alive: false,
}));

let spawnIdx = 0;           // circular pointer into pool
const _tv = new THREE.Vector3();

function spawnOne() {
  const p = pool[spawnIdx];
  spawnIdx = (spawnIdx + 1) % CFG.emitN;

  // World-space position on the rotating heart surface
  const local = randHPt();
  _tv.copy(local).applyMatrix4(heartGroup.matrixWorld);
  p.x = _tv.x; p.y = _tv.y; p.z = _tv.z;

  // Outward direction from heart centre (world origin)
  const len = _tv.length() || 1;
  const spd = CFG.emitSpd * (0.38 + Math.random() * 0.92);
  p.vx = (_tv.x / len) * spd + (Math.random() - 0.5) * 18;
  p.vy = (_tv.y / len) * spd + (Math.random() - 0.5) * 18;
  p.vz = (_tv.z / len) * spd + (Math.random() - 0.5) * 18;

  p.age      = 0;
  p.dur      = 1.6 + Math.random() * 1.4;
  p.baseSize = 2.5 + Math.random() * 5.5;
  p.hue      = 0.86 + Math.random() * 0.09;
  p.alive    = true;
}

function updateEmit(dt) {
  // How many new sparks to emit this frame
  let toSpawn = (CFG.emitN / CFG.emitDur) * dt;
  while (toSpawn-- > 0) spawnOne();

  for (let i = 0; i < CFG.emitN; i++) {
    const p = pool[i];

    if (p.alive) {
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.z  += p.vz * dt;
      p.age += dt;
      if (p.age >= p.dur) p.alive = false;
    }

    const life = p.alive ? p.age / p.dur : 1;
    // Quadratic fade — vanishes quickly near end of life
    const fade = p.alive ? (1 - life) * (1 - life) * 0.95 : 0;

    // Teleport dead particles far away (avoids flicker at origin)
    ePos[i*3]   = p.alive ? p.x : 9e9;
    ePos[i*3+1] = p.alive ? p.y : 9e9;
    ePos[i*3+2] = p.alive ? p.z : 9e9;

    // Colour: starts deep pink, brightens toward white as it disperses
    writeColor(eCol, i, p.hue, 1.0, 0.52 + life * 0.42);
    eSiz[i] = p.baseSize * (1 - life * 0.52);
    eAlp[i] = fade;
  }

  emitGeo.attributes.position.needsUpdate = true;
  emitGeo.attributes.aColor.needsUpdate   = true;
  emitGeo.attributes.aSize.needsUpdate    = true;
  emitGeo.attributes.aAlpha.needsUpdate   = true;
}

scene.add(new THREE.Points(emitGeo, makeMat()));

// ═════════════════════════════════════════════════════════════
// 3. BACKGROUND STARS
// ═════════════════════════════════════════════════════════════
const starGeo = makeGeo(CFG.starN);
const sPos = starGeo.attributes.position.array;
const sCol = starGeo.attributes.aColor.array;
const sSiz = starGeo.attributes.aSize.array;
const sAlp = starGeo.attributes.aAlpha.array;

// Store per-star twinkle phase for animation
const starPhase = new Float32Array(CFG.starN);
const starSpeed = new Float32Array(CFG.starN);

for (let i = 0; i < CFG.starN; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const r     = 550 + Math.random() * 400;
  sPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
  sPos[i*3+1] = r * Math.cos(phi);
  sPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);

  const bri = 0.45 + Math.random() * 0.50;
  writeColor(sCol, i, 0.87 + Math.random() * 0.12, 0.50 + Math.random() * 0.50, bri);
  sSiz[i] = 0.5 + Math.random() * 2.0;
  sAlp[i] = 0.25 + Math.random() * 0.55;

  starPhase[i] = Math.random() * Math.PI * 2;
  starSpeed[i] = 0.6 + Math.random() * 1.8;
}

const starMesh = new THREE.Points(starGeo, makeMat());
scene.add(starMesh);

// ─────────────────────────────────────────────────────────────
// Star twinkle — updates sAlp each frame
// ─────────────────────────────────────────────────────────────
function twinkleStars(tm) {
  const alp = starGeo.attributes.aAlpha;
  for (let i = 0; i < CFG.starN; i++) {
    alp.array[i] = 0.20 + 0.50 * (0.5 + 0.5 * Math.sin(tm * starSpeed[i] + starPhase[i]));
  }
  alp.needsUpdate = true;
}

// ═════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ═════════════════════════════════════════════════════════════
let prevT = null;
let tm    = 0;

function render() {
  requestAnimationFrame(render);

  const now = performance.now() / 1000;
  const dt  = Math.min(now - (prevT ?? now), 0.05);
  prevT = now;
  tm   += dt;

  // ── Lub-dub heartbeat — 1.6 s period ──────────────────────
  const phase = (tm * 0.625) % 1;
  let beat = 1.0;
  if      (phase < 0.12) beat += 0.14 * Math.sin(phase / 0.12 * Math.PI);
  else if (phase < 0.22) beat -= 0.025 * Math.sin((phase - 0.12) / 0.10 * Math.PI);
  else if (phase < 0.32) beat += 0.09  * Math.sin((phase - 0.22) / 0.10 * Math.PI);

  // ── Rotate heart + heartbeat scale ────────────────────────
  heartGroup.rotation.y += dt * CFG.rotSpeed;
  heartGroup.rotation.x  = Math.sin(tm * 0.20) * 0.12;   // gentle nod
  heartGroup.scale.setScalar(beat);
  heartGroup.updateMatrixWorld();   // must come BEFORE emitted-particle spawning

  // ── Flash bloom on each beat ───────────────────────────────
  // beat peaks at ~1.14 (lub) and ~1.09 (dub)
  bloom.strength = 1.30 + (beat - 1) * 5.0;

  // ── Update subsystems ─────────────────────────────────────
  updateEmit(dt);
  twinkleStars(tm);
  controls.update();

  // ── Render with post-processing ───────────────────────────
  composer.render();
}

// ═════════════════════════════════════════════════════════════
// MODAL → start animation
// ═════════════════════════════════════════════════════════════
document.getElementById('ok-btn').addEventListener('click', () => {
  document.getElementById('modal').classList.add('hidden');

  // Staggered letter-by-letter text reveal
  document.querySelectorAll('.char').forEach((ch, i) => {
    setTimeout(() => ch.classList.add('visible'), 900 + i * 130);
  });

  // Show orbit hint after text finishes
  setTimeout(() => {
    document.getElementById('hint').classList.add('visible');
  }, 2400);

  render();
});