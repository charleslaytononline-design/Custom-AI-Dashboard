import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../../hooks/useMobile'
import { loadProjectFiles, saveFile, deleteFile, buildFileTree, getFileType } from '../../lib/virtualFS'
import type { ProjectFile, FileTreeNode } from '../../lib/virtualFS'
import FileTree from '../../components/FileTree'
import DeployButton from '../../components/DeployButton'
import GitHubConnect from '../../components/GitHubConnect'

const CodeEditor = dynamic(() => import('../../components/CodeEditor'), { ssr: false })

interface Message { id?: string; role: 'user' | 'assistant'; content: string; isPlan?: boolean; imageUrl?: string; fileOps?: Array<{ action: string; path: string }> }
type AppMode = 'build' | 'plan'

export default function ProjectBuilder() {
  const router = useRouter()
  const isMobile = useMobile()
  const { id: projectId } = router.query
  const [user, setUser] = useState<any>(null)
  const [project, setProject] = useState<any>(null)
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number>(0)
  const [mode, setMode] = useState<AppMode>('build')
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'split'>('code')
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'files'>('chat')
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'preview'>('chat')
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set())
  const [buildStatus, setBuildStatus] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null)
  const [showBuyCredits, setShowBuyCredits] = useState(false)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Auth
  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) { router.push('/'); return }
    })
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
    })
    return () => authListener.subscription.unsubscribe()
  }, [])

  // Load project + files
  useEffect(() => {
    if (projectId && user) {
      loadProject()
      loadFiles()
      loadProfile()
    }
  }, [projectId, user])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Update file tree when files change
  useEffect(() => { setFileTree(buildFileTree(files)) }, [files])

  async function loadProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', projectId).eq('user_id', user.id).single()
    if (!data) { router.push('/home'); return }
    setProject(data)
    // Load latest deployment URL
    const { data: dep } = await supabase.from('deployments').select('url').eq('project_id', projectId as string).order('created_at', { ascending: false }).limit(1).single()
    if (dep?.url) setDeployUrl(dep.url)
  }

  async function loadFiles() {
    if (!projectId) return
    const projectFiles = await loadProjectFiles(projectId as string)
    setFiles(projectFiles)
    // Auto-open App.tsx if no tabs open
    if (openTabs.length === 0) {
      const appFile = projectFiles.find(f => f.path === 'src/App.tsx')
      if (appFile) {
        setOpenTabs(['src/App.tsx'])
        setActiveTab('src/App.tsx')
      }
    }
  }

  async function loadProfile() {
    if (!user) return
    const { data } = await supabase.from('profiles').select('credit_balance, gift_balance').eq('id', user.id).single()
    if (data) setCreditBalance((data.credit_balance || 0) + (data.gift_balance || 0))
  }

  // Get active file content
  const activeFile = files.find(f => f.path === activeTab)
  const activeCode = activeFile?.content || ''

  // Open a file tab
  function openFile(node: FileTreeNode) {
    if (node.type !== 'file') return
    if (!openTabs.includes(node.path)) {
      setOpenTabs(prev => [...prev, node.path])
    }
    setActiveTab(node.path)
    setSidebarTab('chat')
  }

  // Close a tab
  function closeTab(path: string) {
    setOpenTabs(prev => {
      const next = prev.filter(p => p !== path)
      if (activeTab === path) {
        setActiveTab(next.length > 0 ? next[next.length - 1] : null)
      }
      return next
    })
  }

  // Save file content
  async function handleSave(code: string) {
    if (!activeTab || !user || !projectId) return
    const ft = getFileType(activeTab)
    await saveFile(projectId as string, user.id, activeTab, code, ft)
    setFiles(prev => prev.map(f => f.path === activeTab ? { ...f, content: code } : f))
  }

  // Code change handler (local only)
  function handleCodeChange(code: string) {
    setFiles(prev => prev.map(f => f.path === activeTab ? { ...f, content: code } : f))
  }

  // Create new file
  async function handleNewFile() {
    if (!newFilePath.trim() || !user || !projectId) return
    const path = newFilePath.trim()
    const ft = getFileType(path)
    const content = ft === 'ts' ? `export default function ${path.split('/').pop()?.replace(/\.\w+$/, '') || 'Component'}() {\n  return <div></div>\n}\n` : ''
    await saveFile(projectId as string, user.id, path, content, ft)
    setFiles(prev => [...prev, { id: '', project_id: projectId as string, user_id: user.id, path, content, file_type: ft, created_at: '', updated_at: '' }])
    setOpenTabs(prev => [...prev, path])
    setActiveTab(path)
    setShowNewFile(false)
    setNewFilePath('')
  }

  // Delete file
  async function handleDeleteFile(path: string) {
    if (!confirm(`Delete ${path}?`)) return
    if (!projectId) return
    await deleteFile(projectId as string, path)
    setFiles(prev => prev.filter(f => f.path !== path))
    closeTab(path)
  }

  // Get language from file path
  function getLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'tsx': case 'jsx': return 'typescript'
      case 'ts': return 'typescript'
      case 'js': return 'javascript'
      case 'css': return 'css'
      case 'json': return 'json'
      case 'html': return 'html'
      case 'md': return 'markdown'
      default: return 'plaintext'
    }
  }

  // Image upload
  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const preview = URL.createObjectURL(file)
    setPendingImage({ file, preview })
    e.target.value = ''
  }
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) {
          const preview = URL.createObjectURL(file)
          setPendingImage({ file, preview })
        }
        break
      }
    }
  }

  // Stop build
  function handleStop() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setLoading(false)
    setBuildStatus(null)
  }

  // Clear chat
  function clearChatHistory() {
    setMessages([])
    setPendingPlan(null)
  }

  // Send message
  async function sendMessage() {
    if ((!input.trim() && !pendingImage) || loading || !user) return
    if (creditBalance <= 0) { setShowBuyCredits(true); return }

    let imageUrl: string | undefined
    if (pendingImage) {
      const reader = new FileReader()
      imageUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(pendingImage.file)
      })
    }

    const userMsg: Message = { role: 'user', content: input.trim(), imageUrl }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingImage(null)
    setLoading(true)
    setLastError(null)
    setBuildStatus('Starting build...')

    const controller = new AbortController()
    abortControllerRef.current = controller

    const planOnly = mode === 'plan' && !pendingPlan

    try {
      const chatMessages = [...messages, userMsg].map(m => {
        const msg: any = { role: m.role, content: m.content }
        if (m.imageUrl) msg.imageUrl = m.imageUrl
        return msg
      })

      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: chatMessages,
          userId: user.id,
          projectId,
          planOnly,
          activeFilePath: activeTab,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || err.message || 'Build failed')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let streamedText = ''
      const fileOps: Array<{ action: string; path: string }> = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.type === 'delta') {
              streamedText += event.text
            } else if (event.type === 'status') {
              setBuildStatus(event.text)
            } else if (event.type === 'file_op') {
              fileOps.push({ action: event.action, path: event.path })
              setBuildStatus(`${event.action === 'create' ? 'Created' : event.action === 'edit' ? 'Updated' : 'Deleted'} ${event.path}`)
              setRecentlyChanged(prev => { const arr = Array.from(prev); arr.push(event.path); return new Set(arr) })
              setTimeout(() => {
                setRecentlyChanged(prev => { const next = new Set(prev); next.delete(event.path); return next })
              }, 3000)
            } else if (event.type === 'done') {
              await loadFiles()

              if (planOnly && event.message) {
                setPendingPlan(event.message)
                setMessages(prev => [...prev, { role: 'assistant', content: event.message, isPlan: true }])
              } else {
                const assistantMsg = event.message || 'Build complete'
                setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg, fileOps }])
              }

              if (event.newBalance !== undefined) setCreditBalance(event.newBalance)

              // Auto-open first changed file
              if (fileOps.length > 0) {
                const firstChanged = fileOps.find(op => op.action !== 'delete')
                if (firstChanged) {
                  if (!openTabs.includes(firstChanged.path)) {
                    setOpenTabs(prev => [...prev, firstChanged.path])
                  }
                  setActiveTab(firstChanged.path)
                }
              }
            } else if (event.type === 'error') {
              setLastError(event.error || event.message)
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setLastError(err.message)
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
      }
    } finally {
      setLoading(false)
      setBuildStatus(null)
      abortControllerRef.current = null
    }
  }

  // Plan approval
  function approvePlan() {
    if (!pendingPlan) return
    setInput(`Execute this plan:\n${pendingPlan}`)
    setMode('build')
    setPendingPlan(null)
    setTimeout(() => sendMessage(), 100)
  }

  // Buy credits
  async function buyCredits(packId: string) {
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, userId: user.id }),
      })
      const { url } = await res.json()
      if (url) window.location.href = url
    } catch {}
  }

  if (!user || !project) return <div className="flex items-center justify-center h-screen bg-surface text-[#555] font-sans">Loading...</div>

  const balanceDisplay = `$${creditBalance.toFixed(2)}`
  const balanceColor = creditBalance > 0 ? '#5DCAA5' : '#f09595'

  // Mobile panel visibility
  const showLeft = !isMobile || mobilePanel === 'chat'
  const showRight = !isMobile || mobilePanel === 'preview'

  // Render editor with tabs
  const renderEditor = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* TABS */}
      <div className="flex border-b border-white/[0.06] bg-surface-1 overflow-auto shrink-0">
        {openTabs.map(tab => (
          <div
            key={tab}
            className={`flex items-center gap-1.5 px-3 py-1.5 cursor-pointer whitespace-nowrap text-xs border-r border-white/[0.04] ${
              tab === activeTab ? 'bg-surface-2 text-[#f0f0f0] border-b-2 border-b-brand' : 'text-[#666] border-b-2 border-b-transparent'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            <span>{tab.split('/').pop()}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab) }}
              className="bg-transparent border-none text-[#555] cursor-pointer text-sm px-0.5 leading-none"
            >×</button>
          </div>
        ))}
      </div>
      {activeTab ? (
        <CodeEditor
          code={activeCode}
          onChange={handleCodeChange}
          onSave={handleSave}
          pageName={activeTab}
          language={getLanguage(activeTab)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-[#444] text-[13px]">
          Select a file to start editing
        </div>
      )}
    </div>
  )

  return (
    <div className={`flex flex-col bg-surface overflow-hidden font-sans ${isMobile ? 'h-dvh' : 'h-screen'}`}>
      {/* TOPBAR */}
      <div className="flex items-center justify-between px-3 h-[50px] border-b border-white/[0.07] bg-surface-1 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <button onClick={() => router.push('/home')} className="px-2.5 py-1 bg-transparent border border-white/[0.08] rounded-md text-[#888] text-xs cursor-pointer shrink-0">← {isMobile ? '' : 'Projects'}</button>
          {!isMobile && <span className="text-[#333] shrink-0">/</span>}
          <span className={`text-sm font-medium text-[#f0f0f0] ${isMobile ? 'max-w-[120px]' : ''} overflow-hidden text-ellipsis whitespace-nowrap`}>
            {project.name}
          </span>
        </div>

        {isMobile ? (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-full">
              <span className="text-[11px] font-semibold" style={{ color: balanceColor }}>{balanceDisplay}</span>
              <span className="text-[10px] text-[#444] ml-1">cr</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex gap-0.5 bg-surface-2 rounded-[7px] border border-white/[0.08] p-0.5">
              <button onClick={() => setViewMode('preview')} className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium cursor-pointer border-none ${viewMode==='preview' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[#666]'}`}>Preview</button>
              <button onClick={() => setViewMode('code')} className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium cursor-pointer border-none ${viewMode==='code' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[#666]'}`}>Code</button>
              <button onClick={() => setViewMode('split')} className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium cursor-pointer border-none ${viewMode==='split' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[#666]'}`}>Split</button>
            </div>
            <GitHubConnect projectId={projectId as string} userId={user.id} projectName={project.name} />
            <DeployButton projectId={projectId as string} userId={user.id} />
            <div className="flex items-center px-2.5 py-1 bg-white/[0.04] border border-white/[0.08] rounded-full">
              <span className="text-[11px] font-semibold" style={{ color: balanceColor }}>{balanceDisplay}</span>
              <span className="text-[10px] text-[#444] ml-1">credits</span>
            </div>
            <span className="text-[11px] text-[#444]">{user.email}</span>
          </div>
        )}
      </div>

      {/* MAIN */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL */}
        <div className={`${isMobile ? 'w-full min-w-0' : 'w-[300px] min-w-[300px] border-r border-white/[0.07]'} flex flex-col bg-surface-1 overflow-hidden ${isMobile && !showLeft ? 'hidden' : ''}`}>
          <div className="flex border-b border-white/[0.07] shrink-0 items-center">
            <button className={`flex-1 py-2.5 bg-transparent border-none text-xs font-medium cursor-pointer border-b-2 ${sidebarTab==='chat' ? 'text-[#f0f0f0] border-brand' : 'text-[#444] border-transparent'}`} onClick={() => setSidebarTab('chat')}>Chat</button>
            <button className={`flex-1 py-2.5 bg-transparent border-none text-xs font-medium cursor-pointer border-b-2 ${sidebarTab==='files' ? 'text-[#f0f0f0] border-brand' : 'text-[#444] border-transparent'}`} onClick={() => setSidebarTab('files')}>Files ({files.length})</button>
          </div>

          {sidebarTab === 'chat' && (
            <>
              <div className={`flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 ${isMobile ? 'pb-[60px]' : ''}`}>
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-2 py-8 flex-1">
                    <div className="text-[28px] mb-3">✦</div>
                    <p className="text-[#555] text-[13px] text-center leading-relaxed mb-5">
                      Describe what to build and I'll create it instantly. You can also upload a screenshot for reference.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {['Admin dashboard with sidebar', 'Inventory tracker', 'Sales dashboard with charts', 'User management panel'].map(t => (
                        <button key={t} className="px-2.5 py-1 bg-surface-3 border border-white/[0.08] rounded-full text-[#666] text-[11px] cursor-pointer" onClick={() => setInput(t)}>{t}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-end mb-1">
                      <button onClick={clearChatHistory} className="text-[10px] text-[#444] bg-transparent border-none cursor-pointer px-1.5 py-0.5">Clear history</button>
                    </div>
                    {messages.map((msg, i) => (
                      <div key={i} className={`flex flex-col ${msg.role==='user' ? 'items-end' : ''}`}>
                        <div className={`max-w-[92%] px-3 py-2 rounded-[10px] ${
                          msg.role==='user'
                            ? 'bg-brand text-white'
                            : msg.isPlan
                            ? 'bg-brand/[0.07] border border-brand/20 text-[#e0e0e0] max-w-full w-full'
                            : 'bg-surface-3 border border-white/[0.07] text-[#e0e0e0]'
                        }`}>
                          {msg.isPlan && <div className="text-[11px] font-semibold text-[#9d92f5] mb-2 uppercase tracking-wider">Plan — approve to build</div>}
                          {msg.imageUrl && (
                            <img src={msg.imageUrl} alt="uploaded" className="w-full rounded-md mb-2 max-h-[150px] object-cover" />
                          )}
                          <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed">{msg.content}</div>
                          {msg.fileOps && msg.fileOps.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {msg.fileOps.map((op, j) => (
                                <button
                                  key={j}
                                  onClick={() => {
                                    if (op.action !== 'delete') {
                                      if (!openTabs.includes(op.path)) setOpenTabs(prev => [...prev, op.path])
                                      setActiveTab(op.path)
                                    }
                                  }}
                                  className="text-[10px] px-1.5 py-0.5 rounded cursor-pointer border"
                                  style={{
                                    background: op.action === 'create' ? '#22c55e15' : op.action === 'edit' ? '#3b82f615' : '#ef444415',
                                    borderColor: op.action === 'create' ? '#22c55e30' : op.action === 'edit' ? '#3b82f630' : '#ef444430',
                                    color: op.action === 'create' ? '#4ade80' : op.action === 'edit' ? '#60a5fa' : '#f87171',
                                  }}
                                >
                                  {op.action === 'create' ? '+' : op.action === 'edit' ? '~' : '-'} {op.path.split('/').pop()}
                                </button>
                              ))}
                            </div>
                          )}
                          {msg.isPlan && pendingPlan && (
                            <div className="flex gap-2 mt-3">
                              <button onClick={approvePlan} className="px-3.5 py-1.5 bg-brand border-none rounded-[7px] text-white text-xs font-medium cursor-pointer">✓ Approve & Build</button>
                              <button onClick={() => setPendingPlan(null)} className="px-3 py-1.5 bg-transparent border border-white/10 rounded-[7px] text-[#666] text-xs cursor-pointer">✕ Revise</button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {loading && buildStatus && (
                  <div className="flex flex-col">
                    <div className="max-w-[92%] px-3 py-2 rounded-[10px] bg-surface-3 border border-white/[0.07] text-[#e0e0e0]">
                      <div className="flex gap-1.5 items-center">
                        <span className="text-[#7c6ef7] text-xs inline-block animate-spin">⚙</span>
                        <span className="text-[#555] text-xs">{buildStatus}</span>
                      </div>
                    </div>
                  </div>
                )}
                {loading && !buildStatus && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="flex flex-col">
                    <div className="max-w-[92%] px-3 py-2 rounded-[10px] bg-surface-3 border border-white/[0.07] text-[#e0e0e0]">
                      <div className="flex gap-1.5 items-center">
                        {[0,1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-[#444] inline-block animate-bounce" style={{ animationDelay:`${i*0.2}s` }} />)}
                        <span className="text-[#555] text-xs ml-1">Building...</span>
                      </div>
                    </div>
                  </div>
                )}
                {lastError && (
                  <div className="bg-[#a32d2d1f] border border-[#a32d2d40] rounded-lg px-3 py-2 text-xs text-[#f09595]">
                    <strong>Error:</strong> {lastError}
                    <button onClick={() => { setLastError(null); sendMessage() }} className="ml-2 px-2 py-0.5 bg-[#a32d2d40] border-none rounded text-[#f09595] text-[11px] cursor-pointer hover:bg-[#a32d2d60]">Retry</button>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {pendingImage && (
                <div className="flex items-center gap-2 px-2.5 py-2 bg-surface-3 border-t border-white/[0.06] shrink-0">
                  <img src={pendingImage.preview} alt="pending" className="h-12 w-12 object-cover rounded-md" />
                  <span className="text-[11px] text-[#888] flex-1">Image attached</span>
                  <button onClick={() => setPendingImage(null)} className="bg-transparent border-none text-[#666] cursor-pointer text-xs">✕</button>
                </div>
              )}

              <div className="p-2.5 border-t border-white/[0.07] flex flex-col gap-2 shrink-0">
                <div className="flex items-center gap-1.5">
                  <button onClick={() => { setMode('plan'); setPendingPlan(null) }} className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer border ${mode==='plan' ? 'bg-brand/[0.15] border-brand/30 text-[#9d92f5]' : 'bg-surface-3 border-white/[0.08] text-[#666]'}`}>Plan</button>
                  <button onClick={() => setMode('build')} className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer border ${mode==='build' ? 'bg-brand/[0.15] border-brand/30 text-[#9d92f5]' : 'bg-surface-3 border-white/[0.08] text-[#666]'}`}>Build</button>
                  {loading && (
                    <button onClick={handleStop} className="px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer border bg-red-500/[0.15] border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors" title="Stop current operation">Stop</button>
                  )}
                  <span className="flex-1" />
                  <button onClick={() => fileInputRef.current?.click()} className="px-2 py-0.5 bg-surface-3 border border-white/[0.08] rounded-md cursor-pointer text-sm" title="Attach image">🖼</button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </div>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  onPaste={handlePaste}
                  placeholder={pendingImage ? 'Describe what you want based on the image...' : 'Paste an image or describe what to build...'}
                  rows={3} className="p-2.5 bg-surface-3 border border-white/[0.08] rounded-lg text-[#f0f0f0] text-[13px] resize-none outline-none leading-relaxed" disabled={loading}
                />
                <button onClick={sendMessage} disabled={loading || (!input.trim() && !pendingImage)} className="py-2 bg-brand border-none rounded-lg text-white text-[13px] font-medium cursor-pointer disabled:opacity-50">
                  {loading ? 'Working...' : mode==='plan' ? 'Create Plan' : 'Build'}
                </button>
              </div>
            </>
          )}

          {sidebarTab === 'files' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="p-3">
                {showNewFile ? (
                  <div className="flex gap-1.5">
                    <input autoFocus value={newFilePath} onChange={e => setNewFilePath(e.target.value)}
                      onKeyDown={e => { if (e.key==='Enter') handleNewFile() }}
                      placeholder="e.g. src/pages/Dashboard.tsx" className="flex-1 px-2.5 py-1.5 bg-surface-3 border border-white/10 rounded-md text-[#f0f0f0] text-[13px] outline-none" />
                    <button onClick={handleNewFile} className="px-3 py-1.5 bg-brand border-none rounded-md text-white text-xs cursor-pointer">Add</button>
                    <button onClick={() => { setShowNewFile(false); setNewFilePath('') }} className="px-2.5 py-1.5 bg-transparent border border-white/[0.08] rounded-md text-[#555] text-xs cursor-pointer">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setShowNewFile(true)} className="w-full py-2 bg-surface-3 border border-white/[0.08] rounded-lg text-[#666] text-[13px] cursor-pointer text-left px-3">+ New file</button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                <FileTree
                  nodes={fileTree}
                  activeFilePath={activeTab}
                  onFileSelect={openFile}
                  onNewFile={() => setShowNewFile(true)}
                  onDeleteFile={handleDeleteFile}
                />
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div className={`flex-1 flex flex-col overflow-hidden ${isMobile && !showRight ? 'hidden' : ''} ${isMobile ? 'pb-[50px]' : ''}`}>
          {/* SUB-TOPBAR */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.07] bg-surface-1 shrink-0">
            {activeTab && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface-3 border border-white/[0.08] rounded-[7px] shrink-0">
                <span className="text-xs text-[#555]">⊞</span>
                <select
                  value={activeTab || ''}
                  onChange={e => {
                    const path = e.target.value
                    if (path) {
                      if (!openTabs.includes(path)) setOpenTabs(prev => [...prev, path])
                      setActiveTab(path)
                    }
                  }}
                  className="bg-transparent border-none text-[#aaa] text-xs outline-none cursor-pointer max-w-[120px]"
                >
                  {files.map(f => <option key={f.path} value={f.path}>{f.path.split('/').pop()}</option>)}
                </select>
              </div>
            )}
            {!isMobile && (
              <div className="flex-1 flex items-center px-3 py-1 bg-surface-2 border border-white/[0.06] rounded-[7px] text-xs overflow-hidden">
                <span className="text-[#333] select-none">customaidashboard.com / preview /</span>
                <span className="text-[#666] ml-1.5">
                  {activeTab?.split('/').pop() || 'file'}
                </span>
              </div>
            )}
            {isMobile && (
              <button onClick={() => setViewMode(viewMode === 'code' ? 'preview' : 'code')} className={`px-3 py-1 rounded-[7px] text-xs cursor-pointer font-mono border ml-auto ${viewMode==='code' ? 'bg-brand/10 border-brand/30 text-[#9d92f5]' : 'bg-transparent border-white/10 text-[#666]'}`}>
                {'</>'}
              </button>
            )}
            {deployUrl && (
              <button onClick={() => window.open(`https://${deployUrl}`, '_blank', 'noopener')} className="px-2.5 py-1 bg-transparent border border-white/[0.07] rounded-md text-[#555] cursor-pointer text-[13px] shrink-0" title="Open deployed site">↗</button>
            )}
          </div>

          {/* CONTENT AREA */}
          {viewMode === 'split' ? (
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden border-r border-white/[0.07]">
                {renderEditor()}
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                {deployUrl ? (
                  <iframe ref={iframeRef} src={`https://${deployUrl}`} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" className="flex-1 border-none bg-surface w-full h-full" title="preview" />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-[#444] text-[13px] flex-col gap-3">
                    <div className="text-2xl opacity-20">⚡</div>
                    <p>Deploy your project to see a preview</p>
                  </div>
                )}
              </div>
            </div>
          ) : viewMode === 'code' ? (
            <div className="flex flex-1 overflow-hidden">
              {/* Inline file tree for code view */}
              {!isMobile && (
                <div className="w-[180px] min-w-[180px] border-r border-white/[0.07] flex flex-col overflow-hidden bg-surface-1">
                  <div className="px-3 py-2 border-b border-white/[0.05] text-[11px] text-[#555] font-semibold uppercase tracking-wider">Files</div>
                  <div className="flex-1 overflow-y-auto">
                    <FileTree
                      nodes={fileTree}
                      activeFilePath={activeTab}
                      onFileSelect={openFile}
                      onNewFile={() => setShowNewFile(true)}
                      onDeleteFile={handleDeleteFile}
                    />
                  </div>
                </div>
              )}
              {renderEditor()}
            </div>
          ) : (
            /* Preview mode */
            deployUrl ? (
              <iframe ref={iframeRef} src={`https://${deployUrl}`} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" className="flex-1 border-none bg-surface w-full h-full" title="preview" />
            ) : (
              <div className="flex-1 flex items-center justify-center text-[#444] text-[13px] flex-col gap-3">
                <div className="text-2xl opacity-20">⚡</div>
                <p>Deploy your project to see a preview</p>
              </div>
            )
          )}
        </div>
      </div>

      {/* MOBILE BOTTOM NAV BAR */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-end px-3 h-[50px] border-t border-white/[0.07] bg-surface-1 pb-safe">
          <div className="flex gap-1">
            <button onClick={() => setMobilePanel('chat')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border ${mobilePanel === 'chat' ? 'bg-brand/[0.15] border-brand/30 text-[#9d92f5]' : 'bg-surface-3 border-white/[0.08] text-[#666]'}`}>
              Chat
            </button>
            <button onClick={() => setMobilePanel('preview')}
              className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer border ${mobilePanel === 'preview' ? 'bg-brand/[0.15] border-brand/30 text-[#9d92f5]' : 'bg-surface-3 border-white/[0.08] text-[#666]'}`}>
              Preview
            </button>
          </div>
        </div>
      )}

      {/* Buy Credits Modal */}
      {showBuyCredits && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className={`bg-[#111] border border-white/10 rounded-2xl p-7 w-full flex flex-col gap-3 ${isMobile ? 'max-w-[calc(100%-32px)]' : 'max-w-[400px]'}`}>
            <h2 className="text-base font-semibold text-[#f0f0f0]">Out of credits</h2>
            <p className="text-[#888] text-[13px] mb-5">Purchase credits to continue building.</p>
            <div className="grid grid-cols-2 gap-2.5 mb-4">
              {[{id:'pack_5',label:'$5',desc:'~50 builds'},{id:'pack_10',label:'$10',desc:'~100 builds'},{id:'pack_25',label:'$25',desc:'~250 builds'},{id:'pack_50',label:'$50',desc:'~500 builds'}].map(pack => (
                <div key={pack.id} className="bg-surface-3 border border-white/[0.08] rounded-[10px] p-3.5 text-center">
                  <div className="text-xl font-bold text-[#f0f0f0] mb-1">{pack.label}</div>
                  <div className="text-[11px] text-[#666] mb-2.5">{pack.desc}</div>
                  <button onClick={() => buyCredits(pack.id)} className="w-full py-1.5 bg-brand border-none rounded-md text-white text-xs cursor-pointer">Buy {pack.label}</button>
                </div>
              ))}
            </div>
            <button onClick={() => setShowBuyCredits(false)} className="px-4 py-2 bg-transparent border border-white/[0.08] rounded-lg text-[#888] text-[13px] cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
