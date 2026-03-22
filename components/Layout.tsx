import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const ADMIN_EMAIL = 'charleslayton.online@gmail.com'

const CREDIT_PACKS = [
  { id: 'pack_5',  amount: 5,  label: '$5',  desc: '~50 builds' },
  { id: 'pack_10', amount: 10, label: '$10', desc: '~100 builds' },
  { id: 'pack_25', amount: 25, label: '$25', desc: '~250 builds', popular: true },
  { id: 'pack_50', amount: 50, label: '$50', desc: '~500 builds' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showBuy, setShowBuy] = useState(false)
  const [buyingPack, setBuyingPack] = useState('')

  async function refreshProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('credit_balance, role').eq('id', userId).single()
    if (data) setProfile(data)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      refreshProfile(data.user.id)
    })

    // Child pages fire this event to open the buy modal
    const handler = () => setShowBuy(true)
    window.addEventListener('openBuyModal', handler)
    return () => window.removeEventListener('openBuyModal', handler)
  }, [])

  // Refresh balance on every navigation (handles payment success redirects too)
  useEffect(() => {
    if (user) refreshProfile(user.id)
  }, [router.asPath])

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
    } catch { alert('Failed to start checkout') }
    setBuyingPack('')
  }

  const isAdmin = user?.email === ADMIN_EMAIL
  const balance = profile?.credit_balance || 0
  const path = router.pathname

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
          <div
            style={{ ...s.navItem, ...(path === '/home' ? s.navActive : {}) }}
            onClick={() => router.push('/home')}
          >
            <span>⊞</span> Projects
          </div>
          {isAdmin && (
            <div
              style={{ ...s.navItem, ...(path === '/admin' ? s.navActive : {}) }}
              onClick={() => router.push('/admin')}
            >
              <span>🛡</span> Admin
            </div>
          )}
        </nav>
        <div style={s.sideBottom}>
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
          <button
            onClick={() => { supabase.auth.signOut(); router.push('/') }}
            style={s.signOut}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* PAGE CONTENT */}
      <div style={s.content}>{children}</div>

      {/* BUY CREDITS MODAL */}
      {showBuy && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: 480 }}>
            <h2 style={s.modalTitle}>Buy Credits</h2>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 20 }}>
              Credits power AI builds. Each build costs ~$0.02–$0.10 depending on complexity.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {CREDIT_PACKS.map(pack => (
                <div key={pack.id} style={{ ...s.packCard, ...(pack.popular ? s.packPopular : {}) }}>
                  {pack.popular && <div style={s.popularBadge}>Most Popular</div>}
                  <div style={s.packAmount}>{pack.label}</div>
                  <div style={s.packDesc}>{pack.desc}</div>
                  <button
                    onClick={() => buyCredits(pack.id)}
                    disabled={buyingPack === pack.id}
                    style={{ ...s.packBtn, ...(pack.popular ? s.packBtnPopular : {}) }}
                  >
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

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', background: '#0a0a0a', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', overflow: 'hidden' },
  sidebar: { width: 240, minWidth: 240, background: '#0f0f0f', borderRight: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' },
  sideTop: { padding: 20 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  brandIcon: { width: 32, height: 32, background: '#7c6ef7', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white' },
  brandName: { fontSize: 15, fontWeight: 600, color: '#f0f0f0' },
  nav: { flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13, color: '#666', cursor: 'pointer' },
  navActive: { background: 'rgba(124,110,247,0.1)', color: '#9d92f5' },
  sideBottom: { padding: 16, borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 10 },
  balanceCard: { background: 'rgba(124,110,247,0.07)', border: '1px solid rgba(124,110,247,0.15)', borderRadius: 10, padding: '12px 14px' },
  balanceLabel: { fontSize: 10, color: '#9d92f5', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 },
  balanceVal: { fontSize: 20, fontWeight: 700, marginBottom: 8 },
  topUpBtn: { width: '100%', padding: '6px 0', background: 'rgba(124,110,247,0.2)', border: '1px solid rgba(124,110,247,0.3)', borderRadius: 6, color: '#9d92f5', fontSize: 11, fontWeight: 500, cursor: 'pointer' },
  userInfo: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: '50%', background: 'rgba(124,110,247,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#9d92f5', flexShrink: 0 },
  userDetails: { flex: 1, minWidth: 0 },
  userEmail: { fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  userRole: { fontSize: 10, color: '#555', marginTop: 1 },
  signOut: { padding: '6px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, color: '#555', fontSize: 11, cursor: 'pointer', textAlign: 'center' as const },
  content: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 28, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 },
  modalTitle: { fontSize: 16, fontWeight: 600, color: '#f0f0f0' },
  cancelBtn: { padding: '8px 16px', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' },
  packCard: { background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' as const },
  packPopular: { border: '1px solid rgba(124,110,247,0.4)', background: 'rgba(124,110,247,0.07)' },
  popularBadge: { position: 'absolute' as const, top: -10, left: '50%', transform: 'translateX(-50%)', background: '#7c6ef7', color: 'white', fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' as const },
  packAmount: { fontSize: 22, fontWeight: 700, color: '#f0f0f0' },
  packDesc: { fontSize: 12, color: '#666' },
  packBtn: { padding: '8px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#888', fontSize: 12, fontWeight: 500, cursor: 'pointer', marginTop: 4 },
  packBtnPopular: { background: '#7c6ef7', borderColor: 'transparent', color: 'white' },
}
