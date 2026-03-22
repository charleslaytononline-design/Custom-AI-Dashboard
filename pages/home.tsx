import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const ADMIN_EMAIL = 'charleslayton.online@gmail.com'

const CREDIT_PACKS = [
  { id: 'pack_5',  amount: 5,  label: '$5', desc: '~50 builds' },
  { id: 'pack_10', amount: 10, label: '$10', desc: '~100 builds' },
  { id: 'pack_25', amount: 25, label: '$25', desc: '~250 builds', popular: true },
  { id: 'pack_50', amount: 50, label: '$50', desc: '~500 builds' },
]

interface Project {
  id: string; name: string; description: string; created_at: string; updated_at: string
}

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [showBuy, setShowBuy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [buyingPack, setBuyingPack] = useState('')

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

    // Handle payment success
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      setTimeout(() => { supabase.auth.getUser().then(({ data }) => { if (data.user) loadProfile(data.user.id) }); }, 2000)
    }

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
    
    // Check credits (admin bypass)
    if (profile?.role !== 'admin' && (profile?.credit_balance || 0) <= 0) {
      setShowNew(false)
      setShowBuy(true)
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

  async function buyCredits(packId: string) {
    if (!user) return
    setBuyingPack(packId)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, userId: user.id, userEmail: user.email }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else alert('Error: ' + data.error)
    } catch (err) {
      alert('Failed to start checkout')
    }
    setBuyingPack('')
  }

  const isAdmin = user?.email === ADMIN_EMAIL
  const balance = profile?.credit_balance || 0
  const hasCredits = isAdmin || balance > 0

  if (loading) return <div style={s.loading}>Loading...</div>

  return (
    <div style={s.root}>
      {/* SIDEBAR */}
      <div style={s.sidebar}>
        <div style={s.sideTop}>
          <div style={s.brand}>
            <div style={s.brandIcon}>AI</div>
            <span style={s.brandName}>Custom AI</span>
          </div>
        </div>
        <nav style={s.nav}>
          <div style={{ ...s.navItem, ...s.navActive }}><span>⊞</span> Projects</div>
          {isAdmin && <div style={s.navItem} onClick={() => router.push('/admin')}><span>🛡</span> Admin</div>}
        </nav>
        <div style={s.sideBottom}>
          {/* Credit balance */}
          <div style={s.balanceCard}>
            <div style={s.balanceLabel}>Credit Balance</div>
            <div style={{ ...s.balanceVal, color: balance > 0 ? '#5DCAA5' : '#f09595' }}>
              ${balance.toFixed(2)}
            </div>
            <button onClick={() => setShowBuy(true)} style={s.topUpBtn}>+ Top up</button>
          </div>
          <div style={s.userInfo}>
            <div style={s.avatar}>{user?.email?.[0]?.toUpperCase()}</div>
            <div style={s.userDetails}>
              <div style={s.userEmail}>{user?.email}</div>
              <div style={s.userRole}>{isAdmin ? '👑 Admin' : 'Member'}</div>
            </div>
          </div>
          <button onClick={() => { supabase.auth.signOut(); router.push('/') }} style={s.signOut}>Sign out</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={s.main}>
        <div style={s.topbar}>
          <div>
            <h1 style={s.pageTitle}>My Projects</h1>
            <p style={s.pageSub}>Build and manage your AI-powered apps</p>
          </div>
          <button onClick={() => hasCredits ? setShowNew(true) : setShowBuy(true)} style={s.newBtn}>+ New Project</button>
        </div>

        {/* NO CREDITS BANNER */}
        {!hasCredits && (
          <div style={s.noCreditsBanner}>
            <span>⚡</span>
            <div>
              <strong style={{ color:'#f0f0f0' }}>You need credits to build</strong>
              <p style={{ color:'#888', fontSize:12, marginTop:2 }}>Purchase credits to create projects and use the AI builder.</p>
            </div>
            <button onClick={() => setShowBuy(true)} style={s.buyNowBtn}>Buy Credits →</button>
          </div>
        )}

        {/* PROJECTS GRID */}
        {projects.length === 0 ? (
          <div style={s.empty}>
            <div style={{ fontSize:36, opacity:0.2, marginBottom:16 }}>✦</div>
            <h2 style={s.emptyTitle}>No projects yet</h2>
            <p style={s.emptyText}>Create your first project to start building with AI</p>
            <button onClick={() => hasCredits ? setShowNew(true) : setShowBuy(true)} style={s.emptyBtn}>
              {hasCredits ? '+ Create your first project' : '+ Buy credits to get started'}
            </button>
          </div>
        ) : (
          <div style={s.grid}>
            <div style={s.newCard} onClick={() => hasCredits ? setShowNew(true) : setShowBuy(true)}>
              <div style={s.newCardIcon}>+</div>
              <span style={s.newCardLabel}>New Project</span>
            </div>
            {projects.map(project => (
              <div key={project.id} style={s.card}>
                <div style={s.cardPreview} onClick={() => router.push(`/project/${project.id}`)}>
                  <div style={{ fontSize:28, opacity:0.15 }}>⚡</div>
                </div>
                <div style={s.cardBody}>
                  <div style={{ cursor:'pointer' }} onClick={() => router.push(`/project/${project.id}`)}>
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
      </div>

      {/* NEW PROJECT MODAL */}
      {showNew && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h2 style={s.modalTitle}>New project</h2>
            <div style={s.field}>
              <label style={s.label}>Project name</label>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key==='Enter' && createProject()} placeholder="e.g. Inventory Manager" style={s.input} />
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

      {/* BUY CREDITS MODAL */}
      {showBuy && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth:480 }}>
            <h2 style={s.modalTitle}>Buy Credits</h2>
            <p style={{ color:'#888', fontSize:13, marginBottom:20 }}>Credits are used to power AI builds. Each build costs approximately $0.02–$0.10 depending on complexity.</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
              {CREDIT_PACKS.map(pack => (
                <div key={pack.id} style={{ ...s.packCard, ...(pack.popular ? s.packPopular : {}) }}>
                  {pack.popular && <div style={s.popularBadge}>Most Popular</div>}
                  <div style={s.packAmount}>{pack.label}</div>
                  <div style={s.packDesc}>{pack.desc}</div>
                  <button onClick={() => buyCredits(pack.id)} disabled={buyingPack === pack.id} style={{ ...s.packBtn, ...(pack.popular ? s.packBtnPopular : {}) }}>
                    {buyingPack === pack.id ? 'Loading...' : `Buy ${pack.label}`}
                  </button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowBuy(false)} style={s.cancelBtn}>Maybe later</button>
          </div>
        </div>
      )}
    </div>
  )
}

function getStarterCode() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"><\/script><script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7'}}}}}<\/script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"></head><body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10"><div class="text-center max-w-lg"><div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6"><i class="fa-solid fa-wand-magic-sparkles text-brand text-xl"></i></div><h1 class="text-white text-2xl font-semibold mb-3">Start building</h1><p class="text-white/50 text-sm leading-relaxed mb-8">Use the AI chat on the left to build anything you want.</p><div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm">Try: "Build an admin dashboard with a sidebar, stats and users table"</div></div></body></html>`
}

const s: Record<string, React.CSSProperties> = {
  loading: { display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0a0a0a', color:'#555', fontFamily:'sans-serif' },
  root: { display:'flex', height:'100vh', background:'#0a0a0a', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', overflow:'hidden' },
  sidebar: { width:240, minWidth:240, background:'#0f0f0f', borderRight:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column' },
  sideTop: { padding:20 },
  brand: { display:'flex', alignItems:'center', gap:10 },
  brandIcon: { width:32, height:32, background:'#7c6ef7', borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'white' },
  brandName: { fontSize:15, fontWeight:600, color:'#f0f0f0' },
  nav: { flex:1, padding:'8px 12px', display:'flex', flexDirection:'column', gap:2 },
  navItem: { display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:8, fontSize:13, color:'#666', cursor:'pointer' },
  navActive: { background:'rgba(124,110,247,0.1)', color:'#9d92f5' },
  sideBottom: { padding:16, borderTop:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', gap:10 },
  balanceCard: { background:'rgba(124,110,247,0.07)', border:'1px solid rgba(124,110,247,0.15)', borderRadius:10, padding:'12px 14px' },
  balanceLabel: { fontSize:10, color:'#9d92f5', textTransform:'uppercase' as const, letterSpacing:'0.05em', marginBottom:4 },
  balanceVal: { fontSize:20, fontWeight:700, marginBottom:8 },
  topUpBtn: { width:'100%', padding:'6px 0', background:'rgba(124,110,247,0.2)', border:'1px solid rgba(124,110,247,0.3)', borderRadius:6, color:'#9d92f5', fontSize:11, fontWeight:500, cursor:'pointer' },
  userInfo: { display:'flex', alignItems:'center', gap:10 },
  avatar: { width:30, height:30, borderRadius:'50%', background:'rgba(124,110,247,0.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600, color:'#9d92f5', flexShrink:0 },
  userDetails: { flex:1, minWidth:0 },
  userEmail: { fontSize:11, color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const },
  userRole: { fontSize:10, color:'#555', marginTop:1 },
  signOut: { padding:'6px 10px', background:'none', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, color:'#555', fontSize:11, cursor:'pointer', textAlign:'center' as const },
  main: { flex:1, overflow:'auto', display:'flex', flexDirection:'column' },
  topbar: { padding:'28px 32px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between' },
  pageTitle: { fontSize:22, fontWeight:600, color:'#f0f0f0' },
  pageSub: { fontSize:13, color:'#555', marginTop:2 },
  newBtn: { padding:'9px 18px', background:'#7c6ef7', border:'none', borderRadius:9, color:'white', fontSize:13, fontWeight:500, cursor:'pointer' },
  noCreditsBanner: { margin:'20px 32px 0', padding:'16px 20px', background:'rgba(186,117,23,0.1)', border:'1px solid rgba(186,117,23,0.25)', borderRadius:10, display:'flex', alignItems:'center', gap:14, fontSize:20 },
  buyNowBtn: { marginLeft:'auto', padding:'8px 16px', background:'#BA7517', border:'none', borderRadius:7, color:'white', fontSize:12, fontWeight:500, cursor:'pointer', whiteSpace:'nowrap' as const },
  grid: { padding:32, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:16 },
  newCard: { border:'2px dashed rgba(255,255,255,0.08)', borderRadius:14, padding:32, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, cursor:'pointer', minHeight:180 },
  newCardIcon: { fontSize:24, color:'#444' },
  newCardLabel: { fontSize:13, color:'#555' },
  card: { background:'#111', border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, overflow:'hidden' },
  cardPreview: { height:120, background:'#0a0a0a', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', borderBottom:'1px solid rgba(255,255,255,0.05)' },
  cardBody: { padding:16, display:'flex', flexDirection:'column', gap:10 },
  cardName: { fontSize:14, fontWeight:500, color:'#f0f0f0', marginBottom:3 },
  cardDesc: { fontSize:12, color:'#555', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' as const },
  cardDate: { fontSize:11, color:'#444' },
  cardActions: { display:'flex', gap:8 },
  openBtn: { flex:1, padding:'7px 0', background:'#7c6ef7', border:'none', borderRadius:7, color:'white', fontSize:12, fontWeight:500, cursor:'pointer' },
  deleteBtn: { padding:'7px 12px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:7, color:'#666', fontSize:12, cursor:'pointer' },
  empty: { flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:40 },
  emptyTitle: { fontSize:18, fontWeight:600, color:'#f0f0f0' },
  emptyText: { fontSize:13, color:'#555' },
  emptyBtn: { padding:'10px 22px', background:'#7c6ef7', border:'none', borderRadius:9, color:'white', fontSize:13, fontWeight:500, cursor:'pointer', marginTop:8 },
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 },
  modal: { background:'#111', border:'1px solid rgba(255,255,255,0.1)', borderRadius:16, padding:28, width:'100%', maxWidth:400, display:'flex', flexDirection:'column', gap:16 },
  modalTitle: { fontSize:16, fontWeight:600, color:'#f0f0f0' },
  field: { display:'flex', flexDirection:'column', gap:6 },
  label: { fontSize:12, color:'#666' },
  input: { padding:'10px 12px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#f0f0f0', fontSize:14, outline:'none' },
  modalActions: { display:'flex', gap:10, justifyContent:'flex-end' },
  cancelBtn: { padding:'8px 16px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#888', fontSize:13, cursor:'pointer' },
  createBtn: { padding:'8px 20px', background:'#7c6ef7', border:'none', borderRadius:8, color:'white', fontSize:13, fontWeight:500, cursor:'pointer' },
  packCard: { background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:12, padding:16, display:'flex', flexDirection:'column', gap:8, position:'relative' as const },
  packPopular: { border:'1px solid rgba(124,110,247,0.4)', background:'rgba(124,110,247,0.07)' },
  popularBadge: { position:'absolute' as const, top:-10, left:'50%', transform:'translateX(-50%)', background:'#7c6ef7', color:'white', fontSize:9, fontWeight:600, padding:'2px 8px', borderRadius:20, whiteSpace:'nowrap' as const },
  packAmount: { fontSize:22, fontWeight:700, color:'#f0f0f0' },
  packDesc: { fontSize:12, color:'#666' },
  packBtn: { padding:'8px 0', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#888', fontSize:12, fontWeight:500, cursor:'pointer', marginTop:4 },
  packBtnPopular: { background:'#7c6ef7', borderColor:'transparent', color:'white' },
}
