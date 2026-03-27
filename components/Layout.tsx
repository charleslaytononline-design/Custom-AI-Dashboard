import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { useMobile } from '../hooks/useMobile'
import { useTheme } from '../contexts/ThemeContext'
import type { Theme, ThemeColors } from '../lib/themes'

const CREDIT_PACKS = [
  { id: 'pack_5',  amount: 5,  label: '$5',  desc: '~50 builds' },
  { id: 'pack_10', amount: 10, label: '$10', desc: '~100 builds' },
  { id: 'pack_25', amount: 25, label: '$25', desc: '~250 builds', popular: true },
  { id: 'pack_50', amount: 50, label: '$50', desc: '~500 builds' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const isMobile = useMobile()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showBuy, setShowBuy] = useState(false)
  const [buyingPack, setBuyingPack] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { theme, setTheme, availableThemes } = useTheme()

  async function refreshProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('credit_balance, gift_balance, role').eq('id', userId).single()
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

    // Refresh balance when credits change (after builds, payments, etc.)
    const creditHandler = () => {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) refreshProfile(data.user.id)
      })
    }
    window.addEventListener('creditBalanceChanged', creditHandler)

    return () => {
      window.removeEventListener('openBuyModal', handler)
      window.removeEventListener('creditBalanceChanged', creditHandler)
    }
  }, [])

  // Refresh balance on payment success redirect only
  useEffect(() => {
    if (user && router.asPath.includes('success=true')) {
      refreshProfile(user.id)
    }
  }, [router.asPath, user])

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
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

  const isAdmin = profile?.role === 'admin'
  const balance = profile?.credit_balance || 0
  const giftBalance = profile?.gift_balance || 0
  const path = router.pathname

  const sidebarStyle: React.CSSProperties = isMobile
    ? {
        ...s.sidebar,
        position: 'fixed',
        top: 0,
        left: 0,
        height: '100vh',
        zIndex: 100,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s ease',
      }
    : s.sidebar

  return (
    <div style={s.root}>
      {/* SIDEBAR */}
      <div style={sidebarStyle}>
        <div style={s.sideTop}>
          <div style={s.brand}>
            <div style={s.brandIcon}>AI</div>
            <span style={s.brandName}>Custom AI</span>
          </div>
        </div>
        <nav style={s.nav}>
          <Link href="/home" style={{ textDecoration: 'none' }}>
            <div style={{ ...s.navItem, ...(path === '/home' ? s.navActive : {}) }}>
              <span>⊞</span> Projects
            </div>
          </Link>
          <Link href="/profile" style={{ textDecoration: 'none' }}>
            <div style={{ ...s.navItem, ...(path === '/profile' ? s.navActive : {}) }}>
              <span>◎</span> My Profile
            </div>
          </Link>
          {isAdmin && (
            <Link href="/admin" style={{ textDecoration: 'none' }}>
              <div style={{ ...s.navItem, ...(path === '/admin' ? s.navActive : {}) }}>
                <span>🛡</span> Admin
              </div>
            </Link>
          )}
          <div style={{ marginTop: 'auto' }}>
            <div
              style={{ ...s.navItem, ...(showSettings ? s.navActive : {}) }}
              onClick={() => setShowSettings(true)}
            >
              <span>⚙</span> Settings
            </div>
          </div>
        </nav>
        <div style={s.sideBottom}>
          <div style={s.balanceCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={s.balanceLabel}>Credit Balance</div>
                <div style={{ ...s.balanceVal, color: balance > 0 ? '#5DCAA5' : '#f09595' }}>
                  ${balance.toFixed(2)}
                </div>
              </div>
              {giftBalance > 0 && (
                <div style={{ textAlign: 'right' as const }}>
                  <div style={{ ...s.balanceLabel, color: '#f5a623' }}>Gift Credit</div>
                  <div style={{ ...s.balanceVal, color: '#f5a623' }}>
                    ${giftBalance.toFixed(2)}
                  </div>
                </div>
              )}
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
            onClick={() => { localStorage.removeItem('session_started_at'); supabase.auth.signOut(); router.push('/') }}
            style={s.signOut}
          >
            Sign out
          </button>
        </div>
      </div>

      {/* MOBILE OVERLAY — closes sidebar when tapped */}
      {isMobile && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* PAGE CONTENT */}
      <div style={{ ...s.content, ...(isMobile ? { width: '100%', minWidth: 0 } : {}) }}>
        {/* Mobile top bar with hamburger */}
        {isMobile && (
          <div style={s.mobileHeader}>
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <div style={s.brand}>
              <div style={s.brandIcon}>AI</div>
              <span style={s.brandName}>Custom AI</span>
            </div>
          </div>
        )}
        {children}
      </div>

      {/* BUY CREDITS MODAL */}
      {showBuy && (
        <div style={s.overlay}>
          <div style={{ ...s.modal, maxWidth: isMobile ? 'calc(100% - 32px)' : 480 }}>
            <h2 style={s.modalTitle}>Buy Credits</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20 }}>
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

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div style={s.overlay} onClick={() => setShowSettings(false)}>
          <div style={{ ...s.modal, maxWidth: isMobile ? 'calc(100% - 32px)' : 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={s.modalTitle}>Settings</h2>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 12 }}>
                Color Scheme
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {availableThemes.map(t => {
                  const active = theme.id === t.id
                  return (
                    <div
                      key={t.id}
                      onClick={() => setTheme(t)}
                      style={{
                        padding: 14,
                        borderRadius: 10,
                        border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: active ? 'rgba(124,110,247,0.08)' : 'var(--bg-3)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
                        {t.name}
                        {active && <span style={{ color: '#9d92f5', fontSize: 11, marginLeft: 6 }}>Active</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[t.colors.bg, t.colors.bg2, t.colors.bg3, t.colors.text, t.colors.text2, t.colors.accent].map((c, i) => (
                          <div
                            key={i}
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: c,
                              border: '1px solid rgba(255,255,255,0.15)',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <button onClick={() => setShowSettings(false)} style={s.cancelBtn}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100vh', background: 'var(--bg)', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', overflow: 'hidden' },
  sidebar: { width: 240, minWidth: 240, background: 'var(--bg)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' },
  sideTop: { padding: 20 },
  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  brandIcon: { width: 32, height: 32, background: 'var(--accent)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0 },
  brandName: { fontSize: 15, fontWeight: 600, color: 'var(--text)' },
  nav: { flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' },
  navActive: { background: 'rgba(124,110,247,0.1)', color: '#9d92f5' },
  sideBottom: { padding: 16, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 },
  balanceCard: { background: 'rgba(124,110,247,0.07)', border: '1px solid rgba(124,110,247,0.15)', borderRadius: 10, padding: '12px 14px' },
  balanceLabel: { fontSize: 10, color: '#9d92f5', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 4 },
  balanceVal: { fontSize: 20, fontWeight: 700, marginBottom: 8 },
  topUpBtn: { width: '100%', padding: '6px 0', background: 'rgba(124,110,247,0.2)', border: '1px solid rgba(124,110,247,0.3)', borderRadius: 6, color: '#9d92f5', fontSize: 11, fontWeight: 500, cursor: 'pointer' },
  userInfo: { display: 'flex', alignItems: 'center', gap: 10 },
  avatar: { width: 30, height: 30, borderRadius: '50%', background: 'rgba(124,110,247,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#9d92f5', flexShrink: 0 },
  userDetails: { flex: 1, minWidth: 0 },
  userEmail: { fontSize: 11, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  userRole: { fontSize: 10, color: 'var(--text-3)', marginTop: 1 },
  signOut: { padding: '6px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-3)', fontSize: 11, cursor: 'pointer', textAlign: 'center' as const },
  content: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  mobileHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' },
  modal: { background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 16, padding: 28, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 },
  modalTitle: { fontSize: 16, fontWeight: 600, color: 'var(--text)' },
  cancelBtn: { padding: '8px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  packCard: { background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' as const },
  packPopular: { border: '1px solid rgba(124,110,247,0.4)', background: 'rgba(124,110,247,0.07)' },
  popularBadge: { position: 'absolute' as const, top: -10, left: '50%', transform: 'translateX(-50%)', background: 'var(--accent)', color: 'white', fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' as const },
  packAmount: { fontSize: 22, fontWeight: 700, color: 'var(--text)' },
  packDesc: { fontSize: 12, color: 'var(--text-3)' },
  packBtn: { padding: '8px 0', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-2)', borderRadius: 7, color: 'var(--text-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', marginTop: 4 },
  packBtnPopular: { background: 'var(--accent)', borderColor: 'transparent', color: 'white' },
}
