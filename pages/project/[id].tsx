import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { supabase } from '../../lib/supabase'
import { useMobile } from '../../hooks/useMobile'
import { composePage } from '../../lib/composePage'

const CodeEditor = dynamic(() => import('../../components/CodeEditor'), { ssr: false })
import VersionHistory from '../../components/VersionHistory'
import DeployButton from '../../components/DeployButton'
import GitHubConnect from '../../components/GitHubConnect'

interface Page { id: string; name: string; code: string; updated_at: string }
interface Message { id?: string; role: 'user' | 'assistant'; content: string; isPlan?: boolean; imageUrl?: string }
type AppMode = 'build' | 'plan'

export default function ProjectBuilder() {
  const router = useRouter()
  const isMobile = useMobile()
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
  const [viewMode, setViewMode] = useState<'preview' | 'code' | 'split'>('preview')
  const [lastError, setLastError] = useState<string | null>(null)
  const [showBuyCredits, setShowBuyCredits] = useState(false)
  const [pendingImage, setPendingImage] = useState<{ base64: string; mediaType: string; preview: string } | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [autoFixAttempts, setAutoFixAttempts] = useState(0)
  const [isAutoFixing, setIsAutoFixing] = useState(false)
  const [sharedCode, setSharedCode] = useState<string | null>(null)
  const MAX_AUTO_FIX_ATTEMPTS = 2
  // Mobile: which panel is visible ('chat' or 'preview')
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'preview'>('preview')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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

  const renderIframe = useCallback((code: string, pageNameOverride?: string) => {
    if (!iframeRef.current) return
    const layout = project?.layout_code || null
    const pName = pageNameOverride || activePage?.name || 'Page'
    const composed = composePage(layout, code, pages, pName, projectId as string, sharedCode)

    const errorCatcher = `<script>
(function(){
  var errors = [];
  var timer = null;
  function report() {
    if (errors.length === 0) return;
    var batch = errors.splice(0, 5);
    window.parent.postMessage({ type: 'iframe-error', errors: batch }, '*');
  }
  function collect(err) {
    errors.push(err);
    clearTimeout(timer);
    timer = setTimeout(report, 1000);
  }
  window.onerror = function(msg, source, line, col, error) {
    collect({ message: String(msg), source: source || '', line: line, col: col, stack: error && error.stack ? error.stack.slice(0, 500) : '' });
  };
  window.addEventListener('unhandledrejection', function(e) {
    var reason = e.reason;
    var msg = reason instanceof Error ? reason.message : String(reason);
    var stack = reason instanceof Error && reason.stack ? reason.stack.slice(0, 500) : '';
    collect({ message: 'Unhandled Promise Rejection: ' + msg, stack: stack });
  });
})();
<\/script>`

    const guard = `<script>
(function(){
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    // data-page links are handled by composePage nav script
    if (a.hasAttribute('data-page')) return;
    var href = a.getAttribute('href') || '';
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    e.preventDefault();
    e.stopPropagation();
    if (href.startsWith('#')) {
      var id = href.slice(1);
      var el = document.getElementById(id);
      if (el) el.scrollIntoView({behavior:'smooth'});
    } else if (href.startsWith('http://') || href.startsWith('https://')) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, true);
  try {
    var _push = history.pushState.bind(history);
    var _replace = history.replaceState.bind(history);
    history.pushState = function(s,t,u){ if(u && String(u).startsWith('#')) _push(s,t,u); };
    history.replaceState = function(s,t,u){ if(u && String(u).startsWith('#')) _replace(s,t,u); };
  } catch(e){}
})();
<\/script>`
    const injected = composed.replace(/(<head[^>]*>)/i, '$1' + errorCatcher + guard)
    iframeRef.current.srcdoc = injected || composed
  }, [project?.layout_code, pages, activePage?.name, projectId, sharedCode])

  useEffect(() => { if (activePage) renderIframe(activePage.code) }, [activePage, renderIframe])

  // Re-render iframe when project loads or layout changes
  useEffect(() => { if (project && activePage) renderIframe(activePage.code) }, [project, activePage, renderIframe])

  // Re-render iframe when code view is closed (iframe remounts empty)
  useEffect(() => { if (viewMode !== 'code' && activePage) renderIframe(activePage.code) }, [viewMode])

  // Ref to always access latest handleIframeErrors without re-registering listener
  const handleIframeErrorsRef = useRef<(errors: any[]) => void>(() => {})

  // Listen for page navigation + iframe error messages
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.data?.type === 'navigate' && e.data.page) {
        const target = pages.find(p => p.name === e.data.page)
        if (target) setActivePage(target)
      }
      if (e.data?.type === 'iframe-error' && e.data.errors?.length > 0) {
        handleIframeErrorsRef.current(e.data.errors)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [pages])

  // Load chat history when page changes
  useEffect(() => {
    if (activePage && user) loadChatHistory(activePage.id)
    setAutoFixAttempts(0)
  }, [activePage?.id])

  async function loadProfile(userId: string) {
    const { data } = await supabase.from('profiles').select('credit_balance, gift_balance, role').eq('id', userId).single()
    if (data) {
      setCreditBalance((data.credit_balance || 0) + (data.gift_balance || 0))
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
    // Redirect React projects to the React builder
    if (data.project_type === 'react') {
      router.replace(`/project/${projectId}/react-builder`)
      return
    }
    setProject(data)
    // Load shared code for this project
    const { data: sc } = await supabase.from('project_shared_code').select('code').eq('project_id', projectId as string).single()
    setSharedCode(sc?.code || null)
  }

  async function loadPages() {
    const { data } = await supabase.from('pages').select('*').eq('project_id', projectId).order('created_at', { ascending: true })
    if (data && data.length > 0) {
      setPages(data)
      // Keep the current active page if it still exists, otherwise default to first
      setActivePage(prev => {
        if (prev) {
          const updated = data.find(p => p.id === prev.id)
          if (updated) return updated
        }
        return data[0]
      })
    }
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

  async function savePage(code: string, source: 'ai_build' | 'manual_edit' | 'restore' = 'ai_build') {
    if (!activePage || !user) return
    // Save current code as a version snapshot before overwriting
    if (activePage.code && activePage.code !== code) {
      supabase.from('page_versions').insert({
        page_id: activePage.id,
        user_id: user.id,
        code: activePage.code,
        source,
      }).then(() => {
        // Cleanup: keep only last 30 versions per page
        supabase.from('page_versions')
          .select('id')
          .eq('page_id', activePage.id)
          .order('created_at', { ascending: false })
          .range(30, 999)
          .then(({ data: old }) => {
            if (old && old.length > 0) {
              supabase.from('page_versions').delete().in('id', old.map(v => v.id)).then(() => {})
            }
          })
      })
    }

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

  // Generate images progressively after build — each image gets its own API call (no timeout pressure)
  async function generateImagesProgressively(currentCode: string, prompts: string[]) {
    let updatedCode = currentCode
    const fallback = 'https://placehold.co/1024x768/141414/444444?text=Image+not+available'

    const results = await Promise.allSettled(
      prompts.map(async (prompt, i) => {
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, userId: user?.id }),
        })
        const data = await res.json()
        if (data.url) {
          const num = i + 1
          // Replace numbered loading placeholder for this specific image
          const numberedLoading = `https://placehold.co/1024x768/141414/444444?text=Loading+image+${num}...`
          updatedCode = updatedCode.replace(new RegExp(numberedLoading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), data.url)
          // Also replace generic loading placeholder (for __GENERATED_IMAGE_URL__ case)
          if (i === 0) {
            updatedCode = updatedCode.replace(/https:\/\/placehold\.co\/1024x768\/141414\/444444\?text=Loading\+image\.\.\./g, data.url)
          }
          renderIframe(updatedCode)
          if (data.newBalance !== undefined) setCreditBalance(data.newBalance)
        }
        return data.url || null
      })
    )

    // Replace any remaining loading placeholders with fallback
    updatedCode = updatedCode.replace(/https:\/\/placehold\.co\/1024x768\/141414\/444444\?text=Loading\+image[^"]*/g, fallback)

    // Save final code with all images
    await savePage(updatedCode)
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

  // Fire-and-forget log helper
  function logEvent(event_type: string, severity: string, message: string, metadata?: object) {
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type, severity, message, email: user?.email, metadata }),
    }).catch(() => {})
  }

  async function callAPI(
    msgs: any[],
    planOnly = false,
    image?: { base64: string, mediaType: string } | null,
    onDelta?: (text: string) => void,
    onStatus?: (text: string) => void,
    isAutoFix = false,
  ) {
    const basePayload: any = {
      messages: msgs,
      pageCode: activePage?.code,
      pageName: activePage?.name,
      allPages: pages,
      planOnly,
      userId: user?.id,
      projectId,
      isAutoFix,
    }

    if (image) {
      basePayload.imageBase64 = image.base64
      basePayload.imageMediaType = image.mediaType
    }

    // Continuation loop — handles automatic re-triggering when the server hits its time limit
    let continuationCount = 0
    let accumulatedPartialRaw = ''
    let accumulatedApiCost = 0
    const MAX_CONTINUATIONS = 3

    while (true) {
      const payload: any = { ...basePayload }
      if (continuationCount > 0) {
        payload.isContinuation = true
        payload.partialRaw = accumulatedPartialRaw
        payload.continuationCount = continuationCount
        payload.accumulatedApiCost = accumulatedApiCost
      }

      let fetchRes: Response
      const controller = new AbortController()
      abortControllerRef.current = controller
      try {
        fetchRes = await fetch('/api/claude', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
      } catch (networkErr: any) {
        if (networkErr.name === 'AbortError') throw new Error('__USER_STOPPED__')
        // If this was a continuation, record the accumulated cost as failed
        if (continuationCount > 0 && accumulatedApiCost > 0) {
          try {
            await fetch('/api/record-failed-build', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: basePayload.userId,
                pageName: basePayload.pageName,
                errorMessage: 'Network error during continuation',
                estimatedCost: accumulatedApiCost,
                continuationCount,
              }),
            })
          } catch (_) {}
        }
        throw new Error('The builder timed out. Try a simpler request or try again.')
      }

      const contentType = fetchRes.headers.get('content-type') || ''

      // Non-streaming error responses (pre-flight checks return JSON)
      if (contentType.includes('application/json')) {
        const data = await fetchRes.json()
        if (data.error === 'insufficient_credits') {
          setShowBuyCredits(true)
          logEvent('credits_error', 'warn', `Insufficient credits when building`, { pageName: activePage?.name, balance: data.balance })
          throw new Error(data.message || 'Insufficient credits')
        }
        if (data.error === 'build_limit_reached') {
          setShowBuyCredits(true)
          logEvent('credits_error', 'warn', `Build limit reached`, { pageName: activePage?.name, planName: data.planName })
          throw new Error(data.message || 'Monthly build limit reached. Please upgrade.')
        }
        if (data.error) {
          logEvent('builder_error', 'error', `Builder API returned error: ${data.error}`, { pageName: activePage?.name, projectId, error: data.error })
          throw new Error(data.error)
        }
        if (data.newBalance !== undefined) setCreditBalance(data.newBalance)
        return data
      }

      // SSE streaming response
      if (!contentType.includes('text/event-stream')) {
        throw new Error('The build timed out or the server encountered an error. Try a simpler request or try again.')
      }

      const reader = fetchRes.body?.getReader()
      if (!reader) throw new Error('Failed to read stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let result: any = null
      let shouldContinue = false

      try {
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
              if (event.type === 'delta' && onDelta) {
                onDelta(event.text)
              } else if (event.type === 'status' && onStatus) {
                onStatus(event.text)
              } else if (event.type === 'done') {
                result = event
              } else if (event.type === 'continue') {
                // Server hit its time limit — accumulate partial and auto-continue
                accumulatedPartialRaw = event.partialRaw || ''
                continuationCount = event.continuationCount || (continuationCount + 1)
                accumulatedApiCost = event.accumulatedApiCost || 0
                shouldContinue = true
                if (onStatus) onStatus(`⏳ Build continuing (part ${continuationCount + 1})...`)
              } else if (event.type === 'error') {
                if (event.error === 'insufficient_credits') {
                  setShowBuyCredits(true)
                  throw new Error(event.message || 'Insufficient credits')
                }
                throw new Error(event.error || event.message || 'Build failed')
              }
            } catch (parseErr: any) {
              if (parseErr.message?.includes('credits') || parseErr.message?.includes('Build failed')) throw parseErr
            }
          }
        }
      } catch (streamErr: any) {
        if (streamErr.name === 'AbortError') throw new Error('__USER_STOPPED__')
        throw streamErr
      }

      // If we received a 'continue' event, loop back for another API call
      if (shouldContinue) {
        if (continuationCount >= MAX_CONTINUATIONS) {
          // Record the accumulated cost as a failed build before throwing
          if (accumulatedApiCost > 0) {
            try {
              await fetch('/api/record-failed-build', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  userId: basePayload.userId,
                  pageName: basePayload.pageName,
                  errorMessage: 'Max continuations exceeded',
                  estimatedCost: accumulatedApiCost,
                  continuationCount,
                }),
              })
            } catch (_) {}
          }
          throw new Error('Build is too complex to complete within server time limits. Please simplify your request or build one section at a time.')
        }
        continue // goes back to the while(true) loop for another fetch
      }

      if (!result) {
        // Backend didn't send a terminal event — record the failure since the server couldn't
        if (accumulatedApiCost > 0) {
          try {
            await fetch('/api/record-failed-build', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: basePayload.userId,
                pageName: basePayload.pageName,
                errorMessage: 'Build interrupted - no terminal event received',
                estimatedCost: accumulatedApiCost,
                continuationCount,
              }),
            })
          } catch (_) {}
        }
        throw new Error('The build was interrupted before finishing. This usually means it timed out. Try again or simplify your request.')
      }
      if (result.newBalance !== undefined) setCreditBalance(result.newBalance)
      return result
    }
  }

  async function handleStop() {
    try {
      const res = await fetch(`/api/check-stop-limit?userId=${user?.id}`)
      const data = await res.json()
      if (!data.allowed) {
        setLastError(`Stop limit reached (${data.limit} per hour). Build will continue and you will be charged.`)
        return
      }
    } catch (_) {
      // If rate limit check fails, still allow the stop
    }
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
  }

  async function getPlan() {
    if (!input.trim() && !pendingImage || loading) return
    const userMsg: Message = { role: 'user', content: input || '(sent an image)', imageUrl: pendingImage?.preview }
    setMessages(prev => [...prev, userMsg])
    await saveChatMessage('user', input || '(sent an image)')
    const savedInput = input
    const imgToSend = pendingImage
    setInput(''); setPendingImage(null); setLoading(true); setLastError(null)

    const streamingMsg: Message = { role: 'assistant', content: '', isPlan: true }
    setMessages(prev => [...prev, streamingMsg])

    try {
      const data = await callAPI([{ role: 'user', content: savedInput || 'See the image above.' }], true, imgToSend, (delta) => {
        streamingMsg.content += delta
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...streamingMsg }
          return updated
        })
      })
      const aiMsg: Message = { role: 'assistant', content: data.message, isPlan: true }
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = aiMsg
        return updated
      })
      await saveChatMessage('assistant', data.message, true)
      setPendingPlan(savedInput)
    } catch (err: any) {
      if (err.message === '__USER_STOPPED__') {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Stopped by user.' }
          return updated
        })
        await saveChatMessage('assistant', 'Stopped by user.')
        logEvent('builder_stopped', 'info', `Plan generation stopped by user`, { pageName: activePage?.name, projectId })
      } else {
        setLastError(err.message)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Error: ' + err.message }
          return updated
        })
        await saveChatMessage('assistant', 'Error: ' + err.message)
        logEvent('builder_error', 'error', `Plan generation failed: ${err.message}`, { pageName: activePage?.name, projectId })
      }
    }
    setLoading(false)
  }

  async function approvePlan() {
    if (!pendingPlan) return
    const buildStartTime = Date.now()
    const approveMsg: Message = { role: 'user', content: 'Plan approved. Build it now exactly as planned.' }
    setMessages(prev => [...prev, approveMsg])
    await saveChatMessage('user', approveMsg.content)
    setPendingPlan(null); setLoading(true); setLastError(null)

    const streamingMsg: Message = { role: 'assistant', content: '🤔 Thinking...' }
    setMessages(prev => [...prev, streamingMsg])
    let rawAccumulator = ''

    try {
      const allMsgs = [...messages, approveMsg].map(m => ({ role: m.role, content: m.content }))
      const data = await callAPI(allMsgs, false, null, (delta) => {
        rawAccumulator += delta
        const status = getBuildStatus(rawAccumulator)
        if (status !== streamingMsg.content) {
          streamingMsg.content = status
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { ...streamingMsg }
            return updated
          })
        }
      }, (status) => {
        streamingMsg.content = `⏳ ${status}`
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...streamingMsg }
          return updated
        })
      })

      const aiMsg: Message = { role: 'assistant', content: data.message }
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = aiMsg
        return updated
      })
      await saveChatMessage('assistant', data.message)
      if (data.code) {
        await savePage(data.code)
        if (isMobile) setMobilePanel('preview')
        // Generate images in background after page is saved/displayed
        if (data.imagePrompts?.length > 0) {
          generateImagesProgressively(data.code, data.imagePrompts)
        }
      } else {
        logEvent('builder_error', 'error', `Build completed but returned no code: ${data.message}`, { pageName: activePage?.name, projectId, message: data.message })
      }
      if (data.layoutUpdated) await loadProject()
      if (data.pagesCreated?.length > 0) await loadPages()
      // Reload shared code in case <SHARED_CODE> was output during this build
      const { data: sc } = await supabase.from('project_shared_code').select('code').eq('project_id', projectId as string).single()
      setSharedCode(sc?.code || null)
    } catch (err: any) {
      if (err.message === '__USER_STOPPED__') {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Stopped by user.' }
          return updated
        })
        await saveChatMessage('assistant', 'Stopped by user.')
        logEvent('builder_stopped', 'info', `Build stopped by user during approvePlan`, { pageName: activePage?.name, projectId })
      } else {
        const phase = streamingMsg.content || 'starting'
        const errDetail = `${err.message} (failed during: ${phase})`
        setLastError(errDetail)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Error: ' + errDetail }
          return updated
        })
        await saveChatMessage('assistant', 'Error: ' + errDetail)
        const elapsedSec = ((Date.now() - buildStartTime) / 1000).toFixed(1)
        logEvent('builder_error', 'error', `approvePlan failed after ${elapsedSec}s: ${err.message}`, {
          pageName: activePage?.name, projectId, phase, elapsedSeconds: elapsedSec,
          partialResponseChars: rawAccumulator.length, userPromptPreview: pendingPlan?.slice(0, 200),
          stack: err.stack?.slice(0, 300),
        })
      }
    }
    setLoading(false)
  }

  // Detect build phase from accumulated raw AI output and return a friendly status
  function getBuildStatus(raw: string): string {
    if (raw.includes('<CODE>')) return '✨ Writing code...'
    if (raw.includes('<MESSAGE>')) return '✨ Almost done...'
    if (raw.includes('<CREATE_TABLE>')) return '🗄️ Setting up database...'
    if (raw.includes('<GENERATE_IMAGE>')) return '🖼️ Preparing image...'
    if (raw.includes('<LAYOUT>')) return '📐 Building layout...'
    if (raw.includes('<CREATE_PAGE>')) return '📄 Creating pages...'
    return '🤔 Thinking...'
  }

  // Auto-fix iframe runtime errors by sending them to Claude
  async function handleIframeErrors(errors: Array<{message: string, source?: string, line?: number, col?: number, stack?: string}>) {
    if (loading || isAutoFixing) return
    if (autoFixAttempts >= MAX_AUTO_FIX_ATTEMPTS) return
    if (!activePage?.code) return

    // Filter out noise: CDN/framework errors, cross-origin script errors
    const realErrors = errors.filter(e => {
      const msg = (e.message || '').toLowerCase()
      if (msg.includes('script error') && !e.source) return false
      if (msg.includes('tailwind')) return false
      if (msg.includes('alpine')) return false
      if (msg.includes('favicon')) return false
      return true
    })
    if (realErrors.length === 0) return

    const errorSummary = realErrors.map(e => {
      let s = e.message
      if (e.line) s += ` (line ${e.line}${e.col ? ':' + e.col : ''})`
      if (e.stack) s += `\nStack: ${e.stack}`
      return s
    }).join('\n---\n')

    const attemptNum = autoFixAttempts + 1
    setIsAutoFixing(true)
    setAutoFixAttempts(attemptNum)

    const statusMsg: Message = { role: 'assistant', content: `Auto-fixing error (attempt ${attemptNum}/${MAX_AUTO_FIX_ATTEMPTS})...` }
    setMessages(prev => [...prev, statusMsg])

    try {
      const fixPrompt = `The code you generated has runtime JavaScript errors. Fix ONLY the errors — do not change the design or functionality.\n\nErrors:\n${errorSummary}`
      const apiMsgs = [{ role: 'user' as const, content: fixPrompt }]
      setLoading(true)

      let rawAccumulator = ''
      const data = await callAPI(apiMsgs, false, null, (delta) => {
        rawAccumulator += delta
        const status = getBuildStatus(rawAccumulator)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `Auto-fixing: ${status}` }
          return updated
        })
      }, undefined, true)

      const aiMsg: Message = { role: 'assistant', content: data.message || 'Auto-fix applied.' }
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = aiMsg
        return updated
      })
      await saveChatMessage('assistant', `[Auto-fix] ${data.message || 'Fixed runtime error.'}`)

      if (data.code) {
        await savePage(data.code)
        if (isMobile) setMobilePanel('preview')
      }
      logEvent('auto_fix', 'info', `Auto-fix attempt ${attemptNum} completed`, {
        pageName: activePage?.name, projectId, errorSummary: errorSummary.slice(0, 300), success: !!data.code,
      })
    } catch (err: any) {
      if (err.message === '__USER_STOPPED__') {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Auto-fix stopped by user.' }
          return updated
        })
      } else {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: `Auto-fix failed: ${err.message}` }
          return updated
        })
        logEvent('auto_fix_error', 'error', `Auto-fix failed: ${err.message}`, {
          pageName: activePage?.name, projectId, errorSummary: errorSummary.slice(0, 300),
        })
      }
    }
    setLoading(false)
    setIsAutoFixing(false)
  }

  // Keep the ref in sync so the postMessage listener always calls the latest version
  handleIframeErrorsRef.current = handleIframeErrors

  async function sendMessage() {
    if ((!input.trim() && !pendingImage) || loading || !activePage) return
    if (mode === 'plan') { getPlan(); return }
    setAutoFixAttempts(0)
    const buildStartTime = Date.now()

    const msgContent = input || (pendingImage ? '(sent an image)' : '')
    const userMsg: Message = { role: 'user', content: msgContent, imageUrl: pendingImage?.preview }
    const newMsgs = [...messages, userMsg]
    setMessages(newMsgs)
    await saveChatMessage('user', msgContent)
    setInput(''); setLoading(true); setLastError(null)
    const imgToSend = pendingImage
    setPendingImage(null)

    // Add a placeholder assistant message for build status
    const streamingMsg: Message = { role: 'assistant', content: '🤔 Thinking...' }
    setMessages(prev => [...prev, streamingMsg])
    let rawAccumulator = ''

    try {
      const apiMsgs = newMsgs.map(m => ({ role: m.role, content: m.content }))
      const data = await callAPI(apiMsgs, false, imgToSend, (delta) => {
        rawAccumulator += delta
        const status = getBuildStatus(rawAccumulator)
        if (status !== streamingMsg.content) {
          streamingMsg.content = status
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { ...streamingMsg }
            return updated
          })
        }
      }, (status) => {
        streamingMsg.content = `⏳ ${status}`
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...streamingMsg }
          return updated
        })
      })

      // Replace streaming message with final message
      const aiMsg: Message = { role: 'assistant', content: data.message }
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = aiMsg
        return updated
      })
      await saveChatMessage('assistant', data.message)
      if (data.code) {
        await savePage(data.code)
        if (isMobile) setMobilePanel('preview')
        // Generate images in background after page is saved/displayed
        if (data.imagePrompts?.length > 0) {
          generateImagesProgressively(data.code, data.imagePrompts)
        }
      } else {
        logEvent('builder_error', 'error', `sendMessage build returned no code: ${data.message}`, { pageName: activePage?.name, projectId, prompt: msgContent.slice(0, 200) })
      }
      if (data.layoutUpdated) await loadProject()
      if (data.pagesCreated?.length > 0) await loadPages()
      // Reload shared code in case <SHARED_CODE> was output during this build
      const { data: sc2 } = await supabase.from('project_shared_code').select('code').eq('project_id', projectId as string).single()
      setSharedCode(sc2?.code || null)
    } catch (err: any) {
      if (err.message === '__USER_STOPPED__') {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Stopped by user.' }
          return updated
        })
        await saveChatMessage('assistant', 'Stopped by user.')
        logEvent('builder_stopped', 'info', `Build stopped by user`, { pageName: activePage?.name, projectId, prompt: msgContent.slice(0, 200) })
      } else {
        const phase = streamingMsg.content || 'starting'
        const errDetail = `${err.message} (failed during: ${phase})`
        setLastError(errDetail)
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { role: 'assistant', content: 'Error: ' + errDetail }
          return updated
        })
        await saveChatMessage('assistant', 'Error: ' + errDetail)
        const elapsedSec = ((Date.now() - buildStartTime) / 1000).toFixed(1)
        logEvent('builder_error', 'error', `sendMessage failed after ${elapsedSec}s: ${err.message}`, {
          pageName: activePage?.name, projectId, prompt: msgContent.slice(0, 200), phase,
          elapsedSeconds: elapsedSec, partialResponseChars: rawAccumulator.length,
        })
      }
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

  if (!user || !project) return <div className="flex items-center justify-center h-screen bg-surface text-[#555] font-sans">Loading...</div>

  const balanceDisplay = `$${creditBalance.toFixed(2)}`
  const balanceColor = creditBalance > 0 ? '#5DCAA5' : '#f09595'

  // Mobile panel visibility
  const showLeft = !isMobile || mobilePanel === 'chat'
  const showRight = !isMobile || mobilePanel === 'preview'

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
            {activePage && (
              <div className="flex gap-0.5 bg-surface-2 rounded-[7px] border border-white/[0.08] p-0.5">
                <button onClick={() => setViewMode('preview')} className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium cursor-pointer border-none ${viewMode==='preview' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[#666]'}`}>Preview</button>
                <button onClick={() => setViewMode('code')} className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium cursor-pointer border-none ${viewMode==='code' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[#666]'}`}>Code</button>
                <button onClick={() => setViewMode('split')} className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium cursor-pointer border-none ${viewMode==='split' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[#666]'}`}>Split</button>
              </div>
            )}
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
            <button className={`flex-1 py-2.5 bg-transparent border-none text-xs font-medium cursor-pointer border-b-2 ${sidebarTab==='pages' ? 'text-[#f0f0f0] border-brand' : 'text-[#444] border-transparent'}`} onClick={() => setSidebarTab('pages')}>Pages ({pages.length})</button>
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
                {loading && messages.length > 0 && messages[messages.length - 1]?.role !== 'assistant' && (
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

          {sidebarTab === 'pages' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="p-3">
                {showNewPage ? (
                  <div className="flex gap-1.5">
                    <input autoFocus value={newPageName} onChange={e => setNewPageName(e.target.value)}
                      onKeyDown={e => { if (e.key==='Enter') createPage(newPageName) }}
                      placeholder="Page name..." className="flex-1 px-2.5 py-1.5 bg-surface-3 border border-white/10 rounded-md text-[#f0f0f0] text-[13px] outline-none" />
                    <button onClick={() => createPage(newPageName)} className="px-3 py-1.5 bg-brand border-none rounded-md text-white text-xs cursor-pointer">Add</button>
                    <button onClick={() => setShowNewPage(false)} className="px-2.5 py-1.5 bg-transparent border border-white/[0.08] rounded-md text-[#555] text-xs cursor-pointer">✕</button>
                  </div>
                ) : (
                  <button onClick={() => setShowNewPage(true)} className="w-full py-2 bg-surface-3 border border-white/[0.08] rounded-lg text-[#666] text-[13px] cursor-pointer text-left px-3">+ New page</button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {pages.map(page => (
                  <div key={page.id} className={`flex items-center px-4 py-2.5 border-b border-white/[0.05] gap-2 ${activePage?.id===page.id ? 'bg-brand/[0.07]' : ''}`}>
                    <div className="flex-1 cursor-pointer" onClick={() => {
                      setActivePage(page);
                      setSidebarTab('chat');
                      if (isMobile) setMobilePanel('chat');
                    }}>
                      <div className="text-[13px] font-medium text-[#f0f0f0]">{page.name}</div>
                      <div className="text-[11px] text-[#444] mt-0.5">{new Date(page.updated_at).toLocaleDateString()}</div>
                    </div>
                    {pages.length > 1 && <button onClick={() => deletePage(page.id)} className="bg-transparent border-none text-[#333] cursor-pointer text-[11px]">✕</button>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div className={`flex-1 flex flex-col overflow-hidden ${isMobile && !showRight ? 'hidden' : ''} ${isMobile ? 'pb-[50px]' : ''}`}>
          <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/[0.07] bg-surface-1 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface-3 border border-white/[0.08] rounded-[7px] shrink-0">
              <span className="text-xs text-[#555]">⊞</span>
              <select
                value={activePage?.id || ''}
                onChange={e => {
                  const page = pages.find(p => p.id === e.target.value)
                  if (page) { setActivePage(page); setSidebarTab('chat') }
                }}
                className="bg-transparent border-none text-[#aaa] text-xs outline-none cursor-pointer max-w-[120px]"
              >
                {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {!isMobile && (
              <div className="flex-1 flex items-center px-3 py-1 bg-surface-2 border border-white/[0.06] rounded-[7px] text-xs overflow-hidden">
                <span className="text-[#333] select-none">customaidashboard.com / preview /</span>
                <span className="text-[#666] ml-1.5">
                  {activePage?.name?.toLowerCase().replace(/\s+/g, '-') || 'page'}
                </span>
              </div>
            )}
            {isMobile && activePage && (
              <button onClick={() => setViewMode(viewMode === 'code' ? 'preview' : 'code')} className={`px-3 py-1 rounded-[7px] text-xs cursor-pointer font-mono border ml-auto ${viewMode==='code' ? 'bg-brand/10 border-brand/30 text-[#9d92f5]' : 'bg-transparent border-white/10 text-[#666]'}`}>
                {'</>'}
              </button>
            )}
            {activePage && (
              <button onClick={() => window.open(`/api/preview/${activePage.id}`, '_blank', 'noopener')} className="px-2.5 py-1 bg-transparent border border-white/[0.07] rounded-md text-[#555] cursor-pointer text-[13px] shrink-0" title="Open preview in new tab">↗</button>
            )}
            {activePage && (
              <button onClick={() => setShowHistory(true)} className="px-2.5 py-1 bg-transparent border border-white/[0.07] rounded-md text-[#555] cursor-pointer text-[13px] shrink-0" title="Version history">⏱</button>
            )}
            <button onClick={() => activePage && renderIframe(activePage.code)} className="px-2.5 py-1 bg-transparent border border-white/[0.07] rounded-md text-[#555] cursor-pointer text-[13px] shrink-0" title="Refresh preview">↺</button>
          </div>
          {viewMode === 'split' && activePage ? (
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 flex flex-col overflow-hidden border-r border-white/[0.07]">
                <CodeEditor
                  code={activePage.code}
                  pageName={activePage.name}
                  onChange={(val) => renderIframe(val)}
                  onSave={(val) => savePage(val, 'manual_edit')}
                />
              </div>
              <div className="flex-1 flex flex-col overflow-hidden">
                <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" className="flex-1 border-none bg-surface w-full h-full" title="preview" />
              </div>
            </div>
          ) : viewMode === 'code' && activePage ? (
            <CodeEditor
              code={activePage.code}
              pageName={activePage.name}
              onChange={(val) => renderIframe(val)}
              onSave={(val) => savePage(val, 'manual_edit')}
            />
          ) : (
            <iframe ref={iframeRef} sandbox="allow-scripts allow-same-origin allow-forms allow-modals" className="flex-1 border-none bg-surface w-full h-full" title="preview" />
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

      {/* Version History */}
      {showHistory && activePage && (
        <VersionHistory
          pageId={activePage.id}
          onClose={() => setShowHistory(false)}
          onPreview={(code) => renderIframe(code)}
          onRestore={(code) => {
            savePage(code, 'restore')
            setShowHistory(false)
          }}
        />
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
    </div>
  )
}

function getStarterCode() {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"><\/script><script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7'}}}}}<\/script><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"></head><body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10"><div class="text-center max-w-lg"><div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6"><i class="fa-solid fa-wand-magic-sparkles text-brand text-xl"></i></div><h1 class="text-white text-2xl font-semibold mb-3">Start building</h1><p class="text-white/50 text-sm leading-relaxed mb-8">Use the AI chat on the left to build anything you want.</p><div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm">Try: "Build an admin dashboard with a sidebar, stats and users table"</div></div></body></html>`
}

