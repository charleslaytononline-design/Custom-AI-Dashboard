import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase, ADMIN_EMAIL } from '../lib/supabase'

interface Project { id: string; name: string; description: string; updated_at: string; page_count?: number }

export default function Home() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showNew, setShowNew] = useState(false)
  const isAdmin = user?.email === ADMIN_EMAIL

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadProjects(data.user.id)
    })
  }, [])

  async function loadProjects(userId: string) {
    const { data } = await supabase.from('projects').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
    setProjects(data || [])
    setLoading(false)
  }

  async function createProject() {
    if (!newName.trim() || creating) return
    setCreating(true)
    const { data: project } = await supabase.from('projects').insert({
      user_id: user.id, name: newName.trim(), description: ''
    }).select().single()
    if (project) {
      // Create default first page
      await supabase.from('pages').insert({
        project_id: project.id, user_id: user.id, name: 'Home', code: getStarterCode()
      })
      router.push(`/project/${project.id}`)
    }
    setCreating(false)
  }

  async function deleteProject(id: string) {
    if (!confirm('Delete this project and all its pages?')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div style={s.loading}>Loading...</div>

  return (
    <div style={s.root}>
      {/* Sidebar */}
      <div style={s.sidebar}>
        <div style={s.sidebarTop}>
          <div style={s.logo}>
            <div style={s.logoIcon}>AI</div>
            <span style={s.logoText}>Custom AI</span>
          </div>
        </div>
        <nav style={s.nav}>
          <div style={{ ...s.navItem, ...s.navItemActive }}>
            <span style={s.navIcon}>⊞</span> Projects
          </div>
          {isAdmin && (
            <div style={s.navItem} onClick={() => router.push('/admin')}>
              <span style={s.navIcon}>⚙</span> Admin
              <span style={s.adminBadge}>Admin</span>
            </div>
          )}
        </nav>
        <div style={s.sidebarBottom}>
          <div style={s.userRow}>
            <div style={s.avatar}>{user?.email?.[0]?.toUpperCase()}</div>
            <div style={s.userInfo}>
              <div style={s.userEmail}>{user?.email}</div>
              <div style={s.userRole}>{isAdmin ? 'Admin' : 'Member'}</div>
            </div>
          </div>
          <button onClick={signOut} style={s.signOutBtn}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={s.main}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>My Projects</h1>
            <p style={s.subtitle}>Build and manage your AI-powered apps</p>
          </div>
          <button onClick={() => setShowNew(true)} style={s.newBtn}>+ New Project</button>
        </div>

        {/* New project modal */}
        {showNew && (
          <div style={s.modalOverlay} onClick={() => setShowNew(false)}>
            <div style={s.modal} onClick={e => e.stopPropagation()}>
              <h2 style={s.modalTitle}>New Project</h2>
              <p style={s.modalSub}>Give your project a name to get started</p>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createProject() }}
                placeholder="e.g. Inventory Manager, Sales Dashboard..."
                style={s.modalInput}
              />
              <div style={s.modalActions}>
                <button onClick={() => setShowNew(false)} style={s.cancelBtn}>Cancel</button>
                <button onClick={createProject} disabled={creating || !newName.trim()} style={s.createBtn}>
                  {creating ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Projects grid */}
        {projects.length === 0 ? (
          <div style={s.empty}>
            <div style={s.emptyIcon}>✦</div>
            <h2 style={s.emptyTitle}>No projects yet</h2>
            <p style={s.emptySub}>Create your first project to start building with AI</p>
            <button onClick={() => setShowNew(true)} style={s.newBtn}>+ Create your first project</button>
          </div>
        ) : (
          <div style={s.grid}>
            {/* New project card */}
            <div style={s.newCard} onClick={() => setShowNew(true)}>
              <div style={s.newCardIcon}>+</div>
              <div style={s.newCardText}>New Project</div>
            </div>
            {projects.map(project => (
              <div key={project.id} style={s.card}>
                <div style={s.cardPreview} onClick={() => router.push(`/project/${project.id}`)}>
                  <div style={s.cardPreviewInner}>
                    <div style={s.cardPreviewDots}>
                      <span style={{ ...s.dot, background:'#ff5f57' }} />
                      <span style={{ ...s.dot, background:'#febc2e' }} />
                      <span style={{ ...s.dot, background:'#28c840' }} />
                    </div>
                    <div style={s.cardPreviewContent}>
                      <div style={s.cardPreviewBar} />
                      <div style={{ ...s.cardPreviewBar, width:'60%',marginTop:8 }} />
                      <div style={s.cardPreviewBlock} />
                    </div>
                  </div>
                </div>
                <div style={s.cardBody}>
                  <div style={s.cardName} onClick={() => router.push(`/project/${project.id}`)}>{project.name}</div>
                  <div style={s.cardDate}>Edited {new Date(project.updated_at).toLocaleDateString()}</div>
                  <div style={s.cardActions}>
                    <button onClick={() => router.push(`/project/${project.id}`)} style={s.openBtn}>Open</button>
                    <button onClick={() => deleteProject(project.id)} style={s.deleteBtn}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function getStarterCode() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"><\/script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}<\/script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<title>My Page</title>
</head>
<body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10">
  <div class="text-center max-w-lg">
    <div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6">
      <i class="fa-solid fa-wand-magic-sparkles text-brand text-xl"></i>
    </div>
    <h1 class="text-white text-2xl font-semibold mb-3">Start building</h1>
    <p class="text-white/50 text-sm leading-relaxed mb-8">Use the AI chat on the left to build anything you want.</p>
    <div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm">
      Try: "Build an admin dashboard with a sidebar, stats and users table"
    </div>
  </div>
</body>
</html>`
}

const s: Record<string,React.CSSProperties> = {
  loading: { display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#555',background:'#0a0a0a',fontFamily:'sans-serif' },
  root: { display:'flex',height:'100vh',background:'#0a0a0a',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',overflow:'hidden' },
  sidebar: { width:220,minWidth:220,background:'#0f0f0f',borderRight:'1px solid rgba(255,255,255,0.07)',display:'flex',flexDirection:'column',padding:'20px 0' },
  sidebarTop: { padding:'0 16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)' },
  logo: { display:'flex',alignItems:'center',gap:10 },
  logoIcon: { width:30,height:30,background:'#7c6ef7',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'white' },
  logoText: { fontSize:14,fontWeight:600,color:'#f0f0f0' },
  nav: { flex:1,padding:'12px 8px',display:'flex',flexDirection:'column',gap:2 },
  navItem: { display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,fontSize:13,color:'#666',cursor:'pointer',transition:'all 0.15s' },
  navItemActive: { background:'rgba(124,110,247,0.1)',color:'#9d92f5' },
  navIcon: { fontSize:14,width:18,textAlign:'center' as const },
  adminBadge: { marginLeft:'auto',fontSize:10,background:'rgba(124,110,247,0.15)',color:'#9d92f5',padding:'2px 6px',borderRadius:4 },
  sidebarBottom: { padding:'16px',borderTop:'1px solid rgba(255,255,255,0.07)' },
  userRow: { display:'flex',alignItems:'center',gap:10,marginBottom:12 },
  avatar: { width:30,height:30,borderRadius:'50%',background:'#7c6ef7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'white',flexShrink:0 },
  userInfo: { overflow:'hidden' },
  userEmail: { fontSize:11,color:'#888',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const },
  userRole: { fontSize:10,color:'#555',marginTop:1 },
  signOutBtn: { width:'100%',padding:'7px',background:'none',border:'1px solid rgba(255,255,255,0.08)',borderRadius:7,color:'#555',fontSize:12,cursor:'pointer' },
  main: { flex:1,overflow:'auto',padding:40 },
  header: { display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:36 },
  title: { fontSize:24,fontWeight:600,color:'#f0f0f0',margin:0 },
  subtitle: { fontSize:14,color:'#555',marginTop:4 },
  newBtn: { padding:'9px 18px',background:'#7c6ef7',border:'none',borderRadius:8,color:'white',fontSize:13,fontWeight:500,cursor:'pointer' },
  modalOverlay: { position:'fixed' as const,inset:0,background:'rgba(0,0,0,0.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50 },
  modal: { background:'#141414',border:'1px solid rgba(255,255,255,0.1)',borderRadius:16,padding:32,width:'100%',maxWidth:440 },
  modalTitle: { fontSize:18,fontWeight:600,color:'#f0f0f0',margin:'0 0 6px' },
  modalSub: { fontSize:13,color:'#666',marginBottom:20 },
  modalInput: { width:'100%',padding:'10px 12px',background:'#1e1e1e',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,color:'#f0f0f0',fontSize:14,outline:'none',boxSizing:'border-box' as const },
  modalActions: { display:'flex',gap:10,justifyContent:'flex-end',marginTop:20 },
  cancelBtn: { padding:'8px 16px',background:'none',border:'1px solid rgba(255,255,255,0.1)',borderRadius:7,color:'#888',fontSize:13,cursor:'pointer' },
  createBtn: { padding:'8px 18px',background:'#7c6ef7',border:'none',borderRadius:7,color:'white',fontSize:13,fontWeight:500,cursor:'pointer' },
  empty: { display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:400,textAlign:'center' as const },
  emptyIcon: { fontSize:40,marginBottom:16 },
  emptyTitle: { fontSize:20,fontWeight:600,color:'#f0f0f0',margin:'0 0 8px' },
  emptySub: { fontSize:14,color:'#555',marginBottom:24 },
  grid: { display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',gap:20 },
  newCard: { border:'2px dashed rgba(255,255,255,0.1)',borderRadius:12,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',minHeight:200,transition:'all 0.15s',color:'#555' },
  newCardIcon: { fontSize:28,marginBottom:8 },
  newCardText: { fontSize:13 },
  card: { background:'#111',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden',transition:'border-color 0.15s' },
  cardPreview: { background:'#0f0f0f',height:140,cursor:'pointer',padding:14,overflow:'hidden' },
  cardPreviewInner: { background:'#141414',borderRadius:8,height:'100%',overflow:'hidden' },
  cardPreviewDots: { display:'flex',gap:5,padding:'8px 10px',borderBottom:'1px solid rgba(255,255,255,0.05)' },
  dot: { width:8,height:8,borderRadius:'50%' },
  cardPreviewContent: { padding:'10px 12px' },
  cardPreviewBar: { height:8,background:'rgba(255,255,255,0.06)',borderRadius:4,width:'80%' },
  cardPreviewBlock: { height:40,background:'rgba(255,255,255,0.04)',borderRadius:6,marginTop:10 },
  cardBody: { padding:'14px 16px' },
  cardName: { fontSize:14,fontWeight:500,color:'#f0f0f0',cursor:'pointer',marginBottom:4 },
  cardDate: { fontSize:11,color:'#444',marginBottom:12 },
  cardActions: { display:'flex',gap:8 },
  openBtn: { flex:1,padding:'6px 0',background:'rgba(124,110,247,0.1)',border:'1px solid rgba(124,110,247,0.2)',borderRadius:6,color:'#9d92f5',fontSize:12,cursor:'pointer' },
  deleteBtn: { padding:'6px 10px',background:'none',border:'1px solid rgba(255,255,255,0.07)',borderRadius:6,color:'#444',fontSize:12,cursor:'pointer' },
}
