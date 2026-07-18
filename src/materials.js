import * as THREE from 'three';

// --- Building facade: glass/concrete/brick + lit-window grid ----------------
// aInfo per instance = (litDensity, seed, type)  type<.34 glass, <.67 concrete, else brick
export function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.35 });
  mat.envMapIntensity = 0.3;   // keep facades moody — the env map is for the car

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = { value: 1.0 };          // continuous: 1 = night, 0 = day
    mat.userData.shader = shader;
    shader.vertexShader =
      'attribute vec3 aInfo;\nvarying vec3 vInfo;\nvarying vec3 vNrm;\nvarying vec3 vLPos;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vInfo = aInfo; vNrm = normal;
         vLPos = (instanceMatrix * vec4(position, 1.0)).xyz - vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);`
      );

    shader.fragmentShader =
      'uniform float uNight;\nvarying vec3 vInfo;\nvarying vec3 vNrm;\nvarying vec3 vLPos;\n' +
      'float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }\n' +
      shader.fragmentShader
        .replace('#include <map_fragment>',
          `#include <map_fragment>
           vec3 glass = vec3(0.05,0.08,0.13), concrete = vec3(0.13,0.13,0.15), brick = vec3(0.16,0.09,0.07);
           vec3 base = vInfo.z < 0.34 ? glass : (vInfo.z < 0.67 ? concrete : brick);
           base *= 1.0 + (1.0 - uNight) * 1.7;        // daylight albedo lift
           diffuseColor.rgb = base * (0.6 + 0.4 * smoothstep(0.0, 70.0, vLPos.y));`)
        .replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
           float floorH = 2.6, paneW = 2.3;
           float along = abs(vNrm.x) > 0.5 ? vLPos.z : vLPos.x;
           bool wall = abs(vNrm.y) < 0.5;
           vec2 cell = vec2(floor((along + vInfo.y) / paneW), floor(vLPos.y / floorH));
           vec2 f = fract(vec2((along + vInfo.y) / paneW, vLPos.y / floorH));
           float pane = step(0.14, f.x) * step(f.x, 0.86) * step(0.18, f.y) * step(f.y, 0.88);
           pane *= wall ? 1.0 : 0.0;
           float on = step(1.0 - vInfo.x, h21(cell + vInfo.y * 97.0));
           float tint = h21(cell.yx + vInfo.y * 13.0);
           vec3 warm = vec3(1.0,0.72,0.4), cool = vec3(0.55,0.78,1.0), neon = vec3(1.0,0.3,0.75);
           vec3 wc = vInfo.z < 0.34 ? (tint < 0.5 ? cool : warm) : (tint < 0.78 ? warm : (tint < 0.94 ? cool : neon));
           float flick = 0.72 + 0.28 * step(0.5, h21(cell * 1.7 + vInfo.y));
           totalEmissiveRadiance += pane * on * wc * 0.95 * flick * uNight;
           float storefront = step(vLPos.y, 3.2) * step(0.5, vLPos.y) * pane;
           totalEmissiveRadiance += storefront * vec3(1.0,0.62,0.28) * 0.55 * uNight;
           // daytime: panes read as dark reflective glass, not glowing grid
           diffuseColor.rgb *= 1.0 - pane * (1.0 - uNight) * 0.42;`);
  };
  return mat;
}

