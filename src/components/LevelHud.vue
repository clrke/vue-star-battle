<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useProgressionStore } from '../stores/progression'
import { useGameStore } from '../stores/game'

const progression = useProgressionStore()
const game        = useGameStore()
const {
  level, xp, xpIntoLevel, xpForLevelSpan, xpToNextLevel, currentSize,
  totalSolved, totalHints, totalTimeMs, isMaxLevel, winsToNextLevel,
  currentStreak, bestStreak, lastHintDebit,
} = storeToRefs(progression)
const { lastSolve } = storeToRefs(game)

const expanded = ref(false)
const recentGain = ref<number | null>(null)
const recentLevelUp = ref(false)
const recentLevelDown = ref(false)
let gainTimer: ReturnType<typeof setTimeout> | null = null

// Hint debit toast — brief flash of the cost deducted
const recentHintCost = ref<number | null>(null)
let hintToastTimer: ReturnType<typeof setTimeout> | null = null

watch(lastHintDebit, (d) => {
  if (!d) return
  recentHintCost.value = d.cost
  if (hintToastTimer) clearTimeout(hintToastTimer)
  hintToastTimer = setTimeout(() => { recentHintCost.value = null }, 1200)
})

watch(lastSolve, (s) => {
  if (!s) return
  recentGain.value = s.gained
  recentLevelUp.value = s.leveledUp
  recentLevelDown.value = s.leveledDown
  if (gainTimer) clearTimeout(gainTimer)
  gainTimer = setTimeout(() => {
    recentGain.value = null
    recentLevelUp.value = false
    recentLevelDown.value = false
  }, 4000)
})

const progressPct = computed(() =>
  isMaxLevel.value ? 100 : Math.min(100, (xpIntoLevel.value / xpForLevelSpan.value) * 100),
)

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}
</script>

<template>
  <div class="hud" :class="{ 'hud--open': expanded }">
    <button class="hud-summary" @click="expanded = !expanded">
      <div class="hud-level">
        <span class="hud-level__num">
          Lv {{ level }}
          <span v-if="currentStreak >= 3" class="hud-streak" :title="`${currentStreak} clean solves in a row`">🔥{{ currentStreak }}</span>
        </span>
        <span class="hud-level__max">Playing {{ currentSize }}×{{ currentSize }}</span>
      </div>

      <div class="hud-bar" :class="{ 'hud-bar--max': isMaxLevel }">
        <div class="hud-bar__fill" :style="{ width: `${progressPct}%` }" />
        <span class="hud-bar__label">
          <template v-if="isMaxLevel">★ Max Level ★</template>
          <template v-else>{{ xpIntoLevel.toLocaleString() }} / {{ xpForLevelSpan.toLocaleString() }} XP</template>
        </span>
      </div>

      <span class="hud-arrow" :class="{ 'hud-arrow--open': expanded }">▾</span>
    </button>

    <Transition name="expand">
      <div v-if="expanded" class="hud-details">
        <dl class="hud-stats">
          <div><dt>Total XP</dt><dd>{{ xp.toLocaleString() }}</dd></div>
          <div v-if="!isMaxLevel">
            <dt>To next level</dt>
            <dd>{{ xpToNextLevel.toLocaleString() }} XP</dd>
          </div>
          <div v-if="!isMaxLevel && winsToNextLevel !== null">
            <dt>Clean wins needed</dt>
            <dd>~{{ winsToNextLevel }}</dd>
          </div>
          <div><dt>Puzzles solved</dt><dd>{{ totalSolved }}</dd></div>
          <div><dt>Hints used</dt><dd>{{ totalHints }}</dd></div>
          <div><dt>Total play time</dt><dd>{{ formatTime(totalTimeMs) }}</dd></div>
          <div><dt>Clean streak</dt><dd>🔥 {{ currentStreak }}</dd></div>
          <div><dt>Best streak</dt><dd>🔥 {{ bestStreak }}</dd></div>
        </dl>
      </div>
    </Transition>

    <Transition name="hint-fade">
      <div v-if="recentHintCost !== null" class="hint-toast" aria-live="polite">
        −{{ recentHintCost }} XP
      </div>
    </Transition>

    <Transition name="float-up">
      <div
        v-if="recentGain !== null"
        class="xp-toast"
        :class="{
          'xp-toast--levelup':   recentLevelUp,
          'xp-toast--leveldown': recentLevelDown,
        }"
      >
        <span v-if="recentLevelUp"   class="xp-toast__levelup">★ Level Up! ★</span>
        <span v-if="recentLevelDown" class="xp-toast__leveldown">▼ Level Down ▼</span>
        <span class="xp-toast__gain">{{ recentGain >= 0 ? '+' : '' }}{{ recentGain }} XP</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hud {
  width: min(560px, 92vw);
  border: 2px solid var(--border);
  border-radius: 12px;
  background: var(--bg-card);
  overflow: hidden;
  position: relative;
  transition: border-color 200ms ease;
}

