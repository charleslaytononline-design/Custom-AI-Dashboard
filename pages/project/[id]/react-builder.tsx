import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '../../../lib/supabase'
import { loadProjectFiles, saveFile, deleteFile, buildFileTree, getFileType } from '../../../lib/virtualFS'
import type { ProjectFile, FileTreeNode } from '../../../lib/virtualFS'
import FileTree from '../../../components/FileTree'

const CodeEditor = dynamic(() => import('../../../components/CodeEditor'), { ssr: false })

interface Message { id?: string; role: 'user' | 'assistant'; content: string; isPlan?: boolean; fileOps?: Array<{ action: string; path: string }> }
type AppMode = 'build' | 'plan'

export default function ReactBuilder() {
  const router = useRouter()
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
  const [showChat, setShowChat] = useState(true)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [buildStatus, setBuildStatus] = useState<string | null>(null)
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFilePath, setNewFilePath] = useState('')
  const [recentlyChanged, setRecentlyChanged] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) { router.push('/'); return }
      setUser(data.user)
    })
  }, [])

  // Load project + files
  useEffect(() => {
    if (projectId && user) {
      loadProject()
      loadFiles()
    }
  }, [projectId, user])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Update file tree when files change
  useEffect(() => {
    setFileTree(buildFileTree(files))
  }, [files])

  async function loadProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', projectId).single()
    if (data) setProject(data)
  }

  async function loadFiles() {
    if (!projectId) return
    const projectFiles = await loadProjectFiles(projectId as string)
    setFiles(projectFiles)
    // Auto-open App.tsx
    const appFile = projectFiles.find(f => f.path === 'src/App.tsx')
    if (appFile) {
      setOpenTabs(['src/App.tsx'])
      setActiveTab('src/App.tsx')
    }
  }

  async function loadProfile() {
    if (!user) return
    const { data } = await supabase.from('profiles').select('credit_balance, gift_balance').eq('id', user.id).single()
    if (data) setCreditBalance((data.credit_balance || 0) + (data.gift_balance || 0))
  }

  useEffect(() => { if (user) loadProfile() }, [user])

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

  // Code change handler (local only, no save)
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

  // Stop build
  function stopBuild() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setLoading(false)
    setBuildStatus(null)
  }

  // Send message to AI
  async function sendMessage() {
    if (!input.trim() || loading || !user) return

    const userMsg: Message = { role: 'user', content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setBuildStatus('Starting build...')

    const controller = new AbortController()
    abortControllerRef.current = controller

    const planOnly = mode === 'plan' && !pendingPlan

    try {
      const chatMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))

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
              // Highlight recently changed files
              setRecentlyChanged(prev => { const arr = Array.from(prev); arr.push(event.path); return new Set(arr) })
              setTimeout(() => {
                setRecentlyChanged(prev => { const next = new Set(prev); next.delete(event.path); return next })
              }, 3000)
            } else if (event.type === 'done') {
              // Reload files from DB to get all changes
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
              setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${event.error || event.message}` }])
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
      }
    } finally {
      setLoading(false)
      setBuildStatus(null)
      abortControllerRef.current = null
    }
  }

  // Execute pending plan
  function executePlan() {
    if (!pendingPlan) return
    setInput(`Execute this plan:\n${pendingPlan}`)
    setMode('build')
    setPendingPlan(null)
    setTimeout(() => sendMessage(), 100)
  }

  // Get language from file path for Monaco
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

  if (!project) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a', color: '#f0f0f0' }}>
      {/* TOPBAR */}
      <div style={s.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/home')} style={s.backBtn}>←</button>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{project.name}</span>
          <span style={{ fontSize: 11, color: '#555', background: '#1a1a1a', padding: '2px 8px', borderRadius: 4 }}>React</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#555' }}>${creditBalance.toFixed(2)} credits</span>
          <button onClick={() => setShowChat(!showChat)} style={{ ...s.topBtn, background: showChat ? '#7c6ef720' : '#1a1a1a', color: showChat ? '#7c6ef7' : '#888' }}>
            Chat
          </button>
        </div>
      </div>

      {/* MAIN AREA */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* FILE TREE */}
        <div style={s.fileTreePanel}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 11, color: '#555', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
            Files
          </div>
          <FileTree
            nodes={fileTree}
            activeFilePath={activeTab}
            onFileSelect={openFile}
            onNewFile={() => setShowNewFile(true)}
            onDeleteFile={handleDeleteFile}
          />
        </div>

        {/* EDITOR AREA */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* TABS */}
          <div style={s.tabBar}>
            {openTabs.map(tab => (
              <div
                key={tab}
                style={{
                  ...s.tab,
                  background: tab === activeTab ? '#141414' : 'transparent',
                  color: tab === activeTab ? '#f0f0f0' : '#666',
                  borderBottom: tab === activeTab ? '2px solid #7c6ef7' : '2px solid transparent',
                }}
                onClick={() => setActiveTab(tab)}
              >
                <span style={{ fontSize: 12 }}>{tab.split('/').pop()}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); closeTab(tab) }}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* CODE EDITOR */}
          {activeTab ? (
            <CodeEditor
              code={activeCode}
              onChange={handleCodeChange}
              onSave={handleSave}
              pageName={activeTab}
              language={getLanguage(activeTab)}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 }}>
              Select a file from the tree to start editing
            </div>
          )}
        </div>

        {/* CHAT PANEL */}
        {showChat && (
          <div style={s.chatPanel}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#aaa' }}>AI Builder</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setMode('build')}
                  style={{ ...s.modeBtn, background: mode === 'build' ? '#7c6ef7' : '#1a1a1a', color: mode === 'build' ? 'white' : '#666' }}
                >
                  Build
                </button>
                <button
                  onClick={() => setMode('plan')}
                  style={{ ...s.modeBtn, background: mode === 'plan' ? '#7c6ef7' : '#1a1a1a', color: mode === 'plan' ? 'white' : '#666' }}
                >
                  Plan
                </button>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {messages.map((msg, i) => (
                <div key={i} style={{
                  padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                  background: msg.role === 'user' ? '#7c6ef715' : '#141414',
                  border: `1px solid ${msg.role === 'user' ? '#7c6ef720' : 'rgba(255,255,255,0.05)'}`,
                  color: msg.role === 'user' ? '#d0c8ff' : '#ccc',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '90%',
                }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  {msg.fileOps && msg.fileOps.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {msg.fileOps.map((op, j) => (
                        <button
                          key={j}
                          onClick={() => {
                            if (op.action !== 'delete') {
                              if (!openTabs.includes(op.path)) setOpenTabs(prev => [...prev, op.path])
                              setActiveTab(op.path)
                            }
                          }}
                          style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                            background: op.action === 'create' ? '#22c55e15' : op.action === 'edit' ? '#3b82f615' : '#ef444415',
                            border: `1px solid ${op.action === 'create' ? '#22c55e30' : op.action === 'edit' ? '#3b82f630' : '#ef444430'}`,
                            color: op.action === 'create' ? '#4ade80' : op.action === 'edit' ? '#60a5fa' : '#f87171',
                          }}
                        >
                          {op.action === 'create' ? '+' : op.action === 'edit' ? '~' : '-'} {op.path.split('/').pop()}
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.isPlan && pendingPlan && (
                    <button onClick={executePlan} style={{ marginTop: 8, padding: '6px 14px', background: '#7c6ef7', border: 'none', borderRadius: 6, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                      Execute this plan
                    </button>
                  )}
                </div>
              ))}
              {buildStatus && (
                <div style={{ padding: '6px 10px', background: '#7c6ef710', borderRadius: 8, fontSize: 12, color: '#7c6ef7', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚙</span>
                  {buildStatus}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
                  }}
                  placeholder={mode === 'plan' ? 'Describe what you want to build...' : 'Tell the AI what to build or change...'}
                  style={s.chatInput}
                  rows={2}
                />
                {loading ? (
                  <button onClick={stopBuild} style={{ ...s.sendBtn, background: '#ef4444' }}>Stop</button>
                ) : (
                  <button onClick={sendMessage} disabled={!input.trim()} style={{ ...s.sendBtn, opacity: input.trim() ? 1 : 0.5 }}>
                    {mode === 'plan' ? 'Plan' : 'Build'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* NEW FILE MODAL */}
      {showNewFile && (
        <div style={s.overlay}>
          <div style={s.modal}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f0f0f0', marginBottom: 12 }}>New File</h3>
            <input
              autoFocus
              value={newFilePath}
              onChange={e => setNewFilePath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNewFile()}
              placeholder="e.g. src/pages/Dashboard.tsx"
              style={s.input}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => { setShowNewFile(false); setNewFilePath('') }} style={s.cancelBtn}>Cancel</button>
              <button onClick={handleNewFile} disabled={!newFilePath.trim()} style={s.createBtn}>Create</button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 44, borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0f0f0f', flexShrink: 0 },
  backBtn: { background: 'none', border: 'none', color: '#888', fontSize: 16, cursor: 'pointer', padding: '4px 8px' },
  topBtn: { padding: '4px 12px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 500 },
  fileTreePanel: { width: 220, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 },
  tabBar: { display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0f0f0f', overflow: 'auto', flexShrink: 0 },
  tab: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap' as const, fontSize: 12, borderRight: '1px solid rgba(255,255,255,0.04)' },
  chatPanel: { width: 360, borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 },
  modeBtn: { padding: '3px 10px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: 500 },
  chatInput: { flex: 1, padding: '8px 12px', background: '#141414', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f0f0', fontSize: 13, resize: 'none' as const, outline: 'none', fontFamily: 'inherit' },
  sendBtn: { padding: '8px 16px', background: '#7c6ef7', border: 'none', borderRadius: 8, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-end' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 24, width: 400 },
  input: { width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f0f0f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' as const },
  cancelBtn: { padding: '8px 16px', background: 'none', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#888', fontSize: 12, cursor: 'pointer' },
  createBtn: { padding: '8px 20px', background: '#7c6ef7', border: 'none', borderRadius: 8, color: 'white', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
}
