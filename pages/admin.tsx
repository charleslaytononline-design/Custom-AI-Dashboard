import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import type { GetServerSidePropsContext } from 'next'

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  const serverSupabase = createServerSupabaseClient(ctx)
  const { data: { session } } = await serverSupabase.auth.getSession()

  if (!session) {
    return { redirect: { destination: '/', permanent: false } }
  }

  const { data: profile } = await serverSupabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { redirect: { destination: '/home', permanent: false } }
  }

  return { props: {} }
}

interface UserRow {
  id: string
  email: string
  role: string
  suspended: boolean
  credit_balance: number
  created_at: string
  projectCount?: number
  pageCount?: number
  messageCount?: number
  tokenCount?: number
  imageCount?: number
  totalSpend?: number
  anthropicCost?: number
  replicateCost?: number
  lastActive?: string
}

interface Settings {
  markup_multiplier: string
  input_cost_per_1k: string
  output_cost_per_1k: string
}

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [settings, setSettings] = useState<Settings>({ markup_multiplier: '3.0', input_cost_per_1k: '0.003', output_cost_per_1k: '0.015' })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'users' | 'revenue' | 'settings'>('users')
  const [giftUserId, setGiftUserId] = useState('')
  const [giftAmount, setGiftAmount] = useState('')
  const [giftMsg, setGiftMsg] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalApiCost, setTotalApiCost] = useState(0)
  const [totalProfit, setTotalProfit] = useState(0)
  const [anthropicCostTotal, setAnthropicCostTotal] = useState(0)
  const [replicateCostTotal, setReplicateCostTotal] = useState(0)

  useEffect(() => {
    // Server-side guard (getServerSideProps) already verified admin role.
    // Just load the user for display purposes.
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadAll()
    })
  }, [])

  async function loadAll() {
    await Promise.all([loadUsers(), loadSettings(), loadRevenue()])
    setLoading(false)
  }

  async function loadUsers() {
    const { data: profiles } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
    if (!profiles) return

    const [
      { data: projects },
      { data: pages },
      { data: transactions },
      { data: chatHistory },
    ] = await Promise.all([
      supabase.from('projects').select('user_id'),
      supabase.from('pages').select('user_id'),
      supabase.from('transactions').select('user_id, amount, api_cost, type, tokens_used, description, created_at'),
      supabase.from('chat_history').select('user_id, role'),
    ])

    const projectCounts: Record<string, number> = {}
    const pageCounts: Record<string, number> = {}
    const messageCounts: Record<string, number> = {}
    const tokenCounts: Record<string, number> = {}
    const imageCounts: Record<string, number> = {}
    const tokenSpend: Record<string, number> = {}
    const anthropicCosts: Record<string, number> = {}
    const replicateCosts: Record<string, number> = {}
    const lastActive: Record<string, string> = {}

    projects?.forEach((p: any) => { projectCounts[p.user_id] = (projectCounts[p.user_id] || 0) + 1 })
    pages?.forEach((p: any) => { pageCounts[p.user_id] = (pageCounts[p.user_id] || 0) + 1 })
    chatHistory?.forEach((m: any) => {
      if (m.role === 'user') messageCounts[m.user_id] = (messageCounts[m.user_id] || 0) + 1
    })
    transactions?.forEach((t: any) => {
      if (t.type === 'usage') {
        const isImage = (t.description || '').toLowerCase().includes('image')
        tokenSpend[t.user_id] = (tokenSpend[t.user_id] || 0) + Math.abs(t.amount)
        tokenCounts[t.user_id] = (tokenCounts[t.user_id] || 0) + (t.tokens_used || 0)
        if (isImage) {
          imageCounts[t.user_id] = (imageCounts[t.user_id] || 0) + 1
          replicateCosts[t.user_id] = (replicateCosts[t.user_id] || 0) + (t.api_cost || 0)
        } else {
          anthropicCosts[t.user_id] = (anthropicCosts[t.user_id] || 0) + (t.api_cost || 0)
        }
        // Track most recent activity
        if (!lastActive[t.user_id] || t.created_at > lastActive[t.user_id]) {
          lastActive[t.user_id] = t.created_at
        }
      }
    })

    setUsers(profiles.map((p: any) => ({
      ...p,
      projectCount: projectCounts[p.id] || 0,
      pageCount: pageCounts[p.id] || 0,
      messageCount: messageCounts[p.id] || 0,
      totalSpend: tokenSpend[p.id] || 0,
      tokenCount: tokenCounts[p.id] || 0,
      imageCount: imageCounts[p.id] || 0,
      anthropicCost: anthropicCosts[p.id] || 0,
      replicateCost: replicateCosts[p.id] || 0,
      lastActive: lastActive[p.id] || null,
    })))
  }

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((s: any) => { map[s.key] = s.value })
      setSettings(map as unknown as Settings)
    }
  }

  async function loadRevenue() {
    const { data } = await supabase.from('transactions').select('amount, api_cost, type, description')
    if (!data) return
    let revenue = 0, anthropicTotal = 0, replicateTotal = 0
    data.forEach((t: any) => {
      if (t.type === 'usage') {
        revenue += Math.abs(t.amount)
        const isImage = (t.description || '').toLowerCase().includes('image')
        if (isImage) replicateTotal += (t.api_cost || 0)
        else anthropicTotal += (t.api_cost || 0)
      }
    })
    setTotalRevenue(revenue)
    setTotalApiCost(anthropicTotal + replicateTotal)
    setTotalProfit(revenue - anthropicTotal - replicateTotal)
    setAnthropicCostTotal(anthropicTotal)
    setReplicateCostTotal(replicateTotal)
  }

  async function saveSettings() {
    setSavingSettings(true)
    for (const [key, value] of Object.entries(settings)) {
      await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    }
    setSavingSettings(false)
    alert('Settings saved!')
  }

  async function giftCredits() {
    if (!giftUserId || !giftAmount) return
    const amount = parseFloat(giftAmount)
    if (isNaN(amount) || amount <= 0) return

    const { error } = await supabase.rpc('add_credits', {
      p_user_id: giftUserId,
      p_amount: amount,
      p_type: 'gift',
      p_description: `Admin gift: $${amount} credits`,
      p_stripe_payment_id: null,
    })

    if (error) { setGiftMsg('Error: ' + error.message); return }
    setGiftMsg(`✓ $${amount} credits gifted successfully!`)
    setGiftAmount('')
    loadUsers()
    setTimeout(() => setGiftMsg(''), 3000)
  }

  async function toggleSuspend(userId: string, suspended: boolean) {
    await supabase.from('profiles').update({ suspended: !suspended }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, suspended: !suspended } : u))
  }

  async function changeRole(userId: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin'
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    if (error) { alert('Failed to update role: ' + error.message); return }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
  }

  function formatDate(iso: string | null | undefined) {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  const margin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0'
  const filtered = users.filter(u => u.email.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <div style={s.loadingInner}>Loading...</div>

  return (
    <div style={s.main}>
      <div style={s.topbar}>
        <div>
          <h1 style={s.title}>Admin Panel</h1>
          <p style={s.sub}>{users.length} users · {users.reduce((a, u) => a + u.projectCount!, 0)} projects</p>
        </div>
      </div>

      {/* REVENUE STATS */}
      <div style={{ ...s.statsGrid, gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 12 }}>
        <div style={s.statCard}>
          <div style={s.statLabel}>Total Revenue</div>
          <div style={s.statVal}>${totalRevenue.toFixed(2)}</div>
          <div style={s.statSub}>charged to users</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Your Profit</div>
          <div style={{ ...s.statVal, color: '#5DCAA5' }}>${totalProfit.toFixed(2)}</div>
          <div style={s.statSub}>{margin}% margin · {settings.markup_multiplier}x markup</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Total Users</div>
          <div style={s.statVal}>{users.length}</div>
          <div style={s.statSub}>{users.filter(u => u.role === 'admin').length} admin</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Credits Held</div>
          <div style={s.statVal}>${users.reduce((a, u) => a + (u.credit_balance || 0), 0).toFixed(2)}</div>
          <div style={s.statSub}>across all users</div>
        </div>
      </div>
      <div style={{ ...s.statsGrid, gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div style={{ ...s.statCard, border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.05)' }}>
          <div style={{ ...s.statLabel, color: '#818cf8' }}>Anthropic (Claude)</div>
          <div style={{ ...s.statVal, color: '#f09595', fontSize: 18 }}>${anthropicCostTotal.toFixed(4)}</div>
          <div style={s.statSub}>AI text generation</div>
        </div>
        <div style={{ ...s.statCard, border: '1px solid rgba(20,184,166,0.2)', background: 'rgba(20,184,166,0.05)' }}>
          <div style={{ ...s.statLabel, color: '#2dd4bf' }}>Replicate (Flux)</div>
          <div style={{ ...s.statVal, color: '#f09595', fontSize: 18 }}>${replicateCostTotal.toFixed(4)}</div>
          <div style={s.statSub}>AI image generation</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Total API Costs</div>
          <div style={{ ...s.statVal, color: '#f09595', fontSize: 18 }}>${totalApiCost.toFixed(4)}</div>
          <div style={s.statSub}>Anthropic + Replicate</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Cost per $1 Revenue</div>
          <div style={{ ...s.statVal, fontSize: 18 }}>${totalRevenue > 0 ? (totalApiCost / totalRevenue).toFixed(3) : '0.000'}</div>
          <div style={s.statSub}>you keep ${totalRevenue > 0 ? (1 - totalApiCost / totalRevenue).toFixed(3) : '1.000'} per $1</div>
        </div>
      </div>

      {/* TABS */}
      <div style={s.tabRow}>
        {(['users', 'revenue', 'settings'] as const).map(tab => (
          <button key={tab} style={{ ...s.tabBtn, ...(activeTab === tab ? s.tabBtnOn : {}) }} onClick={() => setActiveTab(tab)}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* USERS TAB */}
      {activeTab === 'users' && (
        <div style={s.section}>
          <div style={s.tableTop}>
            <h2 style={s.sectionTitle}>All Users</h2>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by email..." style={s.searchInput} />
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.thead}>
                  <th style={s.th}>User</th>
                  <th style={s.th}>Role</th>
                  <th style={s.th}>Credits</th>
                  <th style={s.th}>Projects</th>
                  <th style={s.th}>Pages</th>
                  <th style={s.th}>Messages</th>
                  <th style={s.th}>Total Spend</th>
                  <th style={{ ...s.th, color: '#818cf8' }}>Anthropic Cost</th>
                  <th style={{ ...s.th, color: '#2dd4bf' }}>Replicate Cost</th>
                  <th style={s.th}>Tokens</th>
                  <th style={s.th}>Images</th>
                  <th style={s.th}>Profit</th>
                  <th style={s.th}>Last Active</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} style={s.tr}>
                    <td style={s.td}>
                      <div style={s.userCell}>
                        <div style={s.uAvatar}>{u.email[0].toUpperCase()}</div>
                        <span style={{ fontSize: 13, color: '#e0e0e0' }}>{u.email}</span>
                      </div>
                    </td>
                    <td style={s.td}><span style={{ ...s.badge, ...(u.role === 'admin' ? s.badgePurple : s.badgeGray) }}>{u.role}</span></td>
                    <td style={s.td}><span style={{ fontSize: 13, color: '#5DCAA5', fontWeight: 500 }}>${(u.credit_balance || 0).toFixed(2)}</span></td>
                    <td style={s.td}><span style={s.num}>{u.projectCount}</span></td>
                    <td style={s.td}><span style={s.num}>{u.pageCount}</span></td>
                    <td style={s.td}><span style={s.num}>{(u.messageCount || 0).toLocaleString()}</span></td>
                    <td style={s.td}><span style={s.num}>${(u.totalSpend || 0).toFixed(2)}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#f09595' }}>${(u.anthropicCost || 0).toFixed(4)}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#2dd4bf' }}>${(u.replicateCost || 0).toFixed(4)}</span></td>
                    <td style={s.td}><span style={s.num}>{(u.tokenCount || 0).toLocaleString()}</span></td>
                    <td style={s.td}><span style={s.num}>{u.imageCount || 0}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#5DCAA5' }}>${((u.totalSpend || 0) - (u.anthropicCost || 0) - (u.replicateCost || 0)).toFixed(4)}</span></td>
                    <td style={s.td}><span style={s.num}>{formatDate(u.lastActive)}</span></td>
                    <td style={s.td}><span style={{ ...s.badge, ...(u.suspended ? s.badgeRed : s.badgeGreen) }}>{u.suspended ? 'Suspended' : 'Active'}</span></td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                        <button
                          onClick={() => changeRole(u.id, u.role)}
                          style={{ ...s.actionBtn, ...(u.role === 'admin' ? s.actionOrange : s.actionPurple) }}
                          title={u.role === 'admin' ? 'Demote to User' : 'Promote to Admin'}
                        >
                          {u.role === 'admin' ? '▼ User' : '▲ Admin'}
                        </button>
                        <button onClick={() => toggleSuspend(u.id, u.suspended)} style={{ ...s.actionBtn, ...(u.suspended ? s.actionGreen : s.actionRed) }}>
                          {u.suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                        <button onClick={() => { setGiftUserId(u.id); setActiveTab('revenue') }} style={s.actionBtn}>
                          Gift $
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REVENUE / GIFT TAB */}
      {activeTab === 'revenue' && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Gift Credits</h2>
          <div style={s.giftCard}>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>Give a user free credits. This appears as a "gift" transaction in their history.</p>
            <div style={s.giftRow}>
              <div style={s.field}>
                <label style={s.label}>User</label>
                <select value={giftUserId} onChange={e => setGiftUserId(e.target.value)} style={s.select}>
                  <option value="">Select user...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.email} (${(u.credit_balance || 0).toFixed(2)} balance)</option>)}
                </select>
              </div>
              <div style={s.field}>
                <label style={s.label}>Amount ($)</label>
                <input type="number" value={giftAmount} onChange={e => setGiftAmount(e.target.value)} placeholder="e.g. 10" style={s.input} min="0.01" step="0.01" />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button onClick={giftCredits} disabled={!giftUserId || !giftAmount} style={s.giftBtn}>Gift Credits</button>
              </div>
            </div>
            {giftMsg && <div style={{ marginTop: 12, fontSize: 13, color: '#5DCAA5' }}>{giftMsg}</div>}
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {activeTab === 'settings' && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Pricing Settings</h2>
          <div style={s.settingsCard}>
            <div style={s.settingsGrid}>
              <div style={s.field}>
                <label style={s.label}>Markup Multiplier</label>
                <p style={s.fieldDesc}>How much to charge users vs what Anthropic charges you. 3x = 66% margin.</p>
                <input type="number" value={settings.markup_multiplier} onChange={e => setSettings(p => ({ ...p, markup_multiplier: e.target.value }))} style={s.input} step="0.1" min="1" />
                <div style={s.previewBox}>
                  At {settings.markup_multiplier}x: You pay $0.01 → User pays ${(0.01 * parseFloat(settings.markup_multiplier || '1')).toFixed(3)} → Your profit: ${(0.01 * parseFloat(settings.markup_multiplier || '1') - 0.01).toFixed(3)} ({((1 - 1 / parseFloat(settings.markup_multiplier || '1')) * 100).toFixed(0)}% margin)
                </div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Input Cost per 1k tokens ($)</label>
                <p style={s.fieldDesc}>Anthropic's actual charge for input tokens. Claude Sonnet = ~$0.003</p>
                <input type="number" value={settings.input_cost_per_1k} onChange={e => setSettings(p => ({ ...p, input_cost_per_1k: e.target.value }))} style={s.input} step="0.001" min="0" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Output Cost per 1k tokens ($)</label>
                <p style={s.fieldDesc}>Anthropic's actual charge for output tokens. Claude Sonnet = ~$0.015</p>
                <input type="number" value={settings.output_cost_per_1k} onChange={e => setSettings(p => ({ ...p, output_cost_per_1k: e.target.value }))} style={s.input} step="0.001" min="0" />
              </div>
            </div>
            <div style={s.marginPreview}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: '#f0f0f0', marginBottom: 12 }}>Margin Preview</h3>
              {[5, 10, 25, 50].map(spend => {
                const apiCost = spend / parseFloat(settings.markup_multiplier || '3')
                const profit = spend - apiCost
                const margin = ((profit / spend) * 100).toFixed(0)
                return (
                  <div key={spend} style={s.marginRow}>
                    <span style={{ color: '#888', fontSize: 13 }}>User spends ${spend}</span>
                    <span style={{ color: '#f09595', fontSize: 13 }}>API cost: ${apiCost.toFixed(2)}</span>
                    <span style={{ color: '#5DCAA5', fontSize: 13 }}>Your profit: ${profit.toFixed(2)} ({margin}%)</span>
                  </div>
                )
              })}
            </div>
            <button onClick={saveSettings} disabled={savingSettings} style={s.saveBtn}>
              {savingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

Admin.getLayout = function getLayout(page: React.ReactNode) {
  return <Layout>{page}</Layout>
}

const s: Record<string, React.CSSProperties> = {
  loadingInner: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 },
  main: { flex: 1, overflow: 'auto' },
  topbar: { padding: '24px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 20, fontWeight: 600, color: '#f0f0f0', marginBottom: 4 },
  sub: { fontSize: 12, color: '#555' },
  statsGrid: { display: 'grid', gap: 12, padding: '20px 28px 0' },
  statCard: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 16px' },
  statLabel: { fontSize: 11, color: '#555', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  statVal: { fontSize: 20, fontWeight: 600, color: '#f0f0f0', marginBottom: 2 },
  statSub: { fontSize: 10, color: '#444' },
  tabRow: { display: 'flex', gap: 4, padding: '20px 28px 0' },
  tabBtn: { padding: '7px 16px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, color: '#666', fontSize: 12, cursor: 'pointer' },
  tabBtnOn: { background: 'rgba(124,110,247,0.15)', borderColor: 'rgba(124,110,247,0.3)', color: '#9d92f5' },
  section: { padding: '16px 28px 28px' },
  sectionTitle: { fontSize: 15, fontWeight: 500, color: '#f0f0f0', marginBottom: 14 },
  tableTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  searchInput: { padding: '7px 12px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, color: '#f0f0f0', fontSize: 12, outline: 'none', width: 220 },
  tableWrap: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  thead: { background: '#1a1a1a' },
  th: { padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, fontWeight: 500, color: '#555', textTransform: 'uppercase' as const, letterSpacing: '0.05em', whiteSpace: 'nowrap' as const },
  tr: { borderTop: '1px solid rgba(255,255,255,0.05)' },
  td: { padding: '10px 14px', verticalAlign: 'middle' as const, whiteSpace: 'nowrap' as const },
  userCell: { display: 'flex', alignItems: 'center', gap: 8 },
  uAvatar: { width: 24, height: 24, borderRadius: '50%', background: 'rgba(124,110,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#9d92f5', flexShrink: 0 },
  num: { fontSize: 12, color: '#888' },
  badge: { display: 'inline-flex', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500 },
  badgeGreen: { background: 'rgba(29,158,117,0.12)', color: '#5DCAA5' },
  badgeRed: { background: 'rgba(163,45,45,0.12)', color: '#f09595' },
  badgePurple: { background: 'rgba(124,110,247,0.12)', color: '#9d92f5' },
  badgeGray: { background: 'rgba(255,255,255,0.05)', color: '#888' },
  actionBtn: { padding: '4px 10px', border: 'none', borderRadius: 5, fontSize: 10, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#888' },
  actionRed: { background: 'rgba(163,45,45,0.12)', color: '#f09595' },
  actionGreen: { background: 'rgba(29,158,117,0.12)', color: '#5DCAA5' },
  actionPurple: { background: 'rgba(124,110,247,0.12)', color: '#9d92f5' },
  actionOrange: { background: 'rgba(186,117,23,0.12)', color: '#f0a952' },
  giftCard: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 24 },
  giftRow: { display: 'flex', gap: 16, alignItems: 'flex-end' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1 },
  label: { fontSize: 11, color: '#666' },
  fieldDesc: { fontSize: 11, color: '#444', marginBottom: 4, lineHeight: 1.5 },
  select: { padding: '8px 12px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f0f0', fontSize: 13, outline: 'none' },
  input: { padding: '8px 12px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f0f0', fontSize: 13, outline: 'none' },
  giftBtn: { padding: '9px 20px', background: '#7c6ef7', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  settingsCard: { background: '#111', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 24 },
  settingsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 24 },
  previewBox: { marginTop: 8, padding: '8px 12px', background: 'rgba(124,110,247,0.07)', border: '1px solid rgba(124,110,247,0.15)', borderRadius: 7, fontSize: 11, color: '#9d92f5', lineHeight: 1.5 },
  marginPreview: { background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: 16, marginBottom: 20 },
  marginRow: { display: 'flex', gap: 32, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 13 },
  saveBtn: { padding: '10px 24px', background: '#7c6ef7', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
}
