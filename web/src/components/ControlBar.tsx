import { useState } from 'react'

export function ControlBar({
  onPause, onFollowup, disabled,
}: { onPause: () => void; onFollowup: (text: string) => void; disabled: boolean }) {
  const [text, setText] = useState('')
  return (
    <div>
      <button onClick={onPause} disabled={disabled}>暫停</button>
      <input
        value={text}
        disabled={disabled}
        placeholder="派新任務…"
        onChange={(e) => setText(e.target.value)}
      />
      <button
        disabled={disabled || text.trim() === ''}
        onClick={() => { onFollowup(text.trim()); setText('') }}
      >送出</button>
    </div>
  )
}
