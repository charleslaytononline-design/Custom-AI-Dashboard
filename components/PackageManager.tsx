/**
 * PackageManager — UI to add/remove npm packages for a project.
 * Packages are resolved from esm.sh CDN in the browser bundler.
 */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Package {
  id: string
  name: string
  version: string
}

interface PackageManagerProps {
  projectId: string
  onPackagesChange?: (packages: Record<string, string>) => void
}

/** Common packages users might want */
const POPULAR_PACKAGES = [
  { name: 'recharts', version: '^2.13.0', desc: 'Charts & graphs' },
  { name: 'framer-motion', version: '^11.0.0', desc: 'Animations' },
  { name: 'date-fns', version: '^3.6.0', desc: 'Date utilities' },
  { name: 'zustand', version: '^4.5.0', desc: 'State management' },
  { name: 'react-hot-toast', version: '^2.4.0', desc: 'Toast notifications' },
  { name: '@tanstack/react-query', version: '^5.0.0', desc: 'Data fetching' },
]

export default function PackageManager({ projectId, onPackagesChange }: PackageManagerProps) {
  const [packages, setPackages] = useState<Package[]>([])
  const [newPkg, setNewPkg] = useState('')
  const [newVersion, setNewVersion] = useState('latest')
  const [adding, setAdding] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    loadPackages()
  }, [projectId])

  async function loadPackages() {
    const { data } = await supabase
      .from('project_packages')
      .select('*')
      .eq('project_id', projectId)
      .order('name')
    if (data) {
      setPackages(data)
      emitChange(data)
    }
  }

  function emitChange(pkgs: Package[]) {
    if (onPackagesChange) {
      const map: Record<string, string> = {}
      for (const p of pkgs) map[p.name] = p.version
      onPackagesChange(map)
    }
  }

  async function addPackage(name: string, version: string = 'latest') {
    if (!name.trim()) return
    setAdding(true)
    try {
      const { error } = await supabase
        .from('project_packages')
        .upsert({
          project_id: projectId,
          name: name.trim(),
          version: version.trim() || 'latest',
        }, { onConflict: 'project_id,name' })
      if (!error) {
        setNewPkg('')
        setNewVersion('latest')
        setShowAdd(false)
        await loadPackages()
      }
    } finally {
      setAdding(false)
    }
  }

  async function removePackage(id: string) {
    await supabase.from('project_packages').delete().eq('id', id)
    await loadPackages()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] text-[var(--text-3)] font-semibold uppercase tracking-wider">Packages</span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-[10px] text-brand bg-transparent border-none cursor-pointer hover:underline"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          <input
            value={newPkg}
            onChange={e => setNewPkg(e.target.value)}
            placeholder="package-name"
            className="px-2 py-1.5 bg-[var(--bg)] border border-white/10 rounded text-xs text-white outline-none focus:border-brand/50"
            onKeyDown={e => e.key === 'Enter' && addPackage(newPkg, newVersion)}
          />
          <div className="flex gap-1">
            <input
              value={newVersion}
              onChange={e => setNewVersion(e.target.value)}
              placeholder="version"
              className="flex-1 px-2 py-1 bg-[var(--bg)] border border-white/10 rounded text-[10px] text-[var(--text-2)] outline-none"
            />
            <button
              onClick={() => addPackage(newPkg, newVersion)}
              disabled={adding || !newPkg.trim()}
              className="px-2.5 py-1 bg-brand border-none rounded text-white text-[10px] cursor-pointer disabled:opacity-40"
            >
              {adding ? '...' : 'Add'}
            </button>
          </div>

          {/* Quick add popular packages */}
          <div className="flex flex-wrap gap-1 mt-1">
            {POPULAR_PACKAGES
              .filter(p => !packages.some(pkg => pkg.name === p.name))
              .slice(0, 4)
              .map(p => (
                <button
                  key={p.name}
                  onClick={() => addPackage(p.name, p.version)}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-[var(--border)] text-[var(--text-2)] cursor-pointer hover:text-white hover:bg-white/10"
                  title={p.desc}
                >
                  + {p.name}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Installed packages */}
      <div className="px-3 space-y-0.5">
        {packages.length === 0 ? (
          <div className="text-[10px] text-[var(--text-3)] py-1">No extra packages installed</div>
        ) : (
          packages.map(pkg => (
            <div key={pkg.id} className="flex items-center justify-between group py-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] text-[var(--text-2)] truncate">{pkg.name}</span>
                <span className="text-[9px] text-[var(--text-3)]">{pkg.version}</span>
              </div>
              <button
                onClick={() => removePackage(pkg.id)}
                className="text-[10px] text-[var(--text-3)] hover:text-red-400 bg-transparent border-none cursor-pointer opacity-0 group-hover:opacity-100"
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
