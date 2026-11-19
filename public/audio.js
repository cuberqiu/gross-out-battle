// Tiny procedural sound board. No audio files, no external assets.
export class SoundBoard {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('gross-muted') === '1';
    this.master = null;
  }

  get enabled() {
    return !this.muted;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    localStorage.setItem('gross-muted', this.muted ? '1' : '0');
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  tone({ freq = 220, endFreq = freq, type = 'sine', duration = 0.15, gain = 0.25, delay = 0, slide = 'exponential' }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    osc.frequency[slide === 'linear' ? 'linearRampToValueAtTime' : 'exponentialRampToValueAtTime'](
      Math.max(20, endFreq),
      t0 + duration,
    );
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  noise({ duration = 0.2, gain = 0.18, delay = 0, lowpass = 1400, highpass = 120 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpass;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(env);
    env.connect(this.master);
    src.start(t0);
    src.stop(t0 + duration);
  }

  play(name) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 480, endFreq: 620, type: 'triangle', duration: 0.07, gain: 0.12 });
        break;
      case 'throw':
        this.noise({ duration: 0.18, gain: 0.1, lowpass: 3200, highpass: 500 });
        this.tone({ freq: 180, endFreq: 90, type: 'sine', duration: 0.18, gain: 0.08 });
        break;
      case 'splat':
        this.noise({ duration: 0.18, gain: 0.22, lowpass: 900, highpass: 80 });
        this.tone({ freq: 150, endFreq: 60, type: 'square', duration: 0.14, gain: 0.1 });
        break;
      case 'wipe':
        this.noise({ duration: 0.09, gain: 0.07, lowpass: 2200, highpass: 700 });
        break;
      case 'fart':
        this.tone({ freq: 110, endFreq: 45, type: 'sawtooth', duration: 0.5, gain: 0.16 });
        this.tone({ freq: 85, endFreq: 38, type: 'square', duration: 0.42, gain: 0.1, delay: 0.08 });
        this.noise({ duration: 0.35, gain: 0.08, lowpass: 380, highpass: 60, delay: 0.04 });
        break;
      case 'roach':
        for (let i = 0; i < 7; i += 1) {
          this.tone({
            freq: 900 + Math.random() * 800,
            endFreq: 500,
            type: 'square',
            duration: 0.035,
            gain: 0.035,
            delay: i * 0.085,
          });
        }
        break;
      case 'flip':
        this.tone({ freq: 260, endFreq: 900, type: 'sine', duration: 0.28, gain: 0.13 });
        this.tone({ freq: 700, endFreq: 140, type: 'triangle', duration: 0.3, gain: 0.1, delay: 0.12 });
        break;
      case 'sync':
        [523, 659, 784, 1046].forEach((freq, i) => {
          this.tone({ freq, type: 'triangle', duration: 0.16, gain: 0.12, delay: i * 0.075 });
        });
        break;
      case 'celebrate':
        [392, 523, 659, 784, 1046].forEach((freq, i) => {
          this.tone({ freq, type: 'triangle', duration: 0.22, gain: 0.13, delay: i * 0.085 });
        });
        break;
      case 'sad':
        [392, 370, 349, 311].forEach((freq, i) => {
          this.tone({
            freq,
            endFreq: freq * 0.97,
            type: 'sawtooth',
            duration: 0.35,
            gain: 0.1,
            delay: i * 0.22,
          });
        });
        this.tone({ freq: 78, endFreq: 60, type: 'sine', duration: 1.1, gain: 0.08, delay: 0.15 });
        break;
      case 'ding':
        this.tone({ freq: 880, type: 'sine', duration: 0.25, gain: 0.1 });
        this.tone({ freq: 1320, type: 'sine', duration: 0.3, gain: 0.07, delay: 0.09 });
        break;
      case 'count':
        this.tone({ freq: 330, endFreq: 330, type: 'square', duration: 0.06, gain: 0.06 });
        break;
      default:
        break;
    }
  }
}
