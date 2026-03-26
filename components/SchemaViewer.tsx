/**
 * SchemaViewer — Visual database schema viewer for a project.
 * Shows tables, columns, and types from the project's clients DB schema.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Column {
  name: string
  type: string
  nullable: boolean
  default: string | null
}

interface Table {
  name: string
  columns: Column[]
}

interface SchemaViewerProps {
  projectId: string
  onClose: () => void
}

export default function SchemaViewer({ projectId, onClose }: SchemaViewerProps) {
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedTable, setExpandedTable] = useState<string | null>(null)

  useEffect(() => {
    loadSchema()
  }, [projectId])

  async function loadSchema() {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/schema?projectId=${projectId}`, {
        headers: {
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
      })
      const data = await res.json()
      if (data.tables) {
        setTables(data.tables)
        if (data.tables.length > 0) setExpandedTable(data.tables[0].name)
      }
      if (data.message) setError(data.message)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const typeColors: Record<string, string> = {
    uuid: 'text-purple-400',
    text: 'text-emerald-400',
    integer: 'text-blue-400',
    bigint: 'text-blue-400',
    numeric: 'text-blue-400',
    boolean: 'text-amber-400',
    timestamptz: 'text-pink-400',
    timestamp: 'text-pink-400',
    jsonb: 'text-orange-400',
    json: 'text-orange-400',
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#111] border border-white/10 rounded-xl w-full max-w-[600px] max-h-[70vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">🗄</span>
            <h2 className="text-sm font-semibold text-[#f0f0f0]">Database Schema</h2>
            <span className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-[#555]">
              {tables.length} table{tables.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white bg-transparent border-none cursor-pointer text-sm">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-[#555] text-sm">Loading schema...</div>
          ) : error ? (
            <div className="text-[#888] text-sm text-center py-8">{error}</div>
          ) : tables.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-[#444] text-2xl mb-2">🗄</div>
              <div className="text-[#888] text-sm">No tables yet</div>
              <div className="text-[#555] text-xs mt-1">Ask the AI to create tables for your app</div>
            </div>
          ) : (
            <div className="space-y-2">
              {tables.map(table => (
                <div key={table.name} className="bg-[#0a0a0a] border border-white/[0.07] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedTable(expandedTable === table.name ? null : table.name)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-transparent border-none cursor-pointer text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#555]">{expandedTable === table.name ? '▼' : '▸'}</span>
                      <span className="text-sm font-medium text-[#f0f0f0]">{table.name}</span>
                      <span className="text-[10px] text-[#444]">{table.columns.length} columns</span>
                    </div>
                  </button>

                  {expandedTable === table.name && (
                    <div className="border-t border-white/[0.05] px-3 py-1.5">
                      <table className="w-full">
                        <thead>
                          <tr className="text-[9px] text-[#555] uppercase tracking-wider">
                            <th className="text-left py-1 font-medium">Column</th>
                            <th className="text-left py-1 font-medium">Type</th>
                            <th className="text-left py-1 font-medium">Default</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.columns.map(col => (
                            <tr key={col.name} className="border-t border-white/[0.03]">
                              <td className="py-1 text-xs text-[#ccc] font-mono">
                                {col.name}
                                {col.nullable && <span className="text-[9px] text-[#444] ml-1">?</span>}
                              </td>
                              <td className={`py-1 text-[10px] font-mono ${typeColors[col.type] || 'text-[#888]'}`}>
                                {col.type}
                              </td>
                              <td className="py-1 text-[10px] text-[#444] font-mono truncate max-w-[120px]">
                                {col.default ? col.default.replace(/::.*$/, '') : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
