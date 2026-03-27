/**
 * PreviewFrame — Unified live preview component for the AI builder.
 *
 * For React projects: bundles files in-browser via esbuild-wasm and renders in iframe.
 * For HTML projects: renders composed HTML directly via srcdoc.
 * Includes: error console, responsive viewport controls, loading states.
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import type { ProjectFile } from '../lib/virtualFS'

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info'
  message: string
  timestamp: number
}

interface PreviewError {
  message: string
  source: string
  line: number
  col: number
  stack: string
  timestamp: number
}

type Viewport = 'desktop' | 'tablet' | 'mobile'
const VIEWPORT_SIZES: Record<Viewport, { width: number; label: string }> = {
  desktop: { width: 0, label: '🖥' },       // 0 = fill container
  tablet: { width: 768, label: '⊟' },
  mobile: { width: 375, label: '📱' },
}

interface PreviewFrameProps {
  /** All project files */
  files: ProjectFile[]
  /** Project type: 'react' or 'html' */
  projectType: string
  /** Project name */
  projectName: string
  /** Brand color */
  brandColor?: string
  /** Deployed URL (if any) — shown as option */
  deployUrl?: string | null
  /** Welcome HTML fallback */
  welcomeHtml?: string | null
  /** Environment variables */
  envVars?: Record<string, string>
  /** Extra npm packages (name → version) */
  extraPackages?: Record<string, string>
  /** Callback when user clicks "Fix this" on an error */
  onFixError?: (errorText: string) => void
  /** Key that changes to force a rebuild (e.g. increment after AI build completes) */
  buildTrigger?: number
}

