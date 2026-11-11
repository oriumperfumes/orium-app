/**
 * Gravador único de voz da Orium (navegador).
 * - mono, 16 kHz, WAV (decodificável em qualquer transcritor);
 * - cancelamento de eco / ruído / ganho automático;
 * - detecção de fim de fala: depois de ouvir voz, ~0,9 s de silêncio encerra sozinho.
 */
export type VoiceRecording = {
  level: () => number;
  stop: () => Promise<{ file: File; speechMs: number }>;
  cancel: () => void;
};

type Opts = { onAutoStop?: (() => void) | undefined; silenceMs?: number; maxMs?: number };

const TARGET_RATE = 16000;

export async function startVoiceRecording(opts: Opts = {}): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const AC: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let lvl = 0;
  let heardAt = 0;
  let lastVoice = 0;
  let speechMs = 0;
  let noiseFloor = 0.01;
  let done = false;
  const started = performance.now();
  const silenceMs = opts.silenceMs ?? 900;
  const maxMs = opts.maxMs ?? 30000;

  node.onaudioprocess = (e) => {
    if (done) return;
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i]! * d[i]!;
    const rms = Math.sqrt(sum / d.length);
    lvl = lvl * 0.6 + rms * 0.4;
    const now = performance.now();
    const frameMs = (d.length / ctx.sampleRate) * 1000;
    const thr = Math.max(0.018, noiseFloor * 3);
    if (rms > thr) {
      if (!heardAt) heardAt = now;
      lastVoice = now;
      speechMs += frameMs;
    } else if (!heardAt) {
      noiseFloor = noiseFloor * 0.9 + rms * 0.1;
    }
    const ended = heardAt && speechMs > 250 && now - lastVoice > silenceMs;
    if ((ended || now - started > maxMs) && opts.onAutoStop) {
      opts.onAutoStop();
      opts.onAutoStop = undefined;
    }
  };
  src.connect(node);
  node.connect(ctx.destination);

  const teardown = () => {
    done = true;
    node.disconnect();
    src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
  };

  return {
    level: () => lvl,
    cancel: teardown,
    stop: async () => {
      const rate = ctx.sampleRate;
      teardown();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(total);
      let o = 0;
      for (const c of chunks) (all.set(c, o), (o += c.length));
      // corta silêncio longo no fim (menos áudio = transcrição mais rápida)
      const tail = lastVoice ? Math.max(0, Math.floor(((performance.now() - lastVoice - 250) / 1000) * rate)) : 0;
      const trimmed = tail > 0 && tail < all.length ? all.subarray(0, all.length - tail) : all;
      return { file: toWav(downsample(trimmed, rate, TARGET_RATE), TARGET_RATE), speechMs: Math.round(speechMs) };
    },
  };
}

function downsample(buf: Float32Array, from: number, to: number) {
  if (from <= to) return buf;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio);
    const e = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let acc = 0;
    for (let j = s; j < e; j++) acc += buf[j]!;
    out[i] = acc / Math.max(1, e - s);
  }
  return out;
}

function toWav(samples: Float32Array, rate: number): File {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new File([buf], "fala.wav", { type: "audio/wav" });
}
