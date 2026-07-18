import * as THREE from 'three';

// Simcade vehicle model: 2D velocity decomposed into car-frame forward/lateral,
// engine force curve + quadratic drag, kinematic-bicycle yaw with speed-sensitive
// steering lock, exponential lateral grip (handbrake cuts it -> real drifts),
// and visual weight transfer driven by the actual accelerations.
const MAX_FWD = 66, MAX_REV = 22;
const ENGINE = 62, DRAG = 0.006, ROLLING = 0.35, BRAKE = 95, HANDBRAKE = 70;
const WHEELBASE = 2.6, GRIP = 9.0, GRIP_HB = 1.9;
const TRAIL = 96;

export class Car {
  constructor() {
    const g = new THREE.Group();

    // -- materials --
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0x3d6f9e, metalness: 0.85, roughness: 0.22,
      clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.4,
    });
    this.paint = paint;
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x06121e, metalness: 0.3, roughness: 0.06, clearcoat: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0b0e, metalness: 0.4, roughness: 0.7 });

    // -- body: extruded Taycan side profile --
    const prof = new THREE.Shape();
    prof.moveTo(2.55, 0.42);
    prof.lineTo(2.5, 0.62);
    prof.quadraticCurveTo(2.2, 0.78, 1.5, 0.84);
    prof.quadraticCurveTo(0.7, 0.9, 0.45, 1.0);
    prof.quadraticCurveTo(0.1, 1.4, -0.5, 1.42);
    prof.quadraticCurveTo(-1.4, 1.34, -2.1, 0.98);
    prof.lineTo(-2.5, 0.88);
    prof.lineTo(-2.55, 0.45);
    prof.lineTo(-2.3, 0.3); prof.lineTo(2.3, 0.3);
    prof.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: 2.7, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.18, bevelSegments: 3, curveSegments: 10 });
    bodyGeo.translate(0, 0, -1.35);
    const body = new THREE.Mesh(bodyGeo, paint);
    body.rotation.y = -Math.PI / 2;
    g.add(body);

    const cp = new THREE.Shape();
    cp.moveTo(0.5, 1.0);
    cp.quadraticCurveTo(0.12, 1.36, -0.5, 1.38);
    cp.quadraticCurveTo(-1.35, 1.3, -1.95, 0.98);
    cp.lineTo(-1.2, 0.98); cp.lineTo(0.2, 0.98);
    cp.closePath();
    const canopyGeo = new THREE.ExtrudeGeometry(cp, { depth: 2.15, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
    canopyGeo.translate(0, 0.045, -1.075);
    const canopy = new THREE.Mesh(canopyGeo, glass);
    canopy.rotation.y = -Math.PI / 2;
    g.add(canopy);

    const box = (w, h, l, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
      m.position.set(x, y, z); g.add(m); return m;
    };

    box(3.15, 0.22, 4.6, dark, 0, 0.28, 0);
    box(3.2, 0.16, 0.55, dark, 0, 0.34, 2.5);
    box(0.34, 0.14, 0.3, paint, -1.62, 1.06, 0.62);
    box(0.34, 0.14, 0.3, paint, 1.62, 1.06, 0.62);

    // four-point DRLs
    const drl = new THREE.MeshBasicMaterial({ color: 0xf4faff });
    for (const sx of [-1, 1]) for (const [dy, dz] of [[0, 0], [0.13, 0.02], [0, 0.16], [0.13, 0.18]]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), drl);
      dot.position.set(sx * (0.95 + dz), 0.78 + dy, 2.52 - dz * 0.4); g.add(dot);
    }
    // full-width rear light bar + reverse lights
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x7a0a18 });
    box(2.75, 0.07, 0.06, this.tailMat, 0, 1.0, -2.62);
    this.revMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    box(0.5, 0.07, 0.05, this.revMat, -0.9, 0.55, -2.63);
    box(0.5, 0.07, 0.05, this.revMat, 0.9, 0.55, -2.63);
    // neon sills
    const trim = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    box(0.05, 0.05, 3.9, trim, -1.58, 0.34, 0);
    box(0.05, 0.05, 3.9, trim, 1.58, 0.34, 0);

    // wheels
    const tyreGeo = new THREE.CylinderGeometry(0.86, 0.86, 0.58, 20);
    const rimGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.6, 10);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.62, 8);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x8d939c, metalness: 1, roughness: 0.25 });
    this._wheels = [[-1.42, 1.62], [1.42, 1.62], [-1.42, -1.62], [1.42, -1.62]].map(([x, z]) => {
      const w = new THREE.Group();
      for (const [geo, mat] of [[tyreGeo, tyreMat], [rimGeo, rimMat], [hubGeo, tyreMat]]) {
        const m = new THREE.Mesh(geo, mat); m.rotation.z = Math.PI / 2; w.add(m);
      }
      w.position.set(x, 0.86, z); g.add(w); return w;
    });

    // lights
    const beam = new THREE.SpotLight(0xf6f2e2, 60, 140, Math.PI / 5.2, 0.55, 1.0);
    beam.position.set(0, 1.0, 2.3); beam.target.position.set(0, 0, 45);
    g.add(beam, beam.target); this.beam = beam;
    const fill = new THREE.PointLight(0xbfd4ff, 7, 34); fill.position.set(0, 2.2, 1.2);
    g.add(fill); this.fill = fill;
    const under = new THREE.PointLight(0x00f0ff, 3, 22); under.position.y = 0.4; g.add(under);
    this.under = under;

    // nitro flames
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const sheathMat = new THREE.MeshBasicMaterial({ color: 0xff6a12, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    this._flames = [-0.72, 0.72].map((x) => {
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.1, 8), coreMat);
      const sheath = new THREE.Mesh(new THREE.ConeGeometry(0.26, 2.0, 8), sheathMat);
      for (const f of [core, sheath]) { f.rotation.x = Math.PI / 2; f.position.set(x, 0.52, -2.75); f.visible = false; g.add(f); }
      return { core, sheath };
    });
    this.heat = new THREE.PointLight(0xff8a30, 0, 12); this.heat.position.set(0, 0.6, -3); g.add(this.heat);

    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    this.mesh = g;
    this.mesh.rotation.order = 'YXZ';
    // vel: world-space 2D velocity (drift capable); speed: signed forward speed
    this.state = { x: 0, z: 0, heading: 0, speed: 0, velX: 0, velZ: 0, latG: 0, drift: 0 };
    this._steer = 0; this._pitch = 0; this._roll = 0; this._accel = 0; this._brakeK = 0;

    // shared particle ribbon: orange boost fire / grey tyre smoke (vertex colors)
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL * 3);
    this.trailCol = new Float32Array(TRAIL * 3);
    this.trailLife = new Float32Array(TRAIL);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trail = new THREE.Points(this.trailGeo, new THREE.PointsMaterial({
      size: 2.4, transparent: true, opacity: 0.65, vertexColors: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.trail.frustumCulled = false;
    this._trailIdx = 0; this._trailT = 0;
  }

  reset(start) {
    Object.assign(this.state, { x: start.x, z: start.z, heading: start.heading, speed: 0, velX: 0, velZ: 0, latG: 0, drift: 0 });
    this._steer = 0; this.trailLife.fill(0);
    this._sync();
  }

  update(dt, keys, collideAt, boost = false) {
    const s = this.state;
    const fwd = keys.KeyW || keys.ArrowUp, back = keys.KeyS || keys.ArrowDown;
    const left = keys.KeyA || keys.ArrowLeft, right = keys.KeyD || keys.ArrowRight;
    const hb = !!keys.Space;
    const sinH = Math.sin(s.heading), cosH = Math.cos(s.heading);

    // car-frame velocity
    let vFwd = s.velX * sinH + s.velZ * cosH;
    let vLat = s.velX * cosH - s.velZ * sinH;

    // steering: rate-limited, lock shrinks with speed
    const steerIn = (left ? 1 : 0) - (right ? 1 : 0);
    const spdK = Math.min(1, Math.abs(vFwd) / MAX_FWD);
    const maxSteer = THREE.MathUtils.lerp(0.58, 0.15, spdK);
    const target = steerIn * maxSteer;
    const rate = (steerIn !== 0 ? 3.4 : 5.2) * dt;            // return-to-center is faster
    this._steer += THREE.MathUtils.clamp(target - this._steer, -rate, rate);

    // longitudinal forces
    const maxF = boost ? MAX_FWD * 1.55 : MAX_FWD;
    let F = 0;
    if (fwd) {
      const k = THREE.MathUtils.clamp(vFwd / maxF, 0, 1);
      F += ENGINE * (boost ? 1.5 : 1) * (1 - k * k);          // torque falls off near top speed
    }
    if (back) {
      if (vFwd > 1) F -= BRAKE;
      else F -= ENGINE * 0.55 * (1 - THREE.MathUtils.clamp(-vFwd / MAX_REV, 0, 1));
    }
    if (hb) F -= Math.sign(vFwd) * HANDBRAKE;
    F -= DRAG * vFwd * Math.abs(vFwd) + ROLLING * Math.sign(vFwd) * Math.min(1, Math.abs(vFwd));
    const prevFwd = vFwd;
    vFwd += F * dt;
    if (Math.abs(vFwd) < 0.12 && !fwd && !back) vFwd = 0;
    vFwd = THREE.MathUtils.clamp(vFwd, -MAX_REV, maxF * 1.02);
    this._accel = (vFwd - prevFwd) / Math.max(dt, 1e-4);

    // yaw: kinematic bicycle
    const yawRate = (vFwd / WHEELBASE) * Math.tan(this._steer) * (hb ? 1.35 : 1);
    s.heading += yawRate * dt;

    // lateral grip: handbrake slides the tail out
    const grip = hb ? GRIP_HB : GRIP;
    vLat *= Math.exp(-grip * dt);
    s.latG = yawRate * vFwd;
    s.drift = Math.abs(vLat);

    // back to world space with the NEW heading
    const sn2 = Math.sin(s.heading), cs2 = Math.cos(s.heading);
    s.velX = sn2 * vFwd + cs2 * vLat;
    s.velZ = cs2 * vFwd - sn2 * vLat;

    const r = collideAt(s.x + s.velX * dt, s.z + s.velZ * dt);
    const impact = r.hit ? Math.hypot(s.velX, s.velZ) : 0;
    s.x = r.x; s.z = r.z;
    if (r.hit) { s.velX *= 0.25; s.velZ *= 0.25; }
    this.hitNow = r.hit ? Math.min(1, impact / 40) : 0;
    s.speed = vFwd;

    // wheels: spin by true forward speed, steer fronts
    for (let i = 0; i < 4; i++) {
      const w = this._wheels[i];
      w.children.forEach((c) => { c.rotation.x += vFwd * dt * 1.16; });
      if (i < 2) w.rotation.y = this._steer;
    }

    // visual weight transfer from real accelerations
    const pitchT = THREE.MathUtils.clamp(-this._accel * 0.0028, -0.06, 0.075) - (boost ? 0.02 : 0);
    const rollT = THREE.MathUtils.clamp(s.latG * 0.0035, -0.08, 0.08);
    this._pitch += (pitchT - this._pitch) * Math.min(1, dt * 6);
    this._roll += (rollT - this._roll) * Math.min(1, dt * 6);

    // tail bright on brake, reverse white backing up
    this._brakeK = ((back && vFwd > 1) || (hb && Math.abs(vFwd) > 2)) ? 1 : 0;
    this._fx(dt, boost);
    this._sync();
  }

  _fx(dt, boost) {
    for (const { core, sheath } of this._flames) {
      core.visible = sheath.visible = boost;
      if (boost) {
        const j = 0.75 + Math.random() * 0.6;
        core.scale.set(j, 0.9 + Math.random() * 0.9, j);
        sheath.scale.set(j * 0.9, 0.8 + Math.random() * 1.3, j * 0.9);
      }
    }
    this.heat.intensity = boost ? 1.4 + Math.random() * 0.8 : 0;

    const s = this.state;
    const drifting = s.drift > 5 && Math.abs(s.speed) > 8;
    if (boost || drifting) {
      this._trailT += dt;
      while (this._trailT > 0.012) {
        this._trailT -= 0.012;
        const i = this._trailIdx = (this._trailIdx + 1) % TRAIL;
        const sinH = Math.sin(s.heading), cosH = Math.cos(s.heading);
        const spread = (Math.random() - 0.5) * (drifting ? 2.4 : 1.5);
        this.trailPos[i * 3] = s.x - sinH * 3.0 + cosH * spread;
        this.trailPos[i * 3 + 1] = 0.5 + Math.random() * 0.5;
        this.trailPos[i * 3 + 2] = s.z - cosH * 3.0 - sinH * spread;
        if (drifting && !boost) { const g = 0.32 + Math.random() * 0.2; this.trailCol.set([g, g, g * 1.05], i * 3); }
        else this.trailCol.set([1.0, 0.62 + Math.random() * 0.2, 0.15], i * 3);
        this.trailLife[i] = 1;
      }
    }
    let any = false;
    for (let i = 0; i < TRAIL; i++) {
      if (this.trailLife[i] <= 0) { this.trailPos[i * 3 + 1] = -50; continue; }
      this.trailLife[i] -= dt * 1.9;
      this.trailPos[i * 3 + 1] += dt * 1.6;
      any = true;
    }
    this.trail.visible = any;
    if (any) {
      this.trailGeo.getAttribute('position').needsUpdate = true;
      this.trailGeo.getAttribute('color').needsUpdate = true;
    }
  }

  // continuous: nightK 0 (day) .. 1 (night)
  setDay(nightK) {
    this.beam.intensity = 60 * nightK;
    this.fill.intensity = 7 * nightK;
    this.under.intensity = 0.5 + 2.5 * nightK;
    this.paint.envMapIntensity = 1.4 - nightK * 0.8;
    const tail = 0.18 + nightK * 0.3 + this._brakeK * 0.85;
    this.tailMat.color.setRGB(tail, tail * 0.06, tail * 0.1);
    const rev = this.state.speed < -0.4 ? 0.95 : 0.07;
    this.revMat.color.setRGB(rev, rev, rev * 0.96);
  }

  _sync() {
    this.mesh.position.set(this.state.x, 0, this.state.z);
    this.mesh.rotation.set(this._pitch, this.state.heading, this._roll);
  }
}
