import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

interface Version {
  id: string
  code: string
  source: string
  created_at: string
}

interface VersionHistoryProps {
  pageId: string
  onRestore: (code: string) => void
  onClose: () => void
  onPreview: (code: string) => void
}

export default function VersionHistory({ pageId, onRestore, onClose, onPreview }: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    loadVersions()
  }, [pageId])

  async function loadVersions() {
    setLoading(true)
    const { data } = await supabase
      .from('page_versions')
      .select('*')
      .eq('page_id', pageId)
      .order('created_at', { ascending: false })
      .limit(30)
    setVersions(data || [])
    setLoading(false)
  }

  function formatTime(ts: string) {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  }

  function sourceLabel(source: string) {
    switch (source) {
      case 'ai_build': return '⚡ AI Build'
      case 'manual_edit': return '✏️ Manual Edit'
      case 'restore': return '↩️ Restored'
      default: return source
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <h3 style={styles.title}>Version History</h3>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : versions.length === 0 ? (
            <div style={styles.empty}>No previous versions yet. Versions are saved automatically on each build or save.</div>
          ) : (
            versions.map((v, i) => (
              <div
                key={v.id}
                style={{ ...styles.item, ...(selected === v.id ? styles.itemSelected : {}) }}
                onClick={() => {
                  setSelected(v.id)
                  onPreview(v.code)
                }}
              >
                <div style={styles.itemTop}>
                  <span style={styles.itemSource}>{sourceLabel(v.source)}</span>
                  <span style={styles.itemTime}>{formatTime(v.created_at)}</span>
                </div>
                <div style={styles.itemPreview}>
                  {v.code.slice(0, 120).replace(/\s+/g, ' ')}...
                </div>
                {selected === v.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onRestore(v.code)
                    }}
                    style={styles.restoreBtn}
                  >
                    ↩ Restore this version
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'flex-end', zIndex: 50,
  },
  panel: {
    width: 360, maxWidth: '100%', background: 'var(--bg-2)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', height: '100%',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  title: { fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 14, cursor: 'pointer',
    padding: '4px 8px',
  },
  list: { flex: 1, overflowY: 'auto', padding: '8px 12px' },
  empty: {
    color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: '40px 20px', lineHeight: 1.6,
  },
  item: {
    padding: '12px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)',
    background: 'var(--bg-3)', marginBottom: 8, cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  itemSelected: {
    borderColor: 'rgba(124,110,247,0.4)', background: 'rgba(124,110,247,0.05)',
  },
  itemTop: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6,
  },
  itemSource: { fontSize: 11, fontWeight: 500, color: 'var(--text-2)' },
  itemTime: { fontSize: 11, color: 'var(--text-3)' },
  itemPreview: {
    fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace', lineHeight: 1.4,
    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  },
  restoreBtn: {
    marginTop: 10, padding: '6px 14px', background: '#7c6ef7', border: 'none',
    borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
    width: '100%',
  },
}
