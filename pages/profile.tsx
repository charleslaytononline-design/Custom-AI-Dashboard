import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useMobile } from '../hooks/useMobile'

export default function Profile() {
  const router = useRouter()
  const isMobile = useMobile()
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadProfile(data.user.id)
    })
  }, [])

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (data) { setProfile(data); setLoading(false) }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const balance = profile?.credit_balance || 0
  const isAdmin = profile?.role === 'admin'

  return (
    <div style={s.main}>
      {loading ? (
        <div style={s.loadingInner}>Loading...</div>
      ) : (
        <>
          <div style={{ ...s.topbar, padding: isMobile ? '20px 16px 0' : '28px 32px 0' }}>
            <div>
              <h1 style={s.title}>My Profile</h1>
              <p style={s.sub}>Account details and usage</p>
            </div>
          </div>

          {/* ACCOUNT + BALANCE ROW */}
          <div style={{
            ...s.twoCol,
            gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
            padding: isMobile ? '16px 16px 0' : '24px 32px 0',
          }}>
            {/* Account Info */}
            <div style={s.card}>
              <div style={s.cardTitle}>Account</div>
              <div style={s.avatarRow}>
                <div style={s.bigAvatar}>{user?.email?.[0]?.toUpperCase()}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ ...s.emailText, wordBreak: 'break-all' as const }}>{user?.email}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ ...s.badge, ...(isAdmin ? s.badgePurple : s.badgeGray) }}>
                      {isAdmin ? '👑 Admin' : 'Member'}
                    </span>
                    {profile?.suspended && <span style={{ ...s.badge, ...s.badgeRed }}>Suspended</span>}
                  </div>
                  <div style={s.joinedText}>Joined {formatDate(profile?.created_at)}</div>
                </div>
              </div>
            </div>

            {/* Credit Balance */}
            <div style={{ ...s.card, border: '1px solid rgba(124,110,247,0.2)', background: 'rgba(124,110,247,0.04)' }}>
              <div style={{ ...s.cardTitle, color: '#9d92f5' }}>Credit Balance</div>
              <div style={{ fontSize: isMobile ? 32 : 40, fontWeight: 700, color: balance > 0 ? '#5DCAA5' : '#f09595', marginBottom: 6 }}>
                ${balance.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 20 }}>
                Each AI build costs ~$0.02–$0.10 depending on complexity
              </div>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('openBuyModal'))}
                style={s.topUpBtn}
              >
                + Top Up Credits
              </button>
            </div>
          </div>

        </>
      )}
    </div>
  )
}

Profile.getLayout = function getLayout(page: React.ReactNode) {
  return <Layout>{page}</Layout>
}

const s: Record<string, React.CSSProperties> = {
  main: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' },
  loadingInner: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 },
  topbar: { padding: '28px 32px 0' },
  title: { fontSize: 22, fontWeight: 600, color: '#f0f0f0' },
  sub: { fontSize: 13, color: '#555', marginTop: 2 },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: '24px 32px 0' },
  card: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 24 },
  cardTitle: { fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 16 },
  avatarRow: { display: 'flex', alignItems: 'flex-start', gap: 16 },
  bigAvatar: { width: 52, height: 52, borderRadius: '50%', background: 'rgba(124,110,247,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#9d92f5', flexShrink: 0 },
  emailText: { fontSize: 15, fontWeight: 500, color: '#f0f0f0' },
  joinedText: { fontSize: 11, color: '#444', marginTop: 6 },
  topUpBtn: { width: '100%', padding: '10px 0', background: '#7c6ef7', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, padding: '16px 32px 0' },
  statCard: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px' },
  statLabel: { fontSize: 11, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 },
  statVal: { fontSize: 24, fontWeight: 700, color: '#f0f0f0', marginBottom: 2 },
  statSub: { fontSize: 11, color: '#444' },
  section: { padding: '24px 32px 32px' },
  sectionTitle: { fontSize: 15, fontWeight: 500, color: '#f0f0f0', marginBottom: 14 },
  empty: { color: '#555', fontSize: 13, padding: '24px 0' },
  tableWrap: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  thead: { background: '#1a1a1a' },
  th: { padding: '10px 16px', textAlign: 'left' as const, fontSize: 10, fontWeight: 500, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  tr: { borderTop: '1px solid rgba(255,255,255,0.05)' },
  td: { padding: '10px 16px', verticalAlign: 'middle' as const },
  dateText: { fontSize: 12, color: '#666' },
  dimText: { fontSize: 12, color: '#555' },
  badge: { display: 'inline-flex', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500 },
  badgeGreen: { background: 'rgba(29,158,117,0.12)', color: '#5DCAA5' },
  badgeRed: { background: 'rgba(163,45,45,0.12)', color: '#f09595' },
  badgePurple: { background: 'rgba(124,110,247,0.12)', color: '#9d92f5' },
  badgeGray: { background: 'rgba(255,255,255,0.05)', color: '#666' },
}
