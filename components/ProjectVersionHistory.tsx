import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { deleteFile, saveFile, getFileType } from '../lib/virtualFS'

interface BuildVersion {
  build_id: string
  created_at: string
  files: Array<{ file_path: string; content: string | null }>
}

interface ProjectVersionHistoryProps {
  projectId: string
  userId: string
  onRestore: () => void
  onClose: () => void
}

export default function ProjectVersionHistory({ projectId, userId, onRestore, onClose }: ProjectVersionHistoryProps) {
  const [builds, setBuilds] = useState<BuildVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    loadVersions()
  }, [projectId])

  async function loadVersions() {
    setLoading(true)
    const { data } = await supabase
      .from('project_file_versions')
      .select('build_id, file_path, content, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (!data || data.length === 0) {
      setBuilds([])
      setLoading(false)
      return
    }

    const grouped = new Map<string, BuildVersion>()
    for (const row of data) {
      if (!grouped.has(row.build_id)) {
        grouped.set(row.build_id, { build_id: row.build_id, created_at: row.created_at, files: [] })
      }
      grouped.get(row.build_id)!.files.push({ file_path: row.file_path, content: row.content })
    }
    setBuilds(Array.from(grouped.values()))
    setLoading(false)
  }

  async function restoreBuild(build: BuildVersion) {
    setRestoring(true)
    try {
      for (const snap of build.files) {
        if (snap.content === null) {
          await deleteFile(projectId, snap.file_path)
        } else {
          const ext = snap.file_path.split('.').pop() || ''
          await saveFile(projectId, userId, snap.file_path, snap.content, getFileType(ext))
        }
      }
      onRestore()
    } catch (err) {
      console.error('Restore failed:', err)
    } finally {
      setRestoring(false)
    }
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

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Version History</h3>
          <button onClick={onClose} style={styles.closeBtn}>&#x2715;</button>
        </div>

        <div style={styles.list}>
          {loading ? (
            <div style={styles.empty}>Loading...</div>
          ) : builds.length === 0 ? (
            <div style={styles.empty}>No previous versions yet. Versions are saved automatically on each build.</div>
          ) : (
            builds.map((build, i) => (
              <div
                key={build.build_id}
                style={{ ...styles.item, ...(selected === build.build_id ? styles.itemSelected : {}) }}
                onClick={() => {
                  setSelected(build.build_id)
                  setExpanded(expanded === build.build_id ? null : build.build_id)
                }}
              >
                <div style={styles.itemTop}>
                  <span style={styles.itemSource}>Build #{builds.length - i}</span>
                  <span style={styles.itemTime}>{formatTime(build.created_at)}</span>
                </div>
                <div style={styles.itemMeta}>
                  {build.files.length} file{build.files.length !== 1 ? 's' : ''} changed
                </div>
                {expanded === build.build_id && (
                  <div style={styles.fileList}>
                    {build.files.map(f => (
                      <div key={f.file_path} style={styles.fileItem}>
                        <span style={{ color: f.content === null ? '#4ade80' : '#60a5fa', marginRight: 6, fontSize: 10 }}>
                          {f.content === null ? '+' : '~'}
                        </span>
                        {f.file_path}
                      </div>
                    ))}
                  </div>
                )}
                {selected === build.build_id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      restoreBuild(build)
                    }}
                    disabled={restoring}
                    style={{ ...styles.restoreBtn, opacity: restoring ? 0.6 : 1 }}
                  >
                    {restoring ? 'Restoring...' : 'Restore this version'}
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
    width: 380, maxWidth: '100%', background: 'var(--bg-2)', borderLeft: '1px solid var(--border)',
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
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  itemSource: { fontSize: 12, fontWeight: 500, color: 'var(--text-2)' },
  itemTime: { fontSize: 11, color: 'var(--text-3)' },
  itemMeta: { fontSize: 11, color: 'var(--text-3)' },
  fileList: {
    marginTop: 8, padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: 6,
  },
  fileItem: {
    fontSize: 11, fontFamily: 'monospace', color: 'var(--text-3)', padding: '2px 0',
    display: 'flex', alignItems: 'center',
  },
  restoreBtn: {
    marginTop: 10, padding: '7px 14px', background: '#7c6ef7', border: 'none',
    borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer',
    width: '100%',
  },
}