.hud--open { border-color: var(--border-strong); }

.hud-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  background: transparent;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.hud-level {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 90px;
}

.hud-level__num {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.hud-streak {
  font-size: 0.75rem;
  font-weight: 700;
  color: #e67e22;
  letter-spacing: 0;
}

.hud-level__max {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 1px;
}

.hud-bar {
  flex: 1;
  position: relative;
  height: 18px;
  border-radius: 999px;
  background: var(--bg-subtle);
  overflow: hidden;
}

.hud-bar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #2980b9, #6a89cc);
  transition: width 400ms ease;
  border-radius: 999px;
}
.hud-bar--max .hud-bar__fill {
  background: linear-gradient(90deg, #c8962c, #e8c84a);
}

.hud-bar__label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.hud-arrow {
  display: inline-block;
  color: var(--text-muted);
  font-size: 0.9rem;
  transition: transform 200ms ease;
}
.hud-arrow--open { transform: rotate(180deg); }

.hud-details {
  border-top: 1px solid var(--border);
  padding: 10px 16px 12px;
  background: var(--bg-subtle);
}

.hud-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px 16px;
  margin: 0;
  font-size: 0.78rem;
}
.hud-stats > div { display: flex; justify-content: space-between; }
.hud-stats dt { color: var(--text-muted); margin: 0; }
.hud-stats dd { color: var(--text); font-weight: 700; margin: 0; }

.expand-enter-active, .expand-leave-active {
  transition: opacity 200ms ease, max-height 280ms ease;
  max-height: 220px; overflow: hidden;
}
.expand-enter-from, .expand-leave-to { opacity: 0; max-height: 0; }

/* XP gain toast */
.xp-toast {
  position: absolute;
  top: 50%; right: 14px;
  transform: translateY(-50%);
  background: var(--text);
  color: var(--bg);
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 700;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.xp-toast--levelup {
  background: linear-gradient(90deg, #f39c12, #e67e22);
  box-shadow: 0 4px 16px rgba(243, 156, 18, 0.5);
}
.xp-toast--leveldown {
  background: linear-gradient(90deg, #c0392b, #962f23);
  box-shadow: 0 4px 16px rgba(192, 57, 43, 0.5);
}
.xp-toast__levelup,
.xp-toast__leveldown { font-size: 0.75rem; letter-spacing: 0.05em; }

.float-up-enter-active { transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.float-up-leave-active { transition: all 0.3s ease; }
.float-up-enter-from   { opacity: 0; transform: translateY(-30%); }
.float-up-leave-to     { opacity: 0; transform: translateY(-80%); }

/* Hint debit toast — small red flash next to the XP bar */
.hint-toast {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 0.72rem;
  font-weight: 800;
  color: var(--red, #e74c3c);
  pointer-events: none;
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.hint-fade-enter-active { transition: all 0.15s ease; }
.hint-fade-leave-active { transition: all 0.9s ease; }
.hint-fade-enter-from   { opacity: 0; transform: translate(-50%, -60%); }
.hint-fade-leave-to     { opacity: 0; transform: translate(-50%, -80%); }
</style>
