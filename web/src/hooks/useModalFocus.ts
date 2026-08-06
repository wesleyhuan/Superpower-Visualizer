import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// modal 可及性:開啟時把焦點移進 modal(第一個可聚焦元素),
// 並用 Tab focus trap 讓焦點在 modal 內循環、不逸出到背景。
export function useModalFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const focusables = () => Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
    focusables()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const f = focusables()
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    box.addEventListener('keydown', onKey)
    return () => box.removeEventListener('keydown', onKey)
  }, [])
  return ref
}
