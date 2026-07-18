import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { fetchContributions, demoData } from './data.js';
import { City, PITCH_X, PITCH_Z, ROAD } from './city.js';
import { Car } from './car.js';
import { Game } from './game.js';
import { sound } from './sound.js';
import { sunDirection, dayFactor, sunsetFactor, moonDirection, PHASES } from './sky.js';

const LABELS = 24, LABEL_MAX = 120, LABEL_MIN = 18;

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0d20, 0.0035);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 3500);
camera.position.set(0, 30, -60);

const hemi = new THREE.HemisphereLight(0x44548a, 0x0b0c14, 1.05); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -95;
sun.shadow.camera.right = sun.shadow.camera.top = 95;
sun.shadow.camera.near = 20; sun.shadow.camera.far = 700;
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.8;
scene.add(sun, sun.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.8);
composer.addPass(bloom);

// --- world ---
const car = new Car(); scene.add(car.mesh, car.trail);
let city = null, game = null, ready = false, camMode = 0;

// --- time of day: one continuous clock; L jumps to the next photo phase ---
const clockState = { time: 13.0, target: 13.0, phase: 0 };
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
function cyclePhase() {
  clockState.phase = (clockState.phase + 1) % PHASES.length;
  clockState.target = PHASES[clockState.phase];
}
function setPhaseName(t) {
  const h = Math.floor(t) % 24, m = Math.floor((t % 1) * 60);
  const name = dayFactor(sunDirection(t, sunDir)) > 0.6 ? 'DAY' : sunsetFactor(sunDir) > 0.35 ? 'GOLDEN' : 'NIGHT';
  const el = $('clock');
  if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${name}`;
}

// preset lerps driven by dayK / warmK every frame
const C = (hex) => new THREE.Color(hex);
const PRESETS = {
  fog: [C(0x06070f), C(0xbfdaeF), C(0x2c1535)],       // night, day, sunset
  hemiSky: [C(0x51629c), C(0xbfd9ff), C(0x7a5a9c)],
  hemiGround: [C(0x11131c), C(0x8a929c), C(0x3a2030)],
  sunCol: [C(0x8fb0ff), C(0xfff4e0), C(0xff8c3a)],    // night slot = moonlight
};
const _c = new THREE.Color();
function mix3(arr, dayK, warmK, out) {
  out.copy(arr[0]).lerp(arr[1], dayK);
  return out.lerp(arr[2], warmK);
}

function applyEnvironment(t) {
  const night = 1 - dayFactor(sunDir), dayK = dayFactor(sunDir), warmK = sunsetFactor(sunDir);

  mix3(PRESETS.fog, dayK, warmK, _c);
  scene.fog.color.copy(_c);
  scene.fog.density = 0.0011 + night * 0.0017 + warmK * 0.0006;
  mix3(PRESETS.hemiSky, dayK, warmK, _c); hemi.color.copy(_c);
  mix3(PRESETS.hemiGround, dayK, warmK, _c); hemi.groundColor.copy(_c);
  hemi.intensity = 0.9 + dayK * 1.5;

  // sun by day/golden, moon at night — same shadow-casting rig
  const focus = mode === 'cine' ? camera.position : car.mesh.position;
  if (dayK > 0.03 || warmK > 0.03) {
    mix3(PRESETS.sunCol, dayK, warmK, _c); sun.color.copy(_c);
    sun.intensity = 0.25 + dayK * 2.9 + warmK * 1.1;
    sun.position.set(focus.x + sunDir.x * 260, Math.max(sunDir.y, 0.03) * 260, focus.z + sunDir.z * 260);
  } else {
    moonDirection(moonDir);
    sun.color.setHex(0x8fb0ff); sun.intensity = 0.38;
    sun.position.set(focus.x + moonDir.x * 260, moonDir.y * 260, focus.z + moonDir.z * 260);
  }
  // snap target to a coarse grid: kills shadow shimmer while driving
  sun.target.position.set(Math.round(focus.x / 4) * 4, 0, Math.round(focus.z / 4) * 4);

  renderer.toneMappingExposure = 1.02 + night * 0.18 + warmK * 0.08;
  bloom.strength = 0.1 + night * 0.34 + warmK * 0.16;
  bloom.threshold = 0.95 - night * 0.09;

  document.body.classList.toggle('day', ready && dayK > 0.55);
  city?.applyEnv(sunDir, dayK, warmK, t);
  car.setDay(night);
  setPhaseName(clockState.time);
}

// --- label sprite pool ---
const labelGroup = new THREE.Group(); scene.add(labelGroup);
const labels = [];
for (let i = 0; i < LABELS; i++) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.92 }));
  spr.scale.set(7, 3.5, 1); spr.visible = false;
  spr.userData = { ctx: cv.getContext('2d'), tex, text: null };
  labels.push(spr); labelGroup.add(spr);
}
function drawLabel(spr, txt) {
  if (spr.userData.text === txt) return;
  spr.userData.text = txt;
  const c = spr.userData.ctx; c.clearRect(0, 0, 128, 64);
  c.strokeStyle = 'rgba(0,240,255,.9)'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(4, 20); c.lineTo(4, 6); c.lineTo(22, 6); c.stroke();
  c.beginPath(); c.moveTo(124, 44); c.lineTo(124, 58); c.lineTo(106, 58); c.stroke();
  c.fillStyle = 'rgba(4,10,18,.78)'; c.fillRect(8, 10, 112, 44);
  c.font = 'bold 30px ui-monospace, monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#eaffff'; c.shadowColor = '#00f0ff'; c.shadowBlur = 6;
  c.fillText(txt, 64, 30);
  c.shadowBlur = 0; c.font = '10px ui-monospace, monospace'; c.fillStyle = 'rgba(0,240,255,.7)';
  c.fillText('COMMITS', 64, 50);
  spr.userData.tex.needsUpdate = true;
}

let nearest = null;
function updateLabels() {
  const near = [];
  const rx = mode === 'cine' ? camera.position.x : car.state.x;
  const rz = mode === 'cine' ? camera.position.z : car.state.z;
  nearest = null; let nd = Infinity;
  for (const b of city.active) {
    const dx = b.x - rx, dz = b.z - rz, d2 = dx * dx + dz * dz;
    if (d2 < nd) { nd = d2; nearest = b; }
    if (d2 > LABEL_MIN * LABEL_MIN && d2 < LABEL_MAX * LABEL_MAX) near.push([d2, b]);
  }
  near.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < labels.length; i++) {
    const spr = labels[i];
    if (i < near.length) {
      const b = near[i][1];
      spr.visible = true; spr.position.set(b.x, b.top + 4.5, b.z);
      drawLabel(spr, String(b.count));
    } else spr.visible = false;
  }
}

// --- input ---
const keys = {};
addEventListener('keydown', (e) => {
  if (mode === 'cine') { finishCine(true); return; }
  keys[e.code] = true;
  if (e.code === 'KeyR' && ready) car.reset(city.carStart);
  if (e.code === 'KeyC') camMode = (camMode + 1) % 2;
  if (e.code === 'KeyL') cyclePhase();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('pointerdown', () => { if (mode === 'cine') finishCine(true); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('message', (e) => {
  if (e.data?.ccKey) keys[e.data.ccKey] = !!e.data.down;
  if (e.data?.ccTeleport && ready) { car.state.x = e.data.ccTeleport.x; car.state.z = e.data.ccTeleport.z; car.state.velX = car.state.velZ = 0; }
  if (typeof e.data?.ccDay === 'boolean') { clockState.target = e.data.ccDay ? PHASES[0] : PHASES[2]; }
  if (typeof e.data?.ccTime === 'number') { clockState.time = clockState.target = e.data.ccTime; }
});

// touch controls: buttons mirror keyboard flags
for (const btn of document.querySelectorAll('#touch button')) {
  const code = btn.dataset.k;
  const on = (e) => { e.preventDefault(); keys[code] = true; btn.classList.add('held'); if (mode === 'cine') finishCine(true); };
  const off = (e) => { e.preventDefault(); keys[code] = false; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- chase camera ---
const camTarget = new THREE.Vector3(), lookTarget = new THREE.Vector3();
function chasePos(out) {
  const s = car.state;
  const cfg = camMode === 0 ? { dist: 13, height: 5.5, look: 2 } : { dist: 30, height: 17, look: 4 };
  out.set(s.x - Math.sin(s.heading) * cfg.dist, cfg.height, s.z - Math.cos(s.heading) * cfg.dist);
  return cfg;
}
function updateCamera(dt) {
  const cfg = chasePos(camTarget);
  camera.position.lerp(camTarget, Math.min(1, dt * 4.5));
  // look where the velocity points: drifting swings the view through the slide
  const s = car.state;
  lookTarget.set(
    s.x + s.velX * 0.22,
    cfg.look,
    s.z + s.velZ * 0.22
  );
  camera.lookAt(lookTarget);
  camera.rotateZ(-car._roll * 0.45);                       // lean with the body roll
  const spdK = Math.min(1, Math.abs(s.speed) / 66);
  const sh = spdK * spdK * 0.045;                          // road texture shake at speed
  camera.position.x += (Math.random() - 0.5) * sh;
  camera.position.y += (Math.random() - 0.5) * sh * 0.6;
}

// --- cinematic intro ---
const smoother = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
let mode = 'idle';
const cine = { t: 0, t0: 0, p2From: new THREE.Vector3(), look: new THREE.Vector3(), countDone: false };
const P0_END = 4.5, P1_END = 9.5, P2_END = 12.5;

function startCine() {
  mode = 'cine'; cine.t = 0; cine.t0 = performance.now(); cine.countDone = false;
  ['barTop', 'barBot'].forEach((id) => $(id).classList.add('on'));
  $('cineUser').textContent = `${$('hUser').textContent} // ${city.stats.year}`;
  $('cineSub').textContent = 'COMMITS THIS YEAR';
  $('cineCount').textContent = '0';
  setTimeout(() => { if (mode === 'cine') { $('cine').classList.add('on'); $('skipHint').classList.add('on'); } }, 350);
}

