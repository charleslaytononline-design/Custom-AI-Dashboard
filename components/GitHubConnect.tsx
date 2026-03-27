import { useState } from 'react'

interface GitHubConnectProps {
  projectId: string
  userId: string
  projectName: string
}

export default function GitHubConnect({ projectId, userId, projectName }: GitHubConnectProps) {
  const [showModal, setShowModal] = useState(false)
  const [token, setToken] = useState('')
  const [repoName, setRepoName] = useState(
    projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  )
  const [isPrivate, setIsPrivate] = useState(true)
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState<{ url?: string; error?: string } | null>(null)

  async function pushToGitHub() {
    if (!token.trim()) return
    setPushing(true)
    setResult(null)
    try {
      const res = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, githubToken: token, repoName, isPrivate }),
      })
      const data = await res.json()
      if (data.error) {
        setResult({ error: data.error })
      } else {
        setResult({ url: data.url })
      }
    } catch (err: any) {
      setResult({ error: err.message })
    }
    setPushing(false)
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="px-3 py-1.5 bg-transparent border border-[var(--border)] rounded-md text-[var(--text-2)] text-xs cursor-pointer hover:bg-white/[0.04] shrink-0 transition-colors"
      >
        GitHub
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-2)] border border-white/10 rounded-2xl p-6 w-full max-w-[420px] flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold text-[var(--text)]">Export to GitHub</h2>
              <button onClick={() => setShowModal(false)} className="bg-transparent border-none text-[var(--text-3)] text-sm cursor-pointer">✕</button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[11px] text-[var(--text-2)] mb-1 block">GitHub Personal Access Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="ghp_..."
                  className="w-full px-3 py-2 bg-surface-3 border border-[var(--border)] rounded-lg text-[var(--text)] text-[13px] outline-none"
                />
                <p className="text-[10px] text-[var(--text-3)] mt-1">
                  Create one at github.com/settings/tokens with &quot;repo&quot; scope
                </p>
              </div>

              <div>
                <label className="text-[11px] text-[var(--text-2)] mb-1 block">Repository Name</label>
                <input
                  value={repoName}
                  onChange={e => setRepoName(e.target.value)}
                  className="w-full px-3 py-2 bg-surface-3 border border-[var(--border)] rounded-lg text-[var(--text)] text-[13px] outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-[12px] text-[var(--text-2)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={e => setIsPrivate(e.target.checked)}
                  className="accent-brand"
                />
                Private repository
              </label>
            </div>

            {result && (
              <div className={`p-3 rounded-lg text-xs ${result.error ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                {result.error ? (
                  <span>{result.error}</span>
                ) : (
                  <>
                    Pushed successfully!{' '}
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline">
                      View on GitHub
                    </a>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={pushToGitHub}
                disabled={pushing || !token.trim()}
                className="flex-1 py-2 bg-brand border-none rounded-lg text-white text-[13px] font-medium cursor-pointer disabled:opacity-50"
              >
                {pushing ? 'Pushing...' : 'Push to GitHub'}
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-transparent border border-[var(--border)] rounded-lg text-[var(--text-2)] text-[13px] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
