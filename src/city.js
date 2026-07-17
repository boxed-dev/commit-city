import * as THREE from 'three';
import { buildingMaterial, roadTile, skyDome } from './materials.js';

// One block = one week of commits (7 buildings, 2×4 slots, last slot = plaza).
// The grid repeats forever: block (c,r) hashes to a week of the user's year,
// so the same skyline motifs recur across an endless city — deterministically.
const DAYS = 7;
const SLOT = 13;
const SUB_COLS = 2, SUB_ROWS = 4;
export const ROAD = 24;
const BLOCK_W = SUB_COLS * SLOT, BLOCK_D = SUB_ROWS * SLOT;
export const PITCH_X = BLOCK_W + ROAD, PITCH_Z = BLOCK_D + ROAD;

// world position of a block's plaza (the unused 8th slot: sub col 1, row 3)
export function plazaPos(bc, br) {
  return {
    x: bc * PITCH_X + ROAD / 2 + 1 * SLOT + SLOT / 2,
    z: br * PITCH_Z + ROAD / 2 + 3 * SLOT + SLOT / 2,
  };
}
const RADIUS_X = 6, RADIUS_Z = 5;                       // streamed blocks around the car
const COLS = RADIUS_X * 2 + 1, ROWS = RADIUS_Z * 2 + 1;
const MAX_B = COLS * ROWS * DAYS;

