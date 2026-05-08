<script setup lang="ts">
const emit = defineEmits<{ close: [] }>()

function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}
</script>

<template>
  <Transition name="modal-fade">
    <div class="modal-backdrop" @click="onBackdropClick">
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="How to Play">
        <div class="modal-header">
          <h2 class="modal-title">★ How to Play</h2>
          <button class="modal-close" aria-label="Close" @click="emit('close')">×</button>
        </div>

        <!-- Rule 1 -->
        <div class="rule">
          <div class="rule-text">
            <strong>One star per row, column, and region.</strong>
            <p>Each coloured area must contain exactly one star.
               Every row and every column must also contain exactly one star.</p>
          </div>
          <!-- 4×4 mini board: valid solution -->
          <div class="mini-board" style="--n: 4">
            <div class="mc" style="--r:0;--c:3;--bg:#ffd6d6">★</div>
            <div class="mc" style="--r:1;--c:1;--bg:#cff5ce">★</div>
            <div class="mc" style="--r:2;--c:3;--bg:#ddd0ff">★</div>
            <div class="mc" style="--r:3;--c:0;--bg:#c8e6ff">★</div>
            <div class="mc" style="--r:0;--c:0;--bg:#ffd6d6" />
            <div class="mc" style="--r:0;--c:1;--bg:#ffd6d6" />
            <div class="mc" style="--r:0;--c:2;--bg:#ffd6d6" />
            <div class="mc" style="--r:1;--c:0;--bg:#cff5ce" />
            <div class="mc" style="--r:1;--c:2;--bg:#fff5c0" />
            <div class="mc" style="--r:1;--c:3;--bg:#fff5c0" />
            <div class="mc" style="--r:2;--c:0;--bg:#c8e6ff" />
            <div class="mc" style="--r:2;--c:1;--bg:#c8e6ff" />
            <div class="mc" style="--r:2;--c:2;--bg:#ddd0ff" />
            <div class="mc" style="--r:3;--c:1;--bg:#c8e6ff" />
            <div class="mc" style="--r:3;--c:2;--bg:#fff5c0" />
            <div class="mc" style="--r:3;--c:3;--bg:#fff5c0" />
          </div>
        </div>

        <!-- Rule 2 -->
        <div class="rule">
          <div class="rule-text">
            <strong>Stars may not touch — not even diagonally.</strong>
            <p>No two stars can share an edge or a corner.
               This includes cells that are diagonal neighbours.</p>
          </div>
          <!-- 3×3 illustration: two stars that ARE diagonally adjacent (bad) -->
          <div class="mini-board bad-example" style="--n: 3" title="Invalid — stars are diagonally adjacent">
            <div class="mc star-bad" style="--r:0;--c:0;--bg:#ffd6d6">★</div>
            <div class="mc" style="--r:0;--c:1;--bg:#ffd6d6" />
            <div class="mc" style="--r:0;--c:2;--bg:#cff5ce" />
            <div class="mc" style="--r:1;--c:0;--bg:#fff5c0" />
            <div class="mc star-bad" style="--r:1;--c:1;--bg:#fff5c0">★</div>
            <div class="mc" style="--r:1;--c:2;--bg:#cff5ce" />
            <div class="mc" style="--r:2;--c:0;--bg:#c8e6ff" />
            <div class="mc" style="--r:2;--c:1;--bg:#c8e6ff" />
            <div class="mc" style="--r:2;--c:2;--bg:#c8e6ff" />
          </div>
        </div>

        <!-- Controls -->
        <div class="controls-section">
          <h3 class="controls-title">Controls</h3>
          <table class="controls-table">
            <tbody>
              <tr><td class="ctrl-key">Left-click / Space</td><td>Place or remove a ★</td></tr>
              <tr><td class="ctrl-key">Right-click / D</td><td>Place a dot to mark eliminated cells</td></tr>
              <tr><td class="ctrl-key">Arrow keys</td><td>Move keyboard cursor</td></tr>
              <tr><td class="ctrl-key">Ctrl+Z</td><td>Undo last move</td></tr>
              <tr><td class="ctrl-key">Hint button</td><td>Get a logical deduction step (costs XP)</td></tr>
            </tbody>
          </table>
        </div>

        <button class="close-btn" @click="emit('close')">Got it!</button>
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
  width: min(500px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-title {
  font-size: 1.15rem;
  font-weight: 800;
  margin: 0;
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
  transition: color 120ms;
}
.modal-close:hover { color: var(--text); }

/* Rules */
.rule {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.rule-text {
  flex: 1;
  font-size: 0.85rem;
  line-height: 1.5;
}
.rule-text strong { display: block; margin-bottom: 4px; color: var(--text); }
.rule-text p { margin: 0; color: var(--text-muted); }

/* Mini board */
.mini-board {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(var(--n), 1fr);
  grid-template-rows: repeat(var(--n), 1fr);
  width: calc(var(--n) * 28px);
  height: calc(var(--n) * 28px);
  border: 2px solid var(--border-strong);
  border-radius: 3px;
  overflow: hidden;
}
.mc {
  grid-row: calc(var(--r) + 1);
  grid-column: calc(var(--c) + 1);
  background: var(--bg);
  border: 0.5px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--amber);
  font-weight: 900;
  background-color: var(--bg, #fff);
}
/* Apply region colour via inline --bg custom prop */
.mc[style*="--bg"] { background: var(--bg); }

.bad-example { position: relative; }
.star-bad { color: var(--red, #e74c3c); }
.bad-example::after {
  content: '✕';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.5rem;
  font-weight: 900;
  color: rgba(192, 57, 43, 0.55);
  pointer-events: none;
}

/* Controls table */
.controls-section { border-top: 1px solid var(--border); padding-top: 14px; }
.controls-title {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 0 0 10px;
}
.controls-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.controls-table td { padding: 4px 0; }
.ctrl-key {
  font-weight: 700;
  color: var(--text);
  padding-right: 16px;
  white-space: nowrap;
}

.close-btn {
  align-self: flex-end;
  padding: 8px 22px;
  border-radius: 8px;
  border: 2px solid var(--accent);
  background: var(--accent);
  color: #fff;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
}
.close-btn:hover { background: var(--accent-dark); border-color: var(--accent-dark); }

/* Reuse StatsModal's fade animation */
.modal-fade-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.4, 0.64, 1); }
.modal-fade-leave-active { transition: all 0.18s ease; }
.modal-fade-enter-from   { opacity: 0; transform: scale(0.88); }
.modal-fade-leave-to     { opacity: 0; transform: scale(0.95); }
</style>
