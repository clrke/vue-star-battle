/**
 * 16-bit PCM stereo WAV encoder with seeded TPDF dither.
 */
import { Buffer } from 'node:buffer'
import type { StereoBuffer } from './types'
import { mulberry32 } from './dsp'

const DEFAULT_DITHER_SEED = 0x2545f491

/**
 * Encodes a stereo float buffer as a 16-bit PCM WAV (RIFF/WAVE, 44-byte header).
 * TPDF dither (+-1 LSB triangular) is seeded, so encoding is deterministic.
 * Exact digital silence stays exactly zero (no dither hiss in silent passages).
 */
export function encodeWav(buf: StereoBuffer, ditherSeed = DEFAULT_DITHER_SEED): Buffer {
  const n = Math.min(buf.left.length, buf.right.length)
  const sr = Math.round(buf.sampleRate)
  const channels = 2
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataBytes = n * blockAlign
  const out = Buffer.alloc(44 + dataBytes)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + dataBytes, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16) // fmt chunk size
  out.writeUInt16LE(1, 20) // PCM
  out.writeUInt16LE(channels, 22)
  out.writeUInt32LE(sr, 24)
  out.writeUInt32LE(sr * blockAlign, 28) // byte rate
  out.writeUInt16LE(blockAlign, 32)
  out.writeUInt16LE(16, 34) // bits per sample
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(dataBytes, 40)

  // TPDF dither: the difference of two independent uniforms (+-1 LSB triangular).
  // One mulberry32 draw supplies both as 16-bit halves.
  const rng = mulberry32(ditherSeed)
  const { left, right } = buf
  const q = (x: number): number => {
    if (x === 0 || !Number.isFinite(x)) return 0 // keep digital silence clean
    const u = (rng() * 4294967296) >>> 0
    const d = ((u & 0xffff) - (u >>> 16)) / 65536
    const v = Math.round(x * 32767 + d)
    return v > 32767 ? 32767 : v < -32768 ? -32768 : v
  }
  if (LITTLE_ENDIAN && (out.byteOffset + 44) % 2 === 0) {
    const pcm = new Int16Array(out.buffer, out.byteOffset + 44, n * channels)
    for (let i = 0, o = 0; i < n; i++, o += 2) {
      pcm[o] = q(left[i])
      pcm[o + 1] = q(right[i])
    }
  } else {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
    for (let i = 0, o = 44; i < n; i++, o += 4) {
      view.setInt16(o, q(left[i]), true)
      view.setInt16(o + 2, q(right[i]), true)
    }
  }
  return out
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
