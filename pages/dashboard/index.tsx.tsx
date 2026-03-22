import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

interface Page { id: string; name: string; code: string; updated_at: string }
interface Message { role: 'user' | 'assistant'; content: string; isPlan?: boolean }

const STARTER_CODE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}</script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<title>My Page</title>
</head>
<body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10">
  <div class="text-center max-w-lg">
    <div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6">
      <i class="fa-solid fa-wand-magic-sparkles text-brand text-xl"></i>
    </div>
    <h1 class="text-white text-2xl font-semibold mb-3">Your page is ready</h1>
    <p class="text-white/50 text-sm leading-relaxed mb-8">Use the AI chat on the left to build anything — dashboards, inventory systems, admin panels, landing pages and more.</p>
    <div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm">
      Try: "Build an admin dashboard with a sidebar, stats and users table"
    </div>
  </div>
</body>
</html>`

type AppMode = 'build' | 'plan'
type SidebarTab = 'chat' | 'pages'

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [activePage, setActivePage] = useState<Page | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [totalTokens, setTotalTokens] = useState(0)
  const [newPageName, setNewPageName] = useState('')
  const [showNewPage, setShowNewPage] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chat')
  const [mode, setMode] = useState<AppMode>('build')
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadPages(data.user.id)
      loadTokens(data.user.id)
    })
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // KEY FIX: use srcdoc to properly render HTML in iframe
  const renderIframe = useCallback((code: string) => {
    if (iframeRef.current) {
      iframeRef.current.srcdoc = code
    }
  }, [])

  useEffect(() => {
    if (activePage) renderIframe(activePage.code)
  }, [activePage])

  async function loadPages(userId: string) {
    const { data } = await supabase
      .from('pages').select('*').eq('user_id', userId).order('updated_at', { ascending: false })
    if (data && data.length > 0) {
      setPages(data); setActivePage(data[0])
    } else {
      createPage('My Dashboard', userId)
    }
  }

  async function loadTokens(userId: string) {
    const { data } = await supabase.from('usage').select('tokens').eq('user_id', userId)
    if (data) setTotalTokens(data.reduce((s: number, r: any) => s + r.tokens, 0))
  }

  async function createPage(name: string, userId?: string) {
    const uid = userId || user?.id
    const { data, error } = await supabase.from('pages').insert({
      user_id: uid, name, code: STARTER_CODE,
    }).select().single()
    if (!error && data) {
      setPages(prev => [data, ...prev])
      setActivePage(data)
      setMessages([])
      setShowNewPage(false)
      setNewPageName('')
      setSidebarTab('chat')
    }
  }

  async function savePage(code: string) {
    if (!activePage) return
    const { data } = await supabase.from('pages')
      .update({ code, updated_at: new Date().toISOString() })
      .eq('id', activePage.id).select().single()
    if (data) {
      setActivePage(data)
      setPages(prev => prev.map(p => p.id === data.id ? data : p))
      renderIframe(data.code)
    }
  }

  async function deletePage(pageId: string) {
    if (pages.length === 1) return alert('You need at least one page.')
    await supabase.from('pages').delete().eq('id', pageId)
    const remaining = pages.filter(p => p.id !== pageId)
    setPages(remaining)
    if (activePage?.id === pageId) { setActivePage(remaining[0]); setMessages([]) }
  }

  // PLANNING MODE: get a plan from AI first
  async function getPlan() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    const userInput = input
    setInput('')
    setLoading(true)
    setLastError(null)

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Create a detailed plan for: "${userInput}". List exactly what sections, components, features and data you will build. Be specific. Do NOT write any code yet — just the plan.` }],
          pageCode: activePage?.code,
          pageName: activePage?.name,
          allPages: pages,
          planOnly: true,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const planMsg: Message = { role: 'assistant', content: data.message, isPlan: true }
      setMessages(prev => [...prev, planMsg])
      setPendingPlan(userInput)
    } catch (err: any) {
      setLastError(err.message)
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    }
    setLoading(false)
  }

  // APPROVE PLAN: now actually build it
  async function approvePlan() {
    if (!pendingPlan) return
    const approveMsg: Message = { role: 'user', content: '✓ Plan approved — build it now' }
    setMessages(prev => [...prev, approveMsg])
    setPendingPlan(null)
    setLoading(true)
    setLastError(null)

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, approveMsg].map(m => ({ role: m.role, content: m.content })),
          pageCode: activePage?.code,
          pageName: activePage?.name,
          allPages: pages,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
      if (data.code) await savePage(data.code)
      if (data.tokensUsed && user) {
        await supabase.from('usage').insert({ user_id: user.id, page_id: activePage?.id, tokens: data.tokensUsed })
        setTotalTokens(prev => prev + data.tokensUsed)
      }
    } catch (err: any) {
      setLastError(err.message)
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    }
    setLoading(false)
  }

  // BUILD MODE: build directly
  async function sendMessage() {
    if (!input.trim() || loading || !activePage) return
    if (mode === 'plan') { getPlan(); return }

    const userMsg: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setLastError(null)

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          pageCode: activePage.code,
          pageName: activePage.name,
          allPages: pages,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
      if (data.code) await savePage(data.code)
      if (data.tokensUsed && user) {
        await supabase.from('usage').insert({ user_id: user.id, page_id: activePage.id, tokens: data.tokensUsed })
        setTotalTokens(prev => prev + data.tokensUsed)
      }
    } catch (err: any) {
      setLastError(err.message)
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${err.message}` }])
    }
    setLoading(false)
  }

  async function signOut() { await supabase.auth.signOut(); router.push('/') }

  if (!user) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'#666', background:'#0a0a0a', fontFamily:'sans-serif' }}>Loading...</div>

  return (
    <div style={s.root}>
      {/* TOPBAR */}
      <div style={s.topbar}>
        <div style={s.topLeft}>
          <div style={s.logoMark}>AI</div>
          <span style={s.logoName}>Custom AI Dashboard</span>
          {activePage && <><span style={s.sep}>/</span><span style={s.pageName}>{activePage.name}</span></>}
        </div>
        <div style={s.topRight}>
          {activePage && (
            <button onClick={() => setShowCode(!showCode)} style={{ ...s.codeBtn, ...(showCode ? s.codeBtnActive : {}) }}>
              {'</>'} {showCode ? 'Hide Code' : 'View Code'}
            </button>
          )}
          <div style={s.tokenBadge}>
            <span style={{ color: '#555', fontSize: 10 }}>tokens</span>
            <span style={{ color: '#7c6ef7', fontWeight: 600, fontSize: 12 }}>{totalTokens.toLocaleString()}</span>
          </div>
          <span style={s.userEmail}>{user.email}</span>
          <button onClick={signOut} style={s.signOutBtn}>Sign out</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={s.main}>
        {/* LEFT PANEL */}
        <div style={s.leftPanel}>
          <div style={s.tabs}>
            <button style={{ ...s.tab, ...(sidebarTab === 'chat' ? s.tabActive : {}) }} onClick={() => setSidebarTab('chat')}>Chat</button>
            <button style={{ ...s.tab, ...(sidebarTab === 'pages' ? s.tabActive : {}) }} onClick={() => setSidebarTab('pages')}>Pages ({pages.length})</button>
          </div>

          {sidebarTab === 'chat' && (
            <>
              <div style={s.messages}>
                {messages.length === 0 && (
                  <div style={s.emptyChat}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>✦</div>
                    <p style={{ color: '#555', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
                      {mode === 'plan' ? 'Describe what you want to build and I\'ll create a plan for your approval.' : 'Describe what you want to build and I\'ll create it instantly.'}
                    </p>
                    <div style={s.suggestions}>
                      {['Admin dashboard with sidebar', 'Inventory tracker with table', 'Sales dashboard with charts', 'User management panel'].map(s2 => (
                        <button key={s2} style={s.chip} onClick={() => setInput(s2)}>{s2}</button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} style={{ ...s.msgRow, ...(msg.role === 'user' ? s.msgRowUser : {}) }}>
                    <div style={{ ...s.bubble, ...(msg.role === 'user' ? s.bubbleUser : msg.isPlan ? s.bubblePlan : s.bubbleAi) }}>
                      {msg.isPlan && <div style={s.planLabel}>📋 Plan</div>}
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6 }}>{msg.content}</div>
                      {msg.isPlan && pendingPlan && (
                        <div style={s.planActions}>
                          <button onClick={approvePlan} style={s.approveBtn}>✓ Approve & Build</button>
                          <button onClick={() => { setPendingPlan(null); setMessages(prev => [...prev, { role: 'assistant', content: 'Plan cancelled. Describe what changes you\'d like.' }]) }} style={s.rejectBtn}>✕ Revise</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div style={s.msgRow}>
                    <div style={{ ...s.bubble, ...s.bubbleAi }}>
                      <div style={s.typingDots}>
                        <span style={s.dot} />
                        <span style={{ ...s.dot, animationDelay: '0.2s' }} />
                        <span style={{ ...s.dot, animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  </div>
                )}

                {lastError && (
                  <div style={s.errorBox}>
                    <strong>Error:</strong> {lastError}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              <div style={s.inputArea}>
                <div style={s.modeToggle}>
                  <button onClick={() => { setMode('plan'); setPendingPlan(null) }} style={{ ...s.modeBtn, ...(mode === 'plan' ? s.modeBtnActive : {}) }}>
                    📋 Plan
                  </button>
                  <button onClick={() => setMode('build')} style={{ ...s.modeBtn, ...(mode === 'build' ? s.modeBtnActive : {}) }}>
                    ⚡ Build
                  </button>
                </div>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  placeholder={mode === 'plan' ? 'Describe what you want to plan...' : 'Describe what to build or change...'}
                  rows={3}
                  style={s.textarea}
                  disabled={loading}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()} style={s.sendBtn}>
                  {loading ? 'Working...' : mode === 'plan' ? '📋 Create Plan' : '⚡ Build'}
                </button>
              </div>
            </>
          )}

          {sidebarTab === 'pages' && (
            <div style={s.pagesPanel}>
              <div style={{ padding: 12 }}>
                {showNewPage ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input autoFocus value={newPageName} onChange={e => setNewPageName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createPage(newPageName) }}
                      placeholder="Page name..." style={s.newPageInput} />
                    <button onClick={() => createPage(newPageName)} style={s.createBtn}>Add</button>
                    <button onClick={() => setShowNewPage(false)} style={s.cancelBtn}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setShowNewPage(true)} style={s.newPageBtn}>+ New page</button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {pages.map(page => (
                  <div key={page.id} style={{ ...s.pageItem, ...(activePage?.id === page.id ? s.pageItemActive : {}) }}>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => { setActivePage(page); setMessages([]); setSidebarTab('chat') }}>
                      <div style={{ fontSize: 13, fontWeight: activePage?.id === page.id ? 500 : 400, color: '#f0f0f0' }}>{page.name}</div>
                      <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>{new Date(page.updated_at).toLocaleDateString()}</div>
                    </div>
                    {pages.length > 1 && <button onClick={() => deletePage(page.id)} style={s.deleteBtn}>✕</button>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={s.rightPanel}>
          <div style={s.previewBar}>
            <div style={s.urlBar}>{activePage?.name || 'No page'}</div>
            <button onClick={() => activePage && renderIframe(activePage.code)} style={s.refreshBtn} title="Refresh">↺</button>
          </div>

          {showCode && activePage ? (
            <div style={s.codePanel}>
              <div style={s.codePanelHeader}>
                <span style={{ color: '#888', fontSize: 12 }}>Source — {activePage.name}</span>
                <button onClick={() => { navigator.clipboard.writeText(activePage.code) }} style={s.copyBtn}>Copy</button>
              </div>
              <pre style={s.codeContent}>{activePage.code}</pre>
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
              style={s.iframe}
              title="preview"
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display:'flex', flexDirection:'column', height:'100vh', background:'#0a0a0a', overflow:'hidden', fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  topbar: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', height:50, borderBottom:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', flexShrink:0 },
  topLeft: { display:'flex', alignItems:'center', gap:10 },
  logoMark: { width:26, height:26, background:'#7c6ef7', borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'white' },
  logoName: { fontSize:14, fontWeight:600, color:'#f0f0f0' },
  sep: { color:'#333', fontSize:16 },
  pageName: { fontSize:13, color:'#666' },
  topRight: { display:'flex', alignItems:'center', gap:12 },
  modeToggle: { display:'flex', background:'#1a1a1a', borderRadius:8, padding:3, border:'1px solid rgba(255,255,255,0.07)', width:'100%' },
  modeBtn: { flex:1, padding:'6px 0', borderRadius:6, border:'none', cursor:'pointer', fontSize:12, fontWeight:500, background:'transparent', color:'#666', transition:'all 0.15s', textAlign:'center' as const },
  modeBtnActive: { background:'#7c6ef7', color:'white' },
  codeBtn: { padding:'5px 12px', background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#888', fontSize:12, cursor:'pointer', fontFamily:'monospace' },
  codeBtnActive: { background:'rgba(124,110,247,0.15)', borderColor:'rgba(124,110,247,0.4)', color:'#9d92f5' },
  tokenBadge: { display:'flex', flexDirection:'column', alignItems:'flex-end', gap:1 },
  userEmail: { fontSize:11, color:'#444' },
  signOutBtn: { padding:'5px 11px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, color:'#666', fontSize:12, cursor:'pointer' },
  main: { display:'flex', flex:1, overflow:'hidden' },
  leftPanel: { width:320, minWidth:320, display:'flex', flexDirection:'column', borderRight:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', overflow:'hidden' },
  tabs: { display:'flex', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 },
  tab: { flex:1, padding:10, background:'none', border:'none', color:'#444', fontSize:12, cursor:'pointer', fontWeight:500, borderBottom:'2px solid transparent' },
  tabActive: { color:'#f0f0f0', borderBottom:'2px solid #7c6ef7' },
  modeBar: { padding:'8px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)', flexShrink:0 },
  modePlanBadge: { fontSize:11, color:'#9d92f5', background:'rgba(124,110,247,0.08)', padding:'4px 8px', borderRadius:5, display:'block' },
  modeBuildBadge: { fontSize:11, color:'#5DCAA5', background:'rgba(29,158,117,0.08)', padding:'4px 8px', borderRadius:5, display:'block' },
  messages: { flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:10 },
  emptyChat: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 0', flex:1 },
  suggestions: { display:'flex', flexWrap:'wrap', gap:5, justifyContent:'center', marginTop:16 },
  chip: { padding:'4px 10px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:20, color:'#888', fontSize:11, cursor:'pointer' },
  msgRow: { display:'flex', flexDirection:'column' },
  msgRowUser: { alignItems:'flex-end' },
  bubble: { maxWidth:'92%', padding:'9px 12px', borderRadius:10, border:'1px solid transparent' },
  bubbleUser: { background:'#7c6ef7', color:'white', borderColor:'transparent' },
  bubbleAi: { background:'#1a1a1a', borderColor:'rgba(255,255,255,0.07)', color:'#e0e0e0' },
  bubblePlan: { background:'rgba(124,110,247,0.08)', borderColor:'rgba(124,110,247,0.2)', color:'#e0e0e0', width:'100%', maxWidth:'100%' },
  planLabel: { fontSize:11, fontWeight:600, color:'#9d92f5', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.05em' },
  planActions: { display:'flex', gap:8, marginTop:12 },
  approveBtn: { padding:'6px 14px', background:'#7c6ef7', border:'none', borderRadius:7, color:'white', fontSize:12, fontWeight:500, cursor:'pointer' },
  rejectBtn: { padding:'6px 14px', background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#888', fontSize:12, cursor:'pointer' },
  typingDots: { display:'flex', gap:4, padding:'2px 0' },
  dot: { width:6, height:6, borderRadius:'50%', background:'#444', animation:'bounce 1.2s infinite' },
  errorBox: { background:'rgba(163,45,45,0.15)', border:'1px solid rgba(163,45,45,0.3)', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#f09595' },
  inputArea: { padding:10, borderTop:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', gap:8, flexShrink:0 },
  textarea: { padding:10, background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#f0f0f0', fontSize:13, resize:'none', outline:'none', lineHeight:1.5 },
  sendBtn: { padding:9, background:'#7c6ef7', border:'none', borderRadius:8, color:'white', fontSize:13, fontWeight:500, cursor:'pointer' },
  pagesPanel: { display:'flex', flexDirection:'column', flex:1, overflow:'hidden' },
  newPageBtn: { width:'100%', padding:8, background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#888', fontSize:13, cursor:'pointer', textAlign:'left' as const },
  newPageInput: { padding:'7px 10px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#f0f0f0', fontSize:13, outline:'none', flex:1 },
  createBtn: { padding:'7px 12px', background:'#7c6ef7', border:'none', borderRadius:6, color:'white', fontSize:12, cursor:'pointer' },
  cancelBtn: { padding:'7px 10px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, color:'#666', fontSize:12, cursor:'pointer' },
  pageItem: { display:'flex', alignItems:'center', padding:'10px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', gap:8 },
  pageItemActive: { background:'rgba(124,110,247,0.08)' },
  deleteBtn: { background:'none', border:'none', color:'#444', cursor:'pointer', fontSize:11, padding:'2px 4px', borderRadius:4 },
  rightPanel: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  previewBar: { display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', flexShrink:0 },
  urlBar: { flex:1, padding:'4px 10px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, fontSize:12, color:'#555' },
  refreshBtn: { padding:'4px 10px', background:'none', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, color:'#555', cursor:'pointer', fontSize:14 },
  iframe: { flex:1, border:'none', background:'#0a0a0a', width:'100%', height:'100%' },
  codePanel: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  codePanelHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', flexShrink:0 },
  copyBtn: { padding:'4px 12px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#888', fontSize:12, cursor:'pointer' },
  codeContent: { flex:1, overflow:'auto', padding:16, fontSize:11.5, lineHeight:1.6, color:'#9d92f5', background:'#0a0a0a', fontFamily:'monospace', whiteSpace:'pre-wrap', wordBreak:'break-all' as const },
}
