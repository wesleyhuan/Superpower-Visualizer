import { useEffect, useState } from 'react'
import type { DirListing } from '../wireTypes'

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

  const go = (path: string) => {
    setError(''); setMkErr('')
    loadDirs(path).then(setListing).catch(() => { setListing(null); setError('無法讀取此目錄') })
  }
  useEffect(() => { go(initialPath) }, [initialPath])

  const atDrives = !!listing?.drives // 磁碟根視圖:不能建資料夾/確認,需先選磁碟機
  const create = () => {
    if (!listing || atDrives || !newName.trim()) return
    makeDir(listing.path, newName.trim())
      .then((path) => { setNewName(''); go(path) })
      .catch((e) => setMkErr(String(e?.message ?? e)))
  }

  return (
    <div className="scrim open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wpick" role="dialog" aria-label="選擇工作目錄">
        <div className="wpick-head">
          <span className="wpick-title">選擇新 Agent 的工作目錄</span>
          <button className="am-close" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
        <div className="wpick-crumb">{atDrives ? '此電腦' : (listing?.path || '載入中…')}</div>
        <div className="wpick-list">
          {error && <div className="wpick-error">{error}</div>}
          {listing && listing.parent !== null && (
            <button className="wpick-row up" onClick={() => go(listing.parent as string)}>.. 上一層</button>
          )}
          {listing?.drives?.map((d) => (
            <button key={d} className="wpick-row" onClick={() => go(d)}>{d}</button>
          ))}
          {listing?.entries.map((name) => (
            <button key={name} className="wpick-row" onClick={() => go(joinPath(listing.path, name))}>{name}</button>
          ))}
          {listing && !atDrives && listing.entries.length === 0 && !error && (
            <div className="wpick-empty">(沒有子資料夾)</div>
          )}
        </div>
        <div className="wpick-new">
          <input placeholder="新資料夾名稱…" value={newName}
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
