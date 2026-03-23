export type SectionType = 'icon' | 'title' | 'subtitle' | 'box' | 'text'

export interface WelcomeSection {
  id: string
  type: SectionType
  content: string
  visible: boolean
}

export interface WelcomeConfig {
  sections: WelcomeSection[]
}

export const DEFAULT_WELCOME_CONFIG: WelcomeConfig = {
  sections: [
    { id: 'icon',     type: 'icon',     content: '✨',                                                                          visible: true },
    { id: 'title',    type: 'title',    content: 'Start building',                                                               visible: true },
    { id: 'subtitle', type: 'subtitle', content: 'Use the AI chat on the left to build anything you want.',                      visible: true },
    { id: 'try_box',  type: 'box',      content: 'Try: "Build an admin dashboard with a sidebar, stats and users table"',        visible: true },
  ],
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function generateWelcomeHtml(config: WelcomeConfig): string {
  const inner = config.sections
    .filter(s => s.visible)
    .map(s => {
      switch (s.type) {
        case 'icon':
          return `<div class="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center mx-auto mb-6 text-3xl">${escHtml(s.content)}</div>`
        case 'title':
          return `<h1 class="text-white text-2xl font-semibold mb-3">${escHtml(s.content)}</h1>`
        case 'subtitle':
          return `<p class="text-white/50 text-sm leading-relaxed mb-8">${escHtml(s.content)}</p>`
        case 'box':
          return `<div class="bg-brand/10 border border-brand/20 rounded-xl p-4 text-brand text-sm mb-4">${escHtml(s.content)}</div>`
        case 'text':
          return `<p class="text-white/70 text-sm leading-relaxed mb-4">${escHtml(s.content)}</p>`
        default:
          return ''
      }
    })
    .join('\n        ')

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"><\/script><script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7'}}}}}<\/script></head><body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center p-10"><div class="text-center max-w-lg">
        ${inner}
      </div></body></html>`
}
