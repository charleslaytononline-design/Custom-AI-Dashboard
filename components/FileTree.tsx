import { useState } from 'react'
import type { FileTreeNode } from '../lib/virtualFS'

interface FileTreeProps {
  nodes: FileTreeNode[]
  activeFilePath: string | null
  onFileSelect: (node: FileTreeNode) => void
  onNewFile?: () => void
  onDeleteFile?: (path: string) => void
}

export default function FileTree({ nodes, activeFilePath, onFileSelect, onNewFile, onDeleteFile }: FileTreeProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {onNewFile && (
        <div className="p-3 shrink-0">
          <button onClick={onNewFile} className="w-full py-2 bg-surface-3 border border-white/[0.08] rounded-lg text-[var(--text-3)] text-[13px] cursor-pointer text-left px-3">
            + New file
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-1">
        {nodes.map(node => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onDeleteFile={onDeleteFile}
          />
        ))}
      </div>
    </div>
  )
}

function TreeNode({
  node,
  depth,
  activeFilePath,
  onFileSelect,
  onDeleteFile,
}: {
  node: FileTreeNode
  depth: number
  activeFilePath: string | null
  onFileSelect: (node: FileTreeNode) => void
  onDeleteFile?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const isActive = activeFilePath === node.path
  const indent = depth * 16

  if (node.type === 'folder') {
    return (
      <div>
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-white/[0.04] rounded-md text-[12px]"
          style={{ paddingLeft: indent + 8 }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="text-[var(--text-3)] text-[10px] w-3">{expanded ? '▾' : '▸'}</span>
          <span className="text-[var(--text-2)]">📁</span>
          <span className="text-[var(--text-2)] font-medium">{node.name}</span>
        </div>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onDeleteFile={onDeleteFile}
          />
        ))}
      </div>
    )
  }

  const icon = node.file_type === 'html' ? '📄' :
    node.file_type === 'css' ? '🎨' :
    node.file_type === 'js' || node.file_type === 'ts' ? '⚙️' :
    node.file_type === 'json' ? '📋' :
    node.file_type === 'image' ? '🖼' : '📝'

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-md text-[12px] group ${
        isActive ? 'bg-brand/10 text-[var(--text)]' : 'hover:bg-white/[0.04] text-[var(--text-2)]'
      }`}
      style={{ paddingLeft: indent + 8 }}
      onClick={() => onFileSelect(node)}
    >
      <span className="w-3" />
      <span>{icon}</span>
      <span className={`flex-1 truncate ${isActive ? 'text-[var(--text)] font-medium' : ''}`}>{node.name}</span>
      {onDeleteFile && (
        <button
          onClick={(e) => { e.stopPropagation(); onDeleteFile(node.path) }}
          className="opacity-0 group-hover:opacity-100 bg-transparent border-none text-[var(--text-3)] text-[10px] cursor-pointer px-1"
        >
          ✕
        </button>
      )}
    </div>
  )
}
