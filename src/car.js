import * as THREE from 'three';

const MAX_FWD = 66, MAX_REV = 24, ACCEL = 50, BRAKE = 100, FRICTION = 26, TURN = 2.5;
const TRAIL = 64;

export class Car {
  constructor() {
    const g = new THREE.Group();

    // -- materials --
    const paint = new THREE.MeshPhysicalMaterial({
      color: 0x3d6f9e, metalness: 0.85, roughness: 0.22,         // Frozen Blue metallic
      clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.4,
    });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x06121e, metalness: 0.3, roughness: 0.06, clearcoat: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0a0b0e, metalness: 0.4, roughness: 0.7 });

    // -- body: extruded Taycan side profile (x = forward, y = up), width via z --
    const prof = new THREE.Shape();
    prof.moveTo(2.55, 0.42);              // front bumper lip
    prof.lineTo(2.5, 0.62);
    prof.quadraticCurveTo(2.2, 0.78, 1.5, 0.84);       // curved nose → hood
    prof.quadraticCurveTo(0.7, 0.9, 0.45, 1.0);        // hood → cowl
    prof.quadraticCurveTo(0.1, 1.4, -0.5, 1.42);       // windshield → roof peak
    prof.quadraticCurveTo(-1.4, 1.34, -2.1, 0.98);     // fastback slope
    prof.lineTo(-2.5, 0.88);                            // ducktail
    prof.lineTo(-2.55, 0.45);                           // rear bumper
    prof.lineTo(-2.3, 0.3); prof.lineTo(2.3, 0.3);      // rocker line
    prof.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: 2.7, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.18, bevelSegments: 3, curveSegments: 10 });
    bodyGeo.translate(0, 0, -1.35);
    const body = new THREE.Mesh(bodyGeo, paint);
    body.rotation.y = -Math.PI / 2;                     // extrusion depth → car width
    g.add(body);

    // glass canopy: slimmer profile riding the same curve
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

    box(3.15, 0.22, 4.6, dark, 0, 0.28, 0);             // floor / diffuser line
    box(3.2, 0.16, 0.55, dark, 0, 0.34, 2.5);           // front splitter
    // mirrors
    box(0.34, 0.14, 0.3, paint, -1.62, 1.06, 0.62);
    box(0.34, 0.14, 0.3, paint, 1.62, 1.06, 0.62);

    // -- Taycan signature: four-point DRLs each side --
    const drl = new THREE.MeshBasicMaterial({ color: 0xf4faff });
    for (const sx of [-1, 1]) for (const [dy, dz] of [[0, 0], [0.13, 0.02], [0, 0.16], [0.13, 0.18]]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), drl);
      dot.position.set(sx * (0.95 + dz), 0.78 + dy, 2.52 - dz * 0.4); g.add(dot);
    }
    // full-width rear light bar
    box(2.75, 0.07, 0.06, new THREE.MeshBasicMaterial({ color: 0xff1430 }), 0, 1.0, -2.62);
    // neon sills
    const trim = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    box(0.05, 0.05, 3.9, trim, -1.58, 0.34, 0);
    box(0.05, 0.05, 3.9, trim, 1.58, 0.34, 0);

    // -- wheels: flat aero rims, flush --
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

    // -- lights: strong beams + soft fill so the road is actually visible --
    const beam = new THREE.SpotLight(0xf6f2e2, 60, 140, Math.PI / 5.2, 0.55, 1.0);
    beam.position.set(0, 1.0, 2.3); beam.target.position.set(0, 0, 45);
    g.add(beam, beam.target); this.beam = beam;
    const fill = new THREE.PointLight(0xbfd4ff, 7, 34); fill.position.set(0, 2.2, 1.2);
    g.add(fill); this.fill = fill;
    const under = new THREE.PointLight(0x00f0ff, 3, 22); under.position.y = 0.4; g.add(under);
    this.under = under;

    // -- nitro: asphalt-style fire — yellow-white core, orange sheath --
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const sheathMat = new THREE.MeshBasicMaterial({ color: 0xff6a12, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    this._flames = [-0.72, 0.72].map((x) => {
      const core = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.1, 8), coreMat);
      const sheath = new THREE.Mesh(new THREE.ConeGeometry(0.26, 2.0, 8), sheathMat);
      for (const f of [core, sheath]) { f.rotation.x = Math.PI / 2; f.position.set(x, 0.52, -2.75); f.visible = false; g.add(f); }
      return { core, sheath };
    });
    this.heat = new THREE.PointLight(0xff8a30, 0, 12); this.heat.position.set(0, 0.6, -3); g.add(this.heat);

    this.mesh = g;
    this.mesh.rotation.order = 'YXZ';                  // heading, then pitch/roll juice
    this.state = { x: 0, z: 0, heading: 0, speed: 0 };
    this._steer = 0; this._pitch = 0; this._roll = 0;

    // -- boost trail --
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(TRAIL * 3);
    this.trailLife = new Float32Array(TRAIL);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Points(this.trailGeo, new THREE.PointsMaterial({
      color: 0xffa236, size: 2.2, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    this.trail.frustumCulled = false;
    this._trailIdx = 0; this._trailT = 0;
  }

  reset(start) {
    Object.assign(this.state, { x: start.x, z: start.z, heading: start.heading, speed: 0 });
    this.trailLife.fill(0);
    this._sync();
  }

  update(dt, keys, collideAt, boost = false) {
    const s = this.state;
    const fwd = keys.KeyW || keys.ArrowUp, back = keys.KeyS || keys.ArrowDown;
    const left = keys.KeyA || keys.ArrowLeft, right = keys.KeyD || keys.ArrowRight;
    const maxF = boost ? MAX_FWD * 1.55 : MAX_FWD;
    const acc = boost ? ACCEL * 1.8 : ACCEL;

    if (fwd) s.speed += acc * dt;
    else if (back) s.speed -= acc * dt;
    else s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), FRICTION * dt);
    if (keys.Space) s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), BRAKE * dt);
    s.speed = Math.max(-MAX_REV, Math.min(maxF, s.speed));

    const grip = Math.min(1, Math.abs(s.speed) / 6) * (s.speed < 0 ? -1 : 1);
    if (left) s.heading += TURN * dt * grip;
    if (right) s.heading -= TURN * dt * grip;

    const nx = s.x + Math.sin(s.heading) * s.speed * dt;
    const nz = s.z + Math.cos(s.heading) * s.speed * dt;
    const r = collideAt(nx, nz);
    s.x = r.x; s.z = r.z;
    this.hitNow = r.hit ? Math.min(1, Math.abs(s.speed) / 40) : 0;   // impact strength for sfx
    if (r.hit) s.speed *= 0.2;

    for (const w of this._wheels) w.children.forEach((c) => { c.rotation.x += s.speed * dt * 1.2; });

    // visual juice: front wheels steer, body pitches on throttle, rolls in corners
    const steerT = (left ? 1 : 0) - (right ? 1 : 0);
    this._steer += (steerT * 0.32 - this._steer) * Math.min(1, dt * 8);
    this._wheels[0].rotation.y = this._wheels[1].rotation.y = this._steer;
    const spdK = Math.min(1, Math.abs(s.speed) / MAX_FWD);
    const pitchT = (fwd ? -0.028 : back ? 0.03 : 0) - (boost ? 0.03 : 0) + (keys.Space ? 0.045 * spdK : 0);
    const rollT = -steerT * 0.05 * spdK * (s.speed < 0 ? -1 : 1);
    this._pitch += (pitchT - this._pitch) * Math.min(1, dt * 5);
    this._roll += (rollT - this._roll) * Math.min(1, dt * 5);

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
    this.heat.intensity = boost ? 1.4 + Math.random() * 0.8 : 0;   // low warm flicker, not a floodlight

    if (boost) {
      this._trailT += dt;
      while (this._trailT > 0.012) {
        this._trailT -= 0.012;
        const i = this._trailIdx = (this._trailIdx + 1) % TRAIL;
        const s = this.state, spread = (Math.random() - 0.5) * 1.5;
        this.trailPos[i * 3] = s.x - Math.sin(s.heading) * 3.0 + Math.cos(s.heading) * spread;
        this.trailPos[i * 3 + 1] = 0.55 + Math.random() * 0.5;
        this.trailPos[i * 3 + 2] = s.z - Math.cos(s.heading) * 3.0 - Math.sin(s.heading) * spread;
        this.trailLife[i] = 1;
      }
    }
    let any = false;
    for (let i = 0; i < TRAIL; i++) {
      if (this.trailLife[i] <= 0) { this.trailPos[i * 3 + 1] = -50; continue; }
      this.trailLife[i] -= dt * 2.0;
      this.trailPos[i * 3 + 1] += dt * 1.8;
      any = true;
    }
    this.trail.visible = any;
    if (any) this.trailGeo.getAttribute('position').needsUpdate = true;
  }

  setDay(day) {
    this.beam.intensity = day ? 0 : 60;
    this.fill.intensity = day ? 0 : 7;
    this.under.intensity = day ? 0.5 : 3;
  }

  _sync() {
    this.mesh.position.set(this.state.x, 0, this.state.z);
    this.mesh.rotation.set(this._pitch, this.state.heading, this._roll);
  }
}