function cineUpdate() {
  const t = cine.t = (performance.now() - cine.t0) / 1000;
  const P = city.peak, top = P.top;

  if (t < P0_END) {
    const k = smoother(t / P0_END);
    camera.position.set(P.x - 110 + 55 * k, 180 - 95 * k, P.z - 260 + 120 * k);
    cine.look.set(P.x, top * 0.5, P.z);
    const c = smoother((t - 1.0) / 2.4);
    $('cineCount').textContent = Math.round(city.stats.total * c).toLocaleString();
  } else if (t < P1_END) {
    if (!cine.countDone) {
      cine.countDone = true;
      $('cineCount').textContent = city.stats.total.toLocaleString();
      $('cineSub').textContent = `PEAK DAY ${city.stats.busy.date} · ${city.stats.busy.count} COMMITS`;
    }
    const k = smoother((t - P0_END) / (P1_END - P0_END));
    const ang = -Math.PI * 0.75 + k * Math.PI * 1.1;
    const r = 95 - 35 * k, h = top + 75 - (top * 0.35 + 45) * k;
    camera.position.set(P.x + Math.cos(ang) * r, Math.max(h, 14), P.z + Math.sin(ang) * r);
    cine.look.set(P.x, top * 0.6 * (1 - k * 0.4), P.z);
    if (t > P1_END - 1) $('cine').classList.remove('on');
  } else if (t < P2_END) {
    $('cine').classList.remove('on');
    const k = smoother((t - P1_END) / (P2_END - P1_END));
    if (cine.p2From.lengthSq() === 0) cine.p2From.copy(camera.position);
    chasePos(camTarget);
    camera.position.lerpVectors(cine.p2From, camTarget, k);
    const s = car.state;
    cine.look.set(P.x + (s.x - P.x) * k, top * 0.36 * (1 - k) + 2 * k, P.z + (s.z - P.z) * k);
    if (t > P2_END - 1.2) { ['barTop', 'barBot'].forEach((id) => $(id).classList.remove('on')); $('skipHint').classList.remove('on'); }
  } else { finishCine(); return; }
  camera.lookAt(cine.look);
}

