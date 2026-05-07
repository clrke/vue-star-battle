<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useProgressionStore } from '../stores/progression'
import { useGameStore } from '../stores/game'

const progression = useProgressionStore()
const game        = useGameStore()
const {
  level, xp, xpIntoLevel, xpForLevelSpan, xpToNextLevel, maxN,
  totalSolved, totalHints, totalTimeMs,
} = storeToRefs(progression)
const { lastSolve } = storeToRefs(game)

const expanded = ref(false)
const recentGain = ref<number | null>(null)
const recentLevelUp = ref(false)
let gainTimer: ReturnType<typeof setTimeout> | null = null

watch(lastSolve, (s) => {
  if (!s || s.gained === 0) return
  recentGain.value = s.gained
  recentLevelUp.value = s.leveledUp
  if (gainTimer) clearTimeout(gainTimer)
  gainTimer = setTimeout(() => { recentGain.value = null; recentLevelUp.value = false }, 4000)
})

const progressPct = computed(() =>
  Math.min(100, (xpIntoLevel.value / xpForLevelSpan.value) * 100),
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
        <span class="hud-level__num">Lv {{ level }}</span>
        <span class="hud-level__max">Max size unlocked: {{ maxN }}×{{ maxN }}</span>
      </div>

      <div class="hud-bar">
        <div class="hud-bar__fill" :style="{ width: `${progressPct}%` }" />
        <span class="hud-bar__label">
          {{ xpIntoLevel.toLocaleString() }} / {{ xpForLevelSpan.toLocaleString() }} XP
        </span>
      </div>

      <span class="hud-arrow" :class="{ 'hud-arrow--open': expanded }">▾</span>
    </button>

    <Transition name="expand">
      <div v-if="expanded" class="hud-details">
        <dl class="hud-stats">
          <div><dt>Total XP</dt><dd>{{ xp.toLocaleString() }}</dd></div>
          <div><dt>To next level</dt><dd>{{ xpToNextLevel.toLocaleString() }}</dd></div>
          <div><dt>Puzzles solved</dt><dd>{{ totalSolved }}</dd></div>
          <div><dt>Hints used</dt><dd>{{ totalHints }}</dd></div>
          <div><dt>Total play time</dt><dd>{{ formatTime(totalTimeMs) }}</dd></div>
        </dl>
      </div>
    </Transition>

    <Transition name="float-up">
      <div v-if="recentGain !== null" class="xp-toast" :class="{ 'xp-toast--levelup': recentLevelUp }">
        <span v-if="recentLevelUp" class="xp-toast__levelup">★ Level Up! ★</span>
        <span class="xp-toast__gain">+{{ recentGain }} XP</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hud {
  width: min(560px, 92vw);
  border: 2px solid #ddd;
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  position: relative;
  transition: border-color 200ms ease;
}

.hud--open { border-color: #aaa; }

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
  color: #1a1a2e;
  letter-spacing: -0.01em;
}

.hud-level__max {
  font-size: 0.7rem;
  color: #888;
  margin-top: 1px;
}

.hud-bar {
  flex: 1;
  position: relative;
  height: 18px;
  border-radius: 999px;
  background: #eee;
  overflow: hidden;
}

.hud-bar__fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #2980b9, #6a89cc);
  transition: width 400ms ease;
  border-radius: 999px;
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
  color: #999;
  font-size: 0.9rem;
  transition: transform 200ms ease;
}
.hud-arrow--open { transform: rotate(180deg); }

.hud-details {
  border-top: 1px solid #eee;
  padding: 10px 16px 12px;
  background: #fafafa;
}

.hud-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px 16px;
  margin: 0;
  font-size: 0.78rem;
}
.hud-stats > div { display: flex; justify-content: space-between; }
.hud-stats dt { color: #888; margin: 0; }
.hud-stats dd { color: #222; font-weight: 700; margin: 0; }

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
  background: #1a1a2e;
  color: #fff;
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
.xp-toast__levelup { font-size: 0.75rem; letter-spacing: 0.05em; }

.float-up-enter-active { transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.float-up-leave-active { transition: all 0.3s ease; }
.float-up-enter-from   { opacity: 0; transform: translateY(-30%); }
.float-up-leave-to     { opacity: 0; transform: translateY(-80%); }
</style>
