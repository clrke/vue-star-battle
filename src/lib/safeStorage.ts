/**
 * localStorage with private-browsing safety.
 *
 * In Safari Private Browsing (and some restrictive corporate environments),
 * `localStorage.getItem` / `setItem` can throw synchronously — the storage
 * object exists but reads/writes raise `SecurityError` or `QuotaExceededError`.
 * Module-level reads that aren't wrapped will crash on import, so wrap them
 * here.
 */

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key) }
  catch { return null }
}

export function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value) }
  catch { /* private browsing / quota — best-effort, silently skip */ }
}
