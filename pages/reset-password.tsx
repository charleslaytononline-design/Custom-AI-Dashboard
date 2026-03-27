import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { useMobile } from '../hooks/useMobile'

export default function ResetPassword() {
  const router = useRouter()
  const isMobile = useMobile()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase handles the token exchange from the URL hash automatically
    // via the auth-helpers library. We listen for the session to be set.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })

    // Also check if we already have a session (e.g. page loaded after redirect)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    setError('')

    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)

    // Log successful password reset
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'password_reset_completed',
        severity: 'info',
        message: 'Password reset completed successfully',
      }),
    }).catch(() => {})

    setTimeout(() => router.push('/home'), 2000)
  }

  if (success) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, padding: isMobile ? 24 : 40 }}>
          <div style={s.brand}>
            <div style={s.brandIcon}>AI</div>
            <div>
              <div style={s.brandName}>Custom AI Dashboard</div>
              <div style={s.brandSub}>Build anything with AI</div>
            </div>
          </div>
          <div style={s.ok}>Password updated successfully! Redirecting...</div>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.card, padding: isMobile ? 24 : 40 }}>
        <div style={s.brand}>
          <div style={s.brandIcon}>AI</div>
          <div>
            <div style={s.brandName}>Custom AI Dashboard</div>
            <div style={s.brandSub}>Build anything with AI</div>
          </div>
        </div>
        {!ready ? (
          <div style={{ color: 'var(--text-2)', fontSize: 14, textAlign: 'center' as const }}>
            Verifying reset link...
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>New password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required style={s.input} />
            </div>
            <div style={s.field}>
              <label style={s.label}>Confirm new password</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required style={s.input} />
            </div>
            {error && <div style={s.err}>{error}</div>}
            <button type="submit" disabled={loading} style={s.btn}>
              {loading ? 'Please wait...' : 'Reset password'}
            </button>
          </form>
        )}
        <div style={s.toggle}>
          <button onClick={() => router.push('/')} style={s.link}>Back to sign in</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 16 },
  card: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 16, padding: 40, width: '100%', maxWidth: 400 },
  brand: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 32 },
  brandIcon: { width: 44, height: 44, background: 'var(--accent)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'white', flexShrink: 0 },
  brandName: { fontSize: 17, fontWeight: 600, color: 'var(--text)' },
  brandSub: { fontSize: 12, color: 'var(--text-3)', marginTop: 2 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: 'var(--text-2)' },
  input: { padding: '10px 12px', background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 14, outline: 'none' },
  err: { background: 'rgba(163,45,45,0.15)', border: '1px solid rgba(163,45,45,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#f09595' },
  ok: { background: 'rgba(29,158,117,0.15)', border: '1px solid rgba(29,158,117,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#5DCAA5' },
  btn: { padding: 11, background: 'var(--accent)', border: 'none', borderRadius: 8, color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer', marginTop: 4 },
  toggle: { marginTop: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-3)' },
  link: { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 },
}
