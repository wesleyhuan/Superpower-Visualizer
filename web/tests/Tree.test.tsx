import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Tree } from '../src/components/Tree'
import type { TreeItem } from '../src/buildTree'

describe('<Tree>', () => {
  it('渲染節點 label 與子節點,並帶 data-status', () => {
    const items: TreeItem[] = [
      {
        node: { id: 'root', parentId: null, type: 'subagent', label: 'subagent: 研究', status: 'running' },
        children: [
          { node: { id: 'c', parentId: 'root', type: 'tool', label: 'Bash: ls', status: 'awaiting' }, children: [] },
        ],
      },
    ]
    render(<Tree items={items} />)
    expect(screen.getByText('subagent: 研究')).toBeInTheDocument()
    const child = screen.getByText('Bash: ls')
    expect(child.closest('[data-status]')?.getAttribute('data-status')).toBe('awaiting')
  })
})
