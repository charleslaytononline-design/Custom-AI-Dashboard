import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase, ADMIN_EMAIL } from '../lib/supabase'

interface UserRow { id: string; email: string; role: string; created_at: string; projects: number; tokens: number }

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      if (data.user.email !== ADMIN_EMAIL) { router.push('/home'); return }
      setUser(data.user)
      loadUsers()
    })
  }, [])

  async function loadUsers() {
    const { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (!profiles) { setLoading(false); return }

    const enriched = await Promise.all(profiles.map(async (p) => {
      const { count: projectCount } = await supabase.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', p.id)
      const { data: usageData } = await supabase.from('usage').select('tokens').eq('user_id', p.id)
      const tokens = usageData?.reduce((s: number, r: any) => s + r.tokens, 0) || 0
      return { ...p, projects: projectCount || 0, tokens }
    }))

    setUsers(enriched)
    setLoading(false)
  }

  async function toggleRole(userId: string, currentRole: string) {
    if (userId === user.id) return alert('Cannot change your own role.')
    const newRole = currentRole === 'admin' ? 'user' : 'admin'
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
  }

  const filtered = users.filter(u => u.email.toLowerCase().includes(search.toLowerCase()))

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
          <div style={s.navItem} onClick={() => router.push('/home')}>
            <span>⊞</span> Projects
          </div>
          <div style={{ ...s.navItem, ...s.navItemActive }}>
            <span>⚙</span> Admin
            <span style={s.adminBadge}>Admin</span>
          </div>
        </nav>
        <div style={s.sidebarBottom}>
          <div style={s.userRow}>
            <div style={s.avatar}>{user?.email?.[0]?.toUpperCase()}</div>
            <div style={{ overflow:'hidden' }}>
              <div style={s.userEmail}>{user?.email}</div>
              <div style={s.userRole}>Admin</div>
            </div>
          </div>
          <button onClick={async () => { await supabase.auth.signOut(); router.push('/') }} style={s.signOutBtn}>Sign out</button>
        </div>
      </div>

      {/* Main */}
      <div style={s.main}>
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Admin Panel</h1>
            <p style={s.subtitle}>{users.length} total users · {users.reduce((s,u)=>s+u.projects,0)} projects · {users.reduce((s,u)=>s+u.tokens,0).toLocaleString()} tokens used</p>
          </div>
        </div>

        {/* Stats row */}
        <div style={s.statsRow}>
          {[
            { label:'Total Users', value: users.length },
            { label:'Total Projects', value: users.reduce((s,u)=>s+u.projects,0) },
            { label:'Tokens Used', value: users.reduce((s,u)=>s+u.tokens,0).toLocaleString() },
            { label:'Admins', value: users.filter(u=>u.role==='admin').length },
          ].map(stat => (
            <div key={stat.label} style={s.statCard}>
              <div style={s.statLabel}>{stat.label}</div>
              <div style={s.statValue}>{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={s.searchRow}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users by email..." style={s.searchInput} />
        </div>

        {/* Users table */}
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr>
                {['User','Role','Projects','Tokens Used','Joined','Actions'].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={s.tr}>
                  <td style={s.td}>
                    <div style={s.userCell}>
                      <div style={{ ...s.avatar, width:28,height:28,fontSize:11 }}>{u.email[0].toUpperCase()}</div>
                      <span style={{ fontSize:13,color: u.email === ADMIN_EMAIL ? '#9d92f5' : '#e0e0e0' }}>{u.email}</span>
                      {u.email === ADMIN_EMAIL && <span style={s.youBadge}>you</span>}
                    </div>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, ...(u.role==='admin' ? s.badgeAdmin : s.badgeUser) }}>{u.role}</span>
                  </td>
                  <td style={{ ...s.td, color:'#888' }}>{u.projects}</td>
                  <td style={{ ...s.td, color:'#888' }}>{u.tokens.toLocaleString()}</td>
                  <td style={{ ...s.td, color:'#555', fontSize:12 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td style={s.td}>
                    {u.email !== ADMIN_EMAIL && (
                      <button onClick={() => toggleRole(u.id, u.role)} style={s.actionBtn}>
                        {u.role === 'admin' ? 'Remove admin' : 'Make admin'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={s.noResults}>No users found</div>}
        </div>
      </div>
    </div>
  )
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
  navItem: { display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,fontSize:13,color:'#666',cursor:'pointer' },
  navItemActive: { background:'rgba(124,110,247,0.1)',color:'#9d92f5' },
  adminBadge: { marginLeft:'auto',fontSize:10,background:'rgba(124,110,247,0.15)',color:'#9d92f5',padding:'2px 6px',borderRadius:4 },
  sidebarBottom: { padding:'16px',borderTop:'1px solid rgba(255,255,255,0.07)' },
  userRow: { display:'flex',alignItems:'center',gap:10,marginBottom:12 },
  avatar: { width:30,height:30,borderRadius:'50%',background:'#7c6ef7',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'white',flexShrink:0 },
  userEmail: { fontSize:11,color:'#888',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' as const },
  userRole: { fontSize:10,color:'#7c6ef7',marginTop:1 },
  signOutBtn: { width:'100%',padding:'7px',background:'none',border:'1px solid rgba(255,255,255,0.08)',borderRadius:7,color:'#555',fontSize:12,cursor:'pointer' },
  main: { flex:1,overflow:'auto',padding:40 },
  header: { marginBottom:28 },
  title: { fontSize:24,fontWeight:600,color:'#f0f0f0',margin:'0 0 4px' },
  subtitle: { fontSize:13,color:'#555' },
  statsRow: { display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:28 },
  statCard: { background:'#111',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'16px 20px' },
  statLabel: { fontSize:11,color:'#555',marginBottom:6,textTransform:'uppercase' as const,letterSpacing:'0.05em' },
  statValue: { fontSize:24,fontWeight:600,color:'#f0f0f0' },
  searchRow: { marginBottom:16 },
  searchInput: { width:'100%',maxWidth:360,padding:'9px 14px',background:'#111',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,color:'#f0f0f0',fontSize:13,outline:'none',boxSizing:'border-box' as const },
  tableWrap: { background:'#111',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,overflow:'hidden' },
  table: { width:'100%',borderCollapse:'collapse' as const },
  th: { padding:'12px 16px',textAlign:'left' as const,fontSize:11,color:'#555',fontWeight:500,textTransform:'uppercase' as const,letterSpacing:'0.05em',background:'#0f0f0f',borderBottom:'1px solid rgba(255,255,255,0.07)' },
  tr: { borderTop:'1px solid rgba(255,255,255,0.05)' },
  td: { padding:'12px 16px',fontSize:13,color:'#e0e0e0',verticalAlign:'middle' as const },
  userCell: { display:'flex',alignItems:'center',gap:10 },
  youBadge: { fontSize:10,background:'rgba(124,110,247,0.15)',color:'#9d92f5',padding:'1px 6px',borderRadius:4 },
  badge: { fontSize:11,padding:'3px 8px',borderRadius:20,fontWeight:500 },
  badgeAdmin: { background:'rgba(124,110,247,0.15)',color:'#9d92f5' },
  badgeUser: { background:'rgba(255,255,255,0.06)',color:'#888' },
  actionBtn: { padding:'5px 12px',background:'none',border:'1px solid rgba(255,255,255,0.08)',borderRadius:6,color:'#888',fontSize:11,cursor:'pointer' },
  noResults: { padding:32,textAlign:'center' as const,color:'#555',fontSize:13 },
}
