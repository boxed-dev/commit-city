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

const LABELS = 24, LABEL_MAX = 120, LABEL_MIN = 18;   // annotate mid-distance buildings only

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b0d20, 0.0035);
// PBR environment: without this, metallic paint has nothing to reflect and goes black
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 3500);
camera.position.set(0, 30, -60);

scene.add(new THREE.HemisphereLight(0x44548a, 0x0b0c14, 1.05));
const moon = new THREE.DirectionalLight(0x9fb6ff, 0.4); moon.position.set(-1, 2, 1); scene.add(moon);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.8);
composer.addPass(bloom);

// --- world ---
const car = new Car(); scene.add(car.mesh, car.trail);
let city = null, game = null, ready = false, camMode = 0, isDay = false;

// --- day / night ---
const hemi = scene.children.find((c) => c.isHemisphereLight);
function applyTheme(day) {
  isDay = day;
  document.body.classList.toggle('day', day);
  if (day) {
    scene.fog.color.set(0xc6d9ec); scene.fog.density = 0.0021;
    hemi.color.set(0xffffff); hemi.groundColor.set(0x8a929c); hemi.intensity = 2.3;
    moon.color.set(0xfff3da); moon.intensity = 2.6; moon.position.set(0.6, 1.3, 0.4);
    bloom.strength = 0.12; bloom.threshold = 0.95;
    renderer.toneMappingExposure = 1.0;
  } else {
    scene.fog.color.set(0x0b0d20); scene.fog.density = 0.0028;
    hemi.color.set(0x51629c); hemi.groundColor.set(0x11131c); hemi.intensity = 1.55;
    moon.color.set(0x9fb6ff); moon.intensity = 0.75; moon.position.set(-1, 2, 1);
    bloom.strength = 0.5; bloom.threshold = 0.82;
    renderer.toneMappingExposure = 1.3;
  }
  city?.setDay(day);
  car.setDay(day);
}

// --- label sprite pool: cyberpunk count tags over nearby towers ---
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
  // angular bracket frame
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
  if (e.code === 'KeyL') applyTheme(!isDay);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('pointerdown', () => { if (mode === 'cine') finishCine(true); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
// remote-control hook (demos / automation): postMessage({ccKey:'KeyW', down:true})
addEventListener('message', (e) => {
  if (e.data?.ccKey) keys[e.data.ccKey] = !!e.data.down;
  if (e.data?.ccTeleport && ready) { car.state.x = e.data.ccTeleport.x; car.state.z = e.data.ccTeleport.z; }
  if (typeof e.data?.ccDay === 'boolean') applyTheme(e.data.ccDay);
});

// --- chase camera ---
const camTarget = new THREE.Vector3();
function chasePos(out) {
  const s = car.state;
  const cfg = camMode === 0 ? { dist: 13, height: 5.5, look: 2 } : { dist: 30, height: 17, look: 4 };
  out.set(s.x - Math.sin(s.heading) * cfg.dist, cfg.height, s.z - Math.cos(s.heading) * cfg.dist);
  return cfg;
}
function updateCamera(dt) {
  const cfg = chasePos(camTarget);
  camera.position.lerp(camTarget, Math.min(1, dt * 4.5));
  camera.lookAt(car.state.x, cfg.look, car.state.z);
}

// --- cinematic intro: scale → count-up → peak-tower orbit → swoop into chase ---
// One continuous eased shot; no cuts, so the handoff to driving keeps spatial context.
const smoother = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
let mode = 'idle';                                   // idle | cine | drive
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
  // wall-clock timeline: frame hiccups never slow the shot
  const t = cine.t = (performance.now() - cine.t0) / 1000;
  const P = city.peak, top = P.top;

  if (t < P0_END) {                                  // establish: high, slow descent
    const k = smoother(t / P0_END);
    camera.position.set(
      P.x - 110 + 55 * k,
      180 - 95 * k,
      P.z - 260 + 120 * k
    );
    cine.look.set(P.x, top * 0.5, P.z);
    // count-up between 1.0s and 3.4s — eased, lands exactly on total
    const c = smoother((t - 1.0) / 2.4);
    $('cineCount').textContent = Math.round(city.stats.total * c).toLocaleString();
  } else if (t < P1_END) {                           // orbit the peak tower
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
  } else if (t < P2_END) {                           // swoop down behind the car
    $('cine').classList.remove('on');                // safety: P1's fade can be skipped on a frame gap
    const k = smoother((t - P1_END) / (P2_END - P1_END));
    if (cine.p2From.lengthSq() === 0) cine.p2From.copy(camera.position);
    chasePos(camTarget);
    camera.position.lerpVectors(cine.p2From, camTarget, k);
    const s = car.state;
    cine.look.set(
      P.x + (s.x - P.x) * k,
      top * 0.36 * (1 - k) + 2 * k,
      P.z + (s.z - P.z) * k
    );
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
      game.update(dt, car.state, keys, { PITCH_X, PITCH_Z, ROAD });
      sound.drive(car.state.speed, (keys.KeyW || keys.ArrowUp) ? 1 : 0, boosting);
      if (car.hitNow) sound.hit(car.hitNow);
      updateCamera(dt);
      // nitro: FOV kick + a touch of shake
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

  fetch('/api/play', { method: 'POST', body: JSON.stringify({ user }) }).catch(() => {}); // analytics ping

  let data;
  try { data = await fetchContributions(user); }
  catch (e) { $('err').textContent = `${e.message} — demo grid loaded`; data = demoData(); }

  if (city) scene.remove(city.group);
  if (game) scene.remove(game.group);
  city = new City(scene, data);
  game = new Game(scene, data);
  game.startAudio();                                  // inside the launch click gesture
  car.reset(city.carStart);
  applyTheme(isDay);                                  // new city inherits current theme
  ready = true;

  const st = city.stats;
  $('hUser').textContent = st.demo ? `${user}//demo` : user;
  $('hTotal').textContent = st.total.toLocaleString();
  $('hYear').textContent = st.year;
  $('hBusy').textContent = `${st.busy.date} · ${st.busy.count}`;

  $('ui').classList.add('hidden');
  $('go').disabled = false;
  startCine();                                        // HUD reveals when the shot lands
}
$('go').addEventListener('click', launch);
$('user').addEventListener('keydown', (e) => { if (e.key === 'Enter') launch(); });
$('user').focus();
