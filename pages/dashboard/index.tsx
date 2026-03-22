import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

interface Page {
  id: string
  name: string
  code: string
  updated_at: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const STARTER_CODE = `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f0f0f; color: #f0f0f0; 
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 40px;
  }
  .welcome { text-align: center; max-width: 480px; }
  .icon { font-size: 48px; margin-bottom: 20px; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
  p { color: #a0a0a0; font-size: 15px; line-height: 1.6; }
  .hint { 
    margin-top: 32px; padding: 16px 20px;
    background: rgba(124,110,247,0.1); border: 1px solid rgba(124,110,247,0.2);
    border-radius: 10px; font-size: 13px; color: #9d92f5;
  }
</style>
</head>
<body>
  <div class="welcome">
    <div class="icon">✦</div>
    <h1>Your page is ready</h1>
    <p>Use the AI chat on the left to build anything you want — tables, forms, dashboards, calculators, trackers and more.</p>
    <div class="hint">Try: "Build me an inventory tracker" or "Create a sales dashboard"</div>
  </div>
</body>
</html>`

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
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'pages'>('chat')
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

  useEffect(() => {
    if (activePage && iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(activePage.code)
        doc.close()
      }
    }
  }, [activePage])

  async function loadPages(userId: string) {
    const { data } = await supabase
      .from('pages')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })

    if (data && data.length > 0) {
      setPages(data)
      setActivePage(data[0])
    } else {
      // Create default first page
      createPage('My Dashboard', userId)
    }
  }

  async function loadTokens(userId: string) {
    const { data } = await supabase
      .from('usage')
      .select('tokens')
      .eq('user_id', userId)
    if (data) {
      setTotalTokens(data.reduce((sum: number, r: any) => sum + r.tokens, 0))
    }
  }

  async function createPage(name: string, userId?: string) {
    const uid = userId || user?.id
    const { data, error } = await supabase.from('pages').insert({
      user_id: uid,
      name,
      code: STARTER_CODE,
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
      .eq('id', activePage.id)
      .select().single()

    if (data) {
      setActivePage(data)
      setPages(prev => prev.map(p => p.id === data.id ? data : p))
    }
  }

  async function deletePage(pageId: string) {
    if (pages.length === 1) return alert('You need at least one page.')
    await supabase.from('pages').delete().eq('id', pageId)
    const remaining = pages.filter(p => p.id !== pageId)
    setPages(remaining)
    if (activePage?.id === pageId) {
      setActivePage(remaining[0])
      setMessages([])
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading || !activePage) return

    const userMsg: Message = { role: 'user', content: input }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          pageCode: activePage.code,
          pageName: activePage.name,
        }),
      })

      const data = await res.json()

      if (data.error) throw new Error(data.error)

      const assistantMsg: Message = { role: 'assistant', content: data.message }
      setMessages(prev => [...prev, assistantMsg])

      if (data.code) {
        await savePage(data.code)
      }

      // Track usage
      if (data.tokensUsed && user) {
        await supabase.from('usage').insert({
          user_id: user.id,
          page_id: activePage.id,
          tokens: data.tokensUsed,
        })
        setTotalTokens(prev => prev + data.tokensUsed)
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}. Please try again.`
      }])
    }
    setLoading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (!user) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-2)' }}>
      Loading...
    </div>
  )

  return (
    <div style={s.root}>
      {/* TOP BAR */}
      <div style={s.topbar}>
        <div style={s.topbarLeft}>
          <div style={s.logoMark}>AI</div>
          <span style={s.logoName}>Custom AI Dashboard</span>
          {activePage && (
            <>
              <span style={s.sep}>/</span>
              <span style={s.pageName}>{activePage.name}</span>
            </>
          )}
        </div>
        <div style={s.topbarRight}>
          <div style={s.tokenBadge}>
            <span style={{ color: 'var(--text-3)', fontSize: '11px' }}>tokens used</span>
            <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{totalTokens.toLocaleString()}</span>
          </div>
          <span style={s.userEmail}>{user.email}</span>
          <button onClick={signOut} style={s.signOutBtn}>Sign out</button>
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div style={s.main}>
        {/* LEFT PANEL */}
        <div style={s.leftPanel}>
          {/* Tab switcher */}
          <div style={s.tabs}>
            <button
              style={{ ...s.tab, ...(sidebarTab === 'chat' ? s.tabActive : {}) }}
              onClick={() => setSidebarTab('chat')}
            >Chat</button>
            <button
              style={{ ...s.tab, ...(sidebarTab === 'pages' ? s.tabActive : {}) }}
              onClick={() => setSidebarTab('pages')}
            >Pages ({pages.length})</button>
          </div>

          {/* CHAT TAB */}
          {sidebarTab === 'chat' && (
            <>
              <div style={s.messages}>
                {messages.length === 0 && (
                  <div style={s.emptyChat}>
                    <div style={{ fontSize: '28px', marginBottom: '12px' }}>✦</div>
                    <p style={{ color: 'var(--text-2)', fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
                      Describe what you want to build and I&apos;ll create it instantly.
                    </p>
                    <div style={s.suggestions}>
                      {['Build an inventory tracker', 'Create a sales dashboard', 'Make a contact form', 'Add a data table'].map(s2 => (
                        <button key={s2} style={s.chip} onClick={() => setInput(s2)}>{s2}</button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} style={{ ...s.msg, ...(msg.role === 'user' ? s.msgUser : s.msgAi) }}>
                    <div style={{ ...s.bubble, ...(msg.role === 'user' ? s.bubbleUser : s.bubbleAi) }}>
                      {msg.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div style={{ ...s.msg, ...s.msgAi }}>
                    <div style={{ ...s.bubble, ...s.bubbleAi }}>
                      <span style={s.typing}>Building<span className="dots">...</span></span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div style={s.inputArea}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  placeholder="Describe what to build or change..."
                  rows={3}
                  style={s.textarea}
                  disabled={loading}
                />
                <button onClick={sendMessage} disabled={loading || !input.trim()} style={s.sendBtn}>
                  {loading ? 'Building...' : 'Send ↑'}
                </button>
              </div>
            </>
          )}

          {/* PAGES TAB */}
          {sidebarTab === 'pages' && (
            <div style={s.pagesPanel}>
              <div style={{ padding: '12px' }}>
                {showNewPage ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      autoFocus
                      value={newPageName}
                      onChange={e => setNewPageName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createPage(newPageName) }}
                      placeholder="Page name..."
                      style={{ ...s.newPageInput, flex: 1 }}
                    />
                    <button onClick={() => createPage(newPageName)} style={s.createBtn}>Add</button>
                    <button onClick={() => setShowNewPage(false)} style={s.cancelBtn}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setShowNewPage(true)} style={s.newPageBtn}>+ New page</button>
                )}
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {pages.map(page => (
                  <div
                    key={page.id}
                    style={{ ...s.pageItem, ...(activePage?.id === page.id ? s.pageItemActive : {}) }}
                  >
                    <div
                      style={{ flex: 1, cursor: 'pointer' }}
                      onClick={() => { setActivePage(page); setMessages([]); setSidebarTab('chat') }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: activePage?.id === page.id ? 500 : 400 }}>{page.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-3)', marginTop: '2px' }}>
                        {new Date(page.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    {pages.length > 1 && (
                      <button
                        onClick={() => deletePage(page.id)}
                        style={s.deleteBtn}
                        title="Delete page"
                      >✕</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL - iframe preview */}
        <div style={s.rightPanel}>
          <div style={s.previewBar}>
            <div style={s.urlBar}>
              {activePage?.name || 'No page selected'}
            </div>
            <button
              style={s.refreshBtn}
              onClick={() => activePage && setActivePage({ ...activePage })}
              title="Refresh preview"
            >↺</button>
          </div>
          <iframe
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin allow-forms"
            style={s.iframe}
            title="preview"
          />
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' },
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 16px', height: '48px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-2)', flexShrink: 0,
  },
  topbarLeft: { display: 'flex', alignItems: 'center', gap: '10px' },
  logoMark: {
    width: '26px', height: '26px', background: 'var(--accent)', borderRadius: '6px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '10px', fontWeight: '700', color: 'white',
  },
  logoName: { fontSize: '14px', fontWeight: '600', color: 'var(--text)' },
  sep: { color: 'var(--text-3)', fontSize: '16px' },
  pageName: { fontSize: '13px', color: 'var(--text-2)' },
  topbarRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  tokenBadge: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' },
  userEmail: { fontSize: '12px', color: 'var(--text-3)' },
  signOutBtn: {
    padding: '5px 12px', background: 'none', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text-2)', fontSize: '12px', cursor: 'pointer',
  },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  leftPanel: {
    width: '320px', minWidth: '320px', display: 'flex', flexDirection: 'column',
    borderRight: '1px solid var(--border)', background: 'var(--bg-2)', overflow: 'hidden',
  },
  tabs: { display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  tab: {
    flex: 1, padding: '10px', background: 'none', border: 'none',
    color: 'var(--text-3)', fontSize: '12px', cursor: 'pointer', fontWeight: 500,
    borderBottom: '2px solid transparent',
  },
  tabActive: { color: 'var(--text)', borderBottom: '2px solid var(--accent)' },
  messages: { flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' },
  emptyChat: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0' },
  suggestions: { display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center', marginTop: '16px' },
  chip: {
    padding: '5px 10px', background: 'var(--bg-3)', border: '1px solid var(--border)',
    borderRadius: '20px', color: 'var(--text-2)', fontSize: '11.5px', cursor: 'pointer',
  },
  msg: { display: 'flex', flexDirection: 'column' },
  msgUser: { alignItems: 'flex-end' },
  msgAi: { alignItems: 'flex-start' },
  bubble: { maxWidth: '90%', padding: '9px 12px', borderRadius: '10px', fontSize: '12.5px', lineHeight: 1.5 },
  bubbleUser: { background: 'var(--accent)', color: 'white' },
  bubbleAi: { background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--text)' },
  typing: { color: 'var(--text-2)' },
  inputArea: { padding: '10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 },
  textarea: {
    padding: '10px', background: 'var(--bg-3)', border: '1px solid var(--border)',
    borderRadius: '8px', color: 'var(--text)', fontSize: '13px', resize: 'none', outline: 'none',
  },
  sendBtn: {
    padding: '9px', background: 'var(--accent)', border: 'none', borderRadius: '8px',
    color: 'white', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
  },
  pagesPanel: { display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' },
  newPageBtn: {
    width: '100%', padding: '8px', background: 'var(--bg-3)', border: '1px solid var(--border)',
    borderRadius: '8px', color: 'var(--text-2)', fontSize: '13px', cursor: 'pointer', textAlign: 'left' as const,
  },
  newPageInput: {
    padding: '7px 10px', background: 'var(--bg-3)', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text)', fontSize: '13px', outline: 'none',
  },
  createBtn: {
    padding: '7px 12px', background: 'var(--accent)', border: 'none',
    borderRadius: '6px', color: 'white', fontSize: '12px', cursor: 'pointer',
  },
  cancelBtn: {
    padding: '7px 10px', background: 'none', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text-3)', fontSize: '12px', cursor: 'pointer',
  },
  pageItem: {
    display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer',
    borderBottom: '1px solid var(--border)', gap: '8px',
  },
  pageItemActive: { background: 'var(--bg-3)' },
  deleteBtn: {
    background: 'none', border: 'none', color: 'var(--text-3)',
    cursor: 'pointer', fontSize: '11px', padding: '2px 4px', borderRadius: '4px',
  },
  rightPanel: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  previewBar: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', flexShrink: 0,
  },
  urlBar: {
    flex: 1, padding: '5px 10px', background: 'var(--bg-3)', border: '1px solid var(--border)',
    borderRadius: '6px', fontSize: '12px', color: 'var(--text-2)',
  },
  refreshBtn: {
    padding: '5px 10px', background: 'none', border: '1px solid var(--border)',
    borderRadius: '6px', color: 'var(--text-2)', cursor: 'pointer', fontSize: '14px',
  },
  iframe: { flex: 1, border: 'none', background: '#0f0f0f' },
}
