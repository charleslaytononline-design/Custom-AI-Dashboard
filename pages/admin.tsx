import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useMobile } from '../hooks/useMobile'
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import type { GetServerSidePropsContext } from 'next'
import { generateWelcomeHtml, DEFAULT_WELCOME_CONFIG } from '../lib/welcomeConfig'
import type { WelcomeConfig, WelcomeSection, SectionType } from '../lib/welcomeConfig'

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
  gift_balance: number
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
  lastLogin?: string
  giftedCredits?: number
  giftUsed?: number
  failedRequests?: number
  failedCost?: number
  stopRequests?: number
  stopCost?: number
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
  image_cost_per_gen: string
  stop_limit_per_hour: string
  max_images_per_build: string
}

// Verified pricing from official docs (March 2026) — per 1K tokens
const MODEL_PRICING: Record<string, { input_cost_per_1k: number; output_cost_per_1k: number }> = {
  'claude-opus-4-6':           { input_cost_per_1k: 0.005,  output_cost_per_1k: 0.025  },
  'claude-sonnet-4-6':         { input_cost_per_1k: 0.003,  output_cost_per_1k: 0.015  },
  'claude-sonnet-4-5':         { input_cost_per_1k: 0.003,  output_cost_per_1k: 0.015  },
  'claude-haiku-4-5-20251001': { input_cost_per_1k: 0.001,  output_cost_per_1k: 0.005  },
}

// Verified pricing from Replicate/BFL (March 2026) — per image
const IMAGE_MODEL_PRICING: Record<string, number> = {
  'black-forest-labs/flux-2-pro':   0.05,
  'black-forest-labs/flux-1.1-pro': 0.04,
  'black-forest-labs/flux-schnell': 0.003,
}

interface Role {
  id: string
  name: string
  description: string
  can_access_admin: boolean
  can_build: boolean
  can_create_projects: boolean
  is_system: boolean
}

interface PageAccess {
  id: string
  role_id: string
  page_path: string
  page_label: string
  can_access: boolean
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

interface ChatMessage {
  id: string
  user_id: string
  project_id: string
  page_id: string | null
  role: 'user' | 'assistant'
  content: string
  is_plan: boolean
  created_at: string
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
  const [settings, setSettings] = useState<Settings>({ markup_multiplier: '3.0', input_cost_per_1k: '0.003', output_cost_per_1k: '0.015', image_cost_per_gen: '0.05', stop_limit_per_hour: '5', max_images_per_build: '5' })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'users' | 'revenue' | 'settings' | 'plans' | 'database' | 'roles' | 'logs' | 'chat_history' | 'welcome' | 'actions' | 'ai_training' | 'security' | 'analytics' | 'themes'>('users')
  const [themesList, setThemesList] = useState<any[]>([])
  const [showThemeForm, setShowThemeForm] = useState(false)
  const [editingTheme, setEditingTheme] = useState<any>(null)
  const [themeForm, setThemeForm] = useState({
    name: '',
    is_available: true,
    colors: {
      bg: '#0f0f0f', bg2: '#1a1a1a', bg3: '#242424',
      border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
      text: '#ffffff', text2: '#c0c0c0', text3: '#909090',
      accent: '#7c6ef7', accent2: '#5b50d6',
      success: '#1D9E75', warning: '#BA7517', danger: '#A32D2D',
    },
  })
  const [analyticsData, setAnalyticsData] = useState<any>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d')
  const [giftUserId, setGiftUserId] = useState('')
  const [giftAmount, setGiftAmount] = useState('')
  const [giftMsg, setGiftMsg] = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalApiCost, setTotalApiCost] = useState(0)
  const [totalProfit, setTotalProfit] = useState(0)
  const [anthropicCostTotal, setAnthropicCostTotal] = useState(0)
  const [replicateCostTotal, setReplicateCostTotal] = useState(0)
  const [totalGifted, setTotalGifted] = useState(0)
  const [totalGiftUsed, setTotalGiftUsed] = useState(0)
  const [failedCostTotal, setFailedCostTotal] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [stoppedCostTotal, setStoppedCostTotal] = useState(0)
  const [stoppedCount, setStoppedCount] = useState(0)
  const [continuationTriggered, setContinuationTriggered] = useState(0)
  const [continuationCompleted, setContinuationCompleted] = useState(0)
  const [continuationFailed, setContinuationFailed] = useState(0)
  const [continuationCommands, setContinuationCommands] = useState(0)

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
  const [newRoleForm, setNewRoleForm] = useState<Omit<Role, 'id' | 'is_system'>>({ name: '', description: '', can_access_admin: false, can_build: true, can_create_projects: true })
  const [pageAccessMap, setPageAccessMap] = useState<PageAccess[]>([])
  const [showNewPage, setShowNewPage] = useState(false)
  const [newPagePath, setNewPagePath] = useState('')
  const [newPageLabel, setNewPageLabel] = useState('')
  const [securityNotes, setSecurityNotes] = useState('')
  const [securityEvents, setSecurityEvents] = useState<PlatformLog[]>([])
  const [suspiciousUsers, setSuspiciousUsers] = useState<{ email: string; reason: string; count: number }[]>([])
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
  const [logPage, setLogPage] = useState(0)
  const [logsPerPage, setLogsPerPage] = useState(20)
  const [expandedBuilderErrors, setExpandedBuilderErrors] = useState<Set<string>>(new Set())
  const [builderErrorPage, setBuilderErrorPage] = useState(0)
  const [builderErrorsPerPage, setBuilderErrorsPerPage] = useState(20)
  const [builderErrorSearch, setBuilderErrorSearch] = useState('')
  const [selectedBuilderErrors, setSelectedBuilderErrors] = useState<Set<string>>(new Set())
  const [builderErrorCardHeight, setBuilderErrorCardHeight] = useState(400)

  // Chat History state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatSearch, setChatSearch] = useState('')
  const [expandedChat, setExpandedChat] = useState<string | null>(null)
  const [chatUserFilter, setChatUserFilter] = useState('all')

  // AI Connections state
  const [aiChatModel, setAiChatModel] = useState('claude-sonnet-4-5')
  const [aiImageModel, setAiImageModel] = useState('black-forest-labs/flux-2-pro')
  // aiConnectionsSaving and aiConnectionsMsg removed — AI Connections merged into Settings tab

  // AI Training state
  interface TrainingRule { id: string; type: 'global' | 'keyword'; keywords: string | null; instructions: string; enabled: boolean; priority: number; created_at: string }
  const [trainingRules, setTrainingRules] = useState<TrainingRule[]>([])
  const [showNewRule, setShowNewRule] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [ruleForm, setRuleForm] = useState({ type: 'global' as 'global' | 'keyword', keywords: '', instructions: '', priority: 0 })
  const [trainingSaving, setTrainingSaving] = useState(false)
  const [trainingMsg, setTrainingMsg] = useState('')

  // Actions tab state
  const [actionsUserSearch, setActionsUserSearch] = useState('')
  const [actionsAuthData, setActionsAuthData] = useState<Array<{ id: string; email: string; email_confirmed_at: string | null; created_at: string; last_sign_in_at: string | null }>>([])
  const [actionsLoading, setActionsLoading] = useState<Record<string, boolean>>({})
  const [actionsMsg, setActionsMsg] = useState<Record<string, string>>({})
  const [actionsDataLoading, setActionsDataLoading] = useState(false)

  // Welcome page editor state
  const [welcomeConfig, setWelcomeConfig] = useState<WelcomeConfig>(DEFAULT_WELCOME_CONFIG)
  const [welcomeSaving, setWelcomeSaving] = useState(false)
  const [welcomeMsg, setWelcomeMsg] = useState('')
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [addSectionType, setAddSectionType] = useState<SectionType>('text')

