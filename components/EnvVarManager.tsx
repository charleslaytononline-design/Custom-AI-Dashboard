/**
 * EnvVarManager — UI to manage environment variables per project.
 * Variables are injected into the browser bundler and Vercel deployments.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface EnvVar {
  id: string
  key: string
  value: string
  is_secret: boolean
}

interface EnvVarManagerProps {
  projectId: string
  onEnvChange?: (vars: Record<string, string>) => void
}

export default function EnvVarManager({ projectId, onEnvChange }: EnvVarManagerProps) {
  const [vars, setVars] = useState<EnvVar[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newSecret, setNewSecret] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    loadVars()
  }, [projectId])

  async function loadVars() {
    const { data } = await supabase
      .from('project_env_vars')
      .select('*')
      .eq('project_id', projectId)
      .order('key')
    if (data) {
      setVars(data)
      emitChange(data)
    }
  }

  function emitChange(envVars: EnvVar[]) {
    if (onEnvChange) {
      const map: Record<string, string> = {}
      for (const v of envVars) map[v.key] = v.value
      onEnvChange(map)
    }
  }

  async function addVar() {
    if (!newKey.trim()) return
    setAdding(true)
    try {
      const { error } = await supabase
        .from('project_env_vars')
        .upsert({
          project_id: projectId,
          key: newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
          value: newValue,
          is_secret: newSecret,
        }, { onConflict: 'project_id,key' })
      if (!error) {
        setNewKey('')
        setNewValue('')
        setNewSecret(false)
        setShowAdd(false)
        await loadVars()
      }
    } finally {
      setAdding(false)
    }
  }

  async function deleteVar(id: string) {
    await supabase.from('project_env_vars').delete().eq('id', id)
    await loadVars()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] text-[var(--text-3)] font-semibold uppercase tracking-wider">Env Variables</span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-[10px] text-brand bg-transparent border-none cursor-pointer hover:underline"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAdd && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          <input
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="VARIABLE_NAME"
            className="px-2 py-1.5 bg-[var(--bg)] border border-white/10 rounded text-xs text-white outline-none focus:border-brand/50 font-mono uppercase"
          />
          <input
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            placeholder="value"
            type={newSecret ? 'password' : 'text'}
            className="px-2 py-1.5 bg-[var(--bg)] border border-white/10 rounded text-xs text-white outline-none focus:border-brand/50 font-mono"
            onKeyDown={e => e.key === 'Enter' && addVar()}
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={newSecret}
                onChange={e => setNewSecret(e.target.checked)}
                className="w-3 h-3 cursor-pointer"
              />
              <span className="text-[10px] text-[var(--text-2)]">Secret (hidden in UI)</span>
            </label>
            <button
              onClick={addVar}
              disabled={adding || !newKey.trim()}
              className="px-2.5 py-1 bg-brand border-none rounded text-white text-[10px] cursor-pointer disabled:opacity-40"
            >
              {adding ? '...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <div className="px-3 space-y-0.5">
        {vars.length === 0 ? (
          <div className="text-[10px] text-[var(--text-3)] py-1">No environment variables set</div>
        ) : (
          vars.map(v => (
            <div key={v.id} className="flex items-center justify-between group py-0.5">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[10px] text-[var(--text-2)] font-mono truncate">{v.key}</span>
                <span className="text-[9px] text-[var(--text-3)] font-mono truncate max-w-[80px]">
                  {v.is_secret ? '••••••' : v.value}
                </span>
              </div>
              <button
                onClick={() => deleteVar(v.id)}
                className="text-[10px] text-[var(--text-3)] hover:text-red-400 bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-100 shrink-0"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
