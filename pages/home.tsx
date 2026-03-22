import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

interface Project {
  id: string; name: string; description: string; created_at: string; updated_at: string
}

function openBuyModal() {
  window.dispatchEvent(new CustomEvent('openBuyModal'))
}

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) { router.push('/'); return }
    })

    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadProfile(data.user.id)
      loadProjects(data.user.id)
    })

    return () => authListener.subscription.unsubscribe()
  }, [])

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) setProfile(data)
  }

  async function loadProjects(userId: string) {
    const { data } = await supabase.from('projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
    setProjects(data || [])
    setLoading(false)
  }

  async function createProject() {
    if (!newName.trim() || !user) return

    if (profile?.role !== 'admin' && (profile?.credit_balance || 0) <= 0) {
      setShowNew(false)
      openBuyModal()
      return
    }

    setCreating(true)
    const { data, error } = await supabase.from('projects').insert({
      user_id: user.id, name: newName.trim(), description: newDesc.trim(),
    }).select().single()

    if (!error && data) {
      await supabase.from('pages').insert({
        project_id: data.id, user_id: user.id, name: 'Home', code: getStarterCode(),
      })
      router.push(`/project/${data.id}`)
    }
    setCreating(false)
  }

  async function deleteProject(id: string) {
    if (!confirm('Delete this project and all its pages?')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const isAdmin = profile?.role === 'admin'
  const balance = profile?.credit_balance || 0
  const hasCredits = isAdmin || balance > 0

  return (
    <div style={s.main}>
      {loading ? (
        <div style={s.loadingInner}>Loading...</div>
      ) : (
        <>
          <div style={s.topbar}>
            <div>
              <h1 style={s.pageTitle}>My Projects</h1>
              <p style={s.pageSub}>Build and manage your AI-powered apps</p>
            </div>
            <button onClick={() => hasCredits ? setShowNew(true) : openBuyModal()} style={s.newBtn}>
              + New Project
            </button>
          </div>

          {!hasCredits && (
            <div style={s.noCreditsBanner}>
              <span>⚡</span>
              <div>
                <strong style={{ color: '#f0f0f0' }}>You need credits to build</strong>
                <p style={{ color: '#888', fontSize: 12, marginTop: 2 }}>Purchase credits to create projects and use the AI builder.</p>
              </div>
              <button onClick={openBuyModal} style={s.buyNowBtn}>Buy Credits →</button>
            </div>
          )}

          {projects.length === 0 ? (
            <div style={s.empty}>
              <div style={{ fontSize: 36, opacity: 0.2, marginBottom: 16 }}>✦</div>
              <h2 style={s.emptyTitle}>No projects yet</h2>
              <p style={s.emptyText}>Create your first project to start building with AI</p>
              <button onClick={() => hasCredits ? setShowNew(true) : openBuyModal()} style={s.emptyBtn}>
                {hasCredits ? '+ Create your first project' : '+ Buy credits to get started'}
              </button>
            </div>
          ) : (
            <div style={s.grid}>
              <div style={s.newCard} onClick={() => hasCredits ? setShowNew(true) : openBuyModal()}>
                <div style={s.newCardIcon}>+</div>
                <span style={s.newCardLabel}>New Project</span>
              </div>
              {projects.map(project => (
                <div key={project.id} style={s.card}>
                  <div style={s.cardPreview} onClick={() => router.push(`/project/${project.id}`)}>
                    <div style={{ fontSize: 28, opacity: 0.15 }}>⚡</div>
                  </div>
                  <div style={s.cardBody}>
                    <div style={{ cursor: 'pointer' }} onClick={() => router.push(`/project/${project.id}`)}>
                      <h3 style={s.cardName}>{project.name}</h3>
                      <p style={s.cardDesc}>{project.description || 'No description'}</p>
                      <p style={s.cardDate}>Edited {new Date(project.updated_at).toLocaleDateString()}</p>
                    </div>
                    <div style={s.cardActions}>
                      <button onClick={() => router.push(`/project/${project.id}`)} style={s.openBtn}>Open</button>
                      <button onClick={() => deleteProject(project.id)} style={s.deleteBtn}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* NEW PROJECT MODAL */}
      {showNew && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h2 style={s.modalTitle}>New project</h2>
            <div style={s.field}>
              <label style={s.label}>Project name</label>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createProject()}
                placeholder="e.g. Inventory Manager"
                style={s.input}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Description (optional)</label>
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What will you build?" style={s.input} />
            </div>
            <div style={s.modalActions}>
              <button onClick={() => { setShowNew(false); setNewName(''); setNewDesc('') }} style={s.cancelBtn}>Cancel</button>
              <button onClick={createProject} disabled={creating || !newName.trim()} style={s.createBtn}>
                {creating ? 'Creating...' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

Dashboard.getLayout = function getLayout(page: React.ReactNode) {
  return <Layout>{page}</Layout>
}

function getStarterCode() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"><\/script><script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7'}}}}}<\/script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"></head><body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10"><div class="text-center max-w-lg"><div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6"><i class="fa-solid fa-wand-magic-sparkles text-brand text-xl"></i></div><h1 class="text-white text-2xl font-semibold mb-3">Start building</h1><p class="text-white/50 text-sm leading-relaxed mb-8">Use the AI chat on the left to build anything you want.</p><div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm">Try: "Build an admin dashboard with a sidebar, stats and users table"</div></div></body></html>`
}

const s: Record<string, React.CSSProperties> = {
  main: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },
  loadingInner: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 },
  topbar: { padding: '28px 32px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  pageTitle: { fontSize: 22, fontWeight: 600, color: '#f0f0f0' },
  pageSub: { fontSize: 13, color: '#555', marginTop: 2 },
  newBtn: { padding: '9px 18px', background: '#7c6ef7', border: 'none', borderRadius: 9, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  noCreditsBanner: { margin: '20px 32px 0', padding: '16px 20px', background: 'rgba(186,117,23,0.1)', border: '1px solid rgba(186,117,23,0.25)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14, fontSize: 20 },
  buyNowBtn: { marginLeft: 'auto', padding: '8px 16px', background: '#BA7517', border: 'none', borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  grid: { padding: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 },
  newCard: { border: '2px dashed rgba(255,255,255,0.08)', borderRadius: 14, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', minHeight: 180 },
  newCardIcon: { fontSize: 24, color: '#444' },
  newCardLabel: { fontSize: 13, color: '#555' },
  card: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, overflow: 'hidden' },
  cardPreview: { height: 120, background: '#0a0a0a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  cardBody: { padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  cardName: { fontSize: 14, fontWeight: 500, color: '#f0f0f0', marginBottom: 3 },
  cardDesc: { fontSize: 12, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  cardDate: { fontSize: 11, color: '#444' },
  cardActions: { display: 'flex', gap: 8 },
  openBtn: { flex: 1, padding: '7px 0', background: '#7c6ef7', border: 'none', borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  deleteBtn: { padding: '7px 12px', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, color: '#666', fontSize: 12, cursor: 'pointer' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: '#f0f0f0' },
  emptyText: { fontSize: 13, color: '#555' },
  emptyBtn: { padding: '10px 22px', background: '#7c6ef7', border: 'none', borderRadius: 9, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 8 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 },
  modalTitle: { fontSize: 16, fontWeight: 600, color: '#f0f0f0' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: '#666' },
  input: { padding: '10px 12px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f0f0', fontSize: 14, outline: 'none' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 16px', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' },
  createBtn: { padding: '8px 20px', background: '#7c6ef7', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
}
