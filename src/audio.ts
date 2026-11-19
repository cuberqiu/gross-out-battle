class AudioBus {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  muted = false

  arm() {
    if (typeof window === 'undefined') return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    if (!this.ctx) {
      const ctx = new Ctx()
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : 0.22
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setMuted(muted: boolean) {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 0.22
  }

  private env(duration: number, peak = 0.8): { ctx: AudioContext; gain: GainNode } | null {
    this.arm()
    if (!this.ctx || !this.master) return null
    const gain = this.ctx.createGain()
    const now = this.ctx.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    gain.connect(this.master)
    return { ctx: this.ctx, gain }
  }

  private tone(freq: number, duration: number, type: OscillatorType, peak = 0.5) {
    const bus = this.env(duration, peak)
    if (!bus) return
    const osc = bus.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, bus.ctx.currentTime)
    osc.connect(bus.gain)
    osc.start()
    osc.stop(bus.ctx.currentTime + duration + 0.02)
  }

  whoosh() {
    this.tone(520, 0.12, 'triangle', 0.25)
    this.tone(220, 0.16, 'sine', 0.2)
  }

  splat() {
    this.tone(180, 0.18, 'sine', 0.45)
    this.noise(0.12, 900)
  }

  bonk() {
    this.tone(140, 0.2, 'square', 0.2)
    this.tone(90, 0.24, 'sine', 0.35)
  }

  slide() {
    const bus = this.env(0.35, 0.35)
    if (!bus) return
    const osc = bus.ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(640, bus.ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(180, bus.ctx.currentTime + 0.32)
    osc.connect(bus.gain)
    osc.start()
    osc.stop(bus.ctx.currentTime + 0.36)
  }

  skitter() {
    ;[0, 0.06, 0.11].forEach((delay) => {
      const bus = this.env(0.05, 0.2)
      if (!bus) return
      const osc = bus.ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = 880 + delay * 2000
      osc.connect(bus.gain)
      osc.start(bus.ctx.currentTime + delay)
      osc.stop(bus.ctx.currentTime + delay + 0.05)
    })
  }

  fart() {
    this.noise(0.45, 240)
    this.tone(92, 0.42, 'sawtooth', 0.28)
    this.tone(70, 0.36, 'sine', 0.3)
  }

  match() {
    ;[523, 659, 784, 1046].forEach((freq, index) => {
      const bus = this.env(0.18, 0.35)
      if (!bus) return
      const osc = bus.ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      osc.connect(bus.gain)
      const when = bus.ctx.currentTime + index * 0.07
      osc.start(when)
      osc.stop(when + 0.18)
    })
  }

  accident() {
    this.match()
    this.tone(880, 0.2, 'square', 0.12)
  }

  trombone() {
    const notes = [349, 311, 277, 220]
    notes.forEach((freq, index) => {
      const bus = this.env(0.28, 0.32)
      if (!bus) return
      const osc = bus.ctx.createOscillator()
      const filter = bus.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 900
      osc.type = 'sawtooth'
      osc.frequency.value = freq
      osc.connect(filter)
      filter.connect(bus.gain)
      const when = bus.ctx.currentTime + index * 0.26
      osc.start(when)
      osc.stop(when + 0.28)
    })
  }

  tick() {
    this.tone(660, 0.08, 'square', 0.15)
  }

  horn() {
    this.tone(196, 0.18, 'square', 0.18)
    this.tone(392, 0.22, 'triangle', 0.25)
  }

  fanfare() {
    ;[392, 523, 659].forEach((freq, index) => {
      const bus = this.env(0.22, 0.3)
      if (!bus) return
      const osc = bus.ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = freq
      osc.connect(bus.gain)
      const when = bus.ctx.currentTime + index * 0.09
      osc.start(when)
      osc.stop(when + 0.22)
    })
  }

  squeak() {
    this.tone(740, 0.06, 'sine', 0.12)
  }

  private noise(duration: number, cutoff: number) {
    const bus = this.env(duration, 0.4)
    if (!bus) return
    const length = Math.floor(bus.ctx.sampleRate * duration)
    const buffer = bus.ctx.createBuffer(1, length, bus.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    const source = bus.ctx.createBufferSource()
    source.buffer = buffer
    const filter = bus.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    source.connect(filter)
    filter.connect(bus.gain)
    source.start()
  }

  effect(name: string) {
    if (name === 'fart') this.fart()
    else if (name === 'shake') this.bonk()
    else if (name === 'flip') this.slide()
    else if (name === 'crawl') this.skitter()
    else if (name === 'drip') this.splat()
    else this.splat()
  }
}

export const audio = new AudioBus()