function hash2(c, r) {
  let h = (c * 374761393 + r * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export class City {
  constructor(scene, data) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.days = data.days;
    this.weeks = Math.ceil(this.days.length / DAYS);
    this.maxCount = Math.max(1, ...this.days.map((d) => d.count));
    this.active = [];                                   // visible buildings (labels + collision)
    this.centerC = null; this.centerR = null;

    this.sky = skyDome(); this.stars = makeStars();
    this.group.add(this.sky, this.stars);

    // infinite ground: one big plane with the road tile repeated, follows the car
    const tex = roadTile({ pitchX: PITCH_X, pitchZ: PITCH_Z, road: ROAD, blockW: BLOCK_W, blockD: BLOCK_D });
    const SPAN_X = PITCH_X * (COLS + 5), SPAN_Z = PITCH_Z * (ROWS + 5); // even tile counts → edges land on tile boundaries
    tex.repeat.set(SPAN_X / PITCH_X, SPAN_Z / PITCH_Z);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(SPAN_X, SPAN_Z),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.group.add(this.ground);
    // vast dark apron so high shots never see a world edge
    this.apron = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000),
      new THREE.MeshBasicMaterial({ color: 0x0a0b18 })
    );
    this.apron.rotation.x = -Math.PI / 2; this.apron.position.y = -0.12;
    this.group.add(this.apron);

    // instanced pools (fixed capacity, matrices rewritten on recenter)
    const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
    this.aInfo = new Float32Array(MAX_B * 3);
    boxGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.aInfo, 3));
    this.towers = new THREE.InstancedMesh(boxGeo, buildingMaterial(), MAX_B);

    const roofGeo = new THREE.BoxGeometry(1, 1, 1); roofGeo.translate(0, 0.5, 0);
    this.roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.9 }), MAX_B);

    this.beacons = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2233 }), MAX_B);

    const lampCount = COLS * ROWS;
    const postGeo = new THREE.CylinderGeometry(0.22, 0.28, 9, 6); postGeo.translate(0, 4.5, 0);
    this.posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x232630, roughness: 0.6, metalness: 0.6 }), lampCount);
    this.lampHeads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.45, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffc37a }), lampCount);

    for (const m of [this.towers, this.roofs, this.beacons, this.posts, this.lampHeads]) {
      m.frustumCulled = false; this.group.add(m);
    }

    this.carStart = { x: ROAD / 4, z: 0, heading: 0 };   // right lane of a north-south avenue
    const busy = this.days.reduce((a, b) => (b.count > a.count ? b : a), { count: -1, date: '—' });
    this.stats = { total: data.total, year: data.year, busy, demo: data.demo };
    this.update(this.carStart.x, this.carStart.z, true);
    // tallest tower in the spawn window — the cinematic's anchor
    this.peak = this.active.reduce((a, b) => (b.top > (a?.top ?? -1) ? b : a), null);
  }

  // stream: rebuild instance data when the car crosses into a new block
  update(px, pz, force = false) {
    const c = Math.floor(px / PITCH_X), r = Math.floor(pz / PITCH_Z);
    if (!force && c === this.centerC && r === this.centerR) return;
    this.centerC = c; this.centerR = r;

    const gx = c * PITCH_X, gz = r * PITCH_Z;
    this.ground.position.set(gx, 0, gz);   // texture stays aligned: offsets are pitch-multiples
    this.apron.position.set(gx, -0.12, gz);
    this.sky.position.set(gx, 0, gz);
    this.stars.position.set(gx, 0, gz);

    const dummy = new THREE.Object3D();
    this.active.length = 0;
    let bi = 0, gi = 0, li = 0;

    for (let dc = -RADIUS_X; dc <= RADIUS_X; dc++) for (let dr = -RADIUS_Z; dr <= RADIUS_Z; dr++) {
      const bc = c + dc, br = r + dr;
      const h0 = hash2(bc, br);
      const week = h0 % this.weeks;
      const bx = bc * PITCH_X + ROAD / 2, bz = br * PITCH_Z + ROAD / 2; // pad centered in tile

      // street lamp beside this block's intersection (corner of the tile)
      const lx = bc * PITCH_X + ROAD / 2 - 3, lz = br * PITCH_Z + ROAD / 2 - 3;
      dummy.position.set(lx, 0, lz); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      this.posts.setMatrixAt(li, dummy.matrix);
      dummy.position.set(lx, 9, lz); dummy.updateMatrix();
      this.lampHeads.setMatrixAt(li, dummy.matrix);
      li++;

      for (let s = 0; s < DAYS; s++) {
        const day = this.days[week * DAYS + s];
        if (!day) continue;
        const hs = hash2(bc * 8 + s, br * 8 + s);
        const sc = s % SUB_COLS, sr = Math.floor(s / SUB_COLS);
        const cx = bx + sc * SLOT + SLOT / 2, cz = bz + sr * SLOT + SLOT / 2;
        const footW = SLOT - 1 - (hs % 30) / 10;
        const footD = SLOT - 1 - ((hs >> 4) % 30) / 10;
        const zero = day.count <= 0;
        const h = zero ? 2.6 + (hs % 3) : 6 + Math.pow(day.count, 0.72) * 5.0;

        dummy.position.set(cx, 0, cz); dummy.scale.set(footW, h, footD); dummy.updateMatrix();
        this.towers.setMatrixAt(bi, dummy.matrix);
        this.aInfo[bi * 3] = zero ? 0 : 0.16 + 0.5 * (day.count / this.maxCount);
        this.aInfo[bi * 3 + 1] = hs % 200;
        this.aInfo[bi * 3 + 2] = ((hs >> 8) % 100) / 100;

        dummy.position.set(cx, h, cz); dummy.scale.set(footW + 0.7, 0.55, footD + 0.7); dummy.updateMatrix();
        this.roofs.setMatrixAt(bi, dummy.matrix);

        if (h > 32) {
          dummy.position.set(cx, h + 2.4, cz); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          this.beacons.setMatrixAt(gi, dummy.matrix); gi++;
        }
        if (!zero) this.active.push({ x: cx, z: cz, halfX: footW / 2, halfZ: footD / 2, top: h, count: day.count, date: day.date });
        bi++;
      }
    }

    this.towers.count = bi; this.roofs.count = bi; this.beacons.count = gi;
    this.posts.count = li; this.lampHeads.count = li;
    this.towers.instanceMatrix.needsUpdate = true;
    this.towers.geometry.getAttribute('aInfo').needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;
    this.beacons.instanceMatrix.needsUpdate = true;
    this.posts.instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
  }

  setDay(day) {
    const sh = this.towers.material.userData.shader;
    if (sh) sh.uniforms.uNight.value = day ? 0 : 1;
    this.stars.visible = !day;
    const u = this.sky.material.uniforms;
    if (day) {
      u.top.value.set(0x4d9fe8); u.horizon.value.set(0xcfe6fa); u.glow.value.set(0xffe4b8);
      this.lampHeads.material.color.set(0x707684);
      this.apron.material.color.set(0x9aa3ad);
    } else {
      u.top.value.set(0x04050d); u.horizon.value.set(0x101336); u.glow.value.set(0x2c1b52);
      this.lampHeads.material.color.set(0xffc37a);
      this.apron.material.color.set(0x0a0b18);
    }
  }

  // circle vs building AABBs — only nearby actives
  collideAt(px, pz, R = 2.6) {
    let hit = false;
    for (const b of this.active) {
      if (Math.abs(b.x - px) > PITCH_X || Math.abs(b.z - pz) > PITCH_Z) continue;
      const qx = Math.max(b.x - b.halfX, Math.min(px, b.x + b.halfX));
      const qz = Math.max(b.z - b.halfZ, Math.min(pz, b.z + b.halfZ));
      const dx = px - qx, dz = pz - qz, d2 = dx * dx + dz * dz;
      if (d2 < R * R) { hit = true; const d = Math.sqrt(d2) || 1e-3; px = qx + (dx / d) * R; pz = qz + (dz / d) * R; }
    }
    return { x: px, z: pz, hit };
  }
}

function makeStars() {
  const n = 900, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const rr = 1000 + Math.random() * 350, t = Math.random() * Math.PI * 2, p = Math.random() * 0.5;
    pos[i * 3] = Math.cos(t) * Math.cos(p) * rr;
    pos[i * 3 + 1] = Math.sin(p) * rr + 60;
    pos[i * 3 + 2] = Math.sin(t) * Math.cos(p) * rr;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fb4ff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.65 }));
}
