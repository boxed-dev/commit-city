// All-synth sound engine — zero assets, built on first user gesture.
// Continuous layers: EV motor whine + sub + road/wind noise, driven per-frame.
// One-shots: musical orb plucks (pentatonic), landmark chord, nitro, impacts.

const PENT = [0, 2, 4, 7, 9]; // major pentatonic — chained pickups become a melody

class Sound {
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);

    // -- drivetrain: low rounded tone + sub rumble, heavily filtered (no whine) --
    this.body = ctx.createOscillator(); this.body.type = 'sawtooth';
    this.body2 = ctx.createOscillator(); this.body2.type = 'sawtooth'; // slight detune = thickness
    this.sub = ctx.createOscillator(); this.sub.type = 'sine';
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320; this.engineFilter.Q.value = 0.4;
    const bodyGain = ctx.createGain(); bodyGain.gain.value = 0.18;
    const body2Gain = ctx.createGain(); body2Gain.gain.value = 0.14;
    const subGain = ctx.createGain(); subGain.gain.value = 0.85;
    this.body.connect(bodyGain).connect(this.engineFilter);
    this.body2.connect(body2Gain).connect(this.engineFilter);
    this.sub.connect(subGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.body.start(); this.body2.start(); this.sub.start();

    // -- road / wind: looped white noise through a swept lowpass --
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 300;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.noise.start();

    // -- tyre screech: bandpassed noise, gain follows lateral slip --
    this.skid = ctx.createBufferSource(); this.skid.buffer = buf; this.skid.loop = true;
    this.skid.playbackRate.value = 0.85;
    this.skidFilter = ctx.createBiquadFilter(); this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1050; this.skidFilter.Q.value = 3.5;
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    this.skid.connect(this.skidFilter).connect(this.skidGain).connect(this.master);
    this.skid.start();
  }

  // k = slip amount 0..1, speed m/s
  drift(k, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = k > 0.25 && speed > 8;
    this.skidGain.gain.setTargetAtTime(on ? Math.min(0.11, k * 0.13) : 0, t, 0.09);
    this.skidFilter.frequency.setTargetAtTime(850 + k * 700, t, 0.1);
  }

  // called every frame while driving: speed m/s, throttle 0/1, boost bool
  drive(speed, throttle, boost) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, v = Math.abs(speed);
    const f = 42 + v * 1.6;                                     // low, slow pitch climb
    this.body.frequency.setTargetAtTime(f, t, 0.08);
    this.body2.frequency.setTargetAtTime(f * 1.011, t, 0.08);   // beat-frequency thickness
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    const load = 0.02 + throttle * 0.035 + (boost ? 0.035 : 0);
    this.engineGain.gain.setTargetAtTime(v > 0.5 ? load : 0.006, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(220 + v * 14 + (boost ? 500 : 0), t, 0.12);
    const windK = Math.min(1, v / 66);
    this.windGain.gain.setTargetAtTime(windK * windK * 0.1 + (boost ? 0.05 : 0), t, 0.12);
    this.windFilter.frequency.setTargetAtTime(220 + windK * 1500, t, 0.18);
  }

  blip(n) { // pentatonic pluck, climbs with combo
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const step = PENT[n % 5] + 12 * Math.min(2, Math.floor(n / 5));
    const f = 523.25 * Math.pow(2, step / 12);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.24);
    const h = this.ctx.createOscillator(), hg = this.ctx.createGain(); // sparkle partial
    h.type = 'sine'; h.frequency.value = f * 2;
    hg.gain.setValueAtTime(0.05, t); hg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    h.connect(hg).connect(this.master); h.start(t); h.stop(t + 0.14);
  }

  chord() { // landmark fanfare
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = i < 2 ? 'triangle' : 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.07);
      g.gain.exponentialRampToValueAtTime(0.1, t + i * 0.07 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      o.connect(g).connect(this.master); o.start(t + i * 0.07); o.stop(t + 1.5);
    });
  }

  whoosh() { // nitro ignition
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(620, t + 0.4);
    f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.4); f.Q.value = 2;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(f).connect(g).connect(this.master); o.start(t); o.stop(t + 0.6);
  }

  hit(force = 1) { // collision thump: sub drop + noise click
    if (!this.ctx) return; const t = this.ctx.currentTime;
    if (t - (this._lastHit || 0) < 0.15) return; this._lastHit = t;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(0.28 * force, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.26);
    const n = this.ctx.createBufferSource(); n.buffer = this.noise.buffer;
    const nf = this.ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.16 * force, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(nf).connect(ng).connect(this.master); n.start(t); n.stop(t + 0.13);
  }
}

export const sound = new Sound();
