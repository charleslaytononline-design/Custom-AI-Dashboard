import React, { useEffect, useState } from 'react'
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
  plan_id?: string | null
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

interface Plan {
  id: string
  name: string
  price_monthly: number
  ai_credits_monthly: number
  max_projects: number
  max_tables_per_project: number
  max_rows_per_table: number
  max_storage_mb: number
  can_connect_own_supabase: boolean
  max_builds_per_month: number
  is_active: boolean
  sort_order: number
  stripe_price_id: string | null
}

interface Settings {
  markup_multiplier: string
  input_cost_per_1k: string
  output_cost_per_1k: string
}

interface Role {
  id: string
  name: string
  description: string
  can_access_admin: boolean
  can_build: boolean
  can_create_projects: boolean
  bypass_credits: boolean
  is_system: boolean
}

interface PlatformLog {
  id: string
  event_type: string
  severity: string
  message: string
  email: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface AlertSetting {
  event_type: string
  send_email: boolean
}

const BLANK_PLAN: Omit<Plan, 'id'> = {
  name: '',
  price_monthly: 0,
  ai_credits_monthly: 0,
  max_projects: 1,
  max_tables_per_project: 5,
  max_rows_per_table: 1000,
  max_storage_mb: 100,
  can_connect_own_supabase: false,
  max_builds_per_month: 10,
  is_active: true,
  sort_order: 99,
  stripe_price_id: null,
}

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [settings, setSettings] = useState<Settings>({ markup_multiplier: '3.0', input_cost_per_1k: '0.003', output_cost_per_1k: '0.015' })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'users' | 'revenue' | 'settings' | 'plans' | 'database' | 'roles' | 'logs'>('users')
  const [giftUserId, setGiftUserId] = useState('')
  const [giftAmount, setGiftAmount] = useState('')
  const [giftMsg, setGiftMsg] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalApiCost, setTotalApiCost] = useState(0)
  const [totalProfit, setTotalProfit] = useState(0)
  const [anthropicCostTotal, setAnthropicCostTotal] = useState(0)
  const [replicateCostTotal, setReplicateCostTotal] = useState(0)

  // Clients DB status
  const [clientsDbStatus, setClientsDbStatus] = useState<'checking' | 'connected' | 'error'>('checking')
  const [clientsDbError, setClientsDbError] = useState('')

  // Plans state
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)
  const [showNewPlan, setShowNewPlan] = useState(false)
  const [newPlan, setNewPlan] = useState<Omit<Plan, 'id'>>(BLANK_PLAN)
  const [planSaving, setPlanSaving] = useState(false)
  const [planMsg, setPlanMsg] = useState('')

  // Roles state
  const [roles, setRoles] = useState<Role[]>([])
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [showNewRole, setShowNewRole] = useState(false)
  const [newRoleForm, setNewRoleForm] = useState<Omit<Role, 'id' | 'is_system'>>({ name: '', description: '', can_access_admin: false, can_build: true, can_create_projects: true, bypass_credits: false })
  const [roleMsg, setRoleMsg] = useState('')
  const OWNER_EMAIL = 'charleslayton.online@gmail.com'

  // Logs state
  const [logs, setLogs] = useState<PlatformLog[]>([])
  const [alertSettings, setAlertSettings] = useState<AlertSetting[]>([])
  const [logTypeFilter, setLogTypeFilter] = useState('all')
  const [logSeverityFilter, setLogSeverityFilter] = useState('all')
  const [logSearch, setLogSearch] = useState('')
  const [alertSaving, setAlertSaving] = useState(false)
  const [alertMsg, setAlertMsg] = useState('')
  const [expandedLog, setExpandedLog] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadAll()
    })
    fetch('/api/check-clients-db')
      .then(r => r.json())
      .then(d => {
        if (d.connected) { setClientsDbStatus('connected') }
        else { setClientsDbStatus('error'); setClientsDbError(d.reason || 'Not configured') }
      })
      .catch(() => { setClientsDbStatus('error'); setClientsDbError('Request failed') })
  }, [])

  async function loadAll() {
    await Promise.all([loadUsers(), loadSettings(), loadRevenue(), loadPlans(), loadRoles(), loadLogs(), loadAlertSettings()])
    setLoading(false)
  }

  async function loadRoles() {
    const { data } = await supabase.from('roles').select('*').order('created_at')
    if (data) setRoles(data)
  }

  async function loadLogs() {
    const { data } = await supabase
      .from('platform_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (data) setLogs(data)
  }

  async function loadAlertSettings() {
    const { data } = await supabase.from('log_alert_settings').select('*').order('event_type')
    if (data) setAlertSettings(data)
  }

  async function saveAlertSettings() {
    setAlertSaving(true)
    for (const s of alertSettings) {
      await supabase
        .from('log_alert_settings')
        .update({ send_email: s.send_email, updated_at: new Date().toISOString() })
        .eq('event_type', s.event_type)
    }
    setAlertSaving(false)
    setAlertMsg('Settings saved!')
    setTimeout(() => setAlertMsg(''), 3000)
  }

  function toggleAlertSetting(event_type: string) {
    setAlertSettings(prev => prev.map(s => s.event_type === event_type ? { ...s, send_email: !s.send_email } : s))
  }

  async function loadPlans() {
    const { data } = await supabase.from('plans').select('*').order('sort_order')
    if (data) setPlans(data)
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

  async function changeRole(userId: string, newRole: string) {
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    if (error) { alert('Failed to update role: ' + error.message); return }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
  }

  async function saveRole(role: Role) {
    const { error } = await supabase.from('roles').update({ name: role.name, description: role.description, can_access_admin: role.can_access_admin, can_build: role.can_build, can_create_projects: role.can_create_projects, bypass_credits: role.bypass_credits }).eq('id', role.id)
    if (error) { setRoleMsg('Error: ' + error.message); return }
    setRoleMsg('Role saved!')
    setEditingRole(null)
    loadRoles()
    setTimeout(() => setRoleMsg(''), 3000)
  }

  async function createRole() {
    if (!newRoleForm.name.trim()) { setRoleMsg('Role name required'); return }
    const { error } = await supabase.from('roles').insert({ ...newRoleForm, is_system: false })
    if (error) { setRoleMsg('Error: ' + error.message); return }
    setRoleMsg('Role created!')
    setNewRoleForm({ name: '', description: '', can_access_admin: false, can_build: true, can_create_projects: true, bypass_credits: false })
    setShowNewRole(false)
    loadRoles()
    setTimeout(() => setRoleMsg(''), 3000)
  }

  async function deleteRole(roleId: string) {
    if (!confirm('Delete this role? Users with this role will keep it assigned until changed.')) return
    await supabase.from('roles').delete().eq('id', roleId)
    setRoles(prev => prev.filter(r => r.id !== roleId))
  }

  async function assignPlan(userId: string, planId: string | null) {
    await supabase.from('profiles').update({ plan_id: planId || null }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, plan_id: planId } : u))
  }

  async function savePlan(plan: Plan) {
    setPlanSaving(true)
    const { error } = await supabase.from('plans').update({
      name: plan.name,
      price_monthly: plan.price_monthly,
      ai_credits_monthly: plan.ai_credits_monthly,
      max_projects: plan.max_projects,
      max_tables_per_project: plan.max_tables_per_project,
      max_rows_per_table: plan.max_rows_per_table,
      max_storage_mb: plan.max_storage_mb,
      can_connect_own_supabase: plan.can_connect_own_supabase,
      max_builds_per_month: plan.max_builds_per_month,
      is_active: plan.is_active,
      sort_order: plan.sort_order,
      stripe_price_id: plan.stripe_price_id,
    }).eq('id', plan.id)
    setPlanSaving(false)
    if (error) { setPlanMsg('Error: ' + error.message); return }
    setPlanMsg('Plan saved!')
    setEditingPlan(null)
    loadPlans()
    setTimeout(() => setPlanMsg(''), 3000)
  }

  async function createPlan() {
    if (!newPlan.name.trim()) { setPlanMsg('Plan name required'); return }
    setPlanSaving(true)
    const { error } = await supabase.from('plans').insert(newPlan)
    setPlanSaving(false)
    if (error) { setPlanMsg('Error: ' + error.message); return }
    setPlanMsg('Plan created!')
    setNewPlan(BLANK_PLAN)
    setShowNewPlan(false)
    loadPlans()
    setTimeout(() => setPlanMsg(''), 3000)
  }

  async function deletePlan(planId: string) {
    if (!confirm('Delete this plan? Users on this plan will not be affected immediately.')) return
    await supabase.from('plans').delete().eq('id', planId)
    setPlans(prev => prev.filter(p => p.id !== planId))
  }

  function formatDate(iso: string | null | undefined) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  function getPlanName(planId: string | null | undefined) {
    if (!planId) return 'Free'
    return plans.find(p => p.id === planId)?.name || 'Free'
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
        {(['users', 'revenue', 'settings', 'plans', 'database', 'roles', 'logs'] as const).map(tab => (
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
                  <th style={s.th}>Plan</th>
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
                    <td style={s.td}>
                      {u.email === OWNER_EMAIL
                        ? <span style={{ ...s.badge, ...s.badgePurple }}>{u.role}</span>
                        : <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} style={s.planSelect}>
                            {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                          </select>
                      }
                    </td>
                    <td style={s.td}>
                      <select
                        value={u.plan_id || ''}
                        onChange={e => assignPlan(u.id, e.target.value || null)}
                        style={s.planSelect}
                      >
                        <option value="">Free</option>
                        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </td>
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
                    <td style={s.td}>
                      {u.email === OWNER_EMAIL
                        ? <span style={{ ...s.badge, ...s.badgeGreen }}>Active</span>
                        : <button onClick={() => toggleSuspend(u.id, u.suspended)} style={{ ...s.badge, ...(u.suspended ? s.badgeRed : s.badgeGreen), cursor: 'pointer', border: 'none', background: u.suspended ? 'rgba(163,45,45,0.12)' : 'rgba(29,158,117,0.12)' }}>
                            {u.suspended ? 'Suspended' : 'Active'}
                          </button>
                      }
                    </td>
                    <td style={s.td}>
                      <button onClick={() => { setGiftUserId(u.id); setActiveTab('revenue') }} style={s.actionBtn}>
                        Gift $
                      </button>
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

      {/* PLANS TAB */}
      {activeTab === 'plans' && (
        <div style={s.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={s.sectionTitle}>Subscription Plans</h2>
            <button onClick={() => { setShowNewPlan(true); setEditingPlan(null) }} style={s.saveBtn}>+ New Plan</button>
          </div>
          {planMsg && <div style={{ marginBottom: 12, fontSize: 13, color: '#5DCAA5' }}>{planMsg}</div>}

          {/* Plans table */}
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.thead}>
                  <th style={s.th}>Name</th>
                  <th style={s.th}>Price/mo</th>
                  <th style={s.th}>AI Credits/mo</th>
                  <th style={s.th}>Max Projects</th>
                  <th style={s.th}>Tables/Project</th>
                  <th style={s.th}>Rows/Table</th>
                  <th style={s.th}>Storage</th>
                  <th style={s.th}>Own Supabase</th>
                  <th style={s.th}>Builds/mo</th>
                  <th style={s.th}>Users</th>
                  <th style={s.th}>Active</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(plan => (
                  <tr key={plan.id} style={s.tr}>
                    {editingPlan?.id === plan.id ? (
                      // Inline edit row
                      <>
                        <td style={s.td}><input value={editingPlan.name} onChange={e => setEditingPlan(p => p ? { ...p, name: e.target.value } : p)} style={s.inlineInput} /></td>
                        <td style={s.td}><input type="number" value={editingPlan.price_monthly} onChange={e => setEditingPlan(p => p ? { ...p, price_monthly: parseFloat(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 60 }} /></td>
                        <td style={s.td}><input type="number" value={editingPlan.ai_credits_monthly} onChange={e => setEditingPlan(p => p ? { ...p, ai_credits_monthly: parseFloat(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 70 }} /></td>
                        <td style={s.td}><input type="number" value={editingPlan.max_projects} onChange={e => setEditingPlan(p => p ? { ...p, max_projects: parseInt(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 50 }} /></td>
                        <td style={s.td}><input type="number" value={editingPlan.max_tables_per_project} onChange={e => setEditingPlan(p => p ? { ...p, max_tables_per_project: parseInt(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 50 }} /></td>
                        <td style={s.td}><input type="number" value={editingPlan.max_rows_per_table} onChange={e => setEditingPlan(p => p ? { ...p, max_rows_per_table: parseInt(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 70 }} /></td>
                        <td style={s.td}><input type="number" value={editingPlan.max_storage_mb} onChange={e => setEditingPlan(p => p ? { ...p, max_storage_mb: parseInt(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 60 }} />MB</td>
                        <td style={s.td}>
                          <input type="checkbox" checked={editingPlan.can_connect_own_supabase} onChange={e => setEditingPlan(p => p ? { ...p, can_connect_own_supabase: e.target.checked } : p)} />
                        </td>
                        <td style={s.td}><input type="number" value={editingPlan.max_builds_per_month} onChange={e => setEditingPlan(p => p ? { ...p, max_builds_per_month: parseInt(e.target.value) || 0 } : p)} style={{ ...s.inlineInput, width: 50 }} /></td>
                        <td style={s.td}><span style={s.num}>{users.filter(u => u.plan_id === plan.id).length}</span></td>
                        <td style={s.td}>
                          <input type="checkbox" checked={editingPlan.is_active} onChange={e => setEditingPlan(p => p ? { ...p, is_active: e.target.checked } : p)} />
                        </td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => savePlan(editingPlan)} disabled={planSaving} style={{ ...s.actionBtn, ...s.actionGreen }}>{planSaving ? '...' : 'Save'}</button>
                            <button onClick={() => setEditingPlan(null)} style={s.actionBtn}>Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      // Display row
                      <>
                        <td style={s.td}><span style={{ fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}>{plan.name}</span></td>
                        <td style={s.td}><span style={{ fontSize: 13, color: plan.price_monthly === 0 ? '#888' : '#5DCAA5' }}>{plan.price_monthly === 0 ? 'Free' : `$${plan.price_monthly}`}</span></td>
                        <td style={s.td}><span style={s.num}>${plan.ai_credits_monthly.toFixed(2)}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_projects}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_tables_per_project}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_rows_per_table.toLocaleString()}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_storage_mb} MB</span></td>
                        <td style={s.td}><span style={{ ...s.badge, ...(plan.can_connect_own_supabase ? s.badgeGreen : s.badgeGray) }}>{plan.can_connect_own_supabase ? 'Yes' : 'No'}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_builds_per_month === -1 ? '∞' : plan.max_builds_per_month}</span></td>
                        <td style={s.td}><span style={s.num}>{users.filter(u => u.plan_id === plan.id).length}</span></td>
                        <td style={s.td}><span style={{ ...s.badge, ...(plan.is_active ? s.badgeGreen : s.badgeRed) }}>{plan.is_active ? 'Active' : 'Hidden'}</span></td>
                        <td style={s.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => { setEditingPlan(plan); setShowNewPlan(false) }} style={{ ...s.actionBtn, ...s.actionPurple }}>Edit</button>
                            <button onClick={() => deletePlan(plan.id)} style={{ ...s.actionBtn, ...s.actionRed }}>Delete</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* New plan form */}
          {showNewPlan && (
            <div style={{ ...s.settingsCard, marginTop: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: '#f0f0f0', marginBottom: 16 }}>New Plan</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
                <div style={s.field}>
                  <label style={s.label}>Plan Name</label>
                  <input value={newPlan.name} onChange={e => setNewPlan(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Pro" style={s.input} />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Price / month ($)</label>
                  <input type="number" value={newPlan.price_monthly} onChange={e => setNewPlan(p => ({ ...p, price_monthly: parseFloat(e.target.value) || 0 }))} style={s.input} min="0" step="1" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>AI Credits / month ($)</label>
                  <input type="number" value={newPlan.ai_credits_monthly} onChange={e => setNewPlan(p => ({ ...p, ai_credits_monthly: parseFloat(e.target.value) || 0 }))} style={s.input} min="0" step="1" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Max Projects</label>
                  <input type="number" value={newPlan.max_projects} onChange={e => setNewPlan(p => ({ ...p, max_projects: parseInt(e.target.value) || 0 }))} style={s.input} min="0" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Tables / Project</label>
                  <input type="number" value={newPlan.max_tables_per_project} onChange={e => setNewPlan(p => ({ ...p, max_tables_per_project: parseInt(e.target.value) || 0 }))} style={s.input} min="0" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Rows / Table</label>
                  <input type="number" value={newPlan.max_rows_per_table} onChange={e => setNewPlan(p => ({ ...p, max_rows_per_table: parseInt(e.target.value) || 0 }))} style={s.input} min="0" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Storage (MB)</label>
                  <input type="number" value={newPlan.max_storage_mb} onChange={e => setNewPlan(p => ({ ...p, max_storage_mb: parseInt(e.target.value) || 0 }))} style={s.input} min="0" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Builds / month</label>
                  <input type="number" value={newPlan.max_builds_per_month} onChange={e => setNewPlan(p => ({ ...p, max_builds_per_month: parseInt(e.target.value) || 0 }))} style={s.input} min="-1" />
                  <span style={{ fontSize: 10, color: '#444', marginTop: 2 }}>-1 = unlimited</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#888', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newPlan.can_connect_own_supabase} onChange={e => setNewPlan(p => ({ ...p, can_connect_own_supabase: e.target.checked }))} />
                  Allow own Supabase connection
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#888', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newPlan.is_active} onChange={e => setNewPlan(p => ({ ...p, is_active: e.target.checked }))} />
                  Visible to users
                </label>
              </div>
              <div style={s.field}>
                <label style={s.label}>Stripe Price ID (optional)</label>
                <input value={newPlan.stripe_price_id || ''} onChange={e => setNewPlan(p => ({ ...p, stripe_price_id: e.target.value || null }))} placeholder="price_..." style={s.input} />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={createPlan} disabled={planSaving} style={s.saveBtn}>{planSaving ? 'Creating...' : 'Create Plan'}</button>
                <button onClick={() => setShowNewPlan(false)} style={{ ...s.saveBtn, background: '#2a2a2a' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DATABASE TAB */}
      {activeTab === 'database' && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Database Infrastructure</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* App DB */}
            <div style={{ ...s.settingsCard, border: '1px solid rgba(124,110,247,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#5DCAA5' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}>App Database</span>
                <span style={{ ...s.badge, ...s.badgeGreen }}>Connected</span>
              </div>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>Stores user auth, profiles, projects, pages, transactions, chat history</div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Provider</span><span style={s.dbVal}>Supabase</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Tables</span><span style={s.dbVal}>profiles · projects · pages · transactions · settings · plans · chat_history</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Users</span><span style={s.dbVal}>{users.length} accounts</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>RLS</span><span style={{ ...s.badge, ...s.badgeGreen }}>Enabled</span></div>
            </div>

            {/* Clients DB */}
            <div style={{ ...s.settingsCard, border: `1px solid ${clientsDbStatus === 'connected' ? 'rgba(20,184,166,0.2)' : clientsDbStatus === 'checking' ? 'rgba(255,255,255,0.07)' : 'rgba(163,45,45,0.2)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: clientsDbStatus === 'connected' ? '#5DCAA5' : clientsDbStatus === 'checking' ? '#666' : '#f09595' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: '#f0f0f0' }}>Clients Database</span>
                <span style={{ ...s.badge, ...(clientsDbStatus === 'connected' ? s.badgeGreen : clientsDbStatus === 'checking' ? s.badgeGray : s.badgeRed) }}>
                  {clientsDbStatus === 'connected' ? 'Connected' : clientsDbStatus === 'checking' ? 'Checking...' : 'Not connected'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>Stores user-generated app data (schemas, tables, rows) in isolated per-project schemas</div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Provider</span><span style={s.dbVal}>Supabase (separate project)</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Isolation</span><span style={s.dbVal}>Schema per project (proj_{'{project_id}'})</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Registry</span><span style={s.dbVal}>schema_registry · schema_usage</span></div>
              {clientsDbStatus === 'error' && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(163,45,45,0.06)', border: '1px solid rgba(163,45,45,0.15)', borderRadius: 8, fontSize: 11, color: '#f09595' }}>
                  {clientsDbError === 'env_missing'
                    ? <>Set <code>CLIENTS_SUPABASE_URL</code> and <code>CLIENTS_SUPABASE_SERVICE_ROLE_KEY</code> in Vercel env vars, then redeploy.</>
                    : `Error: ${clientsDbError}`}
                </div>
              )}
            </div>
          </div>

          {/* Per-plan limits summary */}
          <h3 style={{ fontSize: 14, fontWeight: 500, color: '#f0f0f0', marginBottom: 12 }}>Plan Limits Overview</h3>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.thead}>
                  <th style={s.th}>Plan</th>
                  <th style={s.th}>Price</th>
                  <th style={s.th}>Projects</th>
                  <th style={s.th}>Tables / Project</th>
                  <th style={s.th}>Rows / Table</th>
                  <th style={s.th}>Storage</th>
                  <th style={s.th}>Builds / mo</th>
                  <th style={s.th}>Own Supabase</th>
                  <th style={s.th}>AI Credits</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(plan => (
                  <tr key={plan.id} style={s.tr}>
                    <td style={s.td}><span style={{ fontSize: 13, fontWeight: 500, color: plan.is_active ? '#f0f0f0' : '#555' }}>{plan.name}{!plan.is_active && ' (hidden)'}</span></td>
                    <td style={s.td}><span style={s.num}>{plan.price_monthly === 0 ? 'Free' : `$${plan.price_monthly}/mo`}</span></td>
                    <td style={s.td}><span style={s.num}>{plan.max_projects}</span></td>
                    <td style={s.td}><span style={s.num}>{plan.max_tables_per_project}</span></td>
                    <td style={s.td}><span style={s.num}>{plan.max_rows_per_table.toLocaleString()}</span></td>
                    <td style={s.td}><span style={s.num}>{plan.max_storage_mb} MB</span></td>
                    <td style={s.td}><span style={s.num}>{plan.max_builds_per_month === -1 ? '∞' : plan.max_builds_per_month}</span></td>
                    <td style={s.td}><span style={{ ...s.badge, ...(plan.can_connect_own_supabase ? s.badgeGreen : s.badgeGray) }}>{plan.can_connect_own_supabase ? 'Yes' : 'No'}</span></td>
                    <td style={s.td}><span style={s.num}>${plan.ai_credits_monthly.toFixed(2)}/mo</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11, color: '#444', marginTop: 10 }}>Edit limits in the Plans tab. Changes apply immediately to new usage checks.</p>
        </div>
      )}

      {/* ROLES TAB */}
      {activeTab === 'roles' && (
        <div style={s.section}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={s.sectionTitle}>Roles</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {roleMsg && <span style={{ fontSize: 12, color: '#5DCAA5' }}>{roleMsg}</span>}
              {!showNewRole && !editingRole && (
                <button onClick={() => setShowNewRole(true)} style={s.saveBtn}>+ New Role</button>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: editingRole || showNewRole ? '1fr 1fr' : '1fr', gap: 16 }}>
            {/* Role list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {roles.map(role => (
                <div key={role.id} style={{ ...s.settingsCard, padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 500, color: '#f0f0f0' }}>{role.name}</span>
                        {role.is_system && <span style={{ ...s.badge, ...s.badgeGray, fontSize: 9 }}>🔒 system</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>{role.description || 'No description'}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                        {role.can_access_admin && <span style={{ ...s.badge, ...s.badgePurple }}>Admin Panel</span>}
                        {role.can_build && <span style={{ ...s.badge, ...s.badgeGreen }}>Can Build</span>}
                        {role.can_create_projects && <span style={{ ...s.badge, ...s.badgeGreen }}>Create Projects</span>}
                        {role.bypass_credits && <span style={{ ...s.badge, background: 'rgba(240,169,82,0.12)', color: '#f0a952' }}>Bypass Credits</span>}
                        {!role.can_build && !role.can_create_projects && !role.can_access_admin && !role.bypass_credits && (
                          <span style={{ ...s.badge, ...s.badgeGray }}>No permissions</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => { setEditingRole({ ...role }); setShowNewRole(false) }} style={{ ...s.actionBtn, ...s.actionPurple }}>Edit</button>
                      {!role.is_system && (
                        <button onClick={() => deleteRole(role.id)} style={{ ...s.actionBtn, ...s.actionRed }}>Delete</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Edit / New Role form */}
            {(editingRole || showNewRole) && (
              <div style={s.settingsCard}>
                <h3 style={{ fontSize: 14, fontWeight: 500, color: '#f0f0f0', marginBottom: 16 }}>
                  {editingRole ? `Edit: ${editingRole.name}` : 'New Role'}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={s.field}>
                    <label style={s.label}>Name</label>
                    <input
                      style={s.input}
                      value={editingRole ? editingRole.name : newRoleForm.name}
                      disabled={editingRole?.is_system}
                      onChange={e => editingRole ? setEditingRole({ ...editingRole, name: e.target.value }) : setNewRoleForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. moderator"
                    />
                  </div>
                  <div style={s.field}>
                    <label style={s.label}>Description</label>
                    <input
                      style={s.input}
                      value={editingRole ? editingRole.description : newRoleForm.description}
                      onChange={e => editingRole ? setEditingRole({ ...editingRole, description: e.target.value }) : setNewRoleForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="What can this role do?"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <label style={s.label}>Permissions</label>
                    {([
                      ['can_access_admin', 'Can Access Admin Panel'],
                      ['can_build', 'Can Build with AI'],
                      ['can_create_projects', 'Can Create Projects'],
                      ['bypass_credits', 'Bypass Credits Requirement'],
                    ] as [keyof Omit<Role, 'id' | 'name' | 'description' | 'is_system'>, string][]).map(([key, label]) => {
                      const checked = editingRole ? editingRole[key] as boolean : newRoleForm[key] as boolean
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#ccc' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => editingRole
                              ? setEditingRole({ ...editingRole, [key]: e.target.checked })
                              : setNewRoleForm(p => ({ ...p, [key]: e.target.checked }))
                            }
                            style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c6ef7' }}
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button onClick={() => editingRole ? saveRole(editingRole) : createRole()} style={s.saveBtn}>
                      {editingRole ? 'Save Changes' : 'Create Role'}
                    </button>
                    <button onClick={() => { setEditingRole(null); setShowNewRole(false) }} style={{ ...s.saveBtn, background: '#2a2a2a' }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* LOGS TAB */}
      {activeTab === 'logs' && (() => {
        const EVENT_LABELS: Record<string, string> = {
          login_attempt:   'Login Attempt',
          login_success:   'Login Success',
          login_failure:   'Login Failure',
          signup_attempt:  'Signup Attempt',
          signup_success:  'Signup Success',
          signup_failure:  'Signup Failure',
          form_typing:     'Form Typing',
          payment_success: 'Payment Success',
          project_created: 'Project Created',
          console_error:   'Console Error/Warn',
          unhandled_error: 'Unhandled Error',
        }

        const filteredLogs = logs.filter(l => {
          if (logTypeFilter !== 'all' && l.event_type !== logTypeFilter) return false
          if (logSeverityFilter !== 'all' && l.severity !== logSeverityFilter) return false
          if (logSearch && !l.message.toLowerCase().includes(logSearch.toLowerCase()) && !(l.email || '').toLowerCase().includes(logSearch.toLowerCase())) return false
          return true
        })

        const severityColor: Record<string, string> = { error: '#f09595', warn: '#f0a952', info: '#5DCAA5' }
        const severityBg: Record<string, string> = { error: 'rgba(163,45,45,0.12)', warn: 'rgba(186,117,23,0.12)', info: 'rgba(29,158,117,0.12)' }

        const typeColor: Record<string, string> = {
          login_attempt: '#9d92f5', login_success: '#5DCAA5', login_failure: '#f09595',
          signup_attempt: '#9d92f5', signup_success: '#5DCAA5', signup_failure: '#f09595',
          form_typing: '#888', payment_success: '#f0a952', project_created: '#2dd4bf',
          console_error: '#f09595', unhandled_error: '#f09595',
        }

        return (
          <div style={s.section}>
            {/* Alert Settings */}
            <div style={{ ...s.settingsCard, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 500, color: '#f0f0f0', marginBottom: 4 }}>Email Alerts</h3>
                  <p style={{ fontSize: 11, color: '#555' }}>Choose which events send you an email. Requires <code style={{ color: '#9d92f5' }}>RESEND_API_KEY</code> and <code style={{ color: '#9d92f5' }}>ALERT_TO_EMAIL</code> env vars.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {alertMsg && <span style={{ fontSize: 12, color: '#5DCAA5' }}>{alertMsg}</span>}
                  <button onClick={saveAlertSettings} disabled={alertSaving} style={s.saveBtn}>
                    {alertSaving ? 'Saving...' : 'Save Alerts'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {alertSettings.map(setting => (
                  <label key={setting.event_type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#0a0a0a', borderRadius: 8, border: `1px solid ${setting.send_email ? 'rgba(124,110,247,0.3)' : 'rgba(255,255,255,0.05)'}`, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={setting.send_email}
                      onChange={() => toggleAlertSetting(setting.event_type)}
                      style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c6ef7' }}
                    />
                    <div>
                      <div style={{ fontSize: 12, color: typeColor[setting.event_type] || '#888', fontWeight: 500 }}>
                        {EVENT_LABELS[setting.event_type] || setting.event_type}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Log viewer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
              <h2 style={{ ...s.sectionTitle, margin: 0 }}>Recent Logs <span style={{ fontSize: 11, color: '#444', fontWeight: 400 }}>({filteredLogs.length} of {logs.length})</span></h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder="Search message or email..." style={{ ...s.searchInput, width: 200 }} />
                <select value={logTypeFilter} onChange={e => setLogTypeFilter(e.target.value)} style={s.planSelect}>
                  <option value="all">All types</option>
                  {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={logSeverityFilter} onChange={e => setLogSeverityFilter(e.target.value)} style={s.planSelect}>
                  <option value="all">All severity</option>
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
                <button onClick={loadLogs} style={{ ...s.actionBtn, padding: '6px 12px' }}>↺ Refresh</button>
              </div>
            </div>

            <div style={s.tableWrap}>
              {filteredLogs.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#444', fontSize: 13 }}>No logs yet</div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={s.th}>Time</th>
                      <th style={s.th}>Event</th>
                      <th style={s.th}>Severity</th>
                      <th style={s.th}>Email</th>
                      <th style={s.th}>Message</th>
                      <th style={s.th}>Meta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map(log => (
                      <React.Fragment key={log.id}>
                        <tr style={{ ...s.tr, cursor: log.metadata ? 'pointer' : 'default' }} onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                          <td style={{ ...s.td, fontSize: 11, color: '#555', whiteSpace: 'nowrap' }}>
                            {new Date(log.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td style={s.td}>
                            <span style={{ fontSize: 11, fontWeight: 500, color: typeColor[log.event_type] || '#888' }}>
                              {EVENT_LABELS[log.event_type] || log.event_type}
                            </span>
                          </td>
                          <td style={s.td}>
                            <span style={{ ...s.badge, background: severityBg[log.severity] || severityBg.info, color: severityColor[log.severity] || severityColor.info }}>
                              {log.severity}
                            </span>
                          </td>
                          <td style={s.td}><span style={{ fontSize: 12, color: '#666' }}>{log.email || '—'}</span></td>
                          <td style={{ ...s.td, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ fontSize: 12, color: '#ccc' }}>{log.message}</span>
                          </td>
                          <td style={s.td}>
                            {log.metadata && <span style={{ fontSize: 10, color: '#444' }}>▶ expand</span>}
                          </td>
                        </tr>
                        {expandedLog === log.id && log.metadata && (
                          <tr style={{ background: '#0d0d0d' }}>
                            <td colSpan={6} style={{ padding: '10px 14px' }}>
                              <pre style={{ fontSize: 11, color: '#9d92f5', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )
      })()}
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
  planSelect: { padding: '3px 6px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: '#f0f0f0', fontSize: 11, outline: 'none', cursor: 'pointer' },
  inlineInput: { padding: '3px 6px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: '#f0f0f0', fontSize: 12, outline: 'none', width: 90 },
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
  dbInfoRow: { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' },
  dbLabel: { fontSize: 11, color: '#555', width: 70, flexShrink: 0 },
  dbVal: { fontSize: 12, color: '#888' },
}
