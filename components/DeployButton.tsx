import { useState } from 'react'

interface DeployButtonProps {
  projectId: string
  userId: string
}

export default function DeployButton({ projectId, userId }: DeployButtonProps) {
  const [deploying, setDeploying] = useState(false)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function deploy() {
    setDeploying(true)
    setError(null)
    setDeployUrl(null)
    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId }),
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error + (data.detail ? `: ${data.detail}` : ''))
      } else {
        setDeployUrl(data.url)
      }
    } catch (err: any) {
      setError(err.message)
    }
    setDeploying(false)
  }

  return (
    <div className="relative">
      <button
        onClick={deploy}
        disabled={deploying}
        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 border-none rounded-md text-white text-xs font-medium cursor-pointer disabled:opacity-50 shrink-0 transition-colors"
      >
        {deploying ? 'Deploying...' : '🚀 Deploy'}
      </button>

      {(deployUrl || error) && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#111] border border-white/10 rounded-xl p-4 z-50 shadow-xl">
          {deployUrl ? (
            <>
              <div className="text-emerald-400 text-xs font-medium mb-2">Deployed successfully!</div>
              <a
                href={deployUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand text-xs underline break-all"
              >
                {deployUrl}
              </a>
              <button
                onClick={() => { navigator.clipboard.writeText(deployUrl); }}
                className="mt-2 px-2 py-1 bg-surface-3 border border-white/[0.08] rounded text-[#888] text-[10px] cursor-pointer"
              >
                Copy URL
              </button>
            </>
          ) : error ? (
            <>
              <div className="text-red-400 text-xs font-medium mb-1">Deploy failed</div>
              <div className="text-[#888] text-[11px]">{error}</div>
            </>
          ) : null}
          <button
            onClick={() => { setDeployUrl(null); setError(null) }}
            className="absolute top-2 right-2 bg-transparent border-none text-[#555] text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
