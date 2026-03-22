import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login'|'signup'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(''); setSuccess('')
    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setSuccess('Account created! Check your email to confirm, then sign in.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
      else router.push('/home')
    }
    setLoading(false)
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
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
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required style={s.input} />
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
  page: { minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0a0a0a',padding:24 },
  card: { background:'#111',border:'1px solid rgba(255,255,255,0.08)',borderRadius:16,padding:40,width:'100%',maxWidth:400 },
  brand: { display:'flex',alignItems:'center',gap:14,marginBottom:32 },
  brandIcon: { width:44,height:44,background:'#7c6ef7',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:'white',flexShrink:0 },
  brandName: { fontSize:17,fontWeight:600,color:'#f0f0f0' },
  brandSub: { fontSize:12,color:'#555',marginTop:2 },
  form: { display:'flex',flexDirection:'column',gap:16 },
  field: { display:'flex',flexDirection:'column',gap:6 },
  label: { fontSize:12,color:'#888' },
  input: { padding:'10px 12px',background:'#1a1a1a',border:'1px solid rgba(255,255,255,0.08)',borderRadius:8,color:'#f0f0f0',fontSize:14,outline:'none' },
  err: { background:'rgba(163,45,45,0.15)',border:'1px solid rgba(163,45,45,0.3)',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#f09595' },
  ok: { background:'rgba(29,158,117,0.15)',border:'1px solid rgba(29,158,117,0.3)',borderRadius:8,padding:'10px 12px',fontSize:13,color:'#5DCAA5' },
  btn: { padding:11,background:'#7c6ef7',border:'none',borderRadius:8,color:'white',fontSize:14,fontWeight:500,cursor:'pointer',marginTop:4 },
  toggle: { marginTop:24,textAlign:'center',fontSize:13,color:'#555' },
  link: { background:'none',border:'none',color:'#7c6ef7',cursor:'pointer',fontSize:13,padding:0 },
}