function finishCine(snap = false) {
  mode = 'drive';
  ['cine', 'skipHint'].forEach((id) => $(id).classList.remove('on'));
  ['barTop', 'barBot'].forEach((id) => $(id).classList.remove('on'));
  if (snap) { chasePos(camera.position); camera.lookAt(car.state.x, 2, car.state.z); }
  cine.p2From.set(0, 0, 0);
  ['hud', 'speedo', 'help', 'sector', 'tour', 'game', 'boostBar'].forEach((id) => $(id).classList.add('show'));
}

// --- loop ---
const $ = (id) => document.getElementById(id);
const clock = new THREE.Clock();
let hudTick = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // clock: ease toward the phase target, plus a slow living-world drift
  const cs = clockState;
  if (Math.abs(cs.target - cs.time) > 0.002) {
    cs.time += Math.sign(cs.target - cs.time) * Math.min(Math.abs(cs.target - cs.time), dt * 2.4);
  } else {
    cs.time = (cs.time + dt / 240) % 24;                     // 1 game hour ≈ 4 real min
    cs.target = cs.time;
  }
  sunDirection(cs.time, sunDir);
  applyEnvironment(t);

  if (ready) {
    if (mode === 'cine') {
      cineUpdate();
      updateLabels();
    } else {
      const boosting = game.boosting;
      car.update(dt, keys, (px, pz) => {
        const a = city.collideAt(px, pz);
        const b = game.collide(a.x, a.z);
        return { x: b.x, z: b.z, hit: a.hit || b.hit };
      }, boosting);
      city.update(car.state.x, car.state.z);
      if ((hudTick & 7) === 0) city.updateLampLights(car.state.x, car.state.z, 1 - dayFactor(sunDir));
      game.update(dt, car.state, keys, { PITCH_X, PITCH_Z, ROAD });
      sound.drive(car.state.speed, (keys.KeyW || keys.ArrowUp) ? 1 : 0, boosting);
      sound.drift(Math.min(1, car.state.drift / 14), Math.abs(car.state.speed));
      if (car.hitNow) sound.hit(car.hitNow);
      updateCamera(dt);
      const targetFov = boosting ? 74 : 62;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
      camera.updateProjectionMatrix();
      if (boosting) camera.position.x += (Math.random() - 0.5) * 0.22;
      updateLabels();
      $('spd').textContent = Math.round(Math.abs(car.state.speed) * 3.6);
      if ((hudTick++ & 15) === 0 && nearest) {
        $('hSector').textContent = `${nearest.date} · ${nearest.count} COMMITS`;
      }
    }
  }
  composer.render();
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// --- launch ---
async function launch() {
  const user = $('user').value.trim();
  if (!user) { $('err').textContent = 'enter a username'; return; }
  $('go').disabled = true; $('err').textContent = 'pulling commit grid…';

  fetch('/api/play', { method: 'POST', body: JSON.stringify({ user }) }).catch(() => {});

  let data;
  try { data = await fetchContributions(user); }
  catch (e) { $('err').textContent = `${e.message} — demo grid loaded`; data = demoData(); }

  if (city) scene.remove(city.group);
  if (game) scene.remove(game.group);
  city = new City(scene, data);
  game = new Game(scene, data);
  game.startAudio();
  car.reset(city.carStart);
  applyEnvironment(clock.elapsedTime);
  ready = true;

  const st = city.stats;
  $('hUser').textContent = st.demo ? `${user}//demo` : user;
  $('hTotal').textContent = st.total.toLocaleString();
  $('hYear').textContent = st.year;
  $('hBusy').textContent = `${st.busy.date} · ${st.busy.count}`;

  $('ui').classList.add('hidden');
  $('go').disabled = false;
  startCine();                                        // HUD reveals when the shot lands

  // test/automation hooks: ?fast skips the intro, ?keys=KeyW,KeyD holds inputs, ?time=18.5 sets the clock
  const qp = new URLSearchParams(location.search);
  if (qp.has('time')) { clockState.time = clockState.target = ((parseFloat(qp.get('time')) || 13) % 24 + 24) % 24; }
  if (qp.has('fast')) finishCine(true);
  for (const k of (qp.get('keys') || '').split(',')) if (k.trim()) keys[k.trim()] = true;
}
$('go').addEventListener('click', launch);
$('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') launch(); });
$('user').focus();
// shareable auto-launch: open #torvalds or #demo to skip the menu
if (location.hash.length > 1) {
  $('user').value = decodeURIComponent(location.hash.slice(1));
  launch();
}
