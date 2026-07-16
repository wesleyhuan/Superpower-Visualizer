import { TranscriptSource, readWorkspace } from './transcriptSource'
import { AntigravitySource } from './antigravitySource'
import { listSessions } from './sessions'
import { listAntigravitySessions, antigravityWorkspace } from './antigravitySessions'
import type { FrontendEvent } from './types'

export type SourceSystem = 'claude' | 'antigravity'

// 觀察來源的共同介面(TranscriptSource / AntigravitySource 都符合)。
export interface Source { start(): void; stop(): void }

// 依系統建對應的觀察來源。Claude 讀 .jsonl,Antigravity 讀 conversation .db。
export function makeObserveSource(
  system: SourceSystem, file: string, emit: (events: FrontendEvent[]) => void,
): Source {
  return system === 'antigravity' ? new AntigravitySource(file, emit) : new TranscriptSource(file, emit)
}

// 依系統推斷該 session 的工作目錄(標題列顯示用)。
export function workspaceFor(system: SourceSystem, file: string): string {
  return system === 'antigravity' ? antigravityWorkspace(file) : readWorkspace(file)
}

// 依系統列可觀察的 session,每筆都帶 system 供前端分辨與切換。
export function listObservableSessions(system: SourceSystem) {
  return system === 'antigravity'
    ? listAntigravitySessions()
    : listSessions().map((s) => ({ system: 'claude' as const, ...s }))
}
