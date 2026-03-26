/**
 * React + Vite + Tailwind project template.
 * Returns all boilerplate files needed to scaffold a new React project.
 */

export interface TemplateFile {
  path: string
  content: string
  file_type: string
}

export function generateReactTemplate(options: {
  projectName: string
  supabaseUrl?: string
  supabaseAnonKey?: string
  brandColor?: string
}): TemplateFile[] {
  const { projectName, supabaseUrl = '', supabaseAnonKey = '', brandColor = '#7c6ef7' } = options
  const slug = projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: slug,
        private: true,
        version: '0.0.1',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          'react-router-dom': '^6.28.0',
          '@supabase/supabase-js': '^2.47.0',
          'lucide-react': '^0.460.0',
        },
        devDependencies: {
          '@types/react': '^18.3.12',
          '@types/react-dom': '^18.3.1',
          '@vitejs/plugin-react': '^4.3.4',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.49',
          tailwindcss: '^3.4.15',
          typescript: '~5.6.2',
          vite: '^6.0.0',
        },
      }, null, 2),
      file_type: 'json',
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
`,
      file_type: 'ts',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          isolatedModules: true,
          moduleDetection: 'force',
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
          noUnusedLocals: false,
          noUnusedParameters: false,
          noFallthroughCasesInSwitch: true,
          paths: { '@/*': ['./src/*'] },
        },
        include: ['src'],
      }, null, 2),
      file_type: 'json',
    },
    {
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '${brandColor}',
          light: '${brandColor}33',
        },
      },
    },
  },
  plugins: [],
}
`,
      file_type: 'js',
    },
    {
      path: 'postcss.config.js',
      content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`,
      file_type: 'js',
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body class="bg-gray-950 text-white min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      file_type: 'html',
    },
    {
      path: 'src/main.tsx',
      content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
`,
      file_type: 'ts',
    },
    {
      path: 'src/App.tsx',
      content: `import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
      </Route>
    </Routes>
  )
}
`,
      file_type: 'ts',
    },
    {
      path: 'src/index.css',
      content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
`,
      file_type: 'css',
    },
    {
      path: 'src/lib/supabase.ts',
      content: `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  { auth: { flowType: 'implicit', persistSession: false } }
)
`,
      file_type: 'ts',
    },
    {
      path: 'src/lib/utils.ts',
      content: `/** Merge Tailwind classes conditionally */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
`,
      file_type: 'ts',
    },
    {
      path: 'src/components/Layout.tsx',
      content: `import { Outlet, Link, useLocation } from 'react-router-dom'
import { Home } from 'lucide-react'

const navItems = [
  { path: '/', label: 'Home', icon: Home },
]

export default function Layout() {
  const location = useLocation()

  return (
    <div className="flex min-h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-56 border-r border-white/5 bg-gray-950 flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h1 className="text-sm font-semibold text-white/90 truncate">${projectName}</h1>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={\`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors \${
                  active
                    ? 'bg-brand/10 text-brand'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/5'
                }\`}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
`,
      file_type: 'ts',
    },
    {
      path: 'src/pages/Home.tsx',
      content: `export default function Home() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white mb-2">${projectName}</h1>
      <p className="text-white/50 text-sm">
        Welcome to your new app. Start building by describing what you want in the chat.
      </p>
    </div>
  )
}
`,
      file_type: 'ts',
    },
    {
      path: '.env',
      content: `VITE_SUPABASE_URL=${supabaseUrl}
VITE_SUPABASE_ANON_KEY=${supabaseAnonKey}
`,
      file_type: 'text',
    },
    {
      path: '.gitignore',
      content: `node_modules
dist
.env
.env.local
`,
      file_type: 'text',
    },
  ]
}
