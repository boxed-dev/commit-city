import * as THREE from 'three';
import { plazaPos } from './city.js';
import { sound } from './sound.js';

// The game layer: orbs → combo → nitro, and the Tour — five golden monuments,
// one per top commit day, scattered through the grid with a compass to guide you.
const ORBS = 34, ORB_R = 3.4, LM_R = 17;
const LM_BLOCKS = [[1, 2], [-3, 3], [4, -3], [-5, -2], [7, 4]]; // tour route, spiraling out

const $ = (id) => document.getElementById(id);

export class Game {
  constructor(scene, data) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.score = 0; this.combo = 0; this.comboT = 0; this.boost = 0; this.boosting = false;
    this.best = +(localStorage.getItem('cc_best') || 0);
    this.tourDone = 0; this.time = 0; this.finished = false;

    // --- top-5 days become the tour ---
    const ranked = [...data.days].sort((a, b) => b.count - a.count).slice(0, LM_BLOCKS.length);
    this.landmarks = ranked.map((day, i) => {
      const [bc, br] = LM_BLOCKS[i];
      const { x, z } = plazaPos(bc, br);
      return { day, rank: i + 1, x, z, visited: false };
    });
    this._buildLandmarks();
    this._buildOrbs();
    this._buildParticles();
    this._hud();
    $('tourN').textContent = `0/${this.landmarks.length}`;
  }

  _buildLandmarks() {
    this.lmMeshes = this.landmarks.map((lm) => {
      const g = new THREE.Group();
      const h = 46 - lm.rank * 3;
      const obelisk = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6, 3.2, h, 4, 1),
        new THREE.MeshStandardMaterial({ color: 0x2a1d06, emissive: 0xffb327, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.8 })
      );
      obelisk.position.y = h / 2; obelisk.rotation.y = Math.PI / 4; obelisk.castShadow = true; g.add(obelisk);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 300, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffcf5e, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
      );
      beam.position.y = 150; g.add(beam);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(7, 0.35, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0xffb327 })
      );
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.5; g.add(ring);
      // date banner
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 80;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(10,8,2,.8)'; c.fillRect(0, 0, 256, 80);
      c.strokeStyle = '#ffb327'; c.lineWidth = 3; c.strokeRect(3, 3, 250, 74);
      c.font = 'bold 26px ui-monospace,monospace'; c.textAlign = 'center'; c.fillStyle = '#ffe9b0';
      c.fillText(lm.day.date, 128, 33);
      c.font = '18px ui-monospace,monospace'; c.fillStyle = '#ffcf5e';
      c.fillText(`${lm.day.count} COMMITS · #${lm.rank}`, 128, 60);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
      spr.scale.set(16, 5, 1); spr.position.y = h + 6; g.add(spr);

      g.position.set(lm.x, 0, lm.z);
      this.group.add(g);
      return { g, beam, ring, obelisk };
    });
  }

  _buildOrbs() {
    const geo = new THREE.IcosahedronGeometry(0.75, 1);
    this.orbMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x2ee9ff }), ORBS);
    this.orbMesh.frustumCulled = false;
    this.group.add(this.orbMesh);
    this.orbs = Array.from({ length: ORBS }, () => ({ x: 0, z: 0, live: false }));
  }

  _buildParticles() {
    const N = 140;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pLife = 0;
    this.points = new THREE.Points(this.pGeo, new THREE.PointsMaterial({ color: 0xffd24a, size: 3.2, sizeAttenuation: true, transparent: true, depthWrite: false }));
    this.points.visible = false; this.group.add(this.points);
  }

  burst(x, y, z) {
    const N = this.pPos.length / 3;
    for (let i = 0; i < N; i++) {
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 18, u = Math.random() * 16;
      this.pVel[i * 3] = Math.cos(a) * v; this.pVel[i * 3 + 1] = 6 + u; this.pVel[i * 3 + 2] = Math.sin(a) * v;
    }
    this.pLife = 1.6; this.points.visible = true; this.points.material.opacity = 1;
  }

  // keep orbs strung along road corridors ahead of the car
  _respawnOrb(o, car, PITCH_X, PITCH_Z, ROAD) {
    const ahead = 50 + Math.random() * 130, side = (Math.random() - 0.5) * 120;
    let x = car.x + Math.sin(car.heading) * ahead + Math.cos(car.heading) * side;
    let z = car.z + Math.cos(car.heading) * ahead - Math.sin(car.heading) * side;
    if (Math.random() < 0.5) x = Math.round(x / PITCH_X) * PITCH_X + (Math.random() < 0.5 ? -1 : 1) * ROAD / 4;
    else z = Math.round(z / PITCH_Z) * PITCH_Z + (Math.random() < 0.5 ? -1 : 1) * ROAD / 4;
    o.x = x; o.z = z; o.live = true;
  }

  collide(px, pz, R = 2.6) {   // landmarks are solid
    let hit = false;
    for (const lm of this.landmarks) {
      const qx = Math.max(lm.x - 3, Math.min(px, lm.x + 3));
      const qz = Math.max(lm.z - 3, Math.min(pz, lm.z + 3));
      const dx = px - qx, dz = pz - qz, d2 = dx * dx + dz * dz;
      if (d2 < R * R) { hit = true; const d = Math.sqrt(d2) || 1e-3; px = qx + (dx / d) * R; pz = qz + (dz / d) * R; }
    }
    return { x: px, z: pz, hit };
  }

  update(dt, car, keys, consts) {
    this.time += dt;
    const { PITCH_X, PITCH_Z, ROAD } = consts;
    const dummy = new THREE.Object3D();

    // --- orbs: bob, spin, collect, respawn ---
    for (let i = 0; i < this.orbs.length; i++) {
      const o = this.orbs[i];
      const dx = o.x - car.x, dz = o.z - car.z, d2 = dx * dx + dz * dz;
      if (!o.live || d2 > 260 * 260) this._respawnOrb(o, car, PITCH_X, PITCH_Z, ROAD);
      if (o.live && d2 < ORB_R * ORB_R) {
        o.live = false;
        this.combo++; this.comboT = 4;
        this.score++;
        this.boost = Math.min(1, this.boost + 0.09 + this.combo * 0.012);
        sound.blip(this.combo);
        if (this.score > this.best) { this.best = this.score; localStorage.setItem('cc_best', String(this.best)); }
        this._hud();
      }
      const y = o.live ? 1.7 + Math.sin(this.time * 3 + i * 1.7) * 0.45 : -10;
      dummy.position.set(o.x, y, o.z);
      dummy.rotation.set(0, this.time * 2 + i, this.time * 1.3);
      const s = o.live ? 1 : 0.001; dummy.scale.set(s, s, s);
      dummy.updateMatrix(); this.orbMesh.setMatrixAt(i, dummy.matrix);
    }
    this.orbMesh.instanceMatrix.needsUpdate = true;

    // --- combo decay ---
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0 && this.combo) { this.combo = 0; this._hud(); } }

    // --- nitro ---
    const want = (keys.ShiftLeft || keys.ShiftRight) && this.boost > 0.05;
    if (want && !this.boosting) { this.boosting = true; sound.whoosh(); }
    if (!want) this.boosting = false;
    if (this.boosting) { this.boost = Math.max(0, this.boost - dt / 2.6); if (this.boost <= 0) this.boosting = false; }
    $('boostFill').style.width = `${Math.round(this.boost * 100)}%`;
    $('boostBar').classList.toggle('full', this.boost > 0.95);
    $('boostBar').classList.toggle('active', this.boosting);

    // --- landmarks: pulse, visit detection, compass ---
    let target = null, td = Infinity;
    this.landmarks.forEach((lm, i) => {
      const m = this.lmMeshes[i];
      m.ring.scale.setScalar(1 + Math.sin(this.time * 2.4 + i) * 0.08);
      const dx = lm.x - car.x, dz = lm.z - car.z, d2 = dx * dx + dz * dz;
      if (!lm.visited && d2 < td) { td = d2; target = lm; }
      if (!lm.visited && d2 < LM_R * LM_R) this._visit(lm, m);
    });
    if (target) {
      const bearing = Math.atan2(target.x - car.x, target.z - car.z) - car.heading;
      $('compass').style.transform = `rotate(${(-bearing * 180 / Math.PI).toFixed(1)}deg)`;
      $('tourDist').textContent = `${Math.round(Math.sqrt(td))}m`;
    } else { $('compass').style.transform = 'rotate(0deg)'; $('tourDist').textContent = '—'; }

    // --- particles ---
    if (this.pLife > 0) {
      this.pLife -= dt;
      const N = this.pPos.length / 3;
      for (let i = 0; i < N; i++) {
        this.pVel[i * 3 + 1] -= 22 * dt;
        this.pPos[i * 3] += this.pVel[i * 3] * dt;
        this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
        this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      }
      this.pGeo.getAttribute('position').needsUpdate = true;
      this.points.material.opacity = Math.max(0, this.pLife / 1.6);
      if (this.pLife <= 0) this.points.visible = false;
    }
  }

  _visit(lm, m) {
    lm.visited = true; this.tourDone++;
    m.beam.material.opacity = 0.05;
    m.ring.material.color.set(0x2ee9ff);
    m.obelisk.material.emissiveIntensity = 0.35;
    this.burst(lm.x, 10, lm.z);
    sound.chord();
    this.boost = 1;                                   // reward: full nitro
    const blurb = lm.rank === 1 ? 'YOUR BIGGEST DAY' : `#${lm.rank} DAY OF THE YEAR`;
    this._card(`${lm.day.date}`, `${lm.day.count} COMMITS`, blurb);
    $('tourN').textContent = `${this.tourDone}/${this.landmarks.length}`;
    if (this.tourDone === this.landmarks.length && !this.finished) {
      this.finished = true;
      setTimeout(() => { this._card('GRID CLEARED', `${$('hTotal').textContent} COMMITS · ${$('hYear').textContent}`, 'THE CITY IS YOURS'); sound.chord(); }, 4200);
    }
  }

  _card(a, b, c) {
    $('vcA').textContent = a; $('vcB').textContent = b; $('vcC').textContent = c;
    const el = $('visitCard'); el.classList.add('on');
    clearTimeout(this._cardT);
    this._cardT = setTimeout(() => el.classList.remove('on'), 3600);
  }

  _hud() {
    $('orbN').textContent = this.score;
    $('bestN').textContent = this.best;
    const cb = $('comboN');
    cb.textContent = this.combo > 1 ? `×${this.combo}` : '';
    cb.classList.remove('pop'); void cb.offsetWidth; cb.classList.add('pop');
  }

  startAudio() { sound.start(); }
}
