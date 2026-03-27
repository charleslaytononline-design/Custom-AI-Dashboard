import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useMobile } from '../hooks/useMobile'

interface Project {
  id: string; name: string; description: string; created_at: string; updated_at: string
}

function openBuyModal() {
  window.dispatchEvent(new CustomEvent('openBuyModal'))
}

export default function Dashboard() {
  const router = useRouter()
  const isMobile = useMobile()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [limitMsg, setLimitMsg] = useState<string | null>(null)
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; category: string }>>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) { router.push('/'); return }
    })

    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadProfile(data.user.id)
      loadProjects(data.user.id)
      loadTemplates()
    })

    return () => authListener.subscription.unsubscribe()
  }, [])

  async function loadTemplates() {
    const { data } = await supabase.from('project_templates').select('id, name, description, category').eq('is_active', true).order('sort_order')
    if (data) setTemplates(data)
  }

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

    if ((profile?.credit_balance || 0) + (profile?.gift_balance || 0) <= 0) {
      setShowNew(false)
      openBuyModal()
      return
    }

    // Check max_projects plan limit (resolves Free plan for null plan_id)
    const planId = profile?.plan_id
    const { data: plan } = planId
      ? await supabase.from('plans').select('name, max_projects').eq('id', planId).single()
      : await supabase.from('plans').select('name, max_projects').eq('price_monthly', 0).order('sort_order', { ascending: true }).limit(1).single()
    if (plan?.max_projects) {
      const { count } = await supabase.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
      if (count !== null && count >= plan.max_projects) {
        setShowNew(false)
        setLimitMsg(`You've reached the ${plan.max_projects} project limit on the ${plan.name} plan. Upgrade to create more.`)
        return
      }
    }

    setCreating(true)

    try {
      const res = await fetch('/api/projects/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          name: newName.trim(),
          description: newDesc.trim(),
          projectType: 'react',
          templateId: selectedTemplate || undefined,
        }),
      })
      const result = await res.json()
      if (res.ok && result.project) {
        fetch('/api/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_type: 'project_created',
            severity: 'info',
            message: `New project created: "${result.project.name}"`,
            email: user.email,
            metadata: { project_id: result.project.id, project_name: result.project.name, user_id: user.id, project_type: 'react' },
          }),
        }).catch(() => {})
        router.push(`/project/${result.project.id}`)
      }
    } catch {}
    setCreating(false)
  }

  async function deleteProject(id: string) {
    if (!confirm('Delete this project and all its pages?')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const isAdmin = profile?.role === 'admin'
  const balance = (profile?.credit_balance || 0) + (profile?.gift_balance || 0)
  const hasCredits = balance > 0

  return (
    <div style={s.main}>
      {loading ? (
        <div style={s.loadingInner}>Loading...</div>
      ) : (
        <>
          <div style={{
            ...s.topbar,
            padding: isMobile ? '20px 16px 0' : '28px 32px 0',
            flexWrap: 'wrap' as const,
            gap: 12,
          }}>
            <div>
              <h1 style={s.pageTitle}>My Projects</h1>
              <p style={s.pageSub}>Build and manage your AI-powered apps</p>
            </div>
            <button onClick={() => hasCredits ? setShowNew(true) : openBuyModal()} style={s.newBtn}>
              + New Project
            </button>
          </div>

          {!hasCredits && (
            <div style={{
              ...s.noCreditsBanner,
              margin: isMobile ? '16px 16px 0' : '20px 32px 0',
              flexWrap: 'wrap' as const,
              gap: 10,
            }}>
              <span>⚡</span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong style={{ color: 'var(--text)' }}>You need credits to build</strong>
                <p style={{ color: 'var(--text-2)', fontSize: 12, marginTop: 2 }}>Purchase credits to create projects and use the AI builder.</p>
              </div>
              <button onClick={openBuyModal} style={s.buyNowBtn}>Buy Credits →</button>
            </div>
          )}

          {limitMsg && (
            <div style={{
              ...s.noCreditsBanner,
              margin: isMobile ? '16px 16px 0' : '20px 32px 0',
              flexWrap: 'wrap' as const,
              gap: 10,
              borderColor: 'rgba(200,150,50,0.3)',
              background: 'rgba(200,150,50,0.08)',
            }}>
              <span>🔒</span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong style={{ color: 'var(--text)' }}>Plan limit reached</strong>
                <p style={{ color: '#e0c060', fontSize: 12, marginTop: 2 }}>{limitMsg}</p>
              </div>
              <button onClick={() => setLimitMsg(null)} style={{ ...s.buyNowBtn, background: 'rgba(200,150,50,0.2)', color: '#e0c060' }}>Dismiss</button>
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
            <div style={{
              ...s.grid,
              padding: isMobile ? 16 : 32,
              gridTemplateColumns: isMobile
                ? 'repeat(auto-fill, minmax(150px, 1fr))'
                : 'repeat(auto-fill, minmax(240px, 1fr))',
            }}>
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
          <div style={{ ...s.modal, maxWidth: isMobile ? 'calc(100% - 32px)' : 400 }}>
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
            {templates.length > 0 && (
              <div style={s.field}>
                <label style={s.label}>Start from template</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    onClick={() => setSelectedTemplate(null)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid',
                      background: !selectedTemplate ? 'rgba(124,110,247,0.15)' : 'transparent',
                      borderColor: !selectedTemplate ? 'rgba(124,110,247,0.3)' : 'rgba(255,255,255,0.08)',
                      color: !selectedTemplate ? '#9d92f5' : 'var(--text-3)',
                    }}
                  >
                    Blank
                  </button>
                  {templates.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTemplate(t.id)}
                      title={t.description}
                      style={{
                        padding: '6px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid',
                        background: selectedTemplate === t.id ? 'rgba(124,110,247,0.15)' : 'transparent',
                        borderColor: selectedTemplate === t.id ? 'rgba(124,110,247,0.3)' : 'rgba(255,255,255,0.08)',
                        color: selectedTemplate === t.id ? '#9d92f5' : 'var(--text-3)',
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
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


const s: Record<string, React.CSSProperties> = {
  main: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },
  loadingInner: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 },
  topbar: { padding: '28px 32px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  pageTitle: { fontSize: 22, fontWeight: 600, color: 'var(--text)' },
  pageSub: { fontSize: 13, color: 'var(--text-3)', marginTop: 2 },
  newBtn: { padding: '9px 18px', background: 'var(--accent)', border: 'none', borderRadius: 9, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0 },
  noCreditsBanner: { margin: '20px 32px 0', padding: '16px 20px', background: 'rgba(186,117,23,0.1)', border: '1px solid rgba(186,117,23,0.25)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 14, fontSize: 20 },
  buyNowBtn: { marginLeft: 'auto', padding: '8px 16px', background: '#BA7517', border: 'none', borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  grid: { padding: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 },
  newCard: { border: '2px dashed var(--border)', borderRadius: 14, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', minHeight: 180 },
  newCardIcon: { fontSize: 24, color: 'var(--text-3)' },
  newCardLabel: { fontSize: 13, color: 'var(--text-3)' },
  card: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' },
  cardPreview: { height: 120, background: 'var(--bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)' },
  cardBody: { padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  cardName: { fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 3 },
  cardDesc: { fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  cardDate: { fontSize: 11, color: 'var(--text-3)' },
  cardActions: { display: 'flex', gap: 8 },
  openBtn: { flex: 1, padding: '7px 0', background: 'var(--accent)', border: 'none', borderRadius: 7, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  deleteBtn: { padding: '7px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-3)', fontSize: 12, cursor: 'pointer' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: 'var(--text)' },
  emptyText: { fontSize: 13, color: 'var(--text-3)', textAlign: 'center' as const },
  emptyBtn: { padding: '10px 22px', background: 'var(--accent)', border: 'none', borderRadius: 9, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 8 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 },
  modal: { background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 },
  modalTitle: { fontSize: 16, fontWeight: 600, color: 'var(--text)' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: 'var(--text-3)' },
  input: { padding: '10px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, outline: 'none' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  createBtn: { padding: '8px 20px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
}
