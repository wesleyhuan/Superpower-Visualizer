import { Component, type ReactNode, type ErrorInfo } from 'react'

// React 只要有一個元件在 render 時丟錯,預設會把整棵樹卸載 → 白屏。
// Error Boundary 是「接住子樹錯誤、改畫備援畫面」的元件;React 規定它必須用 class 寫
// (getDerivedStateFromError / componentDidCatch 沒有 hook 版本)。
// 概念類似 Python 在最外層包一個 try/except,讓一處出錯不會拖垮全部。
interface Props {
  children: ReactNode
  // 備援畫面;reset() 會清掉錯誤、重畫 children(適合「關閉後再試」的局部區塊)。
  fallback: (error: Error, reset: () => void) => ReactNode
}
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 接住 render 錯誤:', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}

// 整個 App 的最外層備援:至少讓使用者看得到發生什麼事、能一鍵重新載入。
export function AppCrashFallback({ error }: { error: Error }) {
  return (
    <div className="crash" role="alert">
      <h2>畫面發生錯誤</h2>
      <p>介面遇到無法處理的資料而停止顯示。後端與 agent 仍在執行,重新載入後會從伺服器的快照還原。</p>
      <pre>{error.message}</pre>
      <button className="btn btn-primary" onClick={() => location.reload()}>重新載入</button>
    </div>
  )
}
