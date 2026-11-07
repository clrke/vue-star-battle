/**
 * Upload one rendered Star Battle video to the project's own YouTube channel.
 *
 * Same shape as saint-expeditus/discord-bot/src/sfm-illusion-daily-cron.ts (that script
 * hard-codes the sfm-illusion-gen slug), importing the shared uploader directly so the
 * channel routing, dedup ledger, resumable upload + retries are all identical.
 *
 * Usage: node_modules/.bin/tsx .saint-expeditus/upload-daily.ts <absolute-path-to-mp4> <project-directory>
 * Title/description/privacy: .saint-expeditus/youtube-upload.json ({Name} etc. from the filename).
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  findExistingByContent, uploadAndRecord, isYouTubeConfigured,
  loadYouTubeUploadConfig, templateFor, applyTemplate,
} from '/Users/arke/Projects/saint-expeditus/discord-bot/src/youtube-uploader.ts'

const SLUG = 'vue-star-battle'
const ENV_FILE = '/Users/arke/Projects/saint-expeditus/.env'
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
const NOTIFY_URL = process.env.BRIDGE_NOTIFY_URL ?? `http://localhost:${process.env.PORT ?? '3141'}/notify`
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN

async function notifyDiscord(message: string): Promise<void> {
  try {
    const res = await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(BRIDGE_TOKEN ? { Authorization: `Bearer ${BRIDGE_TOKEN}` } : {}) },
      body: JSON.stringify({ slug: SLUG, message }),
    })
    if (!res.ok) console.error(`[star-battle-daily] /notify failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  } catch (err) {
    console.error(`[star-battle-daily] /notify error: ${(err as Error).message}`)
  }
}

/** The shared uploader can't set category/tags; patch them right after upload (force-ssl scope). */
const CATEGORY_ID = '20' // Gaming
const TAGS = ['star battle', 'queens', 'linkedin queens', 'puzzle', 'logic puzzle', 'brain teaser',
  'depth first search', 'algorithm', 'backtracking', 'satisfying', 'shorts']

export async function setCategoryAndTags(videoId: string, title: string, description: string): Promise<void> {
  const home = process.env.HOME!
  const sec = JSON.parse(fs.readFileSync(`${home}/.saint-expeditus/youtube-client-secret.json`, 'utf8')).installed
  const tok = JSON.parse(fs.readFileSync(`${home}/.saint-expeditus/youtube-tokens/${SLUG}.json`, 'utf8'))
  const r = await fetch(sec.token_uri, { method: 'POST', body: new URLSearchParams({
    client_id: sec.client_id, client_secret: sec.client_secret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }) })
  const { access_token } = await r.json() as { access_token: string }
  const res = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: videoId, snippet: { title, description, categoryId: CATEGORY_ID, tags: TAGS } }),
  })
  if (!res.ok) throw new Error(`videos.update ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function main(): Promise<void> {
  const [filePath, projectDirectory] = process.argv.slice(2)
  if (!filePath || !projectDirectory) {
    console.error('[star-battle-daily] usage: upload-daily.ts <absolute-path-to-mp4> <project-directory>')
    process.exit(1)
  }
  if (!fs.existsSync(filePath)) {
    console.error(`[star-battle-daily] file not found: ${filePath}`)
    process.exit(1)
  }
  if (!(await isYouTubeConfigured(SLUG))) {
    console.error(`[star-battle-daily] channel "${SLUG}" not configured — run youtube-auth.ts --channel ${SLUG} once.`)
    process.exit(1)
  }
  try {
    const { md5, existing } = await findExistingByContent(filePath, SLUG)
    if (existing) {
      console.log(`[star-battle-daily] dedup (silent): ${filePath} already uploaded → ${existing.url}`)
      process.exit(0)
    }
    const filename = path.basename(filePath, path.extname(filePath))
    const projectName = path.basename(projectDirectory)
    const cfg = await loadYouTubeUploadConfig(projectDirectory)
    // Format variants (melody-/challenge- filename prefixes) pick their own title/description.
    const { vars, titleTemplate, description: descTemplate } = templateFor(cfg, filename, projectName)
    const title = (titleTemplate ? applyTemplate(titleTemplate, vars) : filename).slice(0, 100)
    const description = descTemplate ? applyTemplate(descTemplate, vars) : `Project: ${projectName}`
    // Daily is the deliberate-publish path: always public, independent of the config
    // default (which stays unlisted so stray/ad-hoc uploads can never go public).
    // Do NOT "simplify" this back to cfg?.privacy — dailies would silently go unlisted.
    const EFFECTIVE_PRIVACY = 'public' as const
    const result = await uploadAndRecord(filePath, {
      title, description, privacy: EFFECTIVE_PRIVACY, project: projectName, channelKey: SLUG,
    }, md5)
    console.log(`[star-battle-daily] uploaded ${filePath} -> ${result.url} (privacy=${EFFECTIVE_PRIVACY})`)
    try { await setCategoryAndTags(result.videoId, title, description); console.log('[star-battle-daily] set category Gaming + tags') }
    catch (err) { console.error(`[star-battle-daily] category/tags update failed (upload is fine): ${(err as Error).message}`) }
    await notifyDiscord(`⭐ **Daily Star Battle uploaded** — ${result.url}`)
    process.exit(0)
  } catch (err) {
    const msg = (err as Error).message
    console.error(`[star-battle-daily] upload failed for ${filePath}: ${msg}`)
    await notifyDiscord(`⭐ ⚠️ **Daily Star Battle upload failed** for \`${path.basename(filePath)}\`: ${msg.slice(0, 300)}`)
    process.exit(1)
  }
}

if (process.argv[2] !== '--patch') main().catch(err => {
  console.error('[star-battle-daily] fatal:', (err as Error).message)
  process.exit(1)
})
