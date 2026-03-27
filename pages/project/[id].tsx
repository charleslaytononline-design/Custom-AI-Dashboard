import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../../hooks/useMobile'
import { loadProjectFiles, saveFile, deleteFile, buildFileTree, getFileType } from '../../lib/virtualFS'
import type { ProjectFile, FileTreeNode } from '../../lib/virtualFS'
import FileTree from '../../components/FileTree'
import DeployButton from '../../components/DeployButton'
import PreviewFrame from '../../components/PreviewFrame'
import { generateWelcomeHtml, DEFAULT_WELCOME_CONFIG } from '../../lib/welcomeConfig'
import type { WelcomeConfig } from '../../lib/welcomeConfig'
import GitHubConnect from '../../components/GitHubConnect'
import SupabaseConnect from '../../components/SupabaseConnect'
import DiffViewer from '../../components/DiffViewer'
import PackageManager from '../../components/PackageManager'
import EnvVarManager from '../../components/EnvVarManager'
import SchemaViewer from '../../components/SchemaViewer'
import DatabaseChoiceModal from '../../components/DatabaseChoiceModal'

const CodeEditor = dynamic(() => import('../../components/CodeEditor'), { ssr: false })

interface Message { id?: string; role: 'user' | 'assistant'; content: string; isPlan?: boolean; isDbChoice?: boolean; imageUrl?: string; fileOps?: Array<{ action: string; path: string }> }
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
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'split'>('preview')
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
  const [showPlanModal, setShowPlanModal] = useState(false)
  const [planModalContent, setPlanModalContent] = useState('')
  const [welcomeHtml, setWelcomeHtml] = useState<string | null>(null)
  const [buildTrigger, setBuildTrigger] = useState(0)
  const [showSupabaseConnect, setShowSupabaseConnect] = useState(false)
  const [projectSupabaseUrl, setProjectSupabaseUrl] = useState<string | null>(null)
  const [projectSupabaseAnonKey, setProjectSupabaseAnonKey] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [diffChanges, setDiffChanges] = useState<Array<{ path: string; action: 'create' | 'edit' | 'delete'; previousContent: string; newContent: string }>>([])
  const preBuiltFilesRef = useRef<Map<string, string>>(new Map())
  const [extraPackages, setExtraPackages] = useState<Record<string, string>>({})
  const [projectEnvVars, setProjectEnvVars] = useState<Record<string, string>>({})
  const [showSchemaViewer, setShowSchemaViewer] = useState(false)
  const [showDbChoice, setShowDbChoice] = useState(false)
  const [pendingDbTables, setPendingDbTables] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const streamingTextRef = useRef('')


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
      loadChatHistory()
    }
  }, [projectId, user])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Update file tree when files change
  useEffect(() => { setFileTree(buildFileTree(files)) }, [files])

  // Load welcome page HTML for preview placeholder
  useEffect(() => {
    async function loadWelcome() {
      const { data } = await supabase.from('settings').select('value').eq('key', 'welcome_page_config').maybeSingle()
      let config = DEFAULT_WELCOME_CONFIG
      if (data?.value) {
        try { config = JSON.parse(data.value) as WelcomeConfig } catch {}
      }
      setWelcomeHtml(generateWelcomeHtml(config))
    }
    loadWelcome()
  }, [])

  async function loadProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', projectId).eq('user_id', user.id).single()
    if (!data) { router.push('/home'); return }
    setProject(data)
    // Load Supabase connection
    if (data.supabase_url) setProjectSupabaseUrl(data.supabase_url)
    if (data.supabase_anon_key) setProjectSupabaseAnonKey(data.supabase_anon_key)
    // Backfill platform DB credentials for existing projects that don't have them saved
    if (data.db_provider === 'platform' && !data.supabase_url) {
      fetch('/api/projects/set-platform-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      }).then(r => r.json()).then(result => {
        if (result.url) setProjectSupabaseUrl(result.url)
        if (result.anonKey) setProjectSupabaseAnonKey(result.anonKey)
      }).catch(() => {})
    }
    // Load latest deployment URL
    const { data: dep } = await supabase.from('deployments').select('url').eq('project_id', projectId as string).order('created_at', { ascending: false }).limit(1).maybeSingle()
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
    // Trigger preview render for existing projects with files
    if (projectFiles.length > 0) {
      setTimeout(() => setBuildTrigger(prev => prev + 1), 100)
    }
  }

  async function loadProfile() {
    if (!user) return
    const { data } = await supabase.from('profiles').select('credit_balance, gift_balance').eq('id', user.id).single()
    if (data) setCreditBalance((data.credit_balance || 0) + (data.gift_balance || 0))
  }

  async function loadChatHistory() {
    if (!projectId || !user) return
    const { data } = await supabase
      .from('chat_history')
      .select('*')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    if (data && data.length > 0) {
      setMessages(data.map((m: any) => ({ id: m.id, role: m.role, content: m.content, isPlan: m.is_plan })))
    }
  }

  async function saveChatMessage(role: 'user' | 'assistant', content: string, isPlan = false) {
    if (!user || !projectId) return
    await supabase.from('chat_history').insert({
      project_id: projectId,
      user_id: user.id,
      role,
      content,
      is_plan: isPlan,
    })
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


  // Send message
  async function sendMessage(overrideInput?: string, displayText?: string) {
    const messageText = overrideInput || input.trim()
    if ((!messageText && !pendingImage) || loading || !user) return
    if (creditBalance <= 0) { setShowBuyCredits(true); return }

    let imageUrl: string | undefined
    if (pendingImage) {
      const reader = new FileReader()
      imageUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(pendingImage.file)
      })
    }

    // Show displayText in chat if provided, but send full messageText to API
    const visibleText = displayText || messageText
    const userMsg: Message = { role: 'user', content: visibleText, imageUrl }
    setMessages(prev => [...prev, userMsg])
    saveChatMessage('user', visibleText)
    setInput('')
    setPendingImage(null)
    setLoading(true)
    setLastError(null)
    setBuildStatus('Starting build...')
    const buildStartTime = Date.now()
    let deltaCharCount = 0

    const controller = new AbortController()
    abortControllerRef.current = controller

    const planOnly = mode === 'plan' && !pendingPlan

    try {
      const chatMessages = [...messages, userMsg].map(m => {
        const msg: any = { role: m.role, content: m.content }
        if (m.imageUrl) msg.imageUrl = m.imageUrl
        return msg
      })

      const fileOps: Array<{ action: string; path: string }> = []
      const fileContentUpdates: Array<{ action: string; path: string; content: string | null }> = []

      // Snapshot current files for diff comparison
      const preMap = new Map<string, string>()
      for (const f of files) {
        if (f.content !== null) preMap.set(f.path, f.content)
      }
      preBuiltFilesRef.current = preMap

      // For plan mode, add a streaming message that updates live as text arrives
      if (planOnly) {
        streamingTextRef.current = ''
        setMessages(prev => [...prev, { role: 'assistant', content: '' }])
      }

      // Stream a single build call and return continuation data if the server signals one
      const streamBuild = async (extraBody: Record<string, unknown> = {}): Promise<{ continuation?: { partialRaw: string; continuationCount: number; accumulatedApiCost: number } }> => {
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
            ...extraBody,
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
                deltaCharCount += (event.text || '').length
                const elapsed = Math.round((Date.now() - buildStartTime) / 1000)
                const sizeLabel = deltaCharCount > 1000 ? `${(deltaCharCount / 1000).toFixed(1)}K` : `${deltaCharCount}`
                const genLabel = planOnly ? 'Generating plan' : 'Generating code'
                setBuildStatus(`${genLabel}... ${sizeLabel} chars (${elapsed}s)`)

                // Stream text into chat message for plan mode
                if (planOnly) {
                  streamingTextRef.current += event.text || ''
                  const streamedContent = streamingTextRef.current
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = { ...updated[updated.length - 1], content: streamedContent }
                    return updated
                  })
                }
              } else if (event.type === 'status') {
                setBuildStatus(event.text)
              } else if (event.type === 'file_op') {
                fileOps.push({ action: event.action, path: event.path })
                fileContentUpdates.push({ action: event.action, path: event.path, content: event.content || null })
                setBuildStatus(`${event.action === 'create' ? 'Created' : event.action === 'edit' ? 'Updated' : 'Deleted'} ${event.path}`)
                setRecentlyChanged(prev => { const arr = Array.from(prev); arr.push(event.path); return new Set(arr) })
                setTimeout(() => {
                  setRecentlyChanged(prev => { const next = new Set(prev); next.delete(event.path); return next })
                }, 3000)
              } else if (event.type === 'continue') {
                // Server hit time limit — return continuation data so we can auto-retry
                return { continuation: { partialRaw: event.partialRaw, continuationCount: event.continuationCount, accumulatedApiCost: event.accumulatedApiCost } }
              } else if (event.type === 'done') {
                // Apply file changes directly from streamed file_op events for instant preview
                if (fileContentUpdates.length > 0) {
                  setFiles(prev => {
                    let updated = [...prev]
                    for (const op of fileContentUpdates) {
                      if (op.action === 'delete') {
                        updated = updated.filter(f => f.path !== op.path)
                      } else if (op.action === 'create' || op.action === 'edit') {
                        const existing = updated.findIndex(f => f.path === op.path)
                        const ext = op.path.split('.').pop()?.toLowerCase() || 'text'
                        const fileType = ['tsx', 'ts'].includes(ext) ? 'ts' : ['jsx', 'js'].includes(ext) ? 'js' : ext
                        const fileEntry = {
                          id: existing >= 0 ? updated[existing].id : `local_${Date.now()}_${op.path}`,
                          project_id: projectId as string,
                          user_id: user.id,
                          path: op.path,
                          content: op.content,
                          file_type: fileType,
                          created_at: existing >= 0 ? updated[existing].created_at : new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                        }
                        if (existing >= 0) {
                          updated[existing] = fileEntry
                        } else {
                          updated.push(fileEntry)
                        }
                      }
                    }
                    return updated
                  })
                }
                // Also fetch from DB to ensure consistency (non-blocking)
                loadFiles()
                // Defer build trigger to ensure files state has propagated
                setTimeout(() => setBuildTrigger(prev => prev + 1), 50)

                // Compute diffs for changed files
                if (fileOps.length > 0) {
                  const { data: newFiles } = await supabase
                    .from('project_files')
                    .select('path, content')
                    .eq('project_id', projectId as string)
                  const newMap = new Map<string, string>()
                  for (const f of newFiles || []) {
                    if (f.content !== null) newMap.set(f.path, f.content)
                  }
                  const changes = fileOps.map(op => ({
                    path: op.path,
                    action: op.action as 'create' | 'edit' | 'delete',
                    previousContent: preBuiltFilesRef.current.get(op.path) || '',
                    newContent: newMap.get(op.path) || '',
                  }))
                  setDiffChanges(changes)
                  // Save snapshots for undo
                  const buildId = `build_${Date.now()}`
                  saveFileSnapshots(fileOps.map(op => op.path), buildId)
                }

                if (planOnly && event.message) {
                  setPendingPlan(event.message)
                  // Replace the streaming message with the final plan (server-sanitized)
                  setMessages(prev => {
                    const updated = [...prev]
                    updated[updated.length - 1] = { role: 'assistant', content: event.message, isPlan: true }
                    return updated
                  })
                  saveChatMessage('assistant', event.message, true)
                } else {
                  const assistantMsg = event.message || 'Build complete'
                  setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg, fileOps }])
                  saveChatMessage('assistant', assistantMsg)
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

                // Generate AI images if any were requested
                if (event.imagePrompts?.length > 0 && projectId) {
                  const prompts = event.imagePrompts as string[]
                  ;(async () => {
                    for (let i = 0; i < prompts.length; i++) {
                      try {
                        setBuildStatus(`Generating image ${i + 1} of ${prompts.length}...`)
                        const imgRes = await fetch('/api/generate-image', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ prompt: prompts[i] }),
                        })
                        const imgData = await imgRes.json()
                        if (imgData.url) {
                          // Build placeholder URL that matches what the backend inserted
                          const placeholder = i === 0
                            ? `https://placehold.co/1024x768/141414/444444?text=Loading+image...`
                            : `https://placehold.co/1024x768/141414/444444?text=Loading+image+${i + 1}...`
                          const numberedPlaceholder = `https://placehold.co/1024x768/141414/444444?text=Loading+image+${i + 1}...`

                          // Replace placeholders in all project files (DB)
                          const { data: allFiles } = await supabase
                            .from('project_files')
                            .select('id, path, content')
                            .eq('project_id', projectId as string)
                          for (const file of allFiles || []) {
                            if (!file.content) continue
                            let updated = file.content
                            // Replace numbered placeholder
                            updated = updated.split(numberedPlaceholder).join(imgData.url)
                            // For image 1, also replace the shorthand placeholder
                            if (i === 0) {
                              updated = updated.split(placeholder).join(imgData.url)
                            }
                            if (updated !== file.content) {
                              await supabase
                                .from('project_files')
                                .update({ content: updated, updated_at: new Date().toISOString() })
                                .eq('id', file.id)
                            }
                          }

                          // Update local files state
                          setFiles(prev => prev.map(f => {
                            if (!f.content) return f
                            let updated = f.content
                            updated = updated.split(numberedPlaceholder).join(imgData.url)
                            if (i === 0) {
                              updated = updated.split(placeholder).join(imgData.url)
                            }
                            return updated !== f.content ? { ...f, content: updated } : f
                          }))

                          // Refresh preview
                          setBuildTrigger(prev => prev + 1)

                          // Update credit balance if returned
                          if (imgData.newBalance !== undefined) setCreditBalance(imgData.newBalance)
                        }
                      } catch (err) {
                        console.error(`Image ${i + 1} generation failed:`, err)
                      }
                    }
                    setBuildStatus(null)
                  })()
                }
              } else if (event.type === 'db_choice_required') {
                // Project needs a database but user hasn't chosen where yet
                setPendingDbTables(JSON.stringify(event.pendingTables || []))
                setShowDbChoice(true)
                // Add inline DB choice to chat so user can still pick if modal is dismissed
                setMessages(prev => [...prev, { role: 'assistant', content: 'Your app needs a database. Choose where to store your data:', isDbChoice: true }])
                setBuildStatus(null)
                setLoading(false)
                return {} // Stop processing this build
              } else if (event.type === 'error') {
                setLastError(event.error || event.message)
              }
            } catch {}
          }
        }
        return {}
      }

      // Run build with automatic continuation
      let result = await streamBuild()
      while (result.continuation) {
        const { partialRaw, continuationCount, accumulatedApiCost } = result.continuation
        setBuildStatus(`Continuing build (part ${continuationCount + 1})...`)
        result = await streamBuild({ isContinuation: true, partialRaw, continuationCount, accumulatedApiCost })
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setLastError(err.message)
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
        saveChatMessage('assistant', `Error: ${err.message}`)
      }
    } finally {
      setLoading(false)
      setBuildStatus(null)
      abortControllerRef.current = null
    }
  }

  // Handle "Fix this" from preview error console
  function handleFixError(errorText: string) {
    setInput(errorText)
    setMode('build')
    if (isMobile) setMobilePanel('chat')
    setSidebarTab('chat')
  }

  // Save file snapshots to DB for undo capability
  async function saveFileSnapshots(changedPaths: string[], buildId: string) {
    const snapshots = changedPaths
      .filter(path => preBuiltFilesRef.current.has(path) || files.some(f => f.path === path))
      .map(path => ({
        project_id: projectId as string,
        user_id: user.id,
        file_path: path,
        content: preBuiltFilesRef.current.get(path) || null,
        build_id: buildId,
      }))
    if (snapshots.length > 0) {
      await supabase.from('project_file_versions').insert(snapshots)
    }
  }

  // Undo last build — restore files from the most recent snapshot
  async function undoLastBuild() {
    try {
      // Get the latest build_id
      const { data: latest } = await supabase
        .from('project_file_versions')
        .select('build_id')
        .eq('project_id', projectId as string)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (!latest) return

      // Get all snapshots for that build
      const { data: snapshots } = await supabase
        .from('project_file_versions')
        .select('file_path, content')
        .eq('project_id', projectId as string)
        .eq('build_id', latest.build_id)

      if (!snapshots || snapshots.length === 0) return

      // Restore each file
      for (const snap of snapshots) {
        if (snap.content === null) {
          // File was created by the build — delete it
          await deleteFile(projectId as string, snap.file_path)
        } else {
          // File was edited — restore previous content
          await saveFile(projectId as string, user.id, snap.file_path, snap.content, getFileType(snap.file_path.split('.').pop() || ''))
        }
      }

      // Delete the used snapshots
      await supabase
        .from('project_file_versions')
        .delete()
        .eq('project_id', projectId as string)
        .eq('build_id', latest.build_id)

      // Reload files and refresh preview
      await loadFiles()
      setBuildTrigger(prev => prev + 1)
      setMessages(prev => [...prev, { role: 'assistant', content: '↩️ Build undone — files restored to previous state.' }])
    } catch (err: any) {
      setLastError(err.message || 'Undo failed')
    }
  }

  // Plan approval
  function approvePlan() {
    if (!pendingPlan) return
    const planText = `Execute this plan:\n${pendingPlan}`
    setMode('build')
    setPendingPlan(null)
    setInput('')
    sendMessage(planText, 'Execute the plan')
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

  // Memoize env vars so the preview doesn't rebundle on every chat keystroke.
  // Must be BEFORE the early return below — React hooks must run in the same order every render.
  const previewEnvVars = useMemo(() => {
    const dotEnvVars: Record<string, string> = {}
    const dotEnvFile = files.find(f => f.path === '.env')
    if (dotEnvFile?.content) {
      for (const line of dotEnvFile.content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          dotEnvVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
        }
      }
    }
    return {
      ...dotEnvVars,
      ...projectEnvVars,
      ...(projectSupabaseUrl ? { VITE_SUPABASE_URL: projectSupabaseUrl } : {}),
      ...(projectSupabaseAnonKey ? { VITE_SUPABASE_ANON_KEY: projectSupabaseAnonKey } : {}),
    }
  }, [files, projectEnvVars, projectSupabaseUrl, projectSupabaseAnonKey])

  if (!user || !project) return <div className="flex items-center justify-center h-screen bg-surface text-[#555] font-sans">Loading...</div>

  const balanceDisplay = `$${creditBalance.toFixed(2)}`
  const balanceColor = creditBalance > 0 ? '#5DCAA5' : '#f09595'

  // Mobile panel visibility
  const showLeft = !isMobile || mobilePanel === 'chat'
  const showRight = !isMobile || mobilePanel === 'preview'

  const renderPreview = () => (
    <PreviewFrame
      files={files}
      projectType={project.project_type || 'react'}
      projectName={project.name}
      deployUrl={deployUrl}
      welcomeHtml={welcomeHtml}
      onFixError={handleFixError}
      buildTrigger={buildTrigger}
      envVars={previewEnvVars}
      extraPackages={extraPackages}
    />
  )

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
            <button
              onClick={() => setShowSupabaseConnect(true)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer border ${projectSupabaseUrl ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-transparent border-white/[0.08] text-[#666] hover:text-[#aaa]'}`}
              title={projectSupabaseUrl ? 'Supabase connected' : 'Connect Supabase'}
            >
              ⚡ {projectSupabaseUrl ? 'DB' : 'Supabase'}
            </button>
            <button
              onClick={() => setShowSchemaViewer(true)}
              className="px-2 py-1 rounded-md text-[11px] cursor-pointer border bg-transparent border-white/[0.08] text-[#666] hover:text-[#aaa]"
              title="View database schema"
            >
              🗄
            </button>
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
                    <div className="text-[28px] mb-3 text-brand/60">✦</div>
                    <p className="text-[#999] text-[13px] text-center leading-relaxed mb-5">
                      Describe what to build and I'll create it instantly. You can also upload a screenshot for reference.
                    </p>
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {['Admin dashboard with sidebar', 'Inventory tracker', 'Sales dashboard with charts', 'User management panel'].map(t => (
                        <button key={t} className="px-2.5 py-1 bg-surface-3 border border-white/[0.08] rounded-full text-[#aaa] text-[11px] cursor-pointer hover:text-white hover:border-white/20 transition-colors" onClick={() => setInput(t)}>{t}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
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
                          {msg.isDbChoice && (
                            <div className="flex flex-col gap-2 mt-3">
                              <button
                                onClick={() => {
                                  setShowDbChoice(false)
                                  fetch('/api/projects/set-platform-db', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) }).then(r => r.json()).then(data => {
                                    if (data.url) setProjectSupabaseUrl(data.url)
                                    if (data.anonKey) setProjectSupabaseAnonKey(data.anonKey)
                                    fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'server_activated', severity: 'info', message: `User activated platform server for project ${projectId}`, metadata: { projectId } }) }).catch(() => {})
                                    const lastUserMsg = messages.filter(m => m.role === 'user').pop()
                                    if (lastUserMsg) sendMessage(lastUserMsg.content, 'Use our secure server')
                                  })
                                }}
                                className="w-full text-left p-3 bg-[#0a0a0a] border border-white/[0.08] rounded-xl hover:border-emerald-500/30 hover:bg-emerald-500/[0.03] transition-all cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-emerald-400 text-sm">⚡</span>
                                  <span className="text-[13px] font-medium text-[#f0f0f0]">Use our secure server</span>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">Recommended</span>
                                </div>
                                <p className="text-[11px] text-[#666] mt-1 ml-6">Instant setup, fully managed, secure & isolated</p>
                              </button>
                              <button
                                onClick={() => {
                                  setShowDbChoice(false)
                                  supabase.from('projects').update({ db_provider: 'custom' }).eq('id', projectId as string).then(() => {
                                    setMessages(prev => [...prev, { role: 'user', content: 'Connect own Supabase' }])
                                    setShowSupabaseConnect(true)
                                  })
                                }}
                                className="w-full text-left p-3 bg-[#0a0a0a] border border-white/[0.08] rounded-xl hover:border-white/20 hover:bg-white/[0.02] transition-all cursor-pointer"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[#888] text-sm">🔗</span>
                                  <span className="text-[13px] font-medium text-[#ccc]">Connect your own Supabase</span>
                                </div>
                                <p className="text-[11px] text-[#555] mt-1 ml-6">Full control, own auth, requires setup</p>
                              </button>
                            </div>
                          )}
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
                              {diffChanges.length > 0 && (
                                <>
                                  <button
                                    onClick={() => setShowDiff(true)}
                                    className="text-[10px] px-2 py-0.5 rounded cursor-pointer border bg-white/5 border-white/10 text-[#aaa] hover:text-white hover:bg-white/10"
                                  >
                                    View Changes
                                  </button>
                                  <button
                                    onClick={undoLastBuild}
                                    className="text-[10px] px-2 py-0.5 rounded cursor-pointer border bg-amber-500/5 border-amber-500/15 text-amber-400/70 hover:text-amber-300 hover:bg-amber-500/10"
                                  >
                                    ↩ Undo
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {msg.isPlan && (
                            <div className="flex gap-2 mt-3">
                              {pendingPlan && (
                                <button onClick={approvePlan} className="px-3.5 py-1.5 bg-brand border-none rounded-[7px] text-white text-xs font-medium cursor-pointer">✓ Approve & Build</button>
                              )}
                              <button onClick={() => { setPlanModalContent(msg.content); setShowPlanModal(true) }} className="px-3 py-1.5 bg-surface-3 border border-white/10 rounded-[7px] text-[#aaa] text-xs cursor-pointer hover:text-white hover:border-white/20 transition-colors">📋 View Plan</button>
                              {pendingPlan && (
                                <button onClick={() => setPendingPlan(null)} className="px-3 py-1.5 bg-transparent border border-white/10 rounded-[7px] text-[#666] text-xs cursor-pointer">✕ Revise</button>
                              )}
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
                <div className={`flex ${isMobile ? 'flex-row items-end gap-2' : 'flex-col gap-2'}`}>
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                    onPaste={handlePaste}
                    placeholder={pendingImage ? 'Describe what you want based on the image...' : 'Paste an image or describe what to build...'}
                    rows={3} className="flex-1 p-2.5 bg-surface-3 border border-white/[0.08] rounded-lg text-[#f0f0f0] text-[13px] resize-none outline-none leading-relaxed" disabled={loading}
                  />
                  {isMobile ? (
                    <button onClick={() => sendMessage()} disabled={loading || (!input.trim() && !pendingImage)} className="w-10 h-10 bg-brand border-none rounded-xl text-white text-lg font-medium cursor-pointer disabled:opacity-50 shrink-0 flex items-center justify-center">
                      {loading ? '⏳' : '▶'}
                    </button>
                  ) : (
                    <button onClick={() => sendMessage()} disabled={loading || (!input.trim() && !pendingImage)} className="py-2 bg-brand border-none rounded-lg text-white text-[13px] font-medium cursor-pointer disabled:opacity-50">
                      {loading ? 'Working...' : mode==='plan' ? 'Create Plan' : 'Build'}
                    </button>
                  )}
                </div>
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

                {/* Package Manager */}
                <div className="border-t border-white/[0.05] mt-2 pt-1">
                  <PackageManager
                    projectId={projectId as string}
                    onPackagesChange={setExtraPackages}
                  />
                </div>

                {/* Env Vars Manager */}
                <div className="border-t border-white/[0.05] mt-2 pt-1 pb-3">
                  <EnvVarManager
                    projectId={projectId as string}
                    onEnvChange={setProjectEnvVars}
                  />
                </div>
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
                  {files.filter(f => f.path.startsWith('src/pages/')).map(f => <option key={f.path} value={f.path}>{f.path.replace('src/pages/', '').replace(/\.tsx?$/, '')}</option>)}
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
              <div className="flex-1 flex flex-col overflow-hidden border-r border-white/[0.07]">
                {renderEditor()}
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                {renderPreview()}
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
            renderPreview()
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

      {/* View Plan Modal */}
      {/* Database Choice Modal */}
      {showDbChoice && (
        <DatabaseChoiceModal
          projectId={projectId as string}
          onChoosePlatform={() => {
            setShowDbChoice(false)
            // Re-send the last user message to retry the build with db_provider now set
            const lastUserMsg = messages.filter(m => m.role === 'user').pop()
            if (lastUserMsg) sendMessage(lastUserMsg.content, 'Use our secure server')
          }}
          onChooseCustom={() => {
            setShowDbChoice(false)
            setMessages(prev => [...prev, { role: 'user', content: 'Connect own Supabase' }])
            setShowSupabaseConnect(true)
          }}
          onClose={() => setShowDbChoice(false)}
        />
      )}

      {/* Schema Viewer Modal */}
      {showSchemaViewer && (
        <SchemaViewer projectId={projectId as string} onClose={() => setShowSchemaViewer(false)} />
      )}

      {/* Diff Viewer Modal */}
      {showDiff && diffChanges.length > 0 && (
        <DiffViewer changes={diffChanges} onClose={() => setShowDiff(false)} />
      )}

      {/* Supabase Connect Modal */}
      {showSupabaseConnect && (
        <SupabaseConnect
          projectId={projectId as string}
          supabaseUrl={projectSupabaseUrl}
          supabaseAnonKey={projectSupabaseAnonKey}
          onSaved={(url, key) => {
            setProjectSupabaseUrl(url || null)
            setProjectSupabaseAnonKey(key || null)
            setBuildTrigger(prev => prev + 1) // Refresh preview with new env vars
          }}
          onClose={() => setShowSupabaseConnect(false)}
        />
      )}

      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowPlanModal(false)}>
          <div className="bg-[#111] border border-white/10 rounded-xl w-full max-w-[600px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm">📋</span>
                <span className="text-[#e0e0e0] text-sm font-semibold">Build Plan</span>
              </div>
              <button onClick={() => setShowPlanModal(false)} className="text-[#555] hover:text-white text-lg bg-transparent border-none cursor-pointer transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#ccc]">{planModalContent}</div>
            </div>
            {pendingPlan && (
              <div className="flex gap-2 px-5 py-3 border-t border-white/[0.07] shrink-0">
                <button onClick={() => { approvePlan(); setShowPlanModal(false) }} className="px-4 py-2 bg-brand border-none rounded-lg text-white text-xs font-medium cursor-pointer flex-1">✓ Approve & Build</button>
                <button onClick={() => { setPendingPlan(null); setShowPlanModal(false) }} className="px-4 py-2 bg-transparent border border-white/10 rounded-lg text-[#666] text-xs cursor-pointer">✕ Revise</button>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
