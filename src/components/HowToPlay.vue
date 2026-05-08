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
            <strong>One star per row, column &amp; region.</strong>
            <p>Each coloured region must contain exactly one star.
               Every row and every column must also hold exactly one star.</p>
          </div>
          <!--
            Valid 4×4 solution — regions are 2×2 quadrants:
              A(rose) top-left · B(sky) top-right
              C(mint) bottom-left · D(yellow) bottom-right
            Stars: (0,1)A  (1,3)B  (2,0)C  (3,2)D
            Rows 0-3: 1 star each ✓   Cols 1,3,0,2: 1 star each ✓
            No diagonal neighbours ✓
          -->
          <div class="mini-board" style="--n:4" aria-hidden="true">
            <!-- row 0 -->
            <div class="mc" style="--bg:#ffd6d6"></div>
            <div class="mc mc--star" style="--bg:#ffd6d6">★</div>
            <div class="mc" style="--bg:#c8e6ff"></div>
            <div class="mc" style="--bg:#c8e6ff"></div>
            <!-- row 1 -->
            <div class="mc" style="--bg:#ffd6d6"></div>
            <div class="mc" style="--bg:#ffd6d6"></div>
            <div class="mc" style="--bg:#c8e6ff"></div>
            <div class="mc mc--star" style="--bg:#c8e6ff">★</div>
            <!-- row 2 -->
            <div class="mc mc--star" style="--bg:#cff5ce">★</div>
            <div class="mc" style="--bg:#cff5ce"></div>
            <div class="mc" style="--bg:#fff5c0"></div>
            <div class="mc" style="--bg:#fff5c0"></div>
            <!-- row 3 -->
            <div class="mc" style="--bg:#cff5ce"></div>
            <div class="mc" style="--bg:#cff5ce"></div>
            <div class="mc mc--star" style="--bg:#fff5c0">★</div>
            <div class="mc" style="--bg:#fff5c0"></div>
          </div>
        </div>

        <!-- Rule 2 -->
        <div class="rule">
          <div class="rule-text">
            <strong>Stars may not touch — not even diagonally.</strong>
            <p>No two stars can share an edge or a corner.
               Diagonal neighbours are also illegal.</p>
          </div>
          <!--
            3×3 bad example: stars at (0,0) and (1,1) are diagonally adjacent.
          -->
          <div class="mini-board mini-board--bad" style="--n:3" aria-hidden="true">
            <!-- row 0 -->
            <div class="mc mc--star mc--bad" style="--bg:#ffd6d6">★</div>
            <div class="mc" style="--bg:#ffd6d6"></div>
            <div class="mc" style="--bg:#c8e6ff"></div>
            <!-- row 1 -->
            <div class="mc" style="--bg:#cff5ce"></div>
            <div class="mc mc--star mc--bad" style="--bg:#cff5ce">★</div>
            <div class="mc" style="--bg:#c8e6ff"></div>
            <!-- row 2 -->
            <div class="mc" style="--bg:#fff5c0"></div>
            <div class="mc" style="--bg:#fff5c0"></div>
            <div class="mc" style="--bg:#fff5c0"></div>
          </div>
        </div>

        <!-- Controls -->
        <div class="controls-section">
          <h3 class="controls-title">Controls</h3>
          <table class="controls-table">
            <tbody>
              <tr><td class="ctrl-key">Left-click / Space</td><td>Place or remove a ★</td></tr>
              <tr><td class="ctrl-key">Right-click / D</td><td>Place a dot (mark eliminated cells)</td></tr>
              <tr><td class="ctrl-key">Arrow keys</td><td>Move the keyboard cursor</td></tr>
              <tr><td class="ctrl-key">Ctrl+Z</td><td>Undo</td></tr>
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

/* Mini board — simple auto-flow grid, no CSS-variable positioning tricks */
.mini-board {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(var(--n), 28px);
  grid-template-rows:    repeat(var(--n), 28px);
  border: 2px solid var(--border-strong);
  border-radius: 3px;
  overflow: hidden;
}
.mc {
  width: 28px;
  height: 28px;
  background: var(--bg, #eee);
  border: 0.5px solid rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 900;
  color: var(--amber);
  user-select: none;
}
.mc--bad { color: var(--red, #e74c3c); }

/* ✕ overlay on the bad example */
.mini-board--bad {
  position: relative;
}
.mini-board--bad::after {
  content: '✕';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 3rem;
  font-weight: 900;
  color: rgba(192, 57, 43, 0.5);
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
.controls-table td { padding: 4px 0; vertical-align: top; }
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

.modal-fade-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.4, 0.64, 1); }
.modal-fade-leave-active { transition: all 0.18s ease; }
.modal-fade-enter-from   { opacity: 0; transform: scale(0.88); }
.modal-fade-leave-to     { opacity: 0; transform: scale(0.95); }
</style>
