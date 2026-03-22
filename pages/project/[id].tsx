import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

interface Page { id: string; name: string; code: string; updated_at: string }
interface Message { id?: string; role: 'user' | 'assistant'; content: string; isPlan?: boolean; imageUrl?: string }
type AppMode = 'build' | 'plan'

export default function ProjectBuilder() {
  const router = useRouter()
  const { id: projectId } = router.query
  const [user, setUser] = useState<any>(null)
  const [project, setProject] = useState<any>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [activePage, setActivePage] = useState<Page | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number>(0)
  const [newPageName, setNewPageName] = useState('')
  const [showNewPage, setShowNewPage] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'pages'>('chat')
  const [mode, setMode] = useState<AppMode>('build')
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [showBuyCredits, setShowBuyCredits] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
      loadProfile(data.user.id)
      // balance loaded from profile
    })
  }, [])

  useEffect(() => {
    if (projectId && user) {
      loadProject()
      loadPages()
    }
  }, [projectId, user])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const renderIframe = useCallback((code: string) => {
    if (!iframeRef.current) return
    // The iframe sandbox does NOT include allow-same-origin.
    // Without it the iframe gets a null origin so hash/path navigation stays
    // sandboxed — clicking <a href="#benefits"> no longer loads the real project
    // builder page inside the preview.
    // Downside: localStorage throws SecurityError, so we polyfill it in-memory.
    const polyfill = `<script>
(function(){
  function Mem(){this._={}}
  Mem.prototype={
    getItem:function(k){return this._.hasOwnProperty(k)?this._[k]:null},
    setItem:function(k,v){this._[k]=String(v)},
    removeItem:function(k){delete this._[k]},
    clear:function(){this._={}},
    key:function(i){return Object.keys(this._)[i]||null},
    get length(){return Object.keys(this._).length}
  };
  try{localStorage.setItem('__chk','1');localStorage.removeItem('__chk')}
  catch(e){
    var m=new Mem(),s=new Mem();
    try{Object.defineProperty(window,'localStorage',{value:m,configurable:true,writable:true})}catch(_){window.localStorage=m}
    try{Object.defineProperty(window,'sessionStorage',{value:s,configurable:true,writable:true})}catch(_){window.sessionStorage=s}
  }
})()
<\/script>`
    const injected = code.replace(/(<head[^>]*>)/i, '$1' + polyfill)
    iframeRef.current.srcdoc = injected || code
  }, [])

  useEffect(() => { if (activePage) renderIframe(activePage.code) }, [activePage])

  // Load chat history when page changes
  useEffect(() => {
    if (activePage && user) loadChatHistory(activePage.id)
  }, [activePage?.id])

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('credit_balance, role').eq('id', userId).single()
if (data) {
  setCreditBalance(data.credit_balance || 0)
}
  }

  async function loadChatHistory(pageId: string) {
    const { data } = await supabase
      .from('chat_history')
      .select('*')
      .eq('page_id', pageId)
      .order('created_at', { ascending: true })
    if (data && data.length > 0) {
      setMessages(data.map((m: any) => ({ id: m.id, role: m.role, content: m.content, isPlan: m.is_plan })))
    } else {
      setMessages([])
    }
  }

  async function saveChatMessage(role: 'user' | 'assistant', content: string, isPlan = false) {
    if (!user || !activePage) return
    const { data } = await supabase.from('chat_history').insert({
      project_id: projectId,
      user_id: user.id,
      page_id: activePage.id,
      role,
      content,
      is_plan: isPlan,
    }).select().single()
    return data?.id
  }

  async function loadProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', projectId).eq('user_id', user.id).single()
    if (!data) { router.push('/home'); return }
    setProject(data)
  }

  async function loadPages() {
    const { data } = await supabase.from('pages').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
    if (data && data.length > 0) { setPages(data); setActivePage(data[0]) }
  }

  async function createPage(name: string) {
    if (!name.trim() || !user) return
    const { data, error } = await supabase.from('pages').insert({
      project_id: projectId, user_id: user.id, name: name.trim(), code: getStarterCode(),
    }).select().single()
    if (!error && data) {
      setPages(prev => [...prev, data])
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
      await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', projectId)
    }
  }

  async function deletePage(pageId: string) {
    if (pages.length === 1) return alert('Need at least one page.')
    await supabase.from('pages').delete().eq('id', pageId)
    const remaining = pages.filter(p => p.id !== pageId)
    setPages(remaining)
    if (activePage?.id === pageId) { setActivePage(remaining[0]); setMessages([]) }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result as string
      const base64 = result.split(',')[1]
      const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
      setPendingImage({ base64, mediaType, preview: result })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }


  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault()
        const file = items[i].getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = (ev) => {
          const result = ev.target?.result as string
          const base64 = result.split(',')[1]
          const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
          setPendingImage({ base64, mediaType, preview: result })
        }
        reader.readAsDataURL(file)
        break
      }
    }
  }

  async function callAPI(msgs: any[], planOnly = false) {
    const payload: any = {
      messages: msgs,
      pageCode: activePage?.code,
      pageName: activePage?.name,
      allPages: pages,
      planOnly,
      userId: user?.id,
    }

    if (pendingImage && !planOnly) {
      payload.imageBase64 = pendingImage.base64
      payload.imageMediaType = pendingImage.mediaType
    }

    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (data.error === 'insufficient_credits') { setShowBuyCredits(true); throw new Error(data.message || 'Insufficient credits') }
    if (data.error) throw new Error(data.error)
    if (data.newBalance !== undefined) setCreditBalance(data.newBalance)
    return data
  }

  async function getPlan() {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    await saveChatMessage('user', input)
    setInput(''); setPendingImage(null); setLoading(true); setLastError(null)
    try {
      const data = await callAPI([{ role: 'user', content: input }], true)
      const aiMsg: Message = { role: 'assistant', content: data.message, isPlan: true }
      setMessages(prev => [...prev, aiMsg])
      await saveChatMessage('assistant', data.message, true)
      setPendingPlan(input)
    } catch (err: any) { setLastError(err.message); setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]) }
    setLoading(false)
  }

  async function approvePlan() {
    if (!pendingPlan) return
    const approveMsg: Message = { role: 'user', content: 'Plan approved. Build it now exactly as planned.' }
    setMessages(prev => [...prev, approveMsg])
    await saveChatMessage('user', approveMsg.content)
    setPendingPlan(null); setLoading(true); setLastError(null)
    try {
      const allMsgs = [...messages, approveMsg].map(m => ({ role: m.role, content: m.content }))
      const data = await callAPI(allMsgs)
      const aiMsg: Message = { role: 'assistant', content: data.message }
      setMessages(prev => [...prev, aiMsg])
      await saveChatMessage('assistant', data.message)
      if (data.code) await savePage(data.code)
    } catch (err: any) { setLastError(err.message); setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]) }
    setLoading(false)
  }

  async function sendMessage() {
    if ((!input.trim() && !pendingImage) || loading || !activePage) return
    if (mode === 'plan') { getPlan(); return }

    const msgContent = input || (pendingImage ? '(sent an image)' : '')
    const userMsg: Message = { role: 'user', content: msgContent, imageUrl: pendingImage?.preview }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    await saveChatMessage('user', msgContent)
    setInput(''); setLoading(true); setLastError(null)
    const imgToSend = pendingImage
    setPendingImage(null)

    try {
      const apiMsgs = newMsgs.map(m => ({ role: m.role, content: m.content }))
      const data = await callAPI(apiMsgs)
      const aiMsg: Message = { role: 'assistant', content: data.message }
      setMessages(prev => [...prev, aiMsg])
      await saveChatMessage('assistant', data.message)
      if (data.code) await savePage(data.code)
    } catch (err: any) {
      setLastError(err.message)
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }])
    }
    setLoading(false)
  }

  async function clearChatHistory() {
    if (!activePage) return
    await supabase.from('chat_history').delete().eq('page_id', activePage.id)
    setMessages([])
  }

  async function buyCredits(packId: string) {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId, userId: user.id, userEmail: user.email }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  if (!user || !project) return <div style={s.loading}>Loading...</div>

  const balanceDisplay = `$${creditBalance.toFixed(2)}`
  const balanceColor = creditBalance > 0 ? '#5DCAA5' : '#f09595'

  return (
    <div style={s.root}>
      {/* TOPBAR */}
      <div style={s.topbar}>
        <div style={s.topLeft}>
          <button onClick={() => router.push('/home')} style={s.backBtn}>← Projects</button>
          <span style={s.sep}>/</span>
          <span style={s.projectName}>{project.name}</span>
        </div>
        <div style={s.topRight}>
          {activePage && (
            <button onClick={() => setShowCode(!showCode)} style={{ ...s.codeBtn, ...(showCode ? s.codeBtnOn : {}) }}>
              {'</>'} {showCode ? 'Hide Code' : 'View Code'}
            </button>
          )}
          <div style={s.balancePill}>
            <span style={{ fontSize:11, color: balanceColor, fontWeight:600 }}>{balanceDisplay}</span>
            <span style={{ fontSize:10, color:'#444', marginLeft:4 }}>credits</span>
          </div>
          <span style={s.email}>{user.email}</span>
        </div>
      </div>

      {/* MAIN */}
      <div style={s.main}>
        {/* LEFT PANEL */}
        <div style={s.left}>
          <div style={s.tabs}>
            <button style={{ ...s.tab, ...(sidebarTab==='chat' ? s.tabOn : {}) }} onClick={() => setSidebarTab('chat')}>Chat</button>
            <button style={{ ...s.tab, ...(sidebarTab==='pages' ? s.tabOn : {}) }} onClick={() => setSidebarTab('pages')}>Pages ({pages.length})</button>
          </div>

          {sidebarTab === 'chat' && (
            <>
              <div style={s.msgs}>
                {messages.length === 0 ? (
                  <div style={s.empty}>
                    <div style={{ fontSize:28, marginBottom:12 }}>✦</div>
                    <p style={{ color:'#555', fontSize:13, textAlign:'center', lineHeight:1.6, marginBottom:20 }}>
                      Describe what to build and I'll create it instantly. You can also upload a screenshot for reference.
                    </p>
                    <div style={s.chips}>
                      {['Admin dashboard with sidebar', 'Inventory tracker', 'Sales dashboard with charts', 'User management panel'].map(t => (
                        <button key={t} style={s.chip} onClick={() => setInput(t)}>{t}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={s.chatActions}>
                      <button onClick={clearChatHistory} style={s.clearBtn}>Clear history</button>
                    </div>
                    {messages.map((msg, i) => (
                      <div key={i} style={{ ...s.msgRow, ...(msg.role==='user' ? s.msgRight : {}) }}>
                        <div style={{ ...s.bubble, ...(msg.role==='user' ? s.bubbleUser : msg.isPlan ? s.bubblePlan : s.bubbleAI) }}>
                          {msg.isPlan && <div style={s.planLabel}>📋 Plan — approve to build</div>}
                          {msg.imageUrl && (
                            <img src={msg.imageUrl} alt="uploaded" style={{ width:'100%', borderRadius:6, marginBottom:8, maxHeight:150, objectFit:'cover' as const }} />
                          )}
                          <div style={{ whiteSpace:'pre-wrap', fontSize:12.5, lineHeight:1.6 }}>{msg.content}</div>
                          {msg.isPlan && pendingPlan && (
                            <div style={{ display:'flex', gap:8, marginTop:12 }}>
                              <button onClick={approvePlan} style={s.approveBtn}>✓ Approve & Build</button>
                              <button onClick={() => setPendingPlan(null)} style={s.reviseBtn}>✕ Revise</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {loading && (
                  <div style={s.msgRow}>
                    <div style={{ ...s.bubble, ...s.bubbleAI }}>
                      <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                        {[0,1,2].map(i => <span key={i} style={{ ...s.dot, animationDelay:`${i*0.2}s` }} />)}
                        <span style={{ color:'#555', fontSize:12, marginLeft:4 }}>Building...</span>
                      </div>
                    </div>
                  </div>
                )}
                {lastError && <div style={s.errBox}><strong>Error:</strong> {lastError}</div>}
                <div ref={messagesEndRef} />
              </div>

              {/* Image preview */}
              {pendingImage && (
                <div style={s.imgPreview}>
                  <img src={pendingImage.preview} alt="pending" style={{ height:48, width:48, objectFit:'cover' as const, borderRadius:6 }} />
                  <span style={{ fontSize:11, color:'#888', flex:1 }}>Image attached</span>
                  <button onClick={() => setPendingImage(null)} style={s.removeImgBtn}>✕</button>
                </div>
              )}

              <div style={s.inputArea}>
                <div style={s.modeRow}>
                  <button onClick={() => { setMode('plan'); setPendingPlan(null) }} style={{ ...s.modeBtn, ...(mode==='plan' ? s.modeBtnOn : {}) }}>📋 Plan</button>
                  <button onClick={() => setMode('build')} style={{ ...s.modeBtn, ...(mode==='build' ? s.modeBtnOn : {}) }}>⚡ Build</button>
                  <span style={{ flex:1 }} />
                  <button onClick={() => fileInputRef.current?.click()} style={s.imgBtn} title="Attach image">🖼</button>
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleImageUpload} />
                </div>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  onPaste={handlePaste}
                  placeholder={pendingImage ? 'Describe what you want based on the image...' : 'Paste an image or describe what to build...'}
                  rows={3} style={s.textarea} disabled={loading}
                />
                <button onClick={sendMessage} disabled={loading || (!input.trim() && !pendingImage)} style={s.sendBtn}>
                  {loading ? 'Working...' : mode==='plan' ? '📋 Create Plan' : '⚡ Build'}
                </button>
              </div>
            </>
          )}

          {sidebarTab === 'pages' && (
            <div style={s.pagesPanel}>
              <div style={{ padding:12 }}>
                {showNewPage ? (
                  <div style={{ display:'flex', gap:6 }}>
                    <input autoFocus value={newPageName} onChange={e => setNewPageName(e.target.value)}
                      onKeyDown={e => { if (e.key==='Enter') createPage(newPageName) }}
                      placeholder="Page name..." style={s.newInput} />
                    <button onClick={() => createPage(newPageName)} style={s.addBtn}>Add</button>
                    <button onClick={() => setShowNewPage(false)} style={s.cancelBtn}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => setShowNewPage(true)} style={s.newPageBtn}>+ New page</button>
                )}
              </div>
              <div style={{ flex:1, overflowY:'auto' }}>
                {pages.map(page => (
                  <div key={page.id} style={{ ...s.pageItem, ...(activePage?.id===page.id ? s.pageItemOn : {}) }}>
                    <div style={{ flex:1, cursor:'pointer' }} onClick={() => { setActivePage(page); setSidebarTab('chat') }}>
                      <div style={{ fontSize:13, fontWeight:500, color:'#f0f0f0' }}>{page.name}</div>
                      <div style={{ fontSize:11, color:'#444', marginTop:2 }}>{new Date(page.updated_at).toLocaleDateString()}</div>
                    </div>
                    {pages.length > 1 && <button onClick={() => deletePage(page.id)} style={s.delBtn}>✕</button>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={s.right}>
          <div style={s.previewBar}>
            {/* Page selector dropdown */}
            <div style={s.pageSelector}>
              <span style={s.pageSelectorIcon}>⊞</span>
              <select
                value={activePage?.id || ''}
                onChange={e => {
                  const page = pages.find(p => p.id === e.target.value)
                  if (page) { setActivePage(page); setSidebarTab('chat') }
                }}
                style={s.pageSelectorSelect}
              >
                {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {/* Fake URL bar */}
            <div style={s.urlBar}>
              <span style={{ color: '#2a2a2a' }}>preview /</span>
              <span style={{ color: '#555', marginLeft: 6 }}>
                {activePage?.name?.toLowerCase().replace(/\s+/g, '-') || 'page'}
              </span>
            </div>
            <button onClick={() => activePage && renderIframe(activePage.code)} style={s.refreshBtn}>↺</button>
          </div>
          {showCode && activePage ? (
            <div style={s.codePanel}>
              <div style={s.codeHeader}>
                <span style={{ color:'#666', fontSize:12 }}>Source — {activePage.name}</span>
                <button onClick={() => navigator.clipboard.writeText(activePage.code)} style={s.copyBtn}>Copy</button>
              </div>
              <pre style={s.codeContent}>{activePage.code}</pre>
            </div>
          ) : (
            <iframe ref={iframeRef} sandbox="allow-scripts allow-forms allow-modals" style={s.iframe} title="preview" />
          )}
        </div>
      </div>

      {/* Buy Credits Modal */}
      {showBuyCredits && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h2 style={s.modalTitle}>Out of credits</h2>
            <p style={{ color:'#888', fontSize:13, marginBottom:20 }}>Purchase credits to continue building.</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:16 }}>
              {[{id:'pack_5',label:'$5',desc:'~50 builds'},{id:'pack_10',label:'$10',desc:'~100 builds'},{id:'pack_25',label:'$25',desc:'~250 builds'},{id:'pack_50',label:'$50',desc:'~500 builds'}].map(pack => (
                <div key={pack.id} style={{ background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:10, padding:14, textAlign:'center' as const }}>
                  <div style={{ fontSize:20, fontWeight:700, color:'#f0f0f0', marginBottom:4 }}>{pack.label}</div>
                  <div style={{ fontSize:11, color:'#666', marginBottom:10 }}>{pack.desc}</div>
                  <button onClick={() => buyCredits(pack.id)} style={{ width:'100%', padding:'7px 0', background:'#7c6ef7', border:'none', borderRadius:6, color:'white', fontSize:12, cursor:'pointer' }}>Buy {pack.label}</button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowBuyCredits(false)} style={{ padding:'8px 16px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#888', fontSize:13, cursor:'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}`}</style>
    </div>
  )
}

function getStarterCode() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"><\/script><script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7'}}}}}<\/script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"></head><body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10"><div class="text-center max-w-lg"><div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6"><i class="fa-solid fa-wand-magic-sparkles text-brand text-xl"></i></div><h1 class="text-white text-2xl font-semibold mb-3">Start building</h1><p class="text-white/50 text-sm leading-relaxed mb-8">Use the AI chat on the left to build anything you want.</p><div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm">Try: "Build an admin dashboard with a sidebar, stats and users table"</div></div></body></html>`
}

const s: Record<string, React.CSSProperties> = {
  loading: { display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#0a0a0a', color:'#555', fontFamily:'sans-serif' },
  root: { display:'flex', flexDirection:'column', height:'100vh', background:'#0a0a0a', overflow:'hidden', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  topbar: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', height:50, borderBottom:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', flexShrink:0 },
  topLeft: { display:'flex', alignItems:'center', gap:10 },
  backBtn: { padding:'5px 10px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, color:'#888', fontSize:12, cursor:'pointer' },
  sep: { color:'#333' },
  projectName: { fontSize:14, fontWeight:500, color:'#f0f0f0' },
  topRight: { display:'flex', alignItems:'center', gap:12 },
  codeBtn: { padding:'5px 12px', background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#666', fontSize:12, cursor:'pointer', fontFamily:'monospace' },
  codeBtnOn: { background:'rgba(124,110,247,0.1)', borderColor:'rgba(124,110,247,0.3)', color:'#9d92f5' },
  balancePill: { display:'flex', alignItems:'center', padding:'4px 10px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:20 },
  email: { fontSize:11, color:'#444' },
  main: { display:'flex', flex:1, overflow:'hidden' },
  left: { width:300, minWidth:300, display:'flex', flexDirection:'column', borderRight:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', overflow:'hidden' },
  tabs: { display:'flex', borderBottom:'1px solid rgba(255,255,255,0.07)', flexShrink:0 },
  tab: { flex:1, padding:10, background:'none', border:'none', color:'#444', fontSize:12, cursor:'pointer', fontWeight:500, borderBottom:'2px solid transparent' },
  tabOn: { color:'#f0f0f0', borderBottom:'2px solid #7c6ef7' },
  msgs: { flex:1, overflowY:'auto', padding:12, display:'flex', flexDirection:'column', gap:10 },
  chatActions: { display:'flex', justifyContent:'flex-end', marginBottom:4 },
  clearBtn: { fontSize:10, color:'#444', background:'none', border:'none', cursor:'pointer', padding:'2px 6px' },
  empty: { display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'32px 8px', flex:1 },
  chips: { display:'flex', flexWrap:'wrap', gap:5, justifyContent:'center' },
  chip: { padding:'4px 10px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:20, color:'#666', fontSize:11, cursor:'pointer' },
  msgRow: { display:'flex', flexDirection:'column' },
  msgRight: { alignItems:'flex-end' },
  bubble: { maxWidth:'92%', padding:'9px 12px', borderRadius:10 },
  bubbleUser: { background:'#7c6ef7', color:'white' },
  bubbleAI: { background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.07)', color:'#e0e0e0' },
  bubblePlan: { background:'rgba(124,110,247,0.07)', border:'1px solid rgba(124,110,247,0.2)', color:'#e0e0e0', maxWidth:'100%', width:'100%' },
  planLabel: { fontSize:11, fontWeight:600, color:'#9d92f5', marginBottom:8, textTransform:'uppercase' as const, letterSpacing:'0.05em' },
  approveBtn: { padding:'6px 14px', background:'#7c6ef7', border:'none', borderRadius:7, color:'white', fontSize:12, fontWeight:500, cursor:'pointer' },
  reviseBtn: { padding:'6px 12px', background:'none', border:'1px solid rgba(255,255,255,0.1)', borderRadius:7, color:'#666', fontSize:12, cursor:'pointer' },
  dot: { width:6, height:6, borderRadius:'50%', background:'#444', display:'inline-block', animation:'bounce 1.2s infinite' },
  errBox: { background:'rgba(163,45,45,0.12)', border:'1px solid rgba(163,45,45,0.25)', borderRadius:8, padding:'8px 12px', fontSize:12, color:'#f09595' },
  imgPreview: { display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'#1a1a1a', borderTop:'1px solid rgba(255,255,255,0.06)', flexShrink:0 },
  removeImgBtn: { background:'none', border:'none', color:'#666', cursor:'pointer', fontSize:12 },
  inputArea: { padding:10, borderTop:'1px solid rgba(255,255,255,0.07)', display:'flex', flexDirection:'column', gap:8, flexShrink:0 },
  modeRow: { display:'flex', alignItems:'center', gap:6 },
  modeBtn: { padding:'4px 10px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, color:'#666', fontSize:11, cursor:'pointer', fontWeight:500 },
  modeBtnOn: { background:'rgba(124,110,247,0.15)', borderColor:'rgba(124,110,247,0.3)', color:'#9d92f5' },
  imgBtn: { padding:'3px 8px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, cursor:'pointer', fontSize:14 },
  textarea: { padding:10, background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#f0f0f0', fontSize:13, resize:'none', outline:'none', lineHeight:1.5 },
  sendBtn: { padding:9, background:'#7c6ef7', border:'none', borderRadius:8, color:'white', fontSize:13, fontWeight:500, cursor:'pointer' },
  pagesPanel: { display:'flex', flexDirection:'column', flex:1, overflow:'hidden' },
  newPageBtn: { width:'100%', padding:8, background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#666', fontSize:13, cursor:'pointer', textAlign:'left' as const },
  newInput: { flex:1, padding:'7px 10px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#f0f0f0', fontSize:13, outline:'none' },
  addBtn: { padding:'7px 12px', background:'#7c6ef7', border:'none', borderRadius:6, color:'white', fontSize:12, cursor:'pointer' },
  cancelBtn: { padding:'7px 10px', background:'none', border:'1px solid rgba(255,255,255,0.08)', borderRadius:6, color:'#555', fontSize:12, cursor:'pointer' },
  pageItem: { display:'flex', alignItems:'center', padding:'10px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)', gap:8 },
  pageItemOn: { background:'rgba(124,110,247,0.07)' },
  delBtn: { background:'none', border:'none', color:'#333', cursor:'pointer', fontSize:11 },
  right: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  previewBar: { display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', flexShrink:0 },
  pageSelector: { display:'flex', alignItems:'center', gap:6, padding:'3px 8px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:7, flexShrink:0 },
  pageSelectorIcon: { fontSize:12, color:'#555' },
  pageSelectorSelect: { background:'none', border:'none', color:'#aaa', fontSize:12, outline:'none', cursor:'pointer', maxWidth:120 },
  urlBar: { flex:1, display:'flex', alignItems:'center', padding:'4px 12px', background:'#141414', border:'1px solid rgba(255,255,255,0.06)', borderRadius:7, fontSize:12 },
  refreshBtn: { padding:'4px 10px', background:'none', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, color:'#555', cursor:'pointer', fontSize:13, flexShrink:0 },
  iframe: { flex:1, border:'none', background:'#0a0a0a', width:'100%', height:'100%' },
  codePanel: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  codeHeader: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 16px', borderBottom:'1px solid rgba(255,255,255,0.07)', background:'#0f0f0f', flexShrink:0 },
  copyBtn: { padding:'4px 12px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:6, color:'#666', fontSize:12, cursor:'pointer' },
  codeContent: { flex:1, overflow:'auto', padding:16, fontSize:11.5, lineHeight:1.6, color:'#9d92f5', background:'#0a0a0a', fontFamily:'monospace', whiteSpace:'pre-wrap', wordBreak:'break-all' as const },
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50 },
  modal: { background:'#111', border:'1px solid rgba(255,255,255,0.1)', borderRadius:16, padding:28, width:'100%', maxWidth:400, display:'flex', flexDirection:'column', gap:12 },
  modalTitle: { fontSize:16, fontWeight:600, color:'#f0f0f0' },
}
