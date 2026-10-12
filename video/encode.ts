/** Pipe raw RGBA frames straight into ffmpeg (no PNG round-trip) and mux the WAV soundtrack. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'

export interface EncodeOptions {
  out: string
  width: number
  height: number
  fps: number
  frameCount: number
  /** WAV to mux in; omit for a silent video. */
  audioPath?: string
  crf?: number
  preset?: string
  ffmpeg?: string
  onProgress?: (frame: number) => void
}

export async function encodeVideo(frame: (i: number) => Buffer | Uint8Array, o: EncodeOptions): Promise<void> {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
  ]
  if (o.audioPath) args.push('-i', o.audioPath)
  args.push(
    '-map', '0:v',
    ...(o.audioPath ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : []),
    '-c:v', 'libx264', '-preset', o.preset ?? 'medium', '-crf', String(o.crf ?? 17),
    '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    // Tag as BT.709 and convert with the matching matrix so colours survive YouTube's re-encode.
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart',
    ...(o.audioPath ? ['-shortest'] : []),
    o.out,
  )
  const ff = spawn(o.ffmpeg ?? 'ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  ff.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000) })
  const exited = new Promise<number>((resolve, reject) => {
    ff.on('error', reject)
    ff.on('close', code => resolve(code ?? -1))
  })
  for (let i = 0; i < o.frameCount; i++) {
    const buf = frame(i)
    if (!ff.stdin.write(buf)) await Promise.race([once(ff.stdin, 'drain'), exited])
    if (ff.exitCode !== null) break
    o.onProgress?.(i)
  }
  ff.stdin.end()
  const code = await exited
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim()}`)
}

/** Small 720p / 30 fps copy that fits chat attachment limits (Discord: 10 MB). */
export async function encodePreview(input: string, out: string, ffmpeg = 'ffmpeg'): Promise<void> {
  const ff = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-vf', 'scale=720:1280:flags=lanczos', '-r', '30',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  ff.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000) })
  const code = await new Promise<number>((resolve, reject) => { ff.on('error', reject); ff.on('close', c => resolve(c ?? -1)) })
  if (code !== 0) throw new Error(`ffmpeg preview exited with ${code}: ${stderr.trim()}`)
}
