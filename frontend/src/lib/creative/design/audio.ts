/** Música de fondo generada por el sistema (sin pistas de terceros ni licencias).
 *
 * Se sintetiza en el navegador con Web Audio (OfflineAudioContext): batería, bajo, acordes y arpegio con
 * osciladores y ruido, según el ánimo y el tempo de la plantilla de video. La semilla decide la tonalidad y
 * pequeños cambios de patrón, así que dos videos pueden sonar distinto sin perder el estilo. Al ser generada
 * por el propio sistema, no hay derechos de autor de terceros que gestionar. */
import { seededRandom } from './color'
import type { Mood } from './video'

export const AUDIO_SAMPLE_RATE = 48000

const MINOR = [0, 2, 3, 5, 7, 8, 10]
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const PROGRESSIONS: Record<Mood, { scale: number[]; chords: number[] }> = {
  energico: { scale: MINOR, chords: [0, 5, 2, 6] },
  tecno: { scale: MINOR, chords: [0, 0, 5, 3] },
  alegre: { scale: MAJOR, chords: [0, 4, 5, 3] },
  suave: { scale: MAJOR, chords: [0, 5, 3, 4] },
  elegante: { scale: MINOR, chords: [0, 3, 5, 4] },
}
const freq = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** Genera la pista. Devuelve null si el navegador no tiene Web Audio sin conexión. */
export async function generateMusic(seconds: number, mood: Mood, bpm: number, seed: number): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined') return null
  const random = seededRandom(seed * 31 + 7)
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE)
  const master = ctx.createGain()
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -16
  compressor.ratio.value = 4
  master.connect(compressor).connect(ctx.destination)
  // Entrada suave y salida con fundido en el último segundo y medio.
  master.gain.setValueAtTime(0, 0)
  master.gain.linearRampToValueAtTime(0.55, 0.4)
  master.gain.setValueAtTime(0.55, Math.max(0.5, seconds - 1.6))
  master.gain.linearRampToValueAtTime(0, seconds)

  const beat = 60 / bpm
  const root = 45 + Math.floor(random() * 7) // La a Mi graves
  const { scale, chords } = PROGRESSIONS[mood]
  const degree = (step: number, octave = 0) => root + scale[((step % 7) + 7) % 7]! + 12 * (Math.floor(step / 7) + octave)
  const noise = ctx.createBuffer(1, AUDIO_SAMPLE_RATE, AUDIO_SAMPLE_RATE)
  const data = noise.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1

  const tone = (type: OscillatorType, frequency: number, start: number, length: number, gain: number, filter?: number, pan = 0) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = frequency
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0, start)
    amp.gain.linearRampToValueAtTime(gain, start + Math.min(0.02, length / 4))
    amp.gain.exponentialRampToValueAtTime(0.0008, start + length)
    let node: AudioNode = osc
    if (filter) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = filter; node.connect(lp); node = lp }
    const panner = ctx.createStereoPanner()
    panner.pan.value = pan
    node.connect(amp).connect(panner).connect(master)
    osc.start(start)
    osc.stop(start + length + 0.05)
  }
  const kick = (start: number, gain = 0.9) => {
    const osc = ctx.createOscillator()
    const amp = ctx.createGain()
    osc.frequency.setValueAtTime(140, start)
    osc.frequency.exponentialRampToValueAtTime(42, start + 0.16)
    amp.gain.setValueAtTime(gain, start)
    amp.gain.exponentialRampToValueAtTime(0.001, start + 0.32)
    osc.connect(amp).connect(master)
    osc.start(start)
    osc.stop(start + 0.35)
  }
  const hit = (start: number, length: number, gain: number, band: number, type: BiquadFilterType = 'highpass') => {
    const src = ctx.createBufferSource()
    src.buffer = noise
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = band
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(gain, start)
    amp.gain.exponentialRampToValueAtTime(0.001, start + length)
    src.connect(filter).connect(amp).connect(master)
    src.start(start, random() * 0.5)
    src.stop(start + length + 0.02)
  }

  const bar = beat * 4
  const bars = Math.ceil(seconds / bar)
  const drums = mood === 'energico' || mood === 'tecno' || mood === 'alegre'
  const arpEvery = mood === 'tecno' ? beat / 4 : mood === 'energico' ? beat / 2 : beat / 2
  for (let b = 0; b < bars; b++) {
    const t0 = b * bar
    const chord = chords[b % chords.length]!
    // Acorde de fondo (pad), suave y filtrado.
    for (const step of [0, 2, 4]) tone(mood === 'elegante' ? 'triangle' : 'sawtooth', freq(degree(chord + step, 1)), t0, bar * 0.98, mood === 'suave' || mood === 'elegante' ? 0.05 : 0.035, mood === 'tecno' ? 1400 : 1800, step === 2 ? -0.3 : 0.3)
    // Bajo.
    for (let s = 0; s < (drums ? 8 : 2); s++) tone('triangle', freq(degree(chord, -1)), t0 + s * (bar / (drums ? 8 : 2)), bar / (drums ? 9 : 2.2), drums ? 0.16 : 0.12, 500)
    // Arpegio o melodía pulsada.
    if (mood !== 'energico' || b % 2 === 1) {
      for (let s = 0; s * arpEvery < bar; s++) {
        if (mood === 'elegante' && s % 2) continue
        const step = chord + [0, 2, 4, 7, 4, 2][s % 6]! + (random() > 0.85 ? 7 : 0)
        tone(mood === 'tecno' ? 'square' : 'triangle', freq(degree(step, 2)), t0 + s * arpEvery, arpEvery * 0.9, mood === 'tecno' ? 0.035 : 0.05, mood === 'tecno' ? 2600 : 4200, s % 2 ? 0.4 : -0.4)
      }
    }
    if (drums) {
      for (let k = 0; k < 4; k++) {
        kick(t0 + k * beat, mood === 'alegre' ? 0.7 : 0.9)
        hit(t0 + k * beat + beat / 2, 0.05, 0.12, 7000)
        if (k % 2 === 1) hit(t0 + k * beat, 0.16, mood === 'energico' ? 0.35 : 0.25, 1600, 'bandpass')
      }
      if (mood === 'tecno') for (let k = 0; k < 16; k++) hit(t0 + (k * beat) / 4, 0.03, 0.06, 9000)
    }
  }
  return ctx.startRendering()
}

/** ¿El navegador codifica AAC (MP4 con audio compatible con redes sociales)? */
export async function aacSupported(): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return false
  try { return Boolean((await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: 128000 })).supported) } catch { return false }
}

/** Codifica la pista en AAC y entrega cada fragmento al multiplexor. */
export async function encodeAac(buffer: AudioBuffer, onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void): Promise<void> {
  let failure: unknown = null
  const encoder = new AudioEncoder({ output: onChunk, error: (error) => { failure = error } })
  encoder.configure({ codec: 'mp4a.40.2', sampleRate: buffer.sampleRate, numberOfChannels: 2, bitrate: 128000 })
  const left = buffer.getChannelData(0)
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const frames = 1024
  for (let offset = 0; offset < buffer.length && !failure; offset += frames) {
    const count = Math.min(frames, buffer.length - offset)
    const planar = new Float32Array(count * 2)
    planar.set(left.subarray(offset, offset + count), 0)
    planar.set(right.subarray(offset, offset + count), count)
    const data = new AudioData({ format: 'f32-planar', sampleRate: buffer.sampleRate, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round((offset / buffer.sampleRate) * 1_000_000), data: planar })
    encoder.encode(data)
    data.close()
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure
}