  useEffect(() => {
    if (activeTab === 'actions') loadActionsData()
    if (activeTab === 'ai_training') loadTrainingRules()
    if (activeTab === 'analytics' && !analyticsData) loadAnalytics()
    if (activeTab === 'themes') loadThemes()
  }, [activeTab])

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
    await Promise.all([loadUsers(), loadSettings(), loadRevenue(), loadPlans(), loadRoles(), loadLogs(), loadChatHistory(), loadAlertSettings(), loadWelcomeConfig(), loadAiConnections(), loadSecurityData()])
    // Load page access after roles are loaded (needs role IDs)
    await loadPageAccess()
    setLoading(false)
  }

  async function loadAiConnections() {
    const { data } = await supabase.from('settings').select('key, value').in('key', ['ai_chat_model', 'ai_image_model'])
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((s: any) => { map[s.key] = s.value })
      if (map.ai_chat_model) setAiChatModel(map.ai_chat_model)
      if (map.ai_image_model) setAiImageModel(map.ai_image_model)
    }
  }

  // saveAiConnections removed — AI model saves are now part of saveSettings()

  async function loadTrainingRules() {
    const res = await fetch('/api/admin/ai-training')
    const data = await res.json()
    if (data.rules) setTrainingRules(data.rules)
  }

  async function saveTrainingRule() {
    setTrainingSaving(true)
    setTrainingMsg('')
    const method = editingRuleId ? 'PUT' : 'POST'
    const body = editingRuleId ? { id: editingRuleId, ...ruleForm } : ruleForm
    const res = await fetch('/api/admin/ai-training', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (data.error) { setTrainingMsg('Error: ' + data.error) }
    else { setTrainingMsg(editingRuleId ? '✓ Rule updated' : '✓ Rule created'); setShowNewRule(false); setEditingRuleId(null); setRuleForm({ type: 'global', keywords: '', instructions: '', priority: 0 }); loadTrainingRules() }
    setTrainingSaving(false)
    setTimeout(() => setTrainingMsg(''), 4000)
  }

  async function deleteTrainingRule(id: string) {
    if (!confirm('Delete this training rule?')) return
    await fetch('/api/admin/ai-training', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    loadTrainingRules()
  }

  async function toggleTrainingRule(id: string, enabled: boolean) {
    await fetch('/api/admin/ai-training', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled }) })
    loadTrainingRules()
  }

  async function loadActionsData() {
    setActionsDataLoading(true)
    const res = await fetch('/api/admin/users-auth')
    const data = await res.json()
    if (data.users) setActionsAuthData(data.users)
    setActionsDataLoading(false)
  }

  async function resendConfirmation(userId: string, email: string) {
    setActionsLoading(prev => ({ ...prev, [userId]: true }))
    const res = await fetch('/api/admin/resend-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, email }),
    })
    const data = await res.json()
    const msg = data.ok ? '✓ Confirmation email sent' : `Error: ${data.error}`
    setActionsMsg(prev => ({ ...prev, [userId]: msg }))
    setActionsLoading(prev => ({ ...prev, [userId]: false }))
    setTimeout(() => setActionsMsg(prev => { const n = { ...prev }; delete n[userId]; return n }), 6000)
  }

  async function forceConfirmEmail(userId: string) {
    setActionsLoading(prev => ({ ...prev, [userId + '_force']: true }))
    const res = await fetch('/api/admin/confirm-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    const msg = data.ok ? '✓ Email confirmed — user can now sign in' : `Error: ${data.error}`
    setActionsMsg(prev => ({ ...prev, [userId]: msg }))
    setActionsLoading(prev => ({ ...prev, [userId + '_force']: false }))
    if (data.ok) loadActionsData()
    setTimeout(() => setActionsMsg(prev => { const n = { ...prev }; delete n[userId]; return n }), 6000)
  }

  async function loadRoles() {
    const { data } = await supabase.from('roles').select('*').order('created_at')
    if (data) setRoles(data)
  }

  async function loadPageAccess() {
    const { data } = await supabase.from('role_page_access').select('*').order('page_path')
    if (data) {
      setPageAccessMap(data)
      // Seed default pages if table is empty
      if (data.length === 0 && roles.length > 0) {
        await seedDefaultPages()
      }
    }
  }

  async function seedDefaultPages() {
    const defaults = [
      { page_path: '/home', page_label: 'Projects Dashboard' },
      { page_path: '/profile', page_label: 'User Profile' },
      { page_path: '/project', page_label: 'Project Builder' },
      { page_path: '/admin', page_label: 'Admin Panel' },
    ]
    const inserts: { role_id: string; page_path: string; page_label: string; can_access: boolean }[] = []
    for (const role of roles) {
      for (const pg of defaults) {
        const canAccess = pg.page_path === '/admin' ? role.can_access_admin : true
        inserts.push({ role_id: role.id, page_path: pg.page_path, page_label: pg.page_label, can_access: canAccess })
      }
    }
    await supabase.from('role_page_access').insert(inserts)
    await loadPageAccess()
  }

  async function togglePageAccess(accessId: string, canAccess: boolean) {
    await supabase.from('role_page_access').update({ can_access: canAccess }).eq('id', accessId)
    setPageAccessMap(prev => prev.map(pa => pa.id === accessId ? { ...pa, can_access: canAccess } : pa))
  }

  async function registerNewPage() {
    if (!newPagePath.trim() || !newPageLabel.trim()) return
    const path = newPagePath.startsWith('/') ? newPagePath : '/' + newPagePath
    const inserts = roles.map(role => ({
      role_id: role.id,
      page_path: path,
      page_label: newPageLabel.trim(),
      can_access: role.can_access_admin || !path.startsWith('/admin'),
    }))
    await supabase.from('role_page_access').insert(inserts)
    setNewPagePath('')
    setNewPageLabel('')
    setShowNewPage(false)
    await loadPageAccess()
  }

  async function loadSecurityData() {
    // Load security events
    const securityTypes = ['login_failed', 'signup', 'password_reset_completed', 'password_reset_requested', 'credits_error', 'builder_failed_untracked', 'suspension_toggled', 'role_changed']
    const { data: events } = await supabase
      .from('platform_logs')
      .select('*')
      .in('event_type', securityTypes)
      .order('created_at', { ascending: false })
      .limit(100)
    if (events) setSecurityEvents(events)

    // Load security notes
    const { data: notesSetting } = await supabase.from('settings').select('value').eq('key', 'security_audit_notes').maybeSingle()
    if (notesSetting?.value) setSecurityNotes(notesSetting.value)

    // Detect suspicious activity from logs
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: recentLogs } = await supabase
      .from('platform_logs')
      .select('*')
      .in('event_type', ['login_failed', 'credits_error', 'builder_failed_untracked'])
      .gte('created_at', oneHourAgo)
    if (recentLogs) {
      const userCounts: Record<string, { email: string; failed_logins: number; credits_errors: number }> = {}
      for (const log of recentLogs) {
        const email = log.email || (log.metadata as any)?.email || 'unknown'
        if (!userCounts[email]) userCounts[email] = { email, failed_logins: 0, credits_errors: 0 }
        if (log.event_type === 'login_failed') userCounts[email].failed_logins++
        if (log.event_type === 'credits_error') userCounts[email].credits_errors++
      }
      const suspicious = Object.values(userCounts)
        .filter(u => u.failed_logins >= 3 || u.credits_errors >= 3)
        .map(u => ({
          email: u.email,
          reason: u.failed_logins >= 3 ? `${u.failed_logins} failed logins in last hour` : `${u.credits_errors} credit errors in last hour`,
          count: u.failed_logins + u.credits_errors,
        }))
      setSuspiciousUsers(suspicious)
    }
  }

  async function saveSecurityNotes(notes: string) {
    setSecurityNotes(notes)
    await supabase.from('settings').upsert({ key: 'security_audit_notes', value: notes, updated_at: new Date().toISOString() })
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true)
    try {
      const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, 'all': 3650 }
      const days = daysMap[analyticsPeriod] || 30
      const since = new Date(Date.now() - days * 86400_000).toISOString().split('T')[0]

      // Fetch usage_daily data
      const { data: usage } = await supabase
        .from('usage_daily')
        .select('*')
        .gte('date', since)
        .order('date', { ascending: false })

      // Fetch transactions for revenue
      const { data: txns } = await supabase
        .from('transactions')
        .select('user_id, amount, api_cost, type, tokens_used, created_at')
        .gte('created_at', new Date(Date.now() - days * 86400_000).toISOString())

      // Fetch user profiles for per-user breakdown
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, credit_balance, gift_balance, role, plan_id, created_at')

      // Fetch projects
      const { data: projects } = await supabase
        .from('projects')
        .select('id, name, user_id, project_type, db_provider, created_at')

      // Aggregate totals
      const totals = {
        builds: 0, tokensInput: 0, tokensOutput: 0,
        costAnthropic: 0, costReplicate: 0,
        images: 0, functionExecs: 0, cronExecs: 0,
        storageBytes: 0, rowsInserted: 0,
      }
      const dailyStats: Record<string, typeof totals> = {}
      const perUser: Record<string, typeof totals & { email: string; revenue: number; projects: number }> = {}
      const perProject: Record<string, typeof totals & { name: string; ownerEmail: string }> = {}

      for (const row of usage || []) {
        totals.builds += row.builds || 0
        totals.tokensInput += Number(row.tokens_input) || 0
        totals.tokensOutput += Number(row.tokens_output) || 0
        totals.costAnthropic += Number(row.api_cost_anthropic) || 0
        totals.costReplicate += Number(row.api_cost_replicate) || 0
        totals.images += row.images_generated || 0
        totals.functionExecs += row.function_executions || 0
        totals.cronExecs += row.cron_executions || 0
        totals.storageBytes += Number(row.storage_bytes_added) || 0
        totals.rowsInserted += row.rows_inserted || 0

        // Daily
        if (!dailyStats[row.date]) dailyStats[row.date] = { builds: 0, tokensInput: 0, tokensOutput: 0, costAnthropic: 0, costReplicate: 0, images: 0, functionExecs: 0, cronExecs: 0, storageBytes: 0, rowsInserted: 0 }
        dailyStats[row.date].builds += row.builds || 0
        dailyStats[row.date].costAnthropic += Number(row.api_cost_anthropic) || 0
        dailyStats[row.date].costReplicate += Number(row.api_cost_replicate) || 0

        // Per user
        if (row.user_id) {
          if (!perUser[row.user_id]) {
            const profile = (profiles || []).find((p: any) => p.id === row.user_id)
            perUser[row.user_id] = { ...{ builds: 0, tokensInput: 0, tokensOutput: 0, costAnthropic: 0, costReplicate: 0, images: 0, functionExecs: 0, cronExecs: 0, storageBytes: 0, rowsInserted: 0 }, email: profile?.email || 'unknown', revenue: 0, projects: 0 }
          }
          perUser[row.user_id].builds += row.builds || 0
          perUser[row.user_id].tokensInput += Number(row.tokens_input) || 0
          perUser[row.user_id].tokensOutput += Number(row.tokens_output) || 0
          perUser[row.user_id].costAnthropic += Number(row.api_cost_anthropic) || 0
          perUser[row.user_id].costReplicate += Number(row.api_cost_replicate) || 0
          perUser[row.user_id].images += row.images_generated || 0
        }

        // Per project
        if (row.project_id) {
          if (!perProject[row.project_id]) {
            const proj = (projects || []).find((p: any) => p.id === row.project_id)
            const owner = (profiles || []).find((p: any) => p.id === proj?.user_id)
            perProject[row.project_id] = { ...{ builds: 0, tokensInput: 0, tokensOutput: 0, costAnthropic: 0, costReplicate: 0, images: 0, functionExecs: 0, cronExecs: 0, storageBytes: 0, rowsInserted: 0 }, name: proj?.name || 'Unknown', ownerEmail: owner?.email || 'unknown' }
          }
          perProject[row.project_id].builds += row.builds || 0
          perProject[row.project_id].costAnthropic += Number(row.api_cost_anthropic) || 0
          perProject[row.project_id].tokensInput += Number(row.tokens_input) || 0
        }
      }

      // Revenue from transactions
      let totalRevenue = 0
      for (const tx of txns || []) {
        if (tx.type === 'purchase') totalRevenue += Number(tx.amount) || 0
        if (tx.user_id && perUser[tx.user_id] && tx.type === 'purchase') {
          perUser[tx.user_id].revenue += Number(tx.amount) || 0
        }
      }

      // Project counts per user
      for (const proj of projects || []) {
        if (proj.user_id && perUser[proj.user_id]) perUser[proj.user_id].projects++
      }

      const totalApiCost = totals.costAnthropic + totals.costReplicate
      setAnalyticsData({
        totals, dailyStats, perUser, perProject, totalRevenue, totalApiCost,
        profit: totalRevenue - totalApiCost,
        margin: totalRevenue > 0 ? ((totalRevenue - totalApiCost) / totalRevenue * 100) : 0,
        userCount: (profiles || []).length,
        projectCount: (projects || []).length,
      })
    } catch (err) {
      console.error('Analytics load error:', err)
    }
    setAnalyticsLoading(false)
  }

  async function loadLogs() {
    const { data } = await supabase
      .from('platform_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (data) setLogs(data)
  }

  async function loadChatHistory() {
    const { data } = await supabase
      .from('chat_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (data) setChatMessages(data)
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

  // Welcome page editor helpers
  async function loadWelcomeConfig() {
    const { data } = await supabase.from('settings').select('value').eq('key', 'welcome_page_config').maybeSingle()
    if (data?.value) {
      try { setWelcomeConfig(JSON.parse(data.value)) } catch {}
    }
  }

  async function saveWelcomeConfig() {
    setWelcomeSaving(true)
    await supabase.from('settings').upsert({ key: 'welcome_page_config', value: JSON.stringify(welcomeConfig), updated_at: new Date().toISOString() })
    setWelcomeSaving(false)
    setWelcomeMsg('Saved! New projects will use this page.')
    setTimeout(() => setWelcomeMsg(''), 4000)
  }

  function updateSection(id: string, patch: Partial<WelcomeSection>) {
    setWelcomeConfig(prev => ({ sections: prev.sections.map(s => s.id === id ? { ...s, ...patch } : s) }))
  }

  function moveSection(id: string, dir: -1 | 1) {
    setWelcomeConfig(prev => {
      const arr = [...prev.sections]
      const idx = arr.findIndex(s => s.id === id)
      const target = idx + dir
      if (target < 0 || target >= arr.length) return prev
      ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
      return { sections: arr }
    })
  }

  function removeSection(id: string) {
    setWelcomeConfig(prev => ({ sections: prev.sections.filter(s => s.id !== id) }))
    if (editingSectionId === id) setEditingSectionId(null)
  }

  function addSection() {
    const id = `section_${Date.now()}`
    const defaults: Record<SectionType, string> = {
      icon: '✨', title: 'New heading', subtitle: 'Supporting text here.',
      box: 'Highlighted tip or call-to-action.', text: 'New paragraph of text.',
    }
    setWelcomeConfig(prev => ({ sections: [...prev.sections, { id, type: addSectionType, content: defaults[addSectionType], visible: true }] }))
    setEditingSectionId(id)
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
    const giftedAmounts: Record<string, number> = {}
    const failedCounts: Record<string, number> = {}
    const failedCosts: Record<string, number> = {}
    const stopCounts: Record<string, number> = {}
    const stopCosts: Record<string, number> = {}

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
      if (t.type === 'gift') {
        giftedAmounts[t.user_id] = (giftedAmounts[t.user_id] || 0) + Math.abs(t.amount)
      }
      if (t.type === 'failed') {
        failedCounts[t.user_id] = (failedCounts[t.user_id] || 0) + 1
        failedCosts[t.user_id] = (failedCosts[t.user_id] || 0) + (t.api_cost || 0)
      }
      if (t.type === 'stopped') {
        stopCounts[t.user_id] = (stopCounts[t.user_id] || 0) + 1
        stopCosts[t.user_id] = (stopCosts[t.user_id] || 0) + (t.api_cost || 0)
      }
    })

    // Gift used = total gifted - current gift balances remaining
    const totalGiftBalanceRemaining = profiles.reduce((a: number, p: any) => a + (p.gift_balance || 0), 0)
    const totalGiftedInScope = Object.values(giftedAmounts).reduce((a, b) => a + b, 0)
    setTotalGiftUsed(Math.max(0, totalGiftedInScope - totalGiftBalanceRemaining))

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
      lastLogin: p.last_login || null,
      giftedCredits: p.gift_balance || 0,
      giftUsed: Math.max(0, (giftedAmounts[p.id] || 0) - (p.gift_balance || 0)),
      failedRequests: failedCounts[p.id] || 0,
      failedCost: failedCosts[p.id] || 0,
      stopRequests: stopCounts[p.id] || 0,
      stopCost: stopCosts[p.id] || 0,
    })))
  }

  async function loadSettings() {
    const { data } = await supabase.from('settings').select('*')
    if (data) {
      const map: Record<string, string> = {}
      data.forEach((s: any) => { map[s.key] = s.value })
      const defaults: Settings = { markup_multiplier: '3.0', input_cost_per_1k: '0.003', output_cost_per_1k: '0.015', image_cost_per_gen: '0.05', stop_limit_per_hour: '5', max_images_per_build: '5' }
      setSettings({ ...defaults, ...map as unknown as Settings })
    }
  }

  async function loadThemes() {
    const res = await fetch('/api/admin/themes')
    if (res.ok) {
      const data = await res.json()
      setThemesList(data.themes || [])
    }
  }

  async function saveTheme() {
    const body = editingTheme
      ? { id: editingTheme.id, name: themeForm.name, colors: themeForm.colors, is_available: themeForm.is_available }
      : { name: themeForm.name, colors: themeForm.colors, is_available: themeForm.is_available }
    const res = await fetch('/api/admin/themes', {
      method: editingTheme ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setShowThemeForm(false)
      setEditingTheme(null)
      loadThemes()
    }
  }

  async function deleteTheme(id: string) {
    if (!confirm('Delete this theme?')) return
    await fetch('/api/admin/themes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    loadThemes()
  }

  async function toggleThemeAvailability(id: string, current: boolean) {
    await fetch('/api/admin/themes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_available: !current }),
    })
    loadThemes()
  }

  function openEditTheme(t: any) {
    setEditingTheme(t)
    setThemeForm({ name: t.name, is_available: t.is_available, colors: { ...t.colors } })
    setShowThemeForm(true)
  }

  function openNewTheme() {
    setEditingTheme(null)
    setThemeForm({
      name: '',
      is_available: true,
      colors: {
        bg: '#0f0f0f', bg2: '#1a1a1a', bg3: '#242424',
        border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
        text: '#ffffff', text2: '#c0c0c0', text3: '#909090',
        accent: '#7c6ef7', accent2: '#5b50d6',
        success: '#1D9E75', warning: '#BA7517', danger: '#A32D2D',
      },
    })
    setShowThemeForm(true)
  }

  async function loadRevenue() {
    const { data } = await supabase.from('transactions').select('amount, api_cost, type, description')
    if (!data) return
    let revenue = 0, anthropicTotal = 0, replicateTotal = 0, giftTotal = 0
    let failedTotal = 0, failedCnt = 0
    let stoppedTotal = 0, stoppedCnt = 0
    let contTriggered = 0, contCompleted = 0, contFailed = 0
    data.forEach((t: any) => {
      if (t.type === 'usage') {
        revenue += Math.abs(t.amount)
        const isImage = (t.description || '').toLowerCase().includes('image')
        if (isImage) replicateTotal += (t.api_cost || 0)
        else anthropicTotal += (t.api_cost || 0)
        // Count successful builds that used continuations
        if ((t.description || '').includes('continued')) contCompleted++
      }
      if (t.type === 'gift') giftTotal += Math.abs(t.amount)
      if (t.type === 'failed') { failedTotal += (t.api_cost || 0); failedCnt++ }
      if (t.type === 'stopped') { stoppedTotal += (t.api_cost || 0); stoppedCnt++ }
      if (t.type === 'continuation') contTriggered++
    })
    // Failed builds that had continuations
    contFailed = data.filter((t: any) => t.type === 'failed' && (t.description || '').includes('Build failed')).length
    setTotalRevenue(revenue)
    setTotalApiCost(anthropicTotal + replicateTotal)
    setTotalGifted(giftTotal)
    setTotalProfit(revenue - anthropicTotal - replicateTotal)
    setAnthropicCostTotal(anthropicTotal)
    setReplicateCostTotal(replicateTotal)
    setFailedCostTotal(failedTotal)
    setFailedCount(failedCnt)
    setStoppedCostTotal(stoppedTotal)
    setStoppedCount(stoppedCnt)
    setContinuationTriggered(contTriggered)
    setContinuationCompleted(contCompleted)
    setContinuationFailed(contFailed)
    setContinuationCommands(contCompleted + contFailed)
  }

  async function saveSettings() {
    setSavingSettings(true)
    const allSettings: Record<string, string> = {
      ...settings,
      ai_chat_model: aiChatModel,
      ai_image_model: aiImageModel,
    }
    for (const [key, value] of Object.entries(allSettings)) {
      await supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    }
    setSavingSettings(false)
    alert('Settings saved! Changes apply to the next build or image generation.')
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
    const { error } = await supabase.from('roles').update({ name: role.name, description: role.description, can_access_admin: role.can_access_admin, can_build: role.can_build, can_create_projects: role.can_create_projects }).eq('id', role.id)
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
    setNewRoleForm({ name: '', description: '', can_access_admin: false, can_build: true, can_create_projects: true })
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
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  function getPlanName(planId: string | null | undefined) {
    if (!planId) return 'Free'
    return plans.find(p => p.id === planId)?.name || 'Free'
  }

  const isMobile = useMobile()
  const giftRemaining = users.reduce((a, u) => a + (u.gift_balance || 0), 0)
  const realRevenue = totalRevenue - totalGiftUsed
  const actualProfit = realRevenue - totalApiCost - failedCostTotal - stoppedCostTotal
  const margin = realRevenue > 0 ? ((actualProfit / realRevenue) * 100).toFixed(1) : '0'
  const filtered = users.filter(u => u.email.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <div style={s.loadingInner}>Loading...</div>

  return (
    <div style={s.main}>
      <div style={{ ...s.topbar, padding: isMobile ? '16px 16px 0' : '24px 28px 0' }}>
        <div>
          <h1 style={s.title}>Admin Panel</h1>
          <p style={s.sub}>{users.length} users · {users.reduce((a, u) => a + u.projectCount!, 0)} projects</p>
        </div>
      </div>

      {/* REVENUE STATS */}
      <div style={{ ...s.statsGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', marginBottom: 12 }}>
        <div style={s.statCard}>
          <div style={s.statLabel}>Total Revenue</div>
          <div style={s.statVal}>${totalRevenue.toFixed(2)}</div>
          <div style={s.statSub}>real: ${realRevenue.toFixed(2)} / gift: ${totalGiftUsed.toFixed(2)}</div>
        </div>
        <div style={s.statCard}>
          <div style={s.statLabel}>Your Profit</div>
          <div style={{ ...s.statVal, color: '#5DCAA5' }}>${actualProfit.toFixed(2)}</div>
          <div style={s.statSub}>{margin}% margin{totalGiftUsed > 0 ? ` · -$${totalGiftUsed.toFixed(2)} gift excluded` : ''}{failedCostTotal > 0 ? ` · -$${failedCostTotal.toFixed(2)} failed costs` : ''}{stoppedCostTotal > 0 ? ` · -$${stoppedCostTotal.toFixed(2)} stop costs` : ''}</div>
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
        <div style={{ ...s.statCard, border: '1px solid rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.05)' }}>
          <div style={{ ...s.statLabel, color: '#fbbf24' }}>Gifted Credits</div>
          <div style={{ ...s.statVal, color: '#fbbf24', fontSize: 18 }}>${totalGifted.toFixed(2)} <span style={{ color: 'var(--text-2)', fontSize: 13 }}>/</span> <span style={{ color: '#5DCAA5' }}>${giftRemaining.toFixed(2)}</span> <span style={{ color: 'var(--text-2)', fontSize: 13 }}>/</span> <span style={{ color: '#f87171' }}>${totalGiftUsed.toFixed(2)}</span></div>
          <div style={s.statSub}>gifted / remaining / used</div>
        </div>
      </div>
      <div style={{ ...s.statsGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)' }}>
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
      <div style={{ ...s.statsGrid, gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', marginBottom: 0 }}>
        <div style={{ ...s.statCard, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)' }}>
          <div style={{ ...s.statLabel, color: '#f87171' }}>Failed Requests</div>
          <div style={{ ...s.statVal, color: '#f87171', fontSize: 18 }}>${failedCostTotal.toFixed(4)}</div>
          <div style={s.statSub}>{failedCount} failed API calls not charged to users</div>
        </div>
        <div style={{ ...s.statCard, border: '1px solid rgba(192,132,252,0.2)', background: 'rgba(192,132,252,0.05)' }}>
          <div style={{ ...s.statLabel, color: '#c084fc' }}>Stop Costs</div>
          <div style={{ ...s.statVal, color: '#c084fc', fontSize: 18 }}>${stoppedCostTotal.toFixed(4)}</div>
          <div style={s.statSub}>{stoppedCount} stopped builds not charged to users</div>
        </div>
        <div style={{ ...s.statCard, border: '1px solid rgba(251,146,60,0.2)', background: 'rgba(251,146,60,0.05)' }}>
          <div style={{ ...s.statLabel, color: '#fb923c' }}>Continuations</div>
          <div style={{ ...s.statVal, color: '#fb923c', fontSize: 18 }}>
            {continuationTriggered} <span style={{ color: 'var(--text-2)', fontSize: 13 }}>triggered</span>
            {' / '}
            <span style={{ color: '#60a5fa' }}>{continuationCommands}</span> <span style={{ color: 'var(--text-2)', fontSize: 13 }}>commands</span>
            {' / '}
            <span style={{ color: '#f87171' }}>{continuationFailed}</span> <span style={{ color: 'var(--text-2)', fontSize: 13 }}>failed</span>
            {' / '}
            <span style={{ color: '#5DCAA5' }}>{continuationCompleted}</span> <span style={{ color: 'var(--text-2)', fontSize: 13 }}>completed</span>
          </div>
          <div style={s.statSub}>builds that needed multiple API calls due to time limits</div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ ...s.tabRow, flexWrap: 'wrap' as const }}>
        {(['users', 'revenue', 'settings', 'plans', 'database', 'roles', 'logs', 'chat_history', 'welcome', 'ai_training', 'actions', 'security', 'analytics', 'themes'] as const).map(tab => (
          <button key={tab} style={{ ...s.tabBtn, ...(activeTab === tab ? s.tabBtnOn : {}) }} onClick={() => setActiveTab(tab)}>
            {tab === 'ai_training' ? 'AI Training' : tab === 'chat_history' ? 'Chat History' : tab === 'security' ? 'Security Audit' : tab === 'analytics' ? '📊 Analytics' : tab === 'themes' ? '🎨 Themes' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* USERS TAB */}
      {activeTab === 'users' && (
        <div style={{ ...s.section, padding: isMobile ? '12px 16px 24px' : '16px 28px 28px' }}>
          <div style={{ ...s.tableTop, flexDirection: isMobile ? 'column' : 'row' as const, alignItems: isMobile ? 'flex-start' : 'center', gap: 10 }}>
            <h2 style={s.sectionTitle}>All Users</h2>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by email..." style={{ ...s.searchInput, width: isMobile ? '100%' : 220 }} />
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr style={s.thead}>
                  <th style={s.th}>User</th>
                  <th style={s.th}>Role</th>
                  <th style={s.th}>Plan</th>
                  <th style={s.th}>Credits</th>
                  <th style={{ ...s.th, color: '#fbbf24' }}>Gift Credits</th>
                  <th style={s.th}>Projects</th>
                  <th style={s.th}>Pages</th>
                  <th style={s.th}>Messages</th>
                  <th style={{ ...s.th, color: '#fbbf24' }}>Gift Spend</th>
                  <th style={s.th}>Total Spend</th>
                  <th style={{ ...s.th, color: '#818cf8' }}>Anthropic Cost</th>
                  <th style={{ ...s.th, color: '#2dd4bf' }}>Replicate Cost</th>
                  <th style={s.th}>Tokens</th>
                  <th style={s.th}>Images</th>
                  <th style={s.th}>Profit</th>
                  <th style={{ ...s.th, color: '#fb923c' }}>Failed</th>
                  <th style={{ ...s.th, color: '#f87171' }}>Failed $</th>
                  <th style={{ ...s.th, color: '#c084fc' }}>Stopped</th>
                  <th style={{ ...s.th, color: '#c084fc' }}>Stop $</th>
                  <th style={s.th}>Last Active</th>
                  <th style={s.th}>Last Login</th>
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
                        <span style={{ fontSize: 13, color: 'var(--text)' }}>{u.email}</span>
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
                    <td style={s.td}><span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 500 }}>${(u.giftedCredits || 0).toFixed(2)}</span></td>
                    <td style={s.td}><span style={s.num}>{u.projectCount}</span></td>
                    <td style={s.td}><span style={s.num}>{u.pageCount}</span></td>
                    <td style={s.td}><span style={s.num}>{(u.messageCount || 0).toLocaleString()}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#fbbf24' }}>${(u.giftUsed || 0).toFixed(2)}</span></td>
                    <td style={s.td}><span style={s.num}>${((u.totalSpend || 0) - (u.giftUsed || 0)).toFixed(2)}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#f09595' }}>${(u.anthropicCost || 0).toFixed(4)}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#2dd4bf' }}>${(u.replicateCost || 0).toFixed(4)}</span></td>
                    <td style={s.td}><span style={s.num}>{(u.tokenCount || 0).toLocaleString()}</span></td>
                    <td style={s.td}><span style={s.num}>{u.imageCount || 0}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#5DCAA5' }}>${(((u.totalSpend || 0) - (u.giftUsed || 0)) - (u.anthropicCost || 0) - (u.replicateCost || 0) - (u.failedCost || 0) - (u.stopCost || 0)).toFixed(4)}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#fb923c' }}>{u.failedRequests || 0}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#f87171' }}>${(u.failedCost || 0).toFixed(4)}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#c084fc' }}>{u.stopRequests || 0}</span></td>
                    <td style={s.td}><span style={{ ...s.num, color: '#c084fc' }}>${(u.stopCost || 0).toFixed(4)}</span></td>
                    <td style={s.td}><span style={s.num}>{formatDate(u.lastActive)}</span></td>
                    <td style={s.td}><span style={s.num}>{formatDate(u.lastLogin)}</span></td>
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
            <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 16 }}>Give a user free credits. This appears as a "gift" transaction in their history.</p>
            <div style={{ ...s.giftRow, flexDirection: isMobile ? 'column' : 'row' as const }}>
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
          {/* AI Model Selection (moved from AI Connections tab) */}
          <h2 style={s.sectionTitle}>AI Model Selection</h2>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -10, marginBottom: 16 }}>Choose which AI models power your platform. Changing a model auto-updates the pricing fields below.</p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 24 }}>
            {/* Chat / Text model */}
            <div style={{ ...s.settingsCard, border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🤖</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Chat / Text Model</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Anthropic — powers the AI builder</div>
                </div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Model</label>
                <select value={aiChatModel} onChange={e => {
                  const model = e.target.value
                  setAiChatModel(model)
                  const pricing = MODEL_PRICING[model]
                  if (pricing) {
                    setSettings(prev => ({
                      ...prev,
                      input_cost_per_1k: String(pricing.input_cost_per_1k),
                      output_cost_per_1k: String(pricing.output_cost_per_1k),
                    }))
                  }
                }} style={{ ...s.select, marginBottom: 12 }}>
                  <optgroup label="Claude 4.6">
                    <option value="claude-opus-4-6">claude-opus-4-6 — most capable, slowest</option>
                    <option value="claude-sonnet-4-6">claude-sonnet-4-6 — best balance (recommended)</option>
                  </optgroup>
                  <optgroup label="Claude 4.5">
                    <option value="claude-sonnet-4-5">claude-sonnet-4-5 — fast, capable</option>
                    <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 — fastest, cheapest</option>
                  </optgroup>
                </select>
                <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 8, fontSize: 11, color: '#9d92f5', lineHeight: 1.6 }}>
                  <strong>Current:</strong> {aiChatModel}<br />
                  <strong>Input:</strong> ${MODEL_PRICING[aiChatModel]?.input_cost_per_1k ?? '?'}/1K tokens | <strong>Output:</strong> ${MODEL_PRICING[aiChatModel]?.output_cost_per_1k ?? '?'}/1K tokens
                </div>
              </div>
            </div>

            {/* Image model */}
            <div style={{ ...s.settingsCard, border: '1px solid rgba(20,184,166,0.2)', background: 'rgba(20,184,166,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(20,184,166,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎨</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Image Generation Model</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Replicate — generates images in built apps</div>
                </div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Model</label>
                <select value={aiImageModel} onChange={e => {
                  const model = e.target.value
                  setAiImageModel(model)
                  const cost = IMAGE_MODEL_PRICING[model]
                  if (cost !== undefined) {
                    setSettings(prev => ({
                      ...prev,
                      image_cost_per_gen: String(cost),
                    }))
                  }
                }} style={{ ...s.select, marginBottom: 12 }}>
                  <optgroup label="Black Forest Labs (Flux)">
                    <option value="black-forest-labs/flux-2-pro">flux-2-pro — highest quality (recommended)</option>
                    <option value="black-forest-labs/flux-1.1-pro">flux-1.1-pro — reliable fallback</option>
                    <option value="black-forest-labs/flux-schnell">flux-schnell — fastest, cheapest</option>
                  </optgroup>
                </select>
                <div style={{ padding: '10px 14px', background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.15)', borderRadius: 8, fontSize: 11, color: '#2dd4bf', lineHeight: 1.6 }}>
                  <strong>Current:</strong> {aiImageModel}<br />
                  <strong>Cost per image:</strong> ${IMAGE_MODEL_PRICING[aiImageModel] ?? '?'}
                </div>
              </div>
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(240,169,82,0.07)', border: '1px solid rgba(240,169,82,0.15)', borderRadius: 7, fontSize: 11, color: '#f0a952', lineHeight: 1.5 }}>
                ⚡ <strong>Auto-fallback enabled:</strong> If flux-2-pro fails due to an SSL or network error on Replicate's servers, the platform will automatically retry with flux-1.1-pro and log the fallback.
              </div>
            </div>
          </div>

          {/* API Keys Info */}
          <div style={{ ...s.settingsCard, marginBottom: 24, background: 'rgba(255,255,255,0.02)' }}>
            <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)', marginBottom: 12 }}>How to add your own API keys</h3>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7 }}>
              <div>
                <div style={{ color: '#9d92f5', fontWeight: 500, marginBottom: 4 }}>Anthropic (Chat)</div>
                Set <code style={{ color: 'var(--text)', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>ANTHROPIC_API_KEY</code> in your Vercel environment variables. Get a key at console.anthropic.com.
              </div>
              <div>
                <div style={{ color: '#2dd4bf', fontWeight: 500, marginBottom: 4 }}>Replicate (Images)</div>
                Set <code style={{ color: 'var(--text)', background: 'var(--bg-3)', padding: '1px 5px', borderRadius: 3 }}>REPLICATE_API_TOKEN</code> in your Vercel environment variables. Get a token at replicate.com/account/api-tokens.
              </div>
            </div>
          </div>

          {/* Pricing Settings */}
          <h2 style={s.sectionTitle}>Pricing Settings</h2>
          <div style={s.settingsCard}>
            <div style={{ ...s.settingsGrid, gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr) repeat(2, 1fr)' }}>
              <div style={s.field}>
                <label style={s.label}>Markup Multiplier</label>
                <p style={s.fieldDesc}>How much to charge users vs what the AI costs you. 3x = 66% margin.</p>
                <input type="number" value={settings.markup_multiplier} onChange={e => setSettings(p => ({ ...p, markup_multiplier: e.target.value }))} style={s.input} step="0.1" min="1" />
                <div style={s.previewBox}>
                  At {settings.markup_multiplier}x: You pay $0.01 → User pays ${(0.01 * parseFloat(settings.markup_multiplier || '1')).toFixed(3)} → Your profit: ${(0.01 * parseFloat(settings.markup_multiplier || '1') - 0.01).toFixed(3)} ({((1 - 1 / parseFloat(settings.markup_multiplier || '1')) * 100).toFixed(0)}% margin)
                </div>
              </div>
              <div style={s.field}>
                <label style={s.label}>Input Cost per 1K tokens ($) — {aiChatModel}</label>
                <p style={s.fieldDesc}>Default for {aiChatModel}: ${MODEL_PRICING[aiChatModel]?.input_cost_per_1k ?? '?'}</p>
                <input type="number" value={settings.input_cost_per_1k} onChange={e => setSettings(p => ({ ...p, input_cost_per_1k: e.target.value }))} style={s.input} step="0.001" min="0" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Output Cost per 1K tokens ($) — {aiChatModel}</label>
                <p style={s.fieldDesc}>Default for {aiChatModel}: ${MODEL_PRICING[aiChatModel]?.output_cost_per_1k ?? '?'}</p>
                <input type="number" value={settings.output_cost_per_1k} onChange={e => setSettings(p => ({ ...p, output_cost_per_1k: e.target.value }))} style={s.input} step="0.001" min="0" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Image Cost per Generation ($) — {aiImageModel.split('/').pop()}</label>
                <p style={s.fieldDesc}>Default for {aiImageModel.split('/').pop()}: ${IMAGE_MODEL_PRICING[aiImageModel] ?? '?'}</p>
                <input type="number" value={settings.image_cost_per_gen} onChange={e => setSettings(p => ({ ...p, image_cost_per_gen: e.target.value }))} style={s.input} step="0.001" min="0" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Stop Button Limit (per hour)</label>
                <p style={s.fieldDesc}>Max times a user can stop a build per hour without being charged. After this limit, stopped builds are charged normally. Default: 5</p>
                <input type="number" value={settings.stop_limit_per_hour} onChange={e => setSettings(p => ({ ...p, stop_limit_per_hour: e.target.value }))} style={s.input} step="1" min="1" />
              </div>
              <div style={s.field}>
                <label style={s.label}>Max Images per Build</label>
                <p style={s.fieldDesc}>Maximum AI-generated images per single build. Each image costs ${settings.image_cost_per_gen}. Default: 5</p>
                <input type="number" value={settings.max_images_per_build} onChange={e => setSettings(p => ({ ...p, max_images_per_build: e.target.value }))} style={s.input} step="1" min="1" max="10" />
              </div>
            </div>
            <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 7, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
              💡 Prices auto-populate when you change the model above. You can override them manually. Verify at <a href="https://anthropic.com/pricing" target="_blank" style={{ color: '#9d92f5' }}>anthropic.com/pricing</a> and <a href="https://replicate.com/pricing" target="_blank" style={{ color: '#2dd4bf' }}>replicate.com/pricing</a>
            </div>
            <div style={s.marginPreview}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Margin Preview</h3>
              {[5, 10, 25, 50].map(spend => {
                const apiCost = spend / parseFloat(settings.markup_multiplier || '3')
                const profit = spend - apiCost
                const margin = ((profit / spend) * 100).toFixed(0)
                return (
                  <div key={spend} style={s.marginRow}>
                    <span style={{ color: 'var(--text-2)', fontSize: 13 }}>User spends ${spend}</span>
                    <span style={{ color: '#f09595', fontSize: 13 }}>API cost: ${apiCost.toFixed(2)}</span>
                    <span style={{ color: '#5DCAA5', fontSize: 13 }}>Your profit: ${profit.toFixed(2)} ({margin}%)</span>
                  </div>
                )
              })}
              <div style={{ ...s.marginRow, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
                <span style={{ color: 'var(--text-2)', fontSize: 13 }}>1 image generation</span>
                <span style={{ color: '#f09595', fontSize: 13 }}>API cost: ${parseFloat(settings.image_cost_per_gen || '0.05').toFixed(3)}</span>
                <span style={{ color: '#5DCAA5', fontSize: 13 }}>User pays: ${(parseFloat(settings.image_cost_per_gen || '0.05') * parseFloat(settings.markup_multiplier || '3')).toFixed(3)}</span>
              </div>
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
            <div style={{ display: 'flex', gap: 8 }}>
              {users.some(u => !u.plan_id) && (
                <button
                  onClick={async () => {
                    if (!confirm(`Assign the Free plan to ${users.filter(u => !u.plan_id).length} users with no plan?`)) return
                    const r = await fetch('/api/admin/backfill-free-plan', { method: 'POST' })
                    const d = await r.json()
                    if (d.ok) {
                      setPlanMsg(`Assigned Free plan to ${d.usersUpdated} users`)
                      loadUsers()
                    } else {
                      setPlanMsg('Error: ' + (d.error || 'Unknown'))
                    }
                    setTimeout(() => setPlanMsg(''), 4000)
                  }}
                  style={{ ...s.saveBtn, background: '#c97a2a' }}
                >
                  Assign Free Plan to {users.filter(u => !u.plan_id).length} unassigned users
                </button>
              )}
              <button onClick={() => { setShowNewPlan(true); setEditingPlan(null) }} style={s.saveBtn}>+ New Plan</button>
            </div>
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
                        <td style={s.td}><span style={s.num}>{users.filter(u => u.plan_id === plan.id || (plan.price_monthly === 0 && !u.plan_id)).length}</span></td>
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
                        <td style={s.td}><span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{plan.name}</span></td>
                        <td style={s.td}><span style={{ fontSize: 13, color: plan.price_monthly === 0 ? 'var(--text-2)' : '#5DCAA5' }}>{plan.price_monthly === 0 ? 'Free' : `$${plan.price_monthly}`}</span></td>
                        <td style={s.td}><span style={s.num}>${plan.ai_credits_monthly.toFixed(2)}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_projects}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_tables_per_project}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_rows_per_table.toLocaleString()}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_storage_mb} MB</span></td>
                        <td style={s.td}><span style={{ ...s.badge, ...(plan.can_connect_own_supabase ? s.badgeGreen : s.badgeGray) }}>{plan.can_connect_own_supabase ? 'Yes' : 'No'}</span></td>
                        <td style={s.td}><span style={s.num}>{plan.max_builds_per_month === -1 ? '∞' : plan.max_builds_per_month}</span></td>
                        <td style={s.td}><span style={s.num}>{users.filter(u => u.plan_id === plan.id || (plan.price_monthly === 0 && !u.plan_id)).length}</span></td>
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
              <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 16 }}>New Plan</h3>
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
                  <span style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>-1 = unlimited</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={newPlan.can_connect_own_supabase} onChange={e => setNewPlan(p => ({ ...p, can_connect_own_supabase: e.target.checked }))} />
                  Allow own Supabase connection
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>
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
                <button onClick={() => setShowNewPlan(false)} style={{ ...s.saveBtn, background: 'var(--bg-3)' }}>Cancel</button>
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
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>App Database</span>
                <span style={{ ...s.badge, ...s.badgeGreen }}>Connected</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Stores user auth, profiles, projects, pages, transactions, chat history</div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Provider</span><span style={s.dbVal}>Supabase</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Tables</span><span style={s.dbVal}>profiles · projects · pages · transactions · settings · plans · chat_history</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>Users</span><span style={s.dbVal}>{users.length} accounts</span></div>
              <div style={s.dbInfoRow}><span style={s.dbLabel}>RLS</span><span style={{ ...s.badge, ...s.badgeGreen }}>Enabled</span></div>
            </div>

            {/* Clients DB */}
            <div style={{ ...s.settingsCard, border: `1px solid ${clientsDbStatus === 'connected' ? 'rgba(20,184,166,0.2)' : clientsDbStatus === 'checking' ? 'var(--border)' : 'rgba(163,45,45,0.2)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: clientsDbStatus === 'connected' ? '#5DCAA5' : clientsDbStatus === 'checking' ? 'var(--text-3)' : '#f09595' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Clients Database</span>
                <span style={{ ...s.badge, ...(clientsDbStatus === 'connected' ? s.badgeGreen : clientsDbStatus === 'checking' ? s.badgeGray : s.badgeRed) }}>
                  {clientsDbStatus === 'connected' ? 'Connected' : clientsDbStatus === 'checking' ? 'Checking...' : 'Not connected'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>Stores user-generated app data (schemas, tables, rows) in isolated per-project schemas</div>
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
          <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Plan Limits Overview</h3>
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
                    <td style={s.td}><span style={{ fontSize: 13, fontWeight: 500, color: plan.is_active ? 'var(--text)' : 'var(--text-3)' }}>{plan.name}{!plan.is_active && ' (hidden)'}</span></td>
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
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>Edit limits in the Plans tab. Changes apply immediately to new usage checks.</p>
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
                        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{role.name}</span>
                        {role.is_system && <span style={{ ...s.badge, ...s.badgeGray, fontSize: 9 }}>🔒 system</span>}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>{role.description || 'No description'}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
                        {role.can_access_admin && <span style={{ ...s.badge, ...s.badgePurple }}>Admin Panel</span>}
                        {role.can_build && <span style={{ ...s.badge, ...s.badgeGreen }}>Can Build</span>}
                        {role.can_create_projects && <span style={{ ...s.badge, ...s.badgeGreen }}>Create Projects</span>}
                        {!role.can_build && !role.can_create_projects && !role.can_access_admin && (
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
                <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 16 }}>
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
                    ] as [keyof Omit<Role, 'id' | 'name' | 'description' | 'is_system'>, string][]).map(([key, label]) => {
                      const checked = editingRole ? editingRole[key] as boolean : newRoleForm[key] as boolean
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: 'var(--text-2)' }}>
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
                    <button onClick={() => { setEditingRole(null); setShowNewRole(false) }} style={{ ...s.saveBtn, background: 'var(--bg-3)' }}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Page Access Management */}
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Page Access by Role</h3>
              <button onClick={() => setShowNewPage(true)} style={{ ...s.actionBtn, ...s.actionPurple, fontSize: 11, padding: '6px 12px' }}>+ Register New Page</button>
            </div>

            {showNewPage && (
              <div style={{ ...s.settingsCard, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>Page Path</label>
                  <input style={s.input} value={newPagePath} onChange={e => setNewPagePath(e.target.value)} placeholder="/reports" />
                </div>
                <div style={{ ...s.field, flex: 1 }}>
                  <label style={s.label}>Page Label</label>
                  <input style={s.input} value={newPageLabel} onChange={e => setNewPageLabel(e.target.value)} placeholder="Reports Dashboard" />
                </div>
                <button onClick={registerNewPage} style={s.saveBtn}>Add</button>
                <button onClick={() => setShowNewPage(false)} style={{ ...s.saveBtn, background: 'var(--bg-3)' }}>Cancel</button>
              </div>
            )}

            {(() => {
              const uniquePaths = Array.from(new Set(pageAccessMap.map(pa => pa.page_path))).sort()
              if (uniquePaths.length === 0) return <p style={{ fontSize: 12, color: 'var(--text-3)' }}>No pages registered yet. Click "+ Register New Page" to add pages, or they will be seeded automatically on next load.</p>
              return (
                <div style={{ overflowX: 'auto' }}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Role</th>
                        {uniquePaths.map(path => {
                          const label = pageAccessMap.find(pa => pa.page_path === path)?.page_label || path
                          return <th key={path} style={{ ...s.th, textAlign: 'center' as const }}>{label}</th>
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {roles.map(role => (
                        <tr key={role.id}>
                          <td style={s.td}><span style={{ fontSize: 12, color: 'var(--text)' }}>{role.name}</span></td>
                          {uniquePaths.map(path => {
                            const access = pageAccessMap.find(pa => pa.role_id === role.id && pa.page_path === path)
                            return (
                              <td key={path} style={{ ...s.td, textAlign: 'center' as const }}>
                                {access ? (
                                  <input
                                    type="checkbox"
                                    checked={access.can_access}
                                    onChange={e => togglePageAccess(access.id, e.target.checked)}
                                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c6ef7' }}
                                  />
                                ) : <span style={{ color: 'var(--text-3)' }}>-</span>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* SECURITY AUDIT TAB */}
      {activeTab === 'security' && (
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Security Audit</h2>

          {/* System Health */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            <div style={s.settingsCard}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Clients DB</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: clientsDbStatus === 'connected' ? '#5DCAA5' : clientsDbStatus === 'error' ? '#f09595' : 'var(--text-2)' }}>
                {clientsDbStatus === 'connected' ? 'Connected' : clientsDbStatus === 'error' ? 'Error' : 'Checking...'}
              </div>
            </div>
            <div style={s.settingsCard}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Total Users</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{users.length}</div>
            </div>
            <div style={s.settingsCard}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Active Roles</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{roles.length}</div>
            </div>
            <div style={s.settingsCard}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>Suspicious Activity</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: suspiciousUsers.length > 0 ? '#f09595' : '#5DCAA5' }}>
                {suspiciousUsers.length > 0 ? `${suspiciousUsers.length} alerts` : 'None detected'}
              </div>
            </div>
          </div>

          {/* Suspicious Activity Alerts */}
          {suspiciousUsers.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 14, fontWeight: 500, color: '#f09595', marginBottom: 12 }}>Suspicious Activity (Last Hour)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {suspiciousUsers.map((su, i) => (
                  <div key={i} style={{ ...s.settingsCard, borderColor: 'rgba(163,45,45,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div>
                      <span style={{ fontSize: 13, color: 'var(--text)' }}>{su.email}</span>
                      <span style={{ fontSize: 11, color: '#f09595', marginLeft: 12 }}>{su.reason}</span>
                    </div>
                    <span style={{ ...s.badge, ...s.badgeRed }}>{su.count} events</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Access Matrix */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Role Access Overview</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Role</th>
                    <th style={{ ...s.th, textAlign: 'center' as const }}>Admin Panel</th>
                    <th style={{ ...s.th, textAlign: 'center' as const }}>Build with AI</th>
                    <th style={{ ...s.th, textAlign: 'center' as const }}>Create Projects</th>
                    <th style={{ ...s.th, textAlign: 'center' as const }}>System Role</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map(role => (
                    <tr key={role.id}>
                      <td style={s.td}><span style={{ fontSize: 12, color: 'var(--text)' }}>{role.name}</span></td>
                      <td style={{ ...s.td, textAlign: 'center' as const }}><span style={{ color: role.can_access_admin ? '#5DCAA5' : '#f09595' }}>{role.can_access_admin ? '✓' : '✗'}</span></td>
                      <td style={{ ...s.td, textAlign: 'center' as const }}><span style={{ color: role.can_build ? '#5DCAA5' : '#f09595' }}>{role.can_build ? '✓' : '✗'}</span></td>
                      <td style={{ ...s.td, textAlign: 'center' as const }}><span style={{ color: role.can_create_projects ? '#5DCAA5' : '#f09595' }}>{role.can_create_projects ? '✓' : '✗'}</span></td>
                      <td style={{ ...s.td, textAlign: 'center' as const }}><span style={{ color: role.is_system ? '#f0a952' : 'var(--text-3)' }}>{role.is_system ? '🔒' : '-'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Security Events */}
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Security Events (Recent 100)</h3>
            <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Time</th>
                    <th style={s.th}>Event</th>
                    <th style={s.th}>Severity</th>
                    <th style={s.th}>Email</th>
                    <th style={s.th}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {securityEvents.map(event => (
                    <tr key={event.id}>
                      <td style={s.td}><span style={s.num}>{new Date(event.created_at).toLocaleString()}</span></td>
                      <td style={s.td}><span style={{ ...s.badge, ...s.badgePurple }}>{event.event_type}</span></td>
                      <td style={s.td}>
                        <span style={{ ...s.badge, ...(event.severity === 'error' ? s.badgeRed : event.severity === 'warn' ? { background: 'rgba(240,169,82,0.12)', color: '#f0a952' } : s.badgeGreen) }}>
                          {event.severity}
                        </span>
                      </td>
                      <td style={s.td}><span style={s.num}>{event.email || '-'}</span></td>
                      <td style={s.td}><span style={{ fontSize: 11, color: 'var(--text-2)' }}>{event.message?.slice(0, 100)}</span></td>
                    </tr>
                  ))}
                  {securityEvents.length === 0 && (
                    <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center' as const, color: 'var(--text-3)' }}>No security events found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Admin Notes */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 12 }}>Security Notes</h3>
            <div style={s.settingsCard}>
              <textarea
                value={securityNotes}
                onChange={e => saveSecurityNotes(e.target.value)}
                placeholder="Add security observations, audit notes, or reminders here. This is saved automatically and persists across sessions."
                style={{ ...s.input, width: '100%', minHeight: 150, resize: 'vertical' as const, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
              />
              <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8 }}>Auto-saved. Use this to track security observations, audit findings, and follow-up items.</p>
            </div>
          </div>
        </div>
      )}

      {/* PLATFORM ANALYTICS TAB */}
      {activeTab === 'analytics' && (
        <div style={s.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>Platform Analytics</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {(['7d', '30d', '90d', 'all'] as const).map(p => (
                <button key={p} onClick={() => { setAnalyticsPeriod(p); loadAnalytics() }} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid', background: analyticsPeriod === p ? 'rgba(124,110,247,0.15)' : 'transparent', borderColor: analyticsPeriod === p ? 'rgba(124,110,247,0.3)' : 'var(--border)', color: analyticsPeriod === p ? '#9d92f5' : 'var(--text-3)' }}>{p === 'all' ? 'All Time' : p}</button>
              ))}
              <button onClick={loadAnalytics} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-2)' }}>Refresh</button>
            </div>
          </div>

          {analyticsLoading ? (
            <div style={{ textAlign: 'center' as const, color: 'var(--text-3)', padding: 40 }}>Loading analytics...</div>
          ) : !analyticsData ? (
            <div style={{ textAlign: 'center' as const, padding: 40 }}>
              <button onClick={loadAnalytics} style={{ padding: '10px 24px', borderRadius: 8, fontSize: 13, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: 'white' }}>Load Analytics</button>
            </div>
          ) : (
            <>
              {/* Revenue Overview */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Revenue', value: `$${analyticsData.totalRevenue.toFixed(2)}`, color: '#5DCAA5' },
                  { label: 'API Costs', value: `$${analyticsData.totalApiCost.toFixed(4)}`, color: '#f09595' },
                  { label: 'Profit', value: `$${analyticsData.profit.toFixed(2)}`, color: analyticsData.profit >= 0 ? '#5DCAA5' : '#f09595' },
                  { label: 'Margin', value: `${analyticsData.margin.toFixed(1)}%`, color: analyticsData.margin >= 50 ? '#5DCAA5' : '#f5a623' },
                  { label: 'Users', value: String(analyticsData.userCount), color: '#9d92f5' },
                ].map(stat => (
                  <div key={stat.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>{stat.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Build & Usage Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Total Builds', value: String(analyticsData.totals.builds) },
                  { label: 'Tokens (Input)', value: `${(analyticsData.totals.tokensInput / 1000).toFixed(0)}K` },
                  { label: 'Tokens (Output)', value: `${(analyticsData.totals.tokensOutput / 1000).toFixed(0)}K` },
                  { label: 'Images Generated', value: String(analyticsData.totals.images) },
                  { label: 'Projects', value: String(analyticsData.projectCount) },
                ].map(stat => (
                  <div key={stat.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>{stat.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Computed metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                {[
                  { label: 'Avg Cost/Build', value: analyticsData.totals.builds > 0 ? `$${(analyticsData.totalApiCost / analyticsData.totals.builds).toFixed(4)}` : '$0' },
                  { label: 'Avg Tokens/Build', value: analyticsData.totals.builds > 0 ? `${Math.round((analyticsData.totals.tokensInput + analyticsData.totals.tokensOutput) / analyticsData.totals.builds)}` : '0' },
                  { label: 'Fn Executions', value: String(analyticsData.totals.functionExecs) },
                  { label: 'Cron Runs', value: String(analyticsData.totals.cronExecs) },
                ].map(stat => (
                  <div key={stat.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>{stat.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-2)' }}>{stat.value}</div>
                  </div>
                ))}
              </div>

              {/* Per-User Breakdown */}
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Per-User Breakdown</h3>
              <div style={{ maxHeight: 400, overflowY: 'auto' as const, border: '1px solid var(--border)', borderRadius: 10, marginBottom: 24 }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Email</th>
                      <th style={s.th}>Projects</th>
                      <th style={s.th}>Builds</th>
                      <th style={s.th}>Tokens</th>
                      <th style={s.th}>API Cost</th>
                      <th style={s.th}>Revenue</th>
                      <th style={s.th}>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(analyticsData.perUser as Record<string, any>)
                      .sort((a: any, b: any) => (b[1].costAnthropic + b[1].costReplicate) - (a[1].costAnthropic + a[1].costReplicate))
                      .map(([uid, u]: [string, any]) => {
                        const cost = u.costAnthropic + u.costReplicate
                        const profit = u.revenue - cost
                        return (
                          <tr key={uid}>
                            <td style={s.td}><span style={{ fontSize: 11, color: 'var(--text-2)' }}>{u.email}</span></td>
                            <td style={s.td}>{u.projects}</td>
                            <td style={s.td}>{u.builds}</td>
                            <td style={s.td}><span style={{ fontSize: 10, color: 'var(--text-2)' }}>{((u.tokensInput + u.tokensOutput) / 1000).toFixed(0)}K</span></td>
                            <td style={s.td}><span style={{ color: '#f09595', fontSize: 11 }}>${cost.toFixed(4)}</span></td>
                            <td style={s.td}><span style={{ color: '#5DCAA5', fontSize: 11 }}>${u.revenue.toFixed(2)}</span></td>
                            <td style={s.td}><span style={{ color: profit >= 0 ? '#5DCAA5' : '#f09595', fontSize: 11, fontWeight: 600 }}>${profit.toFixed(2)}</span></td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>

              {/* Per-Project Breakdown */}
              <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>Per-Project Breakdown</h3>
              <div style={{ maxHeight: 400, overflowY: 'auto' as const, border: '1px solid var(--border)', borderRadius: 10, marginBottom: 24 }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Project</th>
                      <th style={s.th}>Owner</th>
                      <th style={s.th}>Builds</th>
                      <th style={s.th}>Tokens</th>
                      <th style={s.th}>API Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(analyticsData.perProject as Record<string, any>)
                      .sort((a: any, b: any) => b[1].costAnthropic - a[1].costAnthropic)
                      .map(([pid, p]: [string, any]) => (
                        <tr key={pid}>
                          <td style={s.td}><span style={{ fontSize: 11, color: 'var(--text-2)' }}>{p.name}</span></td>
                          <td style={s.td}><span style={{ fontSize: 10, color: 'var(--text-2)' }}>{p.ownerEmail}</span></td>
                          <td style={s.td}>{p.builds}</td>
                          <td style={s.td}><span style={{ fontSize: 10, color: 'var(--text-2)' }}>{((p.tokensInput || 0) / 1000).toFixed(0)}K</span></td>
                          <td style={s.td}><span style={{ color: '#f09595', fontSize: 11 }}>${(p.costAnthropic || 0).toFixed(4)}</span></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Cost Alerts */}
              {(() => {
                const alerts: Array<{ type: string; message: string }> = []
                Object.entries(analyticsData.perUser as Record<string, any>).forEach(([, u]: [string, any]) => {
                  const cost = u.costAnthropic + u.costReplicate
                  if (cost > u.revenue && cost > 0.01) alerts.push({ type: 'loss', message: `${u.email}: costing $${cost.toFixed(4)} but only paid $${u.revenue.toFixed(2)}` })
                })
                if (alerts.length === 0) return null
                return (
                  <div style={{ marginBottom: 24 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f5a623', marginBottom: 12 }}>Cost Alerts ({alerts.length})</h3>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                      {alerts.map((a, i) => (
                        <div key={i} style={{ padding: '8px 12px', background: 'rgba(245,166,35,0.05)', border: '1px solid rgba(245,166,35,0.15)', borderRadius: 8, fontSize: 12, color: '#f5a623' }}>
                          {a.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </>
          )}
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
          builder_error:   'Builder Error',
          api_error:       'API Error',
          credits_error:   'Credits Error',
          auto_fix:        'Auto-Fix',
          auto_fix_error:  'Auto-Fix Error',
          password_reset_attempt:   'Password Reset Attempt',
          password_reset_requested: 'Password Reset Sent',
          password_reset_completed: 'Password Reset Done',
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
          form_typing: 'var(--text-2)', payment_success: '#f0a952', project_created: '#2dd4bf',
          console_error: '#f09595', unhandled_error: '#f09595',
          builder_error: '#f09595', api_error: '#f09595', credits_error: '#f0a952',
          auto_fix: '#60a5fa', auto_fix_error: '#f09595',
          password_reset_attempt: '#f0a952', password_reset_requested: '#f0a952', password_reset_completed: '#5DCAA5',
        }

        return (
          <div style={s.section}>
            {/* Alert Settings */}
            <div style={{ ...s.settingsCard, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Email Alerts</h3>
                  <p style={{ fontSize: 11, color: 'var(--text-3)' }}>Choose which events send you an email. Requires <code style={{ color: '#9d92f5' }}>RESEND_API_KEY</code> and <code style={{ color: '#9d92f5' }}>ALERT_TO_EMAIL</code> env vars.</p>
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
                  <label key={setting.event_type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, border: `1px solid ${setting.send_email ? 'rgba(124,110,247,0.3)' : 'var(--border)'}`, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={setting.send_email}
                      onChange={() => toggleAlertSetting(setting.event_type)}
                      style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c6ef7' }}
                    />
                    <div>
                      <div style={{ fontSize: 12, color: typeColor[setting.event_type] || 'var(--text-2)', fontWeight: 500 }}>
                        {EVENT_LABELS[setting.event_type] || setting.event_type}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Auto-Fix Logs */}
            {(() => {
              const autoFixLogs = logs.filter(l => l.event_type === 'auto_fix' || l.event_type === 'auto_fix_error')
              return (
                <div style={{ ...s.settingsCard, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Auto-Fix Logs</h3>
                      <p style={{ fontSize: 11, color: 'var(--text-3)' }}>Tracks when the builder auto-detects iframe JS errors (runtime bugs in generated code) and attempts to fix them via Claude. Build timeouts and API errors are logged separately in the table above — Auto-Fix only triggers for code that was successfully generated but has runtime bugs.</p>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{autoFixLogs.length} events</span>
                  </div>
                  {autoFixLogs.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, background: 'var(--bg)', borderRadius: 8 }}>No auto-fix events yet</div>
                  ) : (
                    <div style={{ maxHeight: 300, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <table style={s.table}>
                        <thead>
                          <tr style={s.thead}>
                            <th style={s.th}>Time</th>
                            <th style={s.th}>Result</th>
                            <th style={s.th}>Email</th>
                            <th style={s.th}>Page</th>
                            <th style={s.th}>Message</th>
                          </tr>
                        </thead>
                        <tbody>
                          {autoFixLogs.map(log => (
                            <tr key={log.id} style={s.tr}>
                              <td style={{ ...s.td, fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                {new Date(log.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </td>
                              <td style={s.td}>
                                <span style={{ ...s.badge, background: log.event_type === 'auto_fix' ? 'rgba(96,165,250,0.12)' : 'rgba(163,45,45,0.12)', color: log.event_type === 'auto_fix' ? '#60a5fa' : '#f09595' }}>
                                  {log.event_type === 'auto_fix' ? 'Fixed' : 'Failed'}
                                </span>
                              </td>
                              <td style={s.td}><span style={{ fontSize: 12, color: 'var(--text-3)' }}>{log.email || '—'}</span></td>
                              <td style={s.td}><span style={{ fontSize: 12, color: '#9d92f5' }}>{(log.metadata as any)?.pageName || '—'}</span></td>
                              <td style={{ ...s.td, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{log.message}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* AI Builder Errors */}
            {(() => {
              const allBuilderErrors = logs.filter(l => {
                // builder_error and api_error are always builder-related
                if (l.event_type === 'builder_error' || l.event_type === 'api_error') return true
                // console_error and unhandled_error only from the builder/project page
                if (l.event_type === 'console_error' || l.event_type === 'unhandled_error') {
                  return (l.metadata as any)?.url?.startsWith('/project/')
                }
                return false
              })
              const builderErrors = allBuilderErrors.filter(l => {
                if (builderErrorSearch) {
                  const q = builderErrorSearch.toLowerCase()
                  if (!l.message.toLowerCase().includes(q) && !(l.email || '').toLowerCase().includes(q)) return false
                }
                return true
              })
              const totalPages = Math.ceil(builderErrors.length / builderErrorsPerPage)
              const startIdx = builderErrorPage * builderErrorsPerPage
              const endIdx = startIdx + builderErrorsPerPage
              const pagedErrors = builderErrors.slice(startIdx, endIdx)
              const allPageSelected = pagedErrors.length > 0 && pagedErrors.every(l => selectedBuilderErrors.has(l.id))

              const errorTypeLabel: Record<string, string> = {
                console_error: 'Console Error',
                unhandled_error: 'Unhandled Error',
                builder_error: 'Builder Error',
                api_error: 'API Error',
              }
              const errorTypeColor: Record<string, string> = {
                console_error: '#f09595',
                unhandled_error: '#ff6b6b',
                builder_error: '#f0a952',
                api_error: '#e879f9',
              }

              const toggleBuilderExpand = (id: string) => {
                setExpandedBuilderErrors(prev => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id); else next.add(id)
                  return next
                })
              }

              const toggleSelectError = (id: string) => {
                setSelectedBuilderErrors(prev => {
                  const next = new Set(prev)
                  if (next.has(id)) next.delete(id); else next.add(id)
                  return next
                })
              }

              const toggleSelectAll = () => {
                if (allPageSelected) {
                  setSelectedBuilderErrors(prev => {
                    const next = new Set(prev)
                    pagedErrors.forEach(l => next.delete(l.id))
                    return next
                  })
                } else {
                  setSelectedBuilderErrors(prev => {
                    const next = new Set(prev)
                    pagedErrors.forEach(l => next.add(l.id))
                    return next
                  })
                }
              }

              const copySelectedErrors = () => {
                const selected = allBuilderErrors.filter(l => selectedBuilderErrors.has(l.id))
                const text = selected.map(l => {
                  const time = new Date(l.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  const type = errorTypeLabel[l.event_type] || l.event_type
                  let line = `[${time}] [${type}] [${l.severity}] [${l.email || '—'}] ${l.message}`
                  if (l.metadata) line += `\nMetadata: ${JSON.stringify(l.metadata, null, 2)}`
                  return line
                }).join('\n\n---\n\n')
                navigator.clipboard.writeText(text)
              }

              const handleResizeMouseDown = (e: React.MouseEvent) => {
                e.preventDefault()
                const startY = e.clientY
                const startHeight = builderErrorCardHeight
                const onMove = (ev: MouseEvent) => {
                  const diff = ev.clientY - startY
                  setBuilderErrorCardHeight(Math.max(150, startHeight + diff))
                }
                const onUp = () => {
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }

              return (
                <div style={{ ...s.settingsCard, marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>AI Builder Errors</h3>
                      <p style={{ fontSize: 11, color: 'var(--text-3)' }}>Console errors, unhandled exceptions, builder failures and API errors from the AI Builder. Helps debug issues users are experiencing.</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {selectedBuilderErrors.size > 0 && (
                        <button onClick={copySelectedErrors} style={{ ...s.actionBtn, padding: '6px 12px', background: 'rgba(124,110,247,0.12)', color: '#9d92f5' }}>
                          Copy {selectedBuilderErrors.size} Error{selectedBuilderErrors.size > 1 ? 's' : ''}
                        </button>
                      )}
                      <input value={builderErrorSearch} onChange={e => { setBuilderErrorSearch(e.target.value); setBuilderErrorPage(0) }} placeholder="Search message or email..." style={{ ...s.searchInput, width: 200 }} />
                      <button onClick={loadLogs} style={{ ...s.actionBtn, padding: '6px 12px' }}>↺ Refresh</button>
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{builderErrors.length} errors</span>
                    </div>
                  </div>
                  {builderErrors.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, background: 'var(--bg)', borderRadius: 8 }}>No AI Builder errors logged</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                        Showing {startIdx + 1}–{Math.min(endIdx, builderErrors.length)} of {builderErrors.length}
                      </div>
                      <div style={{ maxHeight: builderErrorCardHeight, overflowY: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <table style={s.table}>
                          <thead>
                            <tr style={s.thead}>
                              <th style={{ ...s.th, width: 30 }}>
                                <input type="checkbox" checked={allPageSelected} onChange={toggleSelectAll} style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c6ef7' }} />
                              </th>
                              <th style={s.th}>Time</th>
                              <th style={s.th}>Error Type</th>
                              <th style={s.th}>Severity</th>
                              <th style={s.th}>Email</th>
                              <th style={s.th}>Message</th>
                              <th style={s.th}>Meta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedErrors.map(log => (
                              <React.Fragment key={log.id}>
                                <tr style={{ ...s.tr, cursor: log.metadata ? 'pointer' : 'default' }} onClick={() => toggleBuilderExpand(log.id)}>
                                  <td style={{ ...s.td, width: 30 }} onClick={e => e.stopPropagation()}>
                                    <input type="checkbox" checked={selectedBuilderErrors.has(log.id)} onChange={() => toggleSelectError(log.id)} style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7c6ef7' }} />
                                  </td>
                                  <td style={{ ...s.td, fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                    {new Date(log.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </td>
                                  <td style={s.td}>
                                    <span style={{ ...s.badge, background: 'rgba(163,45,45,0.12)', color: errorTypeColor[log.event_type] || '#f09595' }}>
                                      {errorTypeLabel[log.event_type] || log.event_type}
                                    </span>
                                  </td>
                                  <td style={s.td}>
                                    <span style={{ ...s.badge, background: severityBg[log.severity] || severityBg.info, color: severityColor[log.severity] || severityColor.info }}>
                                      {log.severity}
                                    </span>
                                  </td>
                                  <td style={s.td}><span style={{ fontSize: 12, color: 'var(--text-3)' }}>{log.email || '—'}</span></td>
                                  <td style={{ ...s.td, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{log.message}</span>
                                  </td>
                                  <td style={s.td}>
                                    {log.metadata && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{expandedBuilderErrors.has(log.id) ? '▼ collapse' : '▶ expand'}</span>}
                                  </td>
                                </tr>
                                {expandedBuilderErrors.has(log.id) && log.metadata && (
                                  <tr style={{ background: 'var(--bg)' }}>
                                    <td colSpan={7} style={{ padding: '10px 14px' }}>
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
                      </div>

                      {/* Drag handle to resize */}
                      <div
                        onMouseDown={handleResizeMouseDown}
                        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 12, cursor: 'ns-resize', userSelect: 'none', marginTop: 4 }}
                      >
                        <div style={{ width: 40, height: 3, borderRadius: 2, background: 'var(--border-2)' }} />
                      </div>

                      {/* Pagination controls */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, padding: '8px 0' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button
                            onClick={() => setBuilderErrorPage(p => Math.max(0, p - 1))}
                            disabled={builderErrorPage === 0}
                            style={{ ...s.actionBtn, padding: '6px 14px', opacity: builderErrorPage === 0 ? 0.4 : 1, cursor: builderErrorPage === 0 ? 'not-allowed' : 'pointer' }}
                          >
                            ← Previous
                          </button>
                          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Page {builderErrorPage + 1} of {totalPages}</span>
                          <button
                            onClick={() => setBuilderErrorPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={builderErrorPage >= totalPages - 1}
                            style={{ ...s.actionBtn, padding: '6px 14px', opacity: builderErrorPage >= totalPages - 1 ? 0.4 : 1, cursor: builderErrorPage >= totalPages - 1 ? 'not-allowed' : 'pointer' }}
                          >
                            Next Page →
                          </button>
                        </div>
                        <button
                          onClick={() => { setBuilderErrorsPerPage(p => p + 20); setBuilderErrorPage(0) }}
                          style={{ ...s.actionBtn, padding: '6px 14px' }}
                        >
                          Show More ({builderErrorsPerPage} → {builderErrorsPerPage + 20} per page)
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })()}

            {/* Log viewer */}
            <div style={{ ...s.settingsCard }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Recent Logs <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>({filteredLogs.length} of {logs.length})</span></h3>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={logSearch} onChange={e => { setLogSearch(e.target.value); setLogPage(0) }} placeholder="Search message or email..." style={{ ...s.searchInput, width: 200 }} />
                  <select value={logTypeFilter} onChange={e => { setLogTypeFilter(e.target.value); setLogPage(0) }} style={s.planSelect}>
                    <option value="all">All types</option>
                    {Object.entries(EVENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select value={logSeverityFilter} onChange={e => { setLogSeverityFilter(e.target.value); setLogPage(0) }} style={s.planSelect}>
                    <option value="all">All severity</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                  </select>
                  <button onClick={loadLogs} style={{ ...s.actionBtn, padding: '6px 12px' }}>↺ Refresh</button>
                </div>
              </div>

              {(() => {
                const totalPages = Math.ceil(filteredLogs.length / logsPerPage)
                const startIdx = logPage * logsPerPage
                const endIdx = startIdx + logsPerPage
                const pagedLogs = filteredLogs.slice(startIdx, endIdx)

                return (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
                      Showing {filteredLogs.length === 0 ? 0 : startIdx + 1}–{Math.min(endIdx, filteredLogs.length)} of {filteredLogs.length}
                    </div>
                    <div style={{ borderRadius: 8, border: '1px solid var(--border)', overflow: 'auto' }}>
                      {filteredLogs.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No logs yet</div>
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
                            {pagedLogs.map(log => (
                              <React.Fragment key={log.id}>
                                <tr style={{ ...s.tr, cursor: log.metadata ? 'pointer' : 'default' }} onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                                  <td style={{ ...s.td, fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                    {new Date(log.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                  </td>
                                  <td style={s.td}>
                                    <span style={{ fontSize: 11, fontWeight: 500, color: typeColor[log.event_type] || 'var(--text-2)' }}>
                                      {EVENT_LABELS[log.event_type] || log.event_type}
                                    </span>
                                  </td>
                                  <td style={s.td}>
                                    <span style={{ ...s.badge, background: severityBg[log.severity] || severityBg.info, color: severityColor[log.severity] || severityColor.info }}>
                                      {log.severity}
                                    </span>
                                  </td>
                                  <td style={s.td}><span style={{ fontSize: 12, color: 'var(--text-3)' }}>{log.email || '—'}</span></td>
                                  <td style={{ ...s.td, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{log.message}</span>
                                  </td>
                                  <td style={s.td}>
                                    {log.metadata && <span style={{ fontSize: 10, color: 'var(--text-3)' }}>▶ expand</span>}
                                  </td>
                                </tr>
                                {expandedLog === log.id && log.metadata && (
                                  <tr style={{ background: 'var(--bg)' }}>
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

                    {/* Pagination controls */}
                    {filteredLogs.length > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, padding: '8px 0' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button
                            onClick={() => setLogPage(p => Math.max(0, p - 1))}
                            disabled={logPage === 0}
                            style={{ ...s.actionBtn, padding: '6px 14px', opacity: logPage === 0 ? 0.4 : 1, cursor: logPage === 0 ? 'not-allowed' : 'pointer' }}
                          >
                            ← Previous
                          </button>
                          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Page {logPage + 1} of {totalPages}</span>
                          <button
                            onClick={() => setLogPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={logPage >= totalPages - 1}
                            style={{ ...s.actionBtn, padding: '6px 14px', opacity: logPage >= totalPages - 1 ? 0.4 : 1, cursor: logPage >= totalPages - 1 ? 'not-allowed' : 'pointer' }}
                          >
                            Next Page →
                          </button>
                        </div>
                        <button
                          onClick={() => { setLogsPerPage(p => p + 20); setLogPage(0) }}
                          style={{ ...s.actionBtn, padding: '6px 14px' }}
                        >
                          Show More ({logsPerPage} → {logsPerPage + 20} per page)
                        </button>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        )
      })()}

      {/* CHAT HISTORY TAB */}
      {activeTab === 'chat_history' && (() => {
        const isError = (content: string) =>
          content.startsWith('Error:') ||
          content.toLowerCase().includes('went wrong') ||
          content.toLowerCase().includes('timed out') ||
          content.toLowerCase().includes('please try again') ||
          content.toLowerCase().includes('build limit') ||
          content.toLowerCase().includes('insufficient credits')

        // Group all messages by project, pair user→assistant into turns
        const allFiltered = chatMessages.filter(m => {
          if (chatUserFilter !== 'all' && m.user_id !== chatUserFilter) return false
          return true
        })

        const byProject: Record<string, ChatMessage[]> = {}
        allFiltered.forEach(m => {
          if (!byProject[m.project_id]) byProject[m.project_id] = []
          byProject[m.project_id].push(m)
        })

        const turns: Array<{ id: string; time: string; userId: string; userMsg: ChatMessage | null; aiMsg: ChatMessage | null }> = []
        Object.values(byProject).forEach(msgs => {
          const sorted = [...msgs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          let i = 0
          while (i < sorted.length) {
            if (sorted[i].role === 'user') {
              const ai = sorted[i + 1]?.role === 'assistant' ? sorted[i + 1] : null
              turns.push({ id: sorted[i].id, time: sorted[i].created_at, userId: sorted[i].user_id, userMsg: sorted[i], aiMsg: ai })
              i += ai ? 2 : 1
            } else {
              turns.push({ id: sorted[i].id, time: sorted[i].created_at, userId: sorted[i].user_id, userMsg: null, aiMsg: sorted[i] })
              i++
            }
          }
        })
        turns.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())

        // Apply search filter across both messages in a turn
        const filteredTurns = chatSearch
          ? turns.filter(t => {
              const q = chatSearch.toLowerCase()
              const email = users.find(u => u.id === t.userId)?.email || ''
              return email.toLowerCase().includes(q) ||
                (t.userMsg?.content || '').toLowerCase().includes(q) ||
                (t.aiMsg?.content || '').toLowerCase().includes(q)
            })
          : turns

        return (
          <div style={s.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
              <h2 style={{ ...s.sectionTitle, margin: 0 }}>Chat History <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>({filteredTurns.length} turns of {chatMessages.length} messages)</span></h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <select value={chatUserFilter} onChange={e => setChatUserFilter(e.target.value)} style={s.planSelect}>
                  <option value="all">All users</option>
                  {users
                    .filter(u => chatMessages.some(m => m.user_id === u.id))
                    .sort((a, b) => a.email.localeCompare(b.email))
                    .map(u => <option key={u.id} value={u.id}>{u.email}</option>)
                  }
                </select>
                <input value={chatSearch} onChange={e => setChatSearch(e.target.value)} placeholder="Search content..." style={{ ...s.searchInput, width: 200 }} />
                <button onClick={loadChatHistory} style={{ ...s.actionBtn, padding: '6px 12px' }}>↺ Refresh</button>
              </div>
            </div>
            <div style={s.tableWrap}>
              {filteredTurns.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>No chat history yet</div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={s.thead}>
                      <th style={{ ...s.th, width: 110 }}>Time</th>
                      <th style={{ ...s.th, width: 160 }}>User</th>
                      <th style={s.th}>User Input</th>
                      <th style={s.th}>AI Response</th>
                      <th style={{ ...s.th, width: 80 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTurns.map(turn => {
                      const hasError = turn.aiMsg ? isError(turn.aiMsg.content) : false
                      const isPlan = turn.userMsg?.is_plan || turn.aiMsg?.is_plan
                      const hasResponse = !!turn.aiMsg
                      const turnKey = turn.id
                      return (
                        <React.Fragment key={turnKey}>
                          <tr style={{ ...s.tr, cursor: 'pointer' }} onClick={() => setExpandedChat(expandedChat === turnKey ? null : turnKey)}>
                            <td style={{ ...s.td, fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                              {new Date(turn.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td style={{ ...s.td, fontSize: 12, color: 'var(--text-3)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {users.find(u => u.id === turn.userId)?.email || turn.userId.slice(0, 8) + '…'}
                            </td>
                            <td style={{ ...s.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 12, color: '#5DCAA5' }}>
                                {turn.userMsg ? (turn.userMsg.content.slice(0, 100) + (turn.userMsg.content.length > 100 ? '…' : '')) : '—'}
                              </span>
                            </td>
                            <td style={{ ...s.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 12, color: hasError ? '#f07575' : '#9d92f5' }}>
                                {turn.aiMsg ? (turn.aiMsg.content.slice(0, 100) + (turn.aiMsg.content.length > 100 ? '…' : '')) : '—'}
                              </span>
                            </td>
                            <td style={{ ...s.td, whiteSpace: 'nowrap' }}>
                              {hasError
                                ? <span style={{ ...s.badge, background: 'rgba(240,100,100,0.12)', color: '#f07575', fontSize: 10 }}>error</span>
                                : isPlan
                                  ? <span style={{ ...s.badge, background: 'rgba(240,169,82,0.12)', color: '#f0a952', fontSize: 10 }}>plan</span>
                                  : hasResponse
                                    ? <span style={{ ...s.badge, background: 'rgba(93,202,165,0.12)', color: '#5DCAA5', fontSize: 10 }}>ok</span>
                                    : <span style={{ ...s.badge, background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)', fontSize: 10 }}>pending</span>
                              }
                            </td>
                          </tr>
                          {expandedChat === turnKey && (
                            <tr style={{ background: 'var(--bg)' }}>
                              <td colSpan={5} style={{ padding: '12px 16px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                  <div>
                                    <div style={{ fontSize: 10, color: '#5DCAA5', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>User:</div>
                                    <pre style={{ fontSize: 11, color: 'var(--text-2)', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                      {turn.userMsg?.content || '(no user message)'}
                                    </pre>
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 10, color: '#9d92f5', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>AI:</div>
                                    <pre style={{ fontSize: 11, color: hasError ? '#f07575' : '#9d92f5', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                      {turn.aiMsg?.content || '(no response yet)'}
                                    </pre>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )
      })()}

      {/* AI CONNECTIONS TAB — removed, merged into Settings tab above */}

      {/* WELCOME TAB */}
      {activeTab === 'welcome' && (() => {
        const TYPE_LABELS: Record<SectionType, string> = {
          icon: 'Icon', title: 'Title', subtitle: 'Subtitle', box: 'Highlight Box', text: 'Text',
        }
        const TYPE_COLORS: Record<SectionType, string> = {
          icon: '#f0a952', title: 'var(--text)', subtitle: 'var(--text-2)', box: '#9d92f5', text: 'var(--text-2)',
        }
        const previewHtml = generateWelcomeHtml(welcomeConfig)

        return (
          <div style={s.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h2 style={s.sectionTitle}>Welcome Page Editor</h2>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -10 }}>This is what users see when they first open a new project.</p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {welcomeMsg && <span style={{ fontSize: 12, color: '#5DCAA5' }}>{welcomeMsg}</span>}
                <button onClick={() => { setWelcomeConfig(DEFAULT_WELCOME_CONFIG); setEditingSectionId(null) }} style={{ ...s.actionBtn, padding: '8px 14px' }}>Reset to Default</button>
                <button onClick={saveWelcomeConfig} disabled={welcomeSaving} style={s.saveBtn}>
                  {welcomeSaving ? 'Saving...' : 'Save & Publish'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
              {/* Editor panel */}
              <div>
                {/* Section list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {welcomeConfig.sections.map((sec, idx) => (
                    <div key={sec.id} style={{ background: 'var(--bg-2)', border: `1px solid ${editingSectionId === sec.id ? 'rgba(124,110,247,0.4)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
                      {/* Section header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
                        {/* Visibility toggle */}
                        <button
                          onClick={() => updateSection(sec.id, { visible: !sec.visible })}
                          title={sec.visible ? 'Click to hide' : 'Click to show'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: sec.visible ? 1 : 0.35, flexShrink: 0 }}
                        >👁</button>
                        {/* Type badge */}
                        <span style={{ fontSize: 10, fontWeight: 600, color: TYPE_COLORS[sec.type], background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 7px', flexShrink: 0 }}>
                          {TYPE_LABELS[sec.type]}
                        </span>
                        {/* Content preview — click to edit */}
                        <span
                          onClick={() => setEditingSectionId(editingSectionId === sec.id ? null : sec.id)}
                          style={{ flex: 1, fontSize: 12, color: sec.visible ? 'var(--text-2)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                        >
                          {sec.content || '(empty)'}
                        </span>
                        {/* Move / delete */}
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button onClick={() => moveSection(sec.id, -1)} disabled={idx === 0} style={{ ...s.actionBtn, padding: '2px 7px', opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                          <button onClick={() => moveSection(sec.id, 1)} disabled={idx === welcomeConfig.sections.length - 1} style={{ ...s.actionBtn, padding: '2px 7px', opacity: idx === welcomeConfig.sections.length - 1 ? 0.3 : 1 }}>↓</button>
                          <button onClick={() => removeSection(sec.id)} style={{ ...s.actionBtn, ...s.actionRed, padding: '2px 7px' }}>✕</button>
                        </div>
                      </div>

                      {/* Inline editor — shown when expanded */}
                      {editingSectionId === sec.id && (
                        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', background: 'var(--bg)' }}>
                          <label style={{ ...s.label, marginBottom: 6, display: 'block' }}>Content</label>
                          <textarea
                            value={sec.content}
                            onChange={e => updateSection(sec.id, { content: e.target.value })}
                            rows={sec.type === 'text' || sec.type === 'subtitle' ? 3 : 2}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 7, color: 'var(--text)', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }}
                          />
                          {sec.type === 'icon' && (
                            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Paste any emoji — it will be displayed in a styled rounded box.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add section row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={addSectionType} onChange={e => setAddSectionType(e.target.value as SectionType)} style={{ ...s.planSelect, flex: 1, padding: '8px 10px' }}>
                    {(Object.keys(TYPE_LABELS) as SectionType[]).map(t => (
                      <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <button onClick={addSection} style={{ ...s.saveBtn, padding: '8px 18px', whiteSpace: 'nowrap' as const }}>+ Add Section</button>
                </div>
              </div>

              {/* Live preview panel */}
              <div style={{ position: 'sticky', top: 20 }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live Preview</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-scripts"
                    style={{ width: '100%', height: 420, border: 'none', display: 'block' }}
                    title="Welcome page preview"
                  />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>Preview updates as you edit. Hit "Save & Publish" to apply to new projects.</p>
              </div>
            </div>
          </div>
        )
      })()}
      {/* AI TRAINING TAB */}
      {activeTab === 'ai_training' && (
        <div style={{ ...s.section, padding: isMobile ? '12px 16px 24px' : '16px 28px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h3 style={s.sectionTitle}>AI Training Rules</h3>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -8, marginBottom: 0 }}>
                These rules are injected into the AI's system prompt to control how it builds pages.<br/>
                <strong>Global</strong> rules always apply. <strong>Keyword</strong> rules activate when the user's prompt contains matching words.
              </p>
            </div>
            <button onClick={() => { setShowNewRule(true); setEditingRuleId(null); setRuleForm({ type: 'global', keywords: '', instructions: '', priority: 0 }) }}
              style={{ padding: '8px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}>
              + Add Rule
            </button>
          </div>

          {trainingMsg && <div style={{ padding: '8px 12px', background: trainingMsg.startsWith('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${trainingMsg.startsWith('Error') ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`, borderRadius: 7, color: trainingMsg.startsWith('Error') ? '#f87171' : '#34d399', fontSize: 12, marginBottom: 12 }}>{trainingMsg}</div>}

          {/* New / Edit Rule Form */}
          {(showNewRule || editingRuleId) && (
            <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 auto' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Type</label>
                  <select value={ruleForm.type} onChange={e => setRuleForm(f => ({ ...f, type: e.target.value as any }))}
                    style={{ padding: '7px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12 }}>
                    <option value="global">Global (always active)</option>
                    <option value="keyword">Keyword (triggered by words)</option>
                  </select>
                </div>
                {ruleForm.type === 'keyword' && (
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Keywords (comma separated)</label>
                    <input value={ruleForm.keywords} onChange={e => setRuleForm(f => ({ ...f, keywords: e.target.value }))}
                      placeholder="landing page, landing, homepage"
                      style={{ width: '100%', padding: '7px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, outline: 'none' }} />
                  </div>
                )}
                <div style={{ flex: '0 0 80px' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Priority</label>
                  <input type="number" value={ruleForm.priority} onChange={e => setRuleForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))}
                    style={{ width: '100%', padding: '7px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, outline: 'none' }} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>Instructions (what to tell the AI)</label>
                <textarea value={ruleForm.instructions} onChange={e => setRuleForm(f => ({ ...f, instructions: e.target.value }))}
                  rows={5}
                  placeholder="Example: Always create stunning hero sections with gradient text, animated hover effects, professional imagery, and clear visual hierarchy..."
                  style={{ width: '100%', padding: '10px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveTrainingRule} disabled={trainingSaving || !ruleForm.instructions.trim()}
                  style={{ padding: '8px 20px', background: trainingSaving ? 'var(--text-3)' : 'var(--accent)', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, cursor: trainingSaving ? 'default' : 'pointer', fontWeight: 500 }}>
                  {trainingSaving ? 'Saving...' : editingRuleId ? 'Update Rule' : 'Create Rule'}
                </button>
                <button onClick={() => { setShowNewRule(false); setEditingRuleId(null) }}
                  style={{ padding: '8px 16px', background: 'var(--bg-3)', color: 'var(--text-2)', border: '1px solid var(--border)', borderRadius: 7, fontSize: 12, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Rules List */}
          {trainingRules.length === 0 && !showNewRule && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-3)', fontSize: 13 }}>
              No training rules yet. Click "Add Rule" to teach the AI how to build better pages.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {trainingRules.map(rule => (
              <div key={rule.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', opacity: rule.enabled ? 1 : 0.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em',
                        background: rule.type === 'global' ? 'rgba(124,110,247,0.15)' : 'rgba(59,130,246,0.15)',
                        color: rule.type === 'global' ? '#9d92f5' : '#60a5fa' }}>
                        {rule.type.toUpperCase()}
                      </span>
                      {rule.type === 'keyword' && rule.keywords && rule.keywords.split(',').map((kw, i) => (
                        <span key={i} style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)' }}>
                          {kw.trim()}
                        </span>
                      ))}
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Priority: {rule.priority}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {rule.instructions.length > 200 ? rule.instructions.slice(0, 200) + '...' : rule.instructions}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <button onClick={() => toggleTrainingRule(rule.id, !rule.enabled)}
                      style={{ padding: '4px 10px', background: rule.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)', border: '1px solid ' + (rule.enabled ? 'rgba(16,185,129,0.3)' : 'var(--border)'), borderRadius: 5, fontSize: 10, color: rule.enabled ? '#34d399' : 'var(--text-3)', cursor: 'pointer' }}>
                      {rule.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button onClick={() => { setEditingRuleId(rule.id); setShowNewRule(false); setRuleForm({ type: rule.type, keywords: rule.keywords || '', instructions: rule.instructions, priority: rule.priority }) }}
                      style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 10, color: 'var(--text-2)', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => deleteTrainingRule(rule.id)}
                      style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5, fontSize: 10, color: '#f87171', cursor: 'pointer' }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIONS TAB */}
      {activeTab === 'actions' && (() => {
        const filtered = actionsAuthData.filter(u =>
          !actionsUserSearch || u.email?.toLowerCase().includes(actionsUserSearch.toLowerCase())
        )
        return (
          <div style={s.section}>
            <div style={s.tableTop}>
              <div>
                <h2 style={s.sectionTitle}>User Actions</h2>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -10, marginBottom: 0 }}>Manage user accounts — resend confirmation emails or manually confirm users</p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input value={actionsUserSearch} onChange={e => setActionsUserSearch(e.target.value)} placeholder="Search by email..." style={s.searchInput} />
                <button onClick={loadActionsData} disabled={actionsDataLoading} style={{ ...s.saveBtn, padding: '7px 14px', fontSize: 11, opacity: actionsDataLoading ? 0.5 : 1 }}>
                  {actionsDataLoading ? 'Loading…' : '↻ Refresh'}
                </button>
              </div>
            </div>

            {/* Info banner */}
            <div style={{ background: 'rgba(124,110,247,0.06)', border: '1px solid rgba(124,110,247,0.15)', borderRadius: 10, padding: '14px 18px', marginBottom: 16, fontSize: 12, color: '#9d92f5', lineHeight: 1.7 }}>
              <strong>About signup emails:</strong> Confirmation emails are now sent via <strong>Resend</strong> (bypasses Supabase rate limits).
              Use the buttons below to manually resend a confirmation or force-confirm a user who can't receive email.
            </div>

            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr style={s.thead}>
                    <th style={s.th}>User</th>
                    <th style={s.th}>Joined</th>
                    <th style={s.th}>Last Sign In</th>
                    <th style={s.th}>Email Status</th>
                    <th style={s.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actionsDataLoading ? (
                    <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--text-3)', padding: 32 }}>Loading users…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...s.td, textAlign: 'center', color: 'var(--text-3)', padding: 32 }}>No users found</td></tr>
                  ) : filtered.map(u => {
                    const confirmed = !!u.email_confirmed_at
                    const isLoading = actionsLoading[u.id] || actionsLoading[u.id + '_force']
                    const msg = actionsMsg[u.id]
                    const joinDate = new Date(u.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                    const lastSign = u.last_sign_in_at
                      ? new Date(u.last_sign_in_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                      : '—'
                    return (
                      <tr key={u.id} style={s.tr}>
                        <td style={s.td}>
                          <div style={s.userCell}>
                            <div style={s.uAvatar}>{(u.email || '?')[0].toUpperCase()}</div>
                            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{u.email}</span>
                          </div>
                        </td>
                        <td style={{ ...s.td, ...s.num }}>{joinDate}</td>
                        <td style={{ ...s.td, ...s.num }}>{lastSign}</td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, ...(confirmed ? s.badgeGreen : s.badgeRed) }}>
                            {confirmed ? '✓ Confirmed' : '✗ Unconfirmed'}
                          </span>
                        </td>
                        <td style={s.td}>
                          {msg ? (
                            <span style={{ fontSize: 11, color: msg.startsWith('✓') ? '#5DCAA5' : '#f09595' }}>{msg}</span>
                          ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => resendConfirmation(u.id, u.email)}
                                disabled={isLoading}
                                style={{ ...s.actionBtn, ...s.actionPurple, opacity: isLoading ? 0.5 : 1 }}
                              >
                                {actionsLoading[u.id] ? 'Sending…' : 'Resend Confirmation'}
                              </button>
                              {!confirmed && (
                                <button
                                  onClick={() => forceConfirmEmail(u.id)}
                                  disabled={isLoading}
                                  style={{ ...s.actionBtn, ...s.actionGreen, opacity: isLoading ? 0.5 : 1 }}
                                >
                                  {actionsLoading[u.id + '_force'] ? 'Confirming…' : 'Force Confirm'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* THEMES TAB */}
      {activeTab === 'themes' && (
        <div style={{ ...s.section, padding: isMobile ? '12px 16px 24px' : '16px 28px 28px' }}>
          <div style={{ ...s.tableTop, flexDirection: isMobile ? 'column' : 'row' as const, alignItems: isMobile ? 'flex-start' : 'center', gap: 10 }}>
            <h2 style={s.sectionTitle}>Color Themes</h2>
            <button onClick={openNewTheme} style={{ ...s.giftBtn, fontSize: 12 }}>+ New Theme</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {themesList.map((t: any) => (
              <div key={t.id} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{t.name}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {t.is_builtin && <span style={{ ...s.badge, ...s.badgePurple }}>Built-in</span>}
                    <span style={{ ...s.badge, ...(t.is_available ? s.badgeGreen : s.badgeRed) }}>
                      {t.is_available ? 'Available' : 'Hidden'}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  {[t.colors.bg, t.colors.bg2, t.colors.bg3, t.colors.text, t.colors.text2, t.colors.accent].map((c: string, i: number) => (
                    <div key={i} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: '1px solid rgba(255,255,255,0.15)' }} title={c} />
                  ))}
                </div>
                {/* Preview card */}
                <div style={{ background: t.colors.bg, border: `1px solid ${t.colors.border}`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: t.colors.text, marginBottom: 4 }}>Preview</div>
                  <div style={{ fontSize: 11, color: t.colors.text2, marginBottom: 2 }}>Secondary text</div>
                  <div style={{ fontSize: 10, color: t.colors.text3, marginBottom: 6 }}>Muted text</div>
                  <div style={{ display: 'inline-block', padding: '3px 10px', background: t.colors.accent, borderRadius: 4, color: 'white', fontSize: 10 }}>Button</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => openEditTheme(t)} style={{ ...s.actionBtn, ...s.actionPurple }}>Edit</button>
                  <button onClick={() => toggleThemeAvailability(t.id, t.is_available)} style={{ ...s.actionBtn, ...s.actionOrange }}>
                    {t.is_available ? 'Hide' : 'Show'}
                  </button>
                  {!t.is_builtin && (
                    <button onClick={() => deleteTheme(t.id)} style={{ ...s.actionBtn, ...s.actionRed }}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* THEME CREATE/EDIT MODAL */}
          {showThemeForm && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border-2)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', marginBottom: 20 }}>
                  {editingTheme ? 'Edit Theme' : 'New Theme'}
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={s.field}>
                    <label style={s.label}>Theme Name</label>
                    <input
                      value={themeForm.name}
                      onChange={e => setThemeForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Ocean Breeze"
                      style={s.input}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={themeForm.is_available}
                      onChange={e => setThemeForm(f => ({ ...f, is_available: e.target.checked }))}
                    />
                    <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Available to users</label>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                    Colors
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                    {Object.entries(themeForm.colors).map(([key, val]) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="color"
                          value={val.startsWith('rgba') ? '#888888' : val}
                          onChange={e => setThemeForm(f => ({ ...f, colors: { ...f.colors, [key]: e.target.value } }))}
                          style={{ width: 32, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none' }}
                        />
                        <div>
                          <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500 }}>{key}</div>
                          <input
                            value={val}
                            onChange={e => setThemeForm(f => ({ ...f, colors: { ...f.colors, [key]: e.target.value } }))}
                            style={{ ...s.input, padding: '3px 6px', fontSize: 10, width: 120 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Live Preview */}
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginTop: 8 }}>
                    Live Preview
                  </div>
                  <div style={{ background: themeForm.colors.bg, border: `1px solid ${themeForm.colors.border}`, borderRadius: 10, padding: 16 }}>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                      <div style={{ width: 60, background: themeForm.colors.bg2, borderRadius: 8, padding: 8 }}>
                        <div style={{ fontSize: 9, color: themeForm.colors.text2 }}>Sidebar</div>
                      </div>
                      <div style={{ flex: 1, background: themeForm.colors.bg2, borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: themeForm.colors.text, marginBottom: 4 }}>Page Title</div>
                        <div style={{ fontSize: 11, color: themeForm.colors.text2, marginBottom: 2 }}>Secondary text content</div>
                        <div style={{ fontSize: 10, color: themeForm.colors.text3, marginBottom: 8 }}>Muted / label text</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <div style={{ padding: '4px 12px', background: themeForm.colors.accent, borderRadius: 6, color: 'white', fontSize: 10 }}>Primary</div>
                          <div style={{ padding: '4px 12px', background: themeForm.colors.bg3, border: `1px solid ${themeForm.colors.border2}`, borderRadius: 6, color: themeForm.colors.text2, fontSize: 10 }}>Secondary</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ ...s.badge, background: 'rgba(29,158,117,0.12)', color: themeForm.colors.success || '#5DCAA5' }}>Success</span>
                      <span style={{ ...s.badge, background: 'rgba(186,117,23,0.12)', color: themeForm.colors.warning || '#f0a952' }}>Warning</span>
                      <span style={{ ...s.badge, background: 'rgba(163,45,45,0.12)', color: themeForm.colors.danger || '#f09595' }}>Danger</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setShowThemeForm(false); setEditingTheme(null) }} style={{ ...s.actionBtn, padding: '8px 16px', fontSize: 12 }}>Cancel</button>
                    <button onClick={saveTheme} disabled={!themeForm.name.trim()} style={{ ...s.giftBtn, fontSize: 12, opacity: themeForm.name.trim() ? 1 : 0.5 }}>
                      {editingTheme ? 'Update Theme' : 'Create Theme'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

Admin.getLayout = function getLayout(page: React.ReactNode) {
  return <Layout>{page}</Layout>
}

const s: Record<string, React.CSSProperties> = {
  loadingInner: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 14 },
  main: { flex: 1, overflow: 'auto' },
  topbar: { padding: '24px 28px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 4 },
  sub: { fontSize: 12, color: 'var(--text-3)' },
  statsGrid: { display: 'grid', gap: 12, padding: '16px 16px 0' },
  statCard: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' },
  statLabel: { fontSize: 11, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  statVal: { fontSize: 20, fontWeight: 600, color: 'var(--text)', marginBottom: 2 },
  statSub: { fontSize: 10, color: 'var(--text-3)' },
  tabRow: { display: 'flex', gap: 4, padding: '16px 16px 0', flexWrap: 'wrap' as const },
  tabBtn: { padding: '7px 16px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-3)', fontSize: 12, cursor: 'pointer' },
  tabBtnOn: { background: 'rgba(124,110,247,0.15)', borderColor: 'rgba(124,110,247,0.3)', color: '#9d92f5' },
  section: { padding: '16px 16px 28px' },
  sectionTitle: { fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 14 },
  tableTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  searchInput: { padding: '7px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text)', fontSize: 12, outline: 'none', width: 220 },
  tableWrap: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  thead: { background: 'var(--bg-3)' },
  th: { padding: '10px 14px', textAlign: 'left' as const, fontSize: 10, fontWeight: 500, color: 'var(--text-3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', whiteSpace: 'nowrap' as const },
  tr: { borderTop: '1px solid var(--border)' },
  td: { padding: '10px 14px', verticalAlign: 'middle' as const, whiteSpace: 'nowrap' as const },
  userCell: { display: 'flex', alignItems: 'center', gap: 8 },
  uAvatar: { width: 24, height: 24, borderRadius: '50%', background: 'rgba(124,110,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#9d92f5', flexShrink: 0 },
  num: { fontSize: 12, color: 'var(--text-2)' },
  badge: { display: 'inline-flex', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500 },
  badgeGreen: { background: 'rgba(29,158,117,0.12)', color: '#5DCAA5' },
  badgeRed: { background: 'rgba(163,45,45,0.12)', color: '#f09595' },
  badgePurple: { background: 'rgba(124,110,247,0.12)', color: '#9d92f5' },
  badgeGray: { background: 'rgba(255,255,255,0.05)', color: 'var(--text-2)' },
  actionBtn: { padding: '4px 10px', border: 'none', borderRadius: 5, fontSize: 10, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)' },
  actionRed: { background: 'rgba(163,45,45,0.12)', color: '#f09595' },
  actionGreen: { background: 'rgba(29,158,117,0.12)', color: '#5DCAA5' },
  actionPurple: { background: 'rgba(124,110,247,0.12)', color: '#9d92f5' },
  actionOrange: { background: 'rgba(186,117,23,0.12)', color: '#f0a952' },
  planSelect: { padding: '3px 6px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', fontSize: 11, outline: 'none', cursor: 'pointer' },
  inlineInput: { padding: '3px 6px', background: 'var(--bg-3)', border: '1px solid var(--border-2)', borderRadius: 5, color: 'var(--text)', fontSize: 12, outline: 'none', width: 90 },
  giftCard: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 },
  giftRow: { display: 'flex', gap: 16, alignItems: 'flex-end' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: 1 },
  label: { fontSize: 11, color: 'var(--text-3)' },
  fieldDesc: { fontSize: 11, color: 'var(--text-3)', marginBottom: 4, lineHeight: 1.5 },
  select: { padding: '8px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' },
  input: { padding: '8px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 13, outline: 'none' },
  giftBtn: { padding: '9px 20px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  settingsCard: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 },
  settingsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 24 },
  previewBox: { marginTop: 8, padding: '8px 12px', background: 'rgba(124,110,247,0.07)', border: '1px solid rgba(124,110,247,0.15)', borderRadius: 7, fontSize: 11, color: '#9d92f5', lineHeight: 1.5 },
  marginPreview: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 20 },
  marginRow: { display: 'flex', gap: 32, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 },
  saveBtn: { padding: '10px 24px', background: 'var(--accent)', border: 'none', borderRadius: 8, color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  dbInfoRow: { display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)', alignItems: 'center' },
  dbLabel: { fontSize: 11, color: 'var(--text-3)', width: 70, flexShrink: 0 },
  dbVal: { fontSize: 12, color: 'var(--text-2)' },
}
