/**
 * DiffViewer — Shows before/after changes using Monaco's diff editor.
 * Displayed as a modal after an AI build completes.
 */
import { useState } from 'react'
import dynamic from 'next/dynamic'

const DiffEditor = dynamic(
  () => import('@monaco-editor/react').then(mod => mod.DiffEditor),
  { ssr: false }
)

interface FileChange {
  path: string
  action: 'create' | 'edit' | 'delete'
  previousContent: string
  newContent: string
}

interface DiffViewerProps {
  changes: FileChange[]
  onClose: () => void
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'tsx': case 'jsx': return 'typescript'
    case 'ts': case 'js': return 'javascript'
    case 'css': return 'css'
    case 'json': return 'json'
    case 'html': return 'html'
    case 'md': return 'markdown'
    default: return 'plaintext'
  }
}

export default function DiffViewer({ changes, onClose }: DiffViewerProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const selected = changes[selectedIndex]

  if (!selected) return null

  const actionColors: Record<string, string> = {
    create: 'text-emerald-400 bg-emerald-500/10',
    edit: 'text-blue-400 bg-blue-500/10',
    delete: 'text-red-400 bg-red-500/10',
  }

  const actionLabels: Record<string, string> = {
    create: '+',
    edit: '~',
    delete: '-',
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#111] border border-white/10 rounded-xl w-full max-w-[960px] h-[80vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#f0f0f0]">Changes</span>
            <span className="text-[10px] text-[#555] px-1.5 py-0.5 bg-white/5 rounded">{changes.length} file{changes.length !== 1 ? 's' : ''}</span>
          </div>
          <button
            onClick={onClose}
            className="px-2 py-1 bg-transparent border border-white/[0.08] rounded-md text-[#888] text-xs cursor-pointer hover:text-white"
          >
            ✕ Close
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* File list sidebar */}
          <div className="w-[200px] border-r border-white/[0.07] overflow-y-auto shrink-0 bg-[#0c0c0c]">
            {changes.map((change, i) => (
              <button
                key={change.path}
                onClick={() => setSelectedIndex(i)}
                className={`w-full text-left px-3 py-2 border-none cursor-pointer flex items-center gap-2 text-xs ${
                  i === selectedIndex
                    ? 'bg-brand/10 text-[#f0f0f0]'
                    : 'bg-transparent text-[#888] hover:bg-white/5'
                }`}
              >
                <span className={`shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold ${actionColors[change.action]}`}>
                  {actionLabels[change.action]}
                </span>
                <span className="truncate">{change.path.split('/').pop()}</span>
              </button>
            ))}
          </div>

          {/* Diff editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.05] bg-[#0a0a0a] shrink-0">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${actionColors[selected.action]}`}>
                {selected.action}
              </span>
              <span className="text-xs text-[#aaa] font-mono">{selected.path}</span>
            </div>
            <div className="flex-1">
              {selected.action === 'create' ? (
                <DiffEditor
                  original=""
                  modified={selected.newContent}
                  language={getLanguage(selected.path)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 18,
                    renderSideBySide: true,
                    scrollBeyondLastLine: false,
                  }}
                />
              ) : selected.action === 'delete' ? (
                <DiffEditor
                  original={selected.previousContent}
                  modified=""
                  language={getLanguage(selected.path)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 18,
                    renderSideBySide: true,
                    scrollBeyondLastLine: false,
                  }}
                />
              ) : (
                <DiffEditor
                  original={selected.previousContent}
                  modified={selected.newContent}
                  language={getLanguage(selected.path)}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 18,
                    renderSideBySide: true,
                    scrollBeyondLastLine: false,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
