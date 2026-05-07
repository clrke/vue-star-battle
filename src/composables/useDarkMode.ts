import { ref, watch } from 'vue'

const STORAGE_KEY = 'star-battle-dark'

const darkMode = ref<boolean>(localStorage.getItem(STORAGE_KEY) === 'true')

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
  try { localStorage.setItem(STORAGE_KEY, String(val)) } catch { /* quota */ }
})

export function useDarkMode() {
  return {
    darkMode,
    toggleDark: () => { darkMode.value = !darkMode.value },
  }
}
