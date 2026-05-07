<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useProgressionStore } from '../stores/progression'

const emit = defineEmits<{ close: [] }>()

const progression = useProgressionStore()
const { level, maxN, perSize, totalSolved, totalHints, totalTimeMs } = storeToRefs(progression)

const ALL_SIZES = [5, 6, 7, 8, 10, 12] as const

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (x: number) => String(x).padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

function formatLong(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const rows = computed(() =>
  ALL_SIZES.map(n => {
    const stats = perSize.value[n]
    const locked = n > maxN.value
    const solved = stats?.solved ?? 0
    const bestTimeMs = stats?.bestTimeMs ?? null
    const totalTimeForSize = stats?.totalTimeMs ?? 0
    const hintsUsed = stats?.hintsUsed ?? 0
    return {
      n,
      locked,
      solved,
      best: bestTimeMs !== null ? formatTime(bestTimeMs) : '—',
      avg: solved > 0 ? formatTime(Math.round(totalTimeForSize / solved)) : '—',
      hintsAvg: solved > 0 ? (hintsUsed / solved).toFixed(1) : '—',
      noData: solved === 0,
    }
  })
)

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <Transition name="modal-fade">
    <div class="modal-backdrop" @click="onBackdropClick">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Your Stats">
        <div class="modal-header">
          <h2 class="modal-title">📊 Your Stats</h2>
          <button class="modal-close" aria-label="Close stats" @click="emit('close')">×</button>
        </div>

        <div class="overall-row">
          <div class="overall-stat">
            <span class="overall-stat__value">{{ totalSolved }}</span>
            <span class="overall-stat__label">Puzzles Solved</span>
          </div>
          <div class="overall-stat">
            <span class="overall-stat__value">{{ totalHints }}</span>
            <span class="overall-stat__label">Hints Used</span>
          </div>
          <div class="overall-stat">
            <span class="overall-stat__value">{{ formatLong(totalTimeMs) }}</span>
            <span class="overall-stat__label">Total Play Time</span>
          </div>
          <div class="overall-stat">
            <span class="overall-stat__value">Lv {{ level }}</span>
            <span class="overall-stat__label">Current Level</span>
          </div>
        </div>

        <div class="table-wrap">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Size</th>
                <th>Solved</th>
                <th>Best Time</th>
                <th>Avg Time</th>
                <th>Hints/Solve</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.n"
                :class="{ 'row--dim': row.noData }"
              >
                <td class="size-col">{{ row.n }}×{{ row.n }}</td>
                <td>{{ row.solved }}</td>
                <td>{{ row.best }}</td>
                <td>{{ row.avg }}</td>
                <td>{{ row.hintsAvg }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.modal-card {
  background: var(--bg-card);
  color: var(--text);
  border-radius: 14px;
  width: min(460px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
  padding: 20px 24px 24px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}

.modal-title {
  font-size: 1.15rem;
  font-weight: 800;
  margin: 0;
  color: var(--text);
  letter-spacing: -0.01em;
}

.modal-close {
  background: transparent;
  border: 0;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0 4px;
  transition: color 120ms ease;
}
.modal-close:hover { color: var(--text); }

/* Overall summary strip */
.overall-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
  gap: 10px;
  background: var(--bg-subtle);
  border-radius: 10px;
  padding: 14px 12px;
  margin-bottom: 18px;
}

.overall-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.overall-stat__value {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.overall-stat__label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: var(--text-muted);
  text-align: center;
}

/* Per-size table */
.table-wrap {
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.stats-table th {
  text-align: left;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 700;
  color: var(--text-muted);
  padding: 4px 8px 8px;
  border-bottom: 1.5px solid var(--border);
}

.stats-table td {
  padding: 7px 8px;
  color: var(--text);
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}

.size-col {
  font-weight: 700;
  color: var(--accent);
}

.row--dim td {
  color: var(--text-muted);
}

.row--dim .size-col {
  color: var(--text-muted);
}

/* Transition */
.modal-fade-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.modal-fade-leave-active {
  transition: all 0.18s ease;
}
.modal-fade-enter-from {
  opacity: 0;
  transform: scale(0.88);
}
.modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
