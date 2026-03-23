import { useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { useMobile } from '../hooks/useMobile'

function log(event_type: string, severity: string, message: string, email?: string, metadata?: object) {
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type, severity, message, email, metadata }),
  }).catch(() => {})
}

export default function Login() {
  const router = useRouter()
  const isMobile = useMobile()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login'|'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Debounce ref for form_typing events
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleEmailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setEmail(val)
    // Debounce: log typing activity 800ms after the user stops
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      if (val.length > 0) {
        log('form_typing', 'info', `Email field activity on ${mode} form`, val, { mode, partial_email: val })
      }
    }, 800)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')

    if (mode === 'signup') {
      log('signup_attempt', 'info', `Signup attempted`, email, { email })
      // Use our own /api/signup endpoint which bypasses Supabase's email rate limit
      // by creating the user via admin API and sending confirmation via Resend
      const signupRes = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const signupData = await signupRes.json()
      if (!signupRes.ok || signupData.error) {
        const msg = signupData.error || 'Signup failed. Please try again.'
        setError(msg)
        log('signup_failure', 'warn', `Signup failed: ${msg}`, email, { email, error: msg })
      } else if (signupData.autoConfirmed) {
        setSuccess('Account created! You can now sign in.')
        log('signup_success', 'info', `New signup (auto-confirmed): ${email}`, email, { email })
      } else {
        setSuccess('Account created! Check your email to confirm your address, then sign in.')
        log('signup_success', 'info', `New signup: ${email}`, email, { email })
      }
    } else {
      log('login_attempt', 'info', `Login attempted`, email, { email })
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) {
        setError(loginError.message)
        log('login_failure', 'warn', `Login failed: ${loginError.message}`, email, { email, error: loginError.message })
      } else {
        log('login_success', 'info', `Login successful`, email, { email })
        router.push('/home')
      }
    }
    setLoading(false)
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
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.field}>
            <label style={s.label}>Email</label>
            <input type="email" value={email} onChange={handleEmailChange} placeholder="you@example.com" required style={s.input} />
          </div>
          <div style={s.field}>
            <label style={s.label}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required style={s.input} />
          </div>
          {error && <div style={s.err}>{error}</div>}
          {success && <div style={s.ok}>{success}</div>}
          <button type="submit" disabled={loading} style={s.btn}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div style={s.toggle}>
          {mode === 'login' ? <>No account? <button onClick={()=>setMode('signup')} style={s.link}>Sign up</button></> : <>Have an account? <button onClick={()=>setMode('login')} style={s.link}>Sign in</button></>}
        </div>
      </div>
    </div>
  )
}

const s: Record<string,React.CSSProperties> = {
  page: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0a0a', padding: 16 },
  card: { background:'#111', border:'1px solid rgba(255,255,255,0.08)', borderRadius:16, padding:40, width:'100%', maxWidth:400 },
  brand: { display:'flex', alignItems:'center', gap:14, marginBottom:32 },
  brandIcon: { width:44, height:44, background:'#7c6ef7', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, color:'white', flexShrink:0 },
  brandName: { fontSize:17, fontWeight:600, color:'#f0f0f0' },
  brandSub: { fontSize:12, color:'#555', marginTop:2 },
  form: { display:'flex', flexDirection:'column', gap:16 },
  field: { display:'flex', flexDirection:'column', gap:6 },
  label: { fontSize:12, color:'#888' },
  input: { padding:'10px 12px', background:'#1a1a1a', border:'1px solid rgba(255,255,255,0.08)', borderRadius:8, color:'#f0f0f0', fontSize:14, outline:'none' },
  err: { background:'rgba(163,45,45,0.15)', border:'1px solid rgba(163,45,45,0.3)', borderRadius:8, padding:'10px 12px', fontSize:13, color:'#f09595' },
  ok: { background:'rgba(29,158,117,0.15)', border:'1px solid rgba(29,158,117,0.3)', borderRadius:8, padding:'10px 12px', fontSize:13, color:'#5DCAA5' },
  btn: { padding:11, background:'#7c6ef7', border:'none', borderRadius:8, color:'white', fontSize:14, fontWeight:500, cursor:'pointer', marginTop:4 },
  toggle: { marginTop:24, textAlign:'center', fontSize:13, color:'#555' },
  link: { background:'none', border:'none', color:'#7c6ef7', cursor:'pointer', fontSize:13, padding:0 },
}
