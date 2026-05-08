import { ref, watch } from 'vue'
import { lsGet, lsSet } from '../lib/safeStorage'

const STORAGE_KEY = 'star-battle-dark'

const darkMode = ref<boolean>(lsGet(STORAGE_KEY) === 'true')

// Apply immediately on load (before any component mounts)
if (darkMode.value) {
  document.documentElement.setAttribute('data-theme', 'dark')
}

watch(darkMode, (val) => {
  if (val) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  lsSet(STORAGE_KEY, String(val))
})

export function useDarkMode() {
  return {
    darkMode,
    toggleDark: () => { darkMode.value = !darkMode.value },
  }
}