export default function PreviewFrame({
  files,
  projectType,
  projectName,
  brandColor = '#7c6ef7',
  deployUrl,
  welcomeHtml,
  envVars = {},
  extraPackages,
  onFixError,
  buildTrigger = 0,
}: PreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)
  const [bundling, setBundling] = useState(false)
  const [bundleErrors, setBundleErrors] = useState<string[]>([])
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [previewErrors, setPreviewErrors] = useState<PreviewError[]>([])
  const [showConsole, setShowConsole] = useState(false)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [previewSource, setPreviewSource] = useState<'live' | 'deployed'>('live')
  const bundleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Convert files array to a map for the bundler
  const fileMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const f of files) {
      if (f.content !== null) {
        map[f.path] = f.content
      }
    }
    return map
  }, [files])

  // Check if this is a React project with files to bundle
  const isReactProject = projectType === 'react' && files.length > 0 && !!fileMap['src/main.tsx']

  // Convert HTML string to a blob URL for the preview iframe.
  // Using blob URLs instead of srcdoc avoids Chrome blocking form submissions
  // to about:srcdoc (which Chrome treats as an invalid form submission target).
  const updateBlobUrl = useCallback((html: string) => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    blobUrlRef.current = url
    setBlobUrl(url)
  }, [])

  // Revoke blob URL on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  // Bundle React project files
  const bundleAndRender = useCallback(async () => {
    if (!isReactProject) return

    setBundling(true)
    setBundleErrors([])
    setConsoleEntries([])
    setPreviewErrors([])

    try {
      // Dynamic import to avoid loading esbuild-wasm until needed
      console.log('[PreviewFrame] Starting bundle...')
      const { bundleProject } = await import('../lib/browserBundler')
      const { generatePreviewHtml, generateErrorHtml } = await import('../lib/previewRenderer')
      console.log('[PreviewFrame] esbuild module loaded, bundling...')

      const result = await bundleProject({
        files: fileMap,
        extraPackages,
        envVars,
      })

      console.log(`[PreviewFrame] Bundle result — js: ${result.js.length} chars, css: ${result.css.length} chars, errors: ${result.errors.length}, cdnMap keys: ${Object.keys(result.cdnMap).length}`)

      if (result.errors.length > 0) {
        setBundleErrors(result.errors)
        updateBlobUrl(generateErrorHtml(result.errors))
      } else {
        const html = generatePreviewHtml({
          js: result.js,
          css: result.css,
          cdnMap: result.cdnMap,
          projectName,
          brandColor,
        })
        console.log(`[PreviewFrame] Preview HTML generated: ${html.length} chars`)
        updateBlobUrl(html)
      }
    } catch (err: any) {
      console.error('[PreviewFrame] Bundle error:', err)
      const errorMsg = err.message || 'Bundle failed'
      setBundleErrors([errorMsg])
      const { generateErrorHtml } = await import('../lib/previewRenderer')
      updateBlobUrl(generateErrorHtml([errorMsg]))
    } finally {
      setBundling(false)
    }
  }, [isReactProject, fileMap, extraPackages, envVars, projectName, brandColor, updateBlobUrl])

  // Rebundle when files change (debounced) or buildTrigger changes
  // Auto-bundles on page load if project has files — existing projects render immediately
  useEffect(() => {
    if (!isReactProject) return

    if (bundleTimerRef.current) clearTimeout(bundleTimerRef.current)
    bundleTimerRef.current = setTimeout(() => {
      bundleAndRender()
    }, 600) // 600ms debounce

    return () => {
      if (bundleTimerRef.current) clearTimeout(bundleTimerRef.current)
    }
  }, [fileMap, buildTrigger, bundleAndRender])

  // Listen for messages from the preview iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data
      if (!data?.type) return

      if (data.type === 'preview-console') {
        setConsoleEntries(prev => [...prev.slice(-99), {
          level: data.level,
          message: data.message,
          timestamp: data.timestamp,
        }])
        // Auto-show console on errors
        if (data.level === 'error') setShowConsole(true)
      } else if (data.type === 'preview-error') {
        setPreviewErrors(prev => [...prev.slice(-19), data as PreviewError])
        setShowConsole(true)
      } else if (data.type === 'preview-build-error') {
        setBundleErrors(data.errors || [])
        setShowConsole(true)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Determine what to show
  const showDeployedPreview = previewSource === 'deployed' && deployUrl
  const hasLivePreview = isReactProject && blobUrl

  const errorCount = previewErrors.length + bundleErrors.length
  const consoleCount = consoleEntries.length

  const viewportStyle: React.CSSProperties = viewport === 'desktop'
    ? { width: '100%', height: '100%' }
    : {
        width: VIEWPORT_SIZES[viewport].width,
        maxWidth: '100%',
        height: '100%',
        margin: '0 auto',
        borderLeft: '1px solid var(--border)',
        borderRight: '1px solid var(--border)',
      }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Preview toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border)] bg-[#0c0c0c] shrink-0">
        {/* Source toggle (live vs deployed) */}
        {isReactProject && (
          <div className="flex items-center rounded-md overflow-hidden border border-[var(--border)] mr-1.5">
            <button
              onClick={() => setPreviewSource('live')}
              className={`px-2 py-0.5 text-[10px] font-medium border-none cursor-pointer transition-colors ${previewSource === 'live' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
            >
              Live
            </button>
            {deployUrl && (
              <button
                onClick={() => setPreviewSource('deployed')}
                className={`px-2 py-0.5 text-[10px] font-medium border-none cursor-pointer transition-colors ${previewSource === 'deployed' ? 'bg-brand/20 text-[#9d92f5]' : 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
              >
                Deployed
              </button>
            )}
          </div>
        )}

        {/* Viewport controls */}
        <div className="flex items-center gap-0.5">
          {(Object.entries(VIEWPORT_SIZES) as [Viewport, { width: number; label: string }][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => setViewport(key)}
              className={`w-6 h-6 flex items-center justify-center rounded text-xs border-none cursor-pointer transition-colors ${viewport === key ? 'bg-white/10 text-white' : 'bg-transparent text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
              title={key.charAt(0).toUpperCase() + key.slice(1)}
            >
              {val.label}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        {isReactProject && previewSource === 'live' && (
          <button
            onClick={bundleAndRender}
            disabled={bundling}
            className="ml-1 px-2 py-0.5 text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] bg-transparent border border-[var(--border)] rounded cursor-pointer disabled:opacity-40"
            title="Refresh preview"
          >
            {bundling ? '⟳' : '↻'} Refresh
          </button>
        )}

        {/* Bundling indicator */}
        {bundling && (
          <span className="ml-1.5 text-[10px] text-brand animate-pulse">Bundling...</span>
        )}

        <div className="flex-1" />

        {/* Console toggle */}
        <button
          onClick={() => setShowConsole(!showConsole)}
          className={`px-2 py-0.5 text-[10px] font-medium border rounded cursor-pointer transition-colors ${
            showConsole
              ? 'bg-white/10 border-white/20 text-[var(--text-2)]'
              : errorCount > 0
                ? 'bg-red-500/10 border-red-500/30 text-red-400'
                : 'bg-transparent border-[var(--border)] text-[var(--text-3)]'
          }`}
        >
          Console{errorCount > 0 ? ` (${errorCount})` : consoleCount > 0 ? ` (${consoleCount})` : ''}
        </button>

        {/* Open deployed site */}
        {deployUrl && (
          <button
            onClick={() => window.open(`https://${deployUrl}`, '_blank', 'noopener')}
            className="px-2 py-0.5 text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] bg-transparent border border-[var(--border)] rounded cursor-pointer"
            title="Open deployed site"
          >
            ↗
          </button>
        )}
      </div>

      {/* Preview content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex items-start justify-center overflow-auto bg-[var(--bg)]">
          <div style={viewportStyle}>
            {showDeployedPreview ? (
              <iframe
                ref={iframeRef}
                src={`https://${deployUrl}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                className="w-full h-full border-none"
                title="deployed preview"
              />
            ) : hasLivePreview ? (
              <iframe
                ref={iframeRef}
                src={blobUrl!}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-top-navigation-by-user-activation"
                className="w-full h-full border-none"
                title="live preview"
              />
            ) : welcomeHtml ? (
              <iframe
                srcDoc={welcomeHtml}
                sandbox="allow-scripts"
                className="w-full h-full border-none"
                title="welcome"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--text-3)] text-[13px] h-full">
                {bundling ? 'Building preview...' : 'No preview available'}
              </div>
            )}
          </div>
        </div>

        {/* Console panel */}
        {showConsole && (
          <div className="h-[180px] min-h-[120px] border-t border-[var(--border)] bg-[#0c0c0c] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.05] shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-wider">Console</span>
                {errorCount > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setConsoleEntries([]); setPreviewErrors([]); setBundleErrors([]) }}
                  className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] bg-transparent border-none cursor-pointer"
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowConsole(false)}
                  className="text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] bg-transparent border-none cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11px] space-y-0.5">
              {/* Build errors */}
              {bundleErrors.map((err, i) => (
                <div key={`berr-${i}`} className="flex items-start gap-2 py-1 border-b border-white/[0.03]">
                  <span className="text-red-400 shrink-0 mt-px">✕</span>
                  <span className="text-red-300 flex-1 break-all">{err}</span>
                  {onFixError && (
                    <button
                      onClick={() => onFixError(`Fix this build error: ${err}`)}
                      className="shrink-0 px-1.5 py-0.5 text-[9px] bg-brand/10 text-brand border border-brand/20 rounded cursor-pointer hover:bg-brand/20"
                    >
                      Fix
                    </button>
                  )}
                </div>
              ))}
              {/* Runtime errors */}
              {previewErrors.map((err, i) => (
                <div key={`perr-${i}`} className="flex items-start gap-2 py-1 border-b border-white/[0.03]">
                  <span className="text-red-400 shrink-0 mt-px">⚠</span>
                  <div className="flex-1">
                    <span className="text-red-300 break-all">{err.message}</span>
                    {err.stack && <pre className="text-[#553333] text-[10px] mt-0.5 whitespace-pre-wrap m-0">{err.stack.split('\n').slice(0, 3).join('\n')}</pre>}
                  </div>
                  {onFixError && (
                    <button
                      onClick={() => onFixError(`Fix this runtime error: ${err.message}${err.stack ? '\n' + err.stack.split('\n').slice(0, 3).join('\n') : ''}`)}
                      className="shrink-0 px-1.5 py-0.5 text-[9px] bg-brand/10 text-brand border border-brand/20 rounded cursor-pointer hover:bg-brand/20"
                    >
                      Fix
                    </button>
                  )}
                </div>
              ))}
              {/* Console entries */}
              {consoleEntries.map((entry, i) => (
                <div key={`c-${i}`} className="flex items-start gap-2 py-0.5">
                  <span className={`shrink-0 mt-px ${
                    entry.level === 'error' ? 'text-red-400' :
                    entry.level === 'warn' ? 'text-yellow-400' :
                    'text-[var(--text-3)]'
                  }`}>
                    {entry.level === 'error' ? '✕' : entry.level === 'warn' ? '⚠' : '›'}
                  </span>
                  <span className={`flex-1 break-all ${
                    entry.level === 'error' ? 'text-red-300' :
                    entry.level === 'warn' ? 'text-yellow-300' :
                    'text-[var(--text-2)]'
                  }`}>
                    {entry.message}
                  </span>
                </div>
              ))}
              {bundleErrors.length === 0 && previewErrors.length === 0 && consoleEntries.length === 0 && (
                <div className="text-[var(--text-3)] py-2">No console output</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
