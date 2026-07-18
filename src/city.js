import * as THREE from 'three';
import { buildingMaterial, roadTile } from './materials.js';
import { Atmosphere, moonDirection } from './sky.js';

// One block = one week of commits (7 buildings, 2×4 slots, last slot = plaza).
// The grid repeats forever: block (c,r) hashes to a week of the user's year,
// so the same skyline motifs recur across an endless city — deterministically.
const DAYS = 7;
const SLOT = 13;
const SUB_COLS = 2, SUB_ROWS = 4;
export const ROAD = 24;
const BLOCK_W = SUB_COLS * SLOT, BLOCK_D = SUB_ROWS * SLOT;
export const PITCH_X = BLOCK_W + ROAD, PITCH_Z = BLOCK_D + ROAD;

export function plazaPos(bc, br) {
  return {
    x: bc * PITCH_X + ROAD / 2 + 1 * SLOT + SLOT / 2,
    z: br * PITCH_Z + ROAD / 2 + 3 * SLOT + SLOT / 2,
  };
}
const RADIUS_X = 6, RADIUS_Z = 5;
const COLS = RADIUS_X * 2 + 1, ROWS = RADIUS_Z * 2 + 1;
const MAX_B = COLS * ROWS * DAYS;
const LAMP_LIGHTS = 4;                                    // real light pool at nearest lamps

