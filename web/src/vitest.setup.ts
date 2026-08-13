import '@testing-library/jest-dom'

// jsdom 沒有 scrollIntoView,對話自動捲動會用到,補一個 no-op。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// jsdom 沒有 matchMedia,App 的主題 hook 會用到,補一個最小 stub。
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false },
    }) as unknown as MediaQueryList
}