// --- ONE road tile (pitchX × pitchZ), tiled infinitely via RepeatWrapping ---
// Returns { map, roughnessMap }: wet-night shine is roughness × material.roughness.
export function roadTile(cfg) {
  const { pitchX, pitchZ, road, blockW, blockD } = cfg;
  const scale = 1024 / Math.max(pitchX, pitchZ);
  const cv = document.createElement('canvas');
  cv.width = Math.round(pitchX * scale); cv.height = Math.round(pitchZ * scale);
  const g = cv.getContext('2d');
  const rv = document.createElement('canvas');               // roughness twin
  rv.width = cv.width; rv.height = cv.height;
  const rg = rv.getContext('2d');
  const S = (v) => v * scale;
  const W = cv.width, H = cv.height;

  rg.fillStyle = '#e8e8e8'; rg.fillRect(0, 0, W, H);         // asphalt ~0.91 rough

  // asphalt with patch noise + cracks + oil stains
  g.fillStyle = '#151822'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${8 + Math.random() * 14 | 0},${10 + Math.random() * 14 | 0},${16 + Math.random() * 16 | 0},.5)`;
    g.fillRect(Math.random() * W, Math.random() * H, S(1.6), S(1.2));
  }
  for (let i = 0; i < 14; i++) {                              // oil / wear stains (smoother → shinier)
    const x = Math.random() * W, y = Math.random() * H, r = S(2 + Math.random() * 5);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(4,5,8,.28)'); grd.addColorStop(1, 'rgba(4,5,8,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    rg.fillStyle = 'rgba(70,70,70,.3)'; rg.beginPath(); rg.arc(x, y, r, 0, 7); rg.fill();
  }
  g.strokeStyle = 'rgba(5,6,10,.65)'; g.lineWidth = S(0.14);  // cracks
  for (let i = 0; i < 9; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * S(6); y += (Math.random() - 0.5) * S(6); g.lineTo(x, y); }
    g.stroke();
  }

  // centered block pad: sidewalk + lot
  const bx = S(road / 2), bz = S(road / 2), bw = S(blockW), bd = S(blockD), m = S(3.2);
  g.fillStyle = '#31374a'; g.fillRect(bx - m, bz - m, bw + 2 * m, bd + 2 * m);
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = S(0.25);
  for (let x = bx - m; x <= bx + bw + m; x += S(4)) { g.beginPath(); g.moveTo(x, bz - m); g.lineTo(x, bz + bd + m); g.stroke(); }
  g.fillStyle = '#1c202e'; g.fillRect(bx, bz, bw, bd);
  rg.fillStyle = '#f2f2f2'; rg.fillRect(bx - m, bz - m, bw + 2 * m, bd + 2 * m);  // concrete: very rough
  // curb highlight
  g.strokeStyle = 'rgba(200,210,225,.35)'; g.lineWidth = S(0.3);
  g.strokeRect(bx - m, bz - m, bw + 2 * m, bd + 2 * m);

  const lineV = (x, style, wdt, dash) => { g.strokeStyle = style; g.lineWidth = wdt; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]); };
  const lineH = (z, style, wdt, dash) => { g.strokeStyle = style; g.lineWidth = wdt; g.setLineDash(dash || []); g.beginPath(); g.moveTo(0, z); g.lineTo(W, z); g.stroke(); g.setLineDash([]); };
  const rlineV = (x, wdt, dash) => { rg.strokeStyle = '#909090'; rg.lineWidth = wdt; rg.setLineDash(dash || []); rg.beginPath(); rg.moveTo(x, 0); rg.lineTo(x, H); rg.stroke(); rg.setLineDash([]); };
  const rlineH = (z, wdt, dash) => { rg.strokeStyle = '#909090'; rg.lineWidth = wdt; rg.setLineDash(dash || []); rg.beginPath(); rg.moveTo(0, z); rg.lineTo(W, z); rg.stroke(); rg.setLineDash([]); };

  for (const e of [0, W]) { lineV(e - S(0.55), '#e0b83d', S(0.45)); lineV(e + S(0.55), '#e0b83d', S(0.45)); rlineV(e - S(0.55), S(0.45)); rlineV(e + S(0.55), S(0.45)); }
  for (const e of [0, H]) { lineH(e - S(0.55), '#e0b83d', S(0.45)); lineH(e + S(0.55), '#e0b83d', S(0.45)); rlineH(e - S(0.55), S(0.45)); rlineH(e + S(0.55), S(0.45)); }
  const laneDash = [S(2.6), S(3.6)], laneCol = 'rgba(230,237,250,.62)';
  for (const e of [0, W]) { lineV(e - S(road / 4), laneCol, S(0.32), laneDash); lineV(e + S(road / 4), laneCol, S(0.32), laneDash); rlineV(e - S(road / 4), S(0.32), laneDash); rlineV(e + S(road / 4), S(0.32), laneDash); }
  for (const e of [0, H]) { lineH(e - S(road / 4), laneCol, S(0.32), laneDash); lineH(e + S(road / 4), laneCol, S(0.32), laneDash); rlineH(e - S(road / 4), S(0.32), laneDash); rlineH(e + S(road / 4), S(0.32), laneDash); }

  // crosswalks on every corridor approach
  g.fillStyle = 'rgba(230,237,250,.68)'; rg.fillStyle = '#909090';
  const band = S(2.6), strip = S(0.7), step = S(1.15);
  for (let i = -3; i <= 3; i++) {
    for (const ex of [0, W]) {
      g.fillRect(ex + i * step - strip / 2, bz - m - band - S(0.4), strip, band);
      g.fillRect(ex + i * step - strip / 2, bz + bd + m + S(0.4), strip, band);
      rg.fillRect(ex + i * step - strip / 2, bz - m - band - S(0.4), strip, band);
      rg.fillRect(ex + i * step - strip / 2, bz + bd + m + S(0.4), strip, band);
    }
    for (const ez of [0, H]) {
      g.fillRect(bx - m - band - S(0.4), ez + i * step - strip / 2, band, strip);
      g.fillRect(bx + bw + m + S(0.4), ez + i * step - strip / 2, band, strip);
      rg.fillRect(bx - m - band - S(0.4), ez + i * step - strip / 2, band, strip);
      rg.fillRect(bx + bw + m + S(0.4), ez + i * step - strip / 2, band, strip);
    }
  }

  const map = new THREE.CanvasTexture(cv);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace;
  const roughnessMap = new THREE.CanvasTexture(rv);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 8;
  roughnessMap.repeat.copy(map.repeat);
  return { map, roughnessMap };
}
