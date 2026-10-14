/**
 * Synthesized intro sounds (no audio files). Browsers start the context "suspended" until the
 * visitor interacts, so callers read `blocked` / listen to `onChange` instead of awaiting resume().
 */
const PREF_KEY = "pq-intro-sound";

export function readSoundPref(): "on" | "off" {
  try {
    return localStorage.getItem(PREF_KEY) === "off" ? "off" : "on";
  } catch {
    return "on";
  }
}
export function writeSoundPref(value: "on" | "off") {
  try {
    localStorage.setItem(PREF_KEY, value);
  } catch {}
}

export type IntroAudio = ReturnType<typeof createIntroAudio>;

export function createIntroAudio(onChange: () => void) {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  let enabled = readSoundPref() === "on";
  const master = ctx.createGain();
  master.gain.value = enabled ? 0.55 : 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  master.connect(comp).connect(analyser).connect(ctx.destination);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  ctx.onstatechange = onChange;
  const live = () => enabled && ctx.state === "running";
  const noiseSource = (at: number, dur: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = dur > 1;
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
    return src;
  };
  const env = (at: number, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    return g;
  };
  const filter = (type: BiquadFilterType, freq: number, q = 1) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  };
  // Continuous sounds that may need cutting short on skip.
  const sustained = new Set<GainNode>();
  const hold = (g: GainNode, until: number) => {
    sustained.add(g);
    setTimeout(
      () => sustained.delete(g),
      (until - ctx.currentTime) * 1000 + 100,
    );
  };

  return {
    context: ctx,
    analyser,
    get blocked() {
      return ctx.state !== "running";
    },
    get enabled() {
      return enabled;
    },
    setEnabled(on: boolean) {
      enabled = on;
      writeSoundPref(on ? "on" : "off");
      master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.03);
    },
    /** Must run inside a user gesture. Plays a silent buffer too, which older iOS needs. */
    unlock() {
      void ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start();
    },
    /** Split-flap clack: a filtered noise snap plus a tiny click. */
    clack(intensity = 1) {
      if (!live()) return;
      const t = ctx.currentTime + 0.002;
      const n = noiseSource(t, 0.05);
      const bp = filter("bandpass", 2200 + Math.random() * 900, 1.4);
      n.connect(bp)
        .connect(env(t, 0.32 * intensity, 0.002, 0.035))
        .connect(master);
      const click = ctx.createOscillator();
      click.type = "square";
      click.frequency.value = 1300 + Math.random() * 500;
      click
        .connect(filter("highpass", 900))
        .connect(env(t, 0.07 * intensity, 0.001, 0.012))
        .connect(master);
      click.start(t);
      click.stop(t + 0.03);
    },
    /** Pencil scribble across `dur` seconds: rough, amplitude-jittered high noise. */
    scribble(dur: number) {
      if (!live()) return;
      const t = ctx.currentTime + 0.005;
      const n = noiseSource(t, dur + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (let s = 0; s < dur; s += 0.028)
        g.gain.setValueAtTime(
          Math.random() < 0.22 ? 0.02 : 0.1 + Math.random() * 0.16,
          t + s,
        );
      g.gain.setTargetAtTime(0.0001, t + dur, 0.03);
      n.connect(filter("highpass", 1800))
        .connect(filter("bandpass", 4200, 0.8))
        .connect(g)
        .connect(master);
      hold(g, t + dur);
    },
    /** Low scanner hum with a faint electric whine. */
    hum(dur: number) {
      if (!live()) return;
      const t = ctx.currentTime + 0.005;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
      g.gain.setValueAtTime(0.16, t + dur - 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const lp = filter("lowpass", 520, 2);
      lp.connect(g).connect(master);
      for (const [type, freq, level] of [
        ["sawtooth", 55, 0.5],
        ["sine", 110, 0.7],
        ["sine", 2400, 0.04],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        o.frequency.linearRampToValueAtTime(freq * 1.06, t + dur);
        const lv = ctx.createGain();
        lv.gain.value = level;
        o.connect(lv).connect(freq > 1000 ? g : lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
      hold(g, t + dur);
    },
    /** Heavy rubber-stamp thud: a falling sine plus a short muffled noise hit. */
    thud() {
      if (!live()) return;
      const t = ctx.currentTime + 0.002;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.32);
      o.connect(env(t, 0.9, 0.004, 0.42)).connect(master);
      o.start(t);
      o.stop(t + 0.5);
      noiseSource(t, 0.12)
        .connect(filter("lowpass", 900, 0.7))
        .connect(env(t, 0.5, 0.002, 0.09))
        .connect(master);
    },
    /** Paper rip: band-passed noise sweeping upward with crackly amplitude. */
    rip(dur = 0.6) {
      if (!live()) return;
      const t = ctx.currentTime + 0.002;
      const n = noiseSource(t, dur + 0.1);
      const bp = filter("bandpass", 700, 1.1);
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(4200, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      for (let s = 0; s < dur; s += 0.018)
        g.gain.setValueAtTime(
          (0.18 + Math.random() * 0.32) * (1 - (s / dur) * 0.6),
          t + s,
        );
      g.gain.setTargetAtTime(0.0001, t + dur, 0.04);
      n.connect(bp).connect(g).connect(master);
    },
    /** Fade out anything still sounding (used when the visitor skips). */
    hush() {
      for (const g of sustained) {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.04);
      }
      sustained.clear();
    },
    close() {
      ctx.onstatechange = null;
      setTimeout(() => void ctx.close().catch(() => {}), 400);
    },
  };
}
