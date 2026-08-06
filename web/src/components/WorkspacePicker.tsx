import { useCallback, useEffect, useState } from 'react'
import type { DirListing } from '../wireTypes'
import { useModalFocus } from '../hooks/useModalFocus'

const FolderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
)
const UpIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V6M6 12l6-6 6 6" /></svg>
)
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
)

interface Props {
  initialPath: string
  loadDirs: (path: string) => Promise<DirListing>
  makeDir: (parent: string, name: string) => Promise<string>
  onConfirm: (path: string) => void
  onClose: () => void
}

// 跨平台在前端接路徑:base 已以 \ 結尾就不再補分隔符。
function joinPath(base: string, name: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  return base.endsWith(sep) ? base + name : base + sep + name
}

// 新 Agent 的工作目錄選擇器:後端列目錄,前端導覽 + 建資料夾 + 確認。
export function WorkspacePicker({ initialPath, loadDirs, makeDir, onConfirm, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [mkErr, setMkErr] = useState('')

  // loadDirs 來自 useSession 的 useCallback,參考穩定 → go 也穩定,effect 只在 initialPath 變時跑。
  const go = useCallback((path: string) => {
    setError(''); setMkErr('')
    loadDirs(path).then(setListing).catch((e) => { console.error('[WorkspacePicker] loadDirs 失敗', e); setListing(null); setError('無法讀取此目錄') })
  }, [loadDirs])
  useEffect(() => { go(initialPath) }, [go, initialPath])

  // 可及性:Esc 關閉(與其他 overlay 一致);開啟時聚焦 + Tab focus trap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const modalRef = useModalFocus<HTMLDivElement>()

  const atDrives = !!listing?.drives // 磁碟根視圖:不能建資料夾/確認,需先選磁碟機
  const create = () => {
    if (!listing || atDrives || !newName.trim()) return
    makeDir(listing.path, newName.trim())
      .then((path) => { setNewName(''); go(path) })
      .catch((e) => { console.error('[WorkspacePicker] makeDir 失敗', e); setMkErr(String(e?.message ?? e)) })
  }

  return (
    <div className="scrim open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wpick" role="dialog" aria-label="選擇工作目錄" ref={modalRef}>
        <div className="wpick-head">
          <span className="wpick-title">選擇新 Agent 的工作目錄</span>
          <button className="am-close" aria-label="關閉" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="wpick-crumb">{atDrives ? '此電腦' : (listing?.path || '載入中…')}</div>
        <div className="wpick-list">
          {error && <div className="wpick-error">{error}</div>}
          {listing && listing.parent !== null && (
            <button className="wpick-row up" onClick={() => go(listing.parent as string)}><UpIcon />上一層</button>
          )}
          {listing?.drives?.map((d) => (
            <button key={d} className="wpick-row" onClick={() => go(d)}><FolderIcon />{d}</button>
          ))}
          {listing?.entries.map((name) => (
            <button key={name} className="wpick-row" onClick={() => go(joinPath(listing.path, name))}><FolderIcon />{name}</button>
          ))}
          {listing && !atDrives && listing.entries.length === 0 && !error && (
            <div className="wpick-empty">(沒有子資料夾)</div>
          )}
        </div>
        <div className="wpick-new">
          <input aria-label="新資料夾名稱" placeholder="新資料夾名稱…" value={newName}
                 onChange={(e) => setNewName(e.target.value)} disabled={!listing || atDrives} />
          <button onClick={create} disabled={!listing || atDrives || !newName.trim()}>＋建立</button>
        </div>
        {mkErr && <div className="wpick-error">{mkErr}</div>}
        <div className="wpick-foot">
          <button className="btn btn-ghost" onClick={onClose}>取消</button>
          <button className="btn btn-primary" disabled={!listing || atDrives}
                  onClick={() => listing && !atDrives && onConfirm(listing.path)}>使用這個目錄</button>
        </div>
      </div>
    </div>
  )
}
