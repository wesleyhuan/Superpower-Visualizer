import { useState } from 'react'
import { useSession } from './useSession'
import { buildTree } from './buildTree'
import { Tree } from './components/Tree'
import { LogStream } from './components/LogStream'
import { ApprovalQueue } from './components/ApprovalQueue'
import { ControlBar } from './components/ControlBar'

export function App() {
  const { state, connected, pause, approve, followup, start } = useSession()
  const [prompt, setPrompt] = useState('')
  const items = buildTree(state)

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>Superpower Visualizer {connected ? '🟢' : '🔴'}</h1>

      {state.sessionEnded && (
        <div style={{ background: '#fee', padding: 8, marginBottom: 8 }}>
          Session 已結束{state.errorMessage ? `:${state.errorMessage}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          style={{ flex: 1 }}
          value={prompt}
          placeholder="輸入初始任務…"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <button disabled={prompt.trim() === ''} onClick={() => { start(prompt.trim()); setPrompt('') }}>
          啟動 agent
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}><h3>互動樹</h3><Tree items={items} /></div>
        <div style={{ flex: 1 }}><h3>活動日誌</h3><LogStream logs={state.logs} /></div>
      </div>

      <ApprovalQueue pending={state.pending} onDecide={approve} />
      <ControlBar onPause={pause} onFollowup={followup} disabled={state.sessionEnded} />
    </div>
  )
}
