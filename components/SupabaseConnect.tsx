/**
 * SupabaseConnect — Modal to connect a user's own Supabase project.
 * Users paste their Supabase URL + anon key, we validate and store it.
 */
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { createClient } from '@supabase/supabase-js'

interface SupabaseConnectProps {
  projectId: string
  /** Current saved URL (if any) */
  supabaseUrl?: string | null
  /** Current saved anon key (if any) */
  supabaseAnonKey?: string | null
  /** Called after successful save */
  onSaved?: (url: string, anonKey: string) => void
  /** Called to close the modal */
  onClose: () => void
}

export default function SupabaseConnect({
  projectId,
  supabaseUrl: savedUrl,
  supabaseAnonKey: savedKey,
  onSaved,
  onClose,
}: SupabaseConnectProps) {
  const [url, setUrl] = useState(savedUrl || '')
  const [anonKey, setAnonKey] = useState(savedKey || '')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const isConnected = !!(savedUrl && savedKey)

  async function testConnection() {
    if (!url.trim() || !anonKey.trim()) {
      setStatus('error')
      setErrorMsg('Please enter both URL and anon key')
      return
    }

    // Validate URL format
    if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
      setStatus('error')
      setErrorMsg('URL must be a valid Supabase project URL (https://xxx.supabase.co)')
      return
    }

    setTesting(true)
    setStatus('idle')
    setErrorMsg('')

    try {
      const testClient = createClient(url.trim(), anonKey.trim())
      // Try a simple query — even if it returns 0 rows, the connection works
      const { error } = await testClient.from('_test_connection').select('*').limit(0)
      // A 404 (relation not found) is FINE — it means the connection works
      if (error && !error.message.includes('does not exist') && !error.message.includes('relation')) {
        throw new Error(error.message)
      }
      setStatus('success')
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message || 'Connection failed. Check your URL and anon key.')
    } finally {
      setTesting(false)
    }
  }

  async function saveConnection() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          supabase_url: url.trim(),
          supabase_anon_key: anonKey.trim(),
        })
        .eq('id', projectId)

      if (error) throw error

      onSaved?.(url.trim(), anonKey.trim())
      onClose()
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          supabase_url: null,
          supabase_anon_key: null,
        })
        .eq('id', projectId)

      if (error) throw error

      setUrl('')
      setAnonKey('')
      setStatus('idle')
      onSaved?.('', '')
      onClose()
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to disconnect')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[var(--bg-2)] border border-white/10 rounded-2xl p-6 w-full max-w-[480px] flex flex-col gap-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <h2 className="text-base font-semibold text-[var(--text)]">Connect Supabase</h2>
          </div>
          {isConnected && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Connected</span>
          )}
        </div>

        <p className="text-[var(--text-2)] text-[13px] -mt-1">
          Connect your own Supabase project to enable auth, database, and storage in your app.
        </p>

        {/* URL Input */}
        <div>
          <label className="text-[11px] text-[var(--text-3)] font-medium uppercase tracking-wider mb-1.5 block">
            Project URL
          </label>
          <input
            type="url"
            value={url}
            onChange={e => { setUrl(e.target.value); setStatus('idle') }}
            placeholder="https://your-project.supabase.co"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-white/10 rounded-lg text-[var(--text)] text-sm outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20"
          />
        </div>

        {/* Anon Key Input */}
        <div>
          <label className="text-[11px] text-[var(--text-3)] font-medium uppercase tracking-wider mb-1.5 block">
            Anon / Public Key
          </label>
          <input
            type="password"
            value={anonKey}
            onChange={e => { setAnonKey(e.target.value); setStatus('idle') }}
            placeholder="eyJhbGciOiJIUzI1NiIs..."
            className="w-full px-3 py-2 bg-[var(--bg)] border border-white/10 rounded-lg text-[var(--text)] text-sm outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 font-mono text-xs"
          />
          <p className="text-[10px] text-[var(--text-3)] mt-1.5">
            Found in your Supabase Dashboard → Settings → API → Project API Keys
          </p>
        </div>

        {/* Status */}
        {status === 'success' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <span className="text-emerald-400">✓</span>
            <span className="text-emerald-300 text-[13px]">Connection successful!</span>
          </div>
        )}
        {status === 'error' && errorMsg && (
          <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
            <span className="text-red-400">✕</span>
            <span className="text-red-300 text-[13px]">{errorMsg}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={testConnection}
            disabled={testing || !url.trim() || !anonKey.trim()}
            className="px-4 py-2 bg-surface-3 border border-[var(--border)] rounded-lg text-[var(--text-2)] text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/[0.08]"
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>

          <button
            onClick={saveConnection}
            disabled={saving || status !== 'success'}
            className="px-4 py-2 bg-brand border-none rounded-lg text-white text-[13px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >
            {saving ? 'Saving...' : 'Save & Connect'}
          </button>

          <div className="flex-1" />

          {isConnected && (
            <button
              onClick={disconnect}
              disabled={saving}
              className="px-3 py-2 bg-transparent border border-red-500/20 rounded-lg text-red-400 text-[13px] cursor-pointer hover:bg-red-500/10"
            >
              Disconnect
            </button>
          )}

          <button
            onClick={onClose}
            className="px-3 py-2 bg-transparent border border-[var(--border)] rounded-lg text-[var(--text-2)] text-[13px] cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