function hash2(c, r) {
  let h = (c * 374761393 + r * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const _c1 = new THREE.Color(), _c2 = new THREE.Color();

export class City {
  constructor(scene, data) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.days = data.days;
    this.weeks = Math.ceil(this.days.length / DAYS);
    this.maxCount = Math.max(1, ...this.days.map((d) => d.count));
    this.active = [];
    this.centerC = null; this.centerR = null;

    this.atmo = new Atmosphere(); this.group.add(this.atmo.group);

    // infinite ground: one big plane with the road tile repeated, follows the car
    const { map, roughnessMap } = roadTile({ pitchX: PITCH_X, pitchZ: PITCH_Z, road: ROAD, blockW: BLOCK_W, blockD: BLOCK_D });
    const SPAN_X = PITCH_X * (COLS + 5), SPAN_Z = PITCH_Z * (ROWS + 5);
    map.repeat.set(SPAN_X / PITCH_X, SPAN_Z / PITCH_Z);
    roughnessMap.repeat.set(SPAN_X / PITCH_X, SPAN_Z / PITCH_Z);
    this.groundMat = new THREE.MeshStandardMaterial({ map, roughnessMap, roughness: 1.0, metalness: 0.0 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(SPAN_X, SPAN_Z), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
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
    this.towers.castShadow = this.towers.receiveShadow = true;

    const roofGeo = new THREE.BoxGeometry(1, 1, 1); roofGeo.translate(0, 0.5, 0);
    this.roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x0b0c12, roughness: 0.9 }), MAX_B);
    this.roofs.castShadow = this.roofs.receiveShadow = true;

    this.beacons = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.55, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2233 }), MAX_B);

    // street podiums: every tower sits on a 2-storey base, like a real block
    const podGeo = new THREE.BoxGeometry(1, 1, 1); podGeo.translate(0, 0.5, 0);
    this.podiums = new THREE.InstancedMesh(podGeo, new THREE.MeshStandardMaterial({ color: 0x1f222b, roughness: 0.85, metalness: 0.1 }), MAX_B);
    this.podiums.castShadow = this.podiums.receiveShadow = true;

    // rooftop clutter: AC units / bulkheads on tall towers
    const propGeo = new THREE.BoxGeometry(1, 1, 1); propGeo.translate(0, 0.5, 0);
    this.props = new THREE.InstancedMesh(propGeo, new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.8, metalness: 0.3 }), MAX_B * 2);
    this.props.castShadow = this.props.receiveShadow = true;

    // street trees ringing each block's sidewalk
    const TREES_PER_BLOCK = 4, treeCount = COLS * ROWS * TREES_PER_BLOCK;
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 2.6, 6); trunkGeo.translate(0, 1.3, 0);
    this.trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.95 }), treeCount);
    const canGeo = new THREE.IcosahedronGeometry(1.7, 1); canGeo.scale(1, 1.3, 1); canGeo.translate(0, 3.9, 0);
    this.canopyMat = new THREE.MeshStandardMaterial({ color: 0x14532a, roughness: 0.9 });
    this.canopies = new THREE.InstancedMesh(canGeo, this.canopyMat, treeCount);
    this.trunks.castShadow = this.canopies.castShadow = true;
    this.canopies.receiveShadow = true;

    const lampCount = COLS * ROWS;
    const postGeo = new THREE.CylinderGeometry(0.22, 0.28, 9, 6); postGeo.translate(0, 4.5, 0);
    this.posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x232630, roughness: 0.6, metalness: 0.6 }), lampCount);
    this.posts.castShadow = true;
    this.lampHeads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.45, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffc37a }), lampCount);
    this.lampPos = new Float32Array(lampCount * 2);

    for (const m of [this.towers, this.roofs, this.beacons, this.podiums, this.props, this.trunks, this.canopies, this.posts, this.lampHeads]) {
      m.frustumCulled = false; this.group.add(m);
    }

    // real sodium-vapor pools of light at the lamps nearest the car (night only)
    this.lampLights = [];
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const pl = new THREE.PointLight(0xffb46a, 0, 60, 1.7);
      pl.position.y = 8.6; this.group.add(pl); this.lampLights.push(pl);
    }
    this._lampTick = 0;

    this.carStart = { x: ROAD / 4, z: 0, heading: 0 };
    const busy = this.days.reduce((a, b) => (b.count > a.count ? b : a), { count: -1, date: '—' });
    this.stats = { total: data.total, year: data.year, busy, demo: data.demo };
    this.update(this.carStart.x, this.carStart.z, true);
    // tallest tower in the spawn window — the cinematic's anchor
    // (fallback when the year is all zeros so the shot never breaks)
    this.peak = this.active.reduce((a, b) => (b.top > (a?.top ?? -1) ? b : a), null)
      ?? { x: this.carStart.x + 30, z: this.carStart.z - 150, top: 55, count: 0, date: '—' };
  }

  update(px, pz, force = false) {
    const c = Math.floor(px / PITCH_X), r = Math.floor(pz / PITCH_Z);
    if (!force && c === this.centerC && r === this.centerR) return;
    this.centerC = c; this.centerR = r;

    const gx = c * PITCH_X, gz = r * PITCH_Z;
    this.ground.position.set(gx, 0, gz);
    this.apron.position.set(gx, -0.12, gz);
    this.atmo.follow(gx, gz);

    const dummy = new THREE.Object3D();
    this.active.length = 0;
    let bi = 0, gi = 0, li = 0, pi = 0, ti = 0;

    for (let dc = -RADIUS_X; dc <= RADIUS_X; dc++) for (let dr = -RADIUS_Z; dr <= RADIUS_Z; dr++) {
      const bc = c + dc, br = r + dr;
      const h0 = hash2(bc, br);
      const week = h0 % this.weeks;
      const bx = bc * PITCH_X + ROAD / 2, bz = br * PITCH_Z + ROAD / 2;

      // street trees on the sidewalk ring (skip some by hash: natural gaps)
      const treeSpots = [
        [bx + BLOCK_W * 0.33, bz - 1.7], [bx + BLOCK_W * 0.67, bz + BLOCK_D + 1.7],
        [bx - 1.7, bz + BLOCK_D * 0.67], [bx + BLOCK_W + 1.7, bz + BLOCK_D * 0.33],
      ];
      for (const [tx, tz] of treeSpots) {
        if (ti >= COLS * ROWS * 4) break;
        const th = hash2(bc * 31 + ti, br * 17 + ti);
        if (th % 5 === 0) continue;                            // gap
        const js = 0.85 + ((th >> 3) % 40) / 100;              // size jitter
        const jx = ((th >> 6) % 14) / 10 - 0.7, jz = ((th >> 10) % 14) / 10 - 0.7;
        dummy.position.set(tx + jx, 0, tz + jz); dummy.scale.set(js, js, js);
        dummy.rotation.set(0, th % 6, 0); dummy.updateMatrix();
        this.trunks.setMatrixAt(ti, dummy.matrix);
        this.canopies.setMatrixAt(ti, dummy.matrix);
        ti++;
      }

      const lx = bc * PITCH_X + ROAD / 2 - 3, lz = br * PITCH_Z + ROAD / 2 - 3;
      dummy.position.set(lx, 0, lz); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      this.posts.setMatrixAt(li, dummy.matrix);
      dummy.position.set(lx, 9, lz); dummy.updateMatrix();
      this.lampHeads.setMatrixAt(li, dummy.matrix);
      this.lampPos[li * 2] = lx; this.lampPos[li * 2 + 1] = lz;
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

        // podium base under every tower
        dummy.position.set(cx, 0, cz); dummy.scale.set(footW + 2.6, 3.4, footD + 2.6);
        dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        this.podiums.setMatrixAt(bi, dummy.matrix);

        // rooftop clutter on tall towers
        if (h > 14) {
          const nProps = (hs >> 12) % 3;
          for (let p = 0; p < nProps && pi < MAX_B * 2; p++) {
            const ph = hash2(bc * 53 + p * 7, br * 59 + s * 11 + p);
            dummy.position.set(
              cx + (((ph >> 2) % 60) / 10 - 3) * footW / 8,
              h + 0.55,
              cz + (((ph >> 8) % 60) / 10 - 3) * footD / 8
            );
            dummy.scale.set(1.1 + (ph % 16) / 10, 0.7 + ((ph >> 4) % 14) / 10, 1.1 + ((ph >> 6) % 16) / 10);
            dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
            this.props.setMatrixAt(pi, dummy.matrix); pi++;
          }
        }

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
    this.podiums.count = bi; this.props.count = pi;
    this.posts.count = li; this.lampHeads.count = li;
    this.trunks.count = ti; this.canopies.count = ti;
    this.towers.instanceMatrix.needsUpdate = true;
    this.towers.geometry.getAttribute('aInfo').needsUpdate = true;
    this.roofs.instanceMatrix.needsUpdate = true;
    this.podiums.instanceMatrix.needsUpdate = true;
    this.props.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
    this.canopies.instanceMatrix.needsUpdate = true;
    this.beacons.instanceMatrix.needsUpdate = true;
    this.posts.instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;
  }

  // continuous environment: dayK 0..1, warmK golden-hour weight
  applyEnv(sunDir, dayK, warmK, t) {
    const night = 1 - dayK;
    const sh = this.towers.material.userData.shader;
    if (sh) sh.uniforms.uNight.value = night;
    this.towers.material.envMapIntensity = 0.08 + 0.35 * dayK;
    this.atmo.update(sunDir, dayK, warmK, t);

    // lamp heads: sodium at night, dead grey by day
    this.lampHeads.material.color.setHex(0xffc37a).lerp(_c1.setHex(0x707684), dayK);
    this.apron.material.color.setHex(0x0a0b18).lerp(_c1.setHex(0x9aa3ad), dayK);
    // wet-look asphalt at night so lamps & neon pool on the road
    this.groundMat.roughness = 0.94 - night * 0.39;
    this.groundMat.envMapIntensity = 0.06 + night * 0.18;
    // greenery fades to silhouette at night
    this.canopyMat.color.setHex(0x1a6b35).lerp(_c1.setHex(0x0a1a10), night);
    // beacons breathe at night, near-dark by day
    const pulse = night * (0.55 + 0.45 * Math.sin(t * 2.2));
    this.beacons.material.color.setRGB(0.08 + pulse, 0.01, 0.02);
  }

  // move the real lamp lights to the nearest lamp heads (throttled by caller)
  updateLampLights(px, pz, nightK) {
    const n = this.lampPos.length / 2;
    const idx = [];
    for (let i = 0; i < n; i++) {
      const dx = this.lampPos[i * 2] - px, dz = this.lampPos[i * 2 + 1] - pz;
      idx.push([dx * dx + dz * dz, i]);
    }
    idx.sort((a, b) => a[0] - b[0]);
    const md = moonDirection();
    for (let k = 0; k < this.lampLights.length; k++) {
      const pl = this.lampLights[k], i = idx[k]?.[1] ?? 0;
      pl.position.set(this.lampPos[i * 2], 8.6, this.lampPos[i * 2 + 1]);
      pl.intensity = nightK * 34;
      pl.color.setHex(0xffb46a).lerp(_c2.setHex(0xbdd0ff), 1 - md.y); // constant warm, kept for clarity
    }
  }

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
