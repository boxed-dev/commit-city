import * as THREE from 'three';

// ── Atmosphere: physically-inspired sky, HDR sun, fbm clouds, moon, stars ────
// One dome shader (rayleigh-style gradient + sunset band + sun disc with corona),
// a translucent cloud dome (5-octave value noise, sun-lit edges, wind drift),
// a canvas-baked moon billboard, and 900 twinkling stars. Everything is driven
// by the sun direction so day / golden hour / night are one continuous system.

export const SUNRISE = 6.15, SUNSET = 18.85;          // clock model
export const PHASES = [13.0, 18.55, 23.6];            // L key: day → sunset → night

// sun elevation/azimuth for a given clock hour (night → below horizon)
export function sunDirection(timeH, out = new THREE.Vector3()) {
  const dayT = (timeH - SUNRISE) / (SUNSET - SUNRISE);              // 0..1 across daylight
  const elev = Math.sin(THREE.MathUtils.clamp(dayT, -0.35, 1.35) * Math.PI) * 0.96 + 0.02;
  const az = Math.PI * 0.15 + THREE.MathUtils.clamp(dayT, -0.2, 1.2) * Math.PI * 0.7;
  const ce = Math.cos(elev);
  return out.set(Math.cos(az) * ce, Math.sin(elev), Math.sin(az) * ce).normalize();
}

// 0 = deep night, 1 = full day — the single knob every material listens to
export function dayFactor(sunDir) {
  return THREE.MathUtils.smoothstep(sunDir.y, -0.045, 0.24);
}
// warm golden-hour weight: peaks when the sun hugs the horizon
export function sunsetFactor(sunDir) {
  const e = sunDir.y;
  return THREE.MathUtils.smoothstep(e, -0.055, 0.0) * (1 - THREE.MathUtils.smoothstep(e, 0.06, 0.34));
}

export function moonDirection(out = new THREE.Vector3()) {
  return out.set(-0.55, 0.58, 0.42).normalize();
}

export class Atmosphere {
  constructor() {
    this.group = new THREE.Group();

    // --- sky dome ---
    this.skyU = {
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      dayK: { value: 1 }, warmK: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: this.skyU,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir; uniform float dayK, warmK;
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          float sd = max(dot(d, sunDir), 0.0);
          vec3 zen = mix(vec3(0.010,0.014,0.042), vec3(0.045,0.22,0.64), dayK);
          vec3 hor = mix(vec3(0.045,0.052,0.115), vec3(0.42,0.62,0.86), dayK);
          zen = mix(zen, vec3(0.13,0.12,0.36), warmK);
          hor = mix(hor, vec3(0.99,0.42,0.16), warmK);
          float hy = clamp(y, 0.0, 1.0);
          vec3 col = mix(hor, zen, pow(hy, 0.40));
          col = mix(col, hor * 0.45, smoothstep(0.0, -0.12, y));      // ground haze below horizon
          col += vec3(1.0, 0.40, 0.10) * pow(sd, 5.0) * warmK * 0.65; // sunset glow lobe
          col += vec3(1.0, 0.88, 0.62) * pow(sd, 28.0) * 0.12 * dayK; // daytime forward scatter
          float vis = smoothstep(-0.075, 0.01, sunDir.y);
          float disc = smoothstep(0.99938, 0.99972, sd);
          float corona = pow(sd, 850.0) * 1.5 + pow(sd, 48.0) * 0.22;
          vec3 sunCol = mix(vec3(1.0, 0.50, 0.18), vec3(1.0, 0.97, 0.88), dayK);
          col += sunCol * (disc * 30.0 + corona) * vis;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1600, 32, 20), skyMat);
    this.group.add(this.dome);

