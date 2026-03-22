import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
      } else {
        setSuccess('Account created! Check your email to confirm, then log in.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
      } else {
        router.push('/dashboard')
      }
    }
    setLoading(false)
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>AI</div>
          <h1 style={styles.logoText}>Custom AI Dashboard</h1>
        </div>

        <p style={styles.subtitle}>
          {mode === 'login' ? 'Sign in to your workspace' : 'Create your workspace'}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={styles.input}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.successMsg}>{success}</div>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={styles.toggle}>
          {mode === 'login' ? (
            <>Don&apos;t have an account?{' '}
              <button onClick={() => setMode('signup')} style={styles.link}>Sign up</button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button onClick={() => setMode('login')} style={styles.link}>Sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '24px',
  },
  card: {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
  },
  logoIcon: {
    width: '36px',
    height: '36px',
    background: 'var(--accent)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '600',
    color: 'white',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text)',
  },
  subtitle: {
    color: 'var(--text-2)',
    fontSize: '13px',
    marginBottom: '28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '12px',
    color: 'var(--text-2)',
  },
  input: {
    padding: '10px 12px',
    background: 'var(--bg-3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text)',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  error: {
    background: 'rgba(163,45,45,0.15)',
    border: '1px solid rgba(163,45,45,0.3)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
    fontSize: '13px',
    color: '#f09595',
  },
  successMsg: {
    background: 'rgba(29,158,117,0.15)',
    border: '1px solid rgba(29,158,117,0.3)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
    fontSize: '13px',
    color: '#5DCAA5',
  },
  btn: {
    padding: '11px',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 'var(--radius)',
    color: 'white',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    marginTop: '4px',
    transition: 'background 0.15s',
  },
  toggle: {
    marginTop: '24px',
    textAlign: 'center',
    fontSize: '13px',
    color: 'var(--text-2)',
  },
  link: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    cursor: 'pointer',
    fontSize: '13px',
    padding: '0',
  },
}
