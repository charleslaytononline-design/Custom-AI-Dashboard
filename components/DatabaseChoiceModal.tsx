/**
 * DatabaseChoiceModal — Appears when a project first needs database storage.
 * User chooses between platform's secure server or connecting their own Supabase.
 */
import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface DatabaseChoiceModalProps {
  projectId: string
  onChoosePlatform: () => void
  onChooseCustom: () => void
  onClose: () => void
}

export default function DatabaseChoiceModal({
  projectId,
  onChoosePlatform,
  onChooseCustom,
  onClose,
}: DatabaseChoiceModalProps) {
  const [saving, setSaving] = useState(false)

  async function handlePlatform() {
    setSaving(true)
    await fetch('/api/projects/set-platform-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    })

    // Log server activation for analytics and email alerts
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'server_activated',
        severity: 'info',
        message: `User activated platform server for project ${projectId}`,
        metadata: { projectId },
      }),
    }).catch(() => {})

    setSaving(false)
    onChoosePlatform()
  }

  async function handleCustom() {
    setSaving(true)
    await supabase.from('projects').update({ db_provider: 'custom' }).eq('id', projectId)
    setSaving(false)
    onChooseCustom()
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div
        className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-[520px] flex flex-col gap-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/15 flex items-center justify-center text-xl">🗄</div>
          <div>
            <h2 className="text-base font-semibold text-[#f0f0f0]">Your app needs a database</h2>
            <p className="text-[#888] text-[13px] mt-0.5">Choose where to store your app's data</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {/* Option 1: Platform DB */}
          <button
            onClick={handlePlatform}
            disabled={saving}
            className="w-full text-left p-4 bg-[#0a0a0a] border border-white/[0.08] rounded-xl hover:border-brand/30 hover:bg-brand/[0.03] transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 text-sm shrink-0 mt-0.5">⚡</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#f0f0f0] group-hover:text-brand transition-colors">
                  Use our secure server
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-normal">Recommended</span>
                </div>
                <p className="text-[12px] text-[#888] mt-1 leading-relaxed">
                  We'll store your data on our secure, managed database. No setup needed — just start building.
                  Your data is isolated and only accessible by your project.
                </p>
                <div className="flex gap-3 mt-2">
                  <span className="text-[10px] text-[#555]">✓ Instant setup</span>
                  <span className="text-[10px] text-[#555]">✓ Fully managed</span>
                  <span className="text-[10px] text-[#555]">✓ Secure & isolated</span>
                </div>
              </div>
            </div>
          </button>

          {/* Option 2: Own Supabase */}
          <button
            onClick={handleCustom}
            disabled={saving}
            className="w-full text-left p-4 bg-[#0a0a0a] border border-white/[0.08] rounded-xl hover:border-white/20 hover:bg-white/[0.02] transition-all cursor-pointer disabled:opacity-50 group"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#888] text-sm shrink-0 mt-0.5">🔗</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-[#ccc] group-hover:text-white transition-colors">
                  Connect your own Supabase
                </div>
                <p className="text-[12px] text-[#666] mt-1 leading-relaxed">
                  Use your own Supabase project for full control. You'll need to provide your project URL and anon key.
                  Supports auth, storage, realtime, and edge functions.
                </p>
                <div className="flex gap-3 mt-2">
                  <span className="text-[10px] text-[#444]">✓ Full control</span>
                  <span className="text-[10px] text-[#444]">✓ Own auth</span>
                  <span className="text-[10px] text-[#444]">✓ Requires setup</span>
                </div>
              </div>
            </div>
          </button>
        </div>

        <p className="text-[11px] text-[#555] text-center">You must choose an option to continue building</p>
      </div>
    </div>
  )
}