    // --- cloud dome ---
    this.clU = {
      time: { value: 0 }, dayK: { value: 1 }, warmK: { value: 0 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, cover: { value: 0.42 },
    };
    const clMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, transparent: true, fog: false,
      uniforms: this.clU,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float time, dayK, warmK, cover; uniform vec3 sunDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.03 + 17.7; a *= 0.5; }
          return v;
        }
        void main(){
          vec3 d = normalize(vDir);
          if (d.y < 0.06) discard;
          vec2 uv = d.xz / (d.y + 0.16) * 1.35 + time * vec2(0.006, 0.0022);
          float base = fbm(uv);
          float lit  = fbm(uv + sunDir.xz * 0.05);        // cheap sun-side shading
          float den = smoothstep(1.0 - cover, 1.0 - cover + 0.22, base);
          if (den < 0.01) discard;
          float edge = clamp((base - lit) * 9.0 + 0.35, 0.0, 1.0);
          vec3 shade = mix(vec3(0.055,0.06,0.10), vec3(0.42,0.45,0.55), dayK);
          vec3 light = mix(vec3(0.10,0.11,0.17), vec3(1.05,1.03,0.98), dayK);
          light = mix(light, vec3(1.25,0.55,0.30), warmK);
          shade = mix(shade, vec3(0.30,0.14,0.20), warmK);
          vec3 col = mix(shade, light, edge);
          float a = den * 0.88 * smoothstep(0.06, 0.30, d.y);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), clMat);
    this.clouds.renderOrder = 1;
    this.group.add(this.clouds);

    // --- moon (baked canvas: maria + limb + halo) ---
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    let grd = c.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, 'rgba(210,222,255,.55)'); grd.addColorStop(0.42, 'rgba(160,180,230,.16)'); grd.addColorStop(1, 'rgba(160,180,230,0)');
    c.fillStyle = grd; c.fillRect(0, 0, 256, 256);
    grd = c.createRadialGradient(116, 112, 6, 128, 128, 46);
    grd.addColorStop(0, '#f4f7ff'); grd.addColorStop(0.75, '#c9d4ec'); grd.addColorStop(1, 'rgba(190,205,235,0)');
    c.fillStyle = grd; c.beginPath(); c.arc(128, 128, 46, 0, 7); c.fill();
    c.fillStyle = 'rgba(140,155,190,.35)';
    for (const [x, y, r] of [[118, 118, 9], [138, 122, 6], [126, 140, 7], [112, 136, 5], [140, 108, 4]]) {
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    const moonTex = new THREE.CanvasTexture(cv); moonTex.colorSpace = THREE.SRGBColorSpace;
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false, opacity: 0 }));
    this.moon.scale.setScalar(190); this.moon.renderOrder = 2;
    this.group.add(this.moon);

    // --- stars ---
    const n = 1100, pos = new Float32Array(n * 3), phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const rr = 1050 + Math.random() * 380, t = Math.random() * Math.PI * 2, p = Math.acos(1 - Math.random() * 0.92);
      pos[i * 3] = Math.cos(t) * Math.sin(p) * rr;
      pos[i * 3 + 1] = Math.cos(p) * rr + 40;
      pos[i * 3 + 2] = Math.sin(t) * Math.sin(p) * rr;
      phase[i] = Math.random() * 6.28;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starU = { op: { value: 0 }, time: { value: 0 } };
    const starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: this.starU,
      vertexShader: `attribute float aPhase; uniform float time; varying float vA;
        void main(){ vA = 0.55 + 0.45 * sin(time * (0.6 + aPhase * 0.35) + aPhase * 7.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_PointSize = 1.6 + 1.3 * fract(aPhase * 0.618); }`,
      fragmentShader: `uniform float op; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.72,0.80,1.0), op * vA); }`,
    });
    this.stars = new THREE.Points(sg, starMat);
    this.stars.renderOrder = 1;
    this.group.add(this.stars);
  }

  follow(x, z) { this.group.position.set(x, 0, z); }

  update(sunDir, dayK, warmK, t) {
    this.skyU.sunDir.value.copy(sunDir);
    this.skyU.dayK.value = dayK; this.skyU.warmK.value = warmK;
    this.clU.sunDir.value.copy(sunDir);
    this.clU.dayK.value = dayK; this.clU.warmK.value = warmK; this.clU.time.value = t;
    const night = 1 - dayK;
    this.starU.op.value = night * night * 0.95; this.starU.time.value = t;
    const md = moonDirection();
    this.moon.position.set(md.x * 1350, md.y * 1350, md.z * 1350);
    this.moon.material.opacity = night * night;
  }
}
