/**
 * Composes a project layout + page content into a complete renderable HTML document.
 * Supports both legacy (full HTML pages) and new (content-only pages with shared layout).
 */

interface PageRef {
  id: string
  name: string
}

const SHARED_HEAD = `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config={theme:{extend:{colors:{brand:{DEFAULT:'#7c6ef7',dark:'#5b50d6'}}}}}</script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
`

function buildPlatformScript(projectId?: string, sharedCode?: string | null): string {
  return `
<script>
  const PROJECT_ID = '${projectId || ''}';
  async function dbQuery(table, action, data) {
    const r = await fetch('/api/db', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({projectId: PROJECT_ID, table, action, data})});
    return r.json();
  }
  async function serverRun(functionName, params) {
    const r = await fetch('/api/run', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({projectId: PROJECT_ID, functionName, params})});
    return r.json();
  }
  async function sendEmail(to, subject, html) {
    const r = await fetch('/api/send-email', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({projectId: PROJECT_ID, to, subject, html})});
    return r.json();
  }
  ${sharedCode || ''}
</script>`
}

const NAV_SCRIPT = `
<script>
  // Page navigation handler — communicates with parent builder or handles standalone
  document.addEventListener('click', function(e) {
    const pageLink = e.target.closest('[data-page]');
    if (!pageLink) return;
    e.preventDefault();
    const pageName = pageLink.getAttribute('data-page');
    // Highlight active nav item
    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.remove('bg-white/10', 'text-white');
      el.classList.add('text-gray-400');
    });
    pageLink.classList.add('bg-white/10', 'text-white');
    pageLink.classList.remove('text-gray-400');
    // Tell parent to navigate (builder mode)
    if (window.parent !== window) {
      window.parent.postMessage({type:'navigate', page: pageName}, '*');
    }
  });
</script>
`

/**
 * Checks if content is a full HTML document or just content fragment.
 */
function isFullHtmlDoc(code: string): boolean {
  return /<!DOCTYPE\s+html|<html[\s>]/i.test(code.trim().slice(0, 100))
}

/**
 * Extracts the body content from a full HTML document.
 * Returns everything between <body> tags, stripping common wrappers.
 */
function extractBodyContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
  if (bodyMatch) return bodyMatch[1].trim()
  // Fallback: strip head/html tags
  return html
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .trim()
}

/**
 * Composes layout + page content into a full HTML document.
 *
 * @param layout - The shared layout HTML (sidebar, topbar). null for legacy projects.
 * @param pageCode - The page code (either full HTML doc or content-only).
 * @param pages - All pages in the project (for nav highlighting).
 * @param activePage - The currently active page name (for nav highlighting).
 * @param projectId - The project ID (for database queries in generated code).
 */
export function composePage(
  layout: string | null,
  pageCode: string,
  pages: PageRef[],
  activePage: string,
  projectId?: string,
  sharedCode?: string | null,
): string {
  // No layout = legacy mode — return page as-is
  if (!layout) return pageCode

  // Extract content if page is a full HTML document
  const content = isFullHtmlDoc(pageCode) ? extractBodyContent(pageCode) : pageCode

  // Build the active page marker script
  const activeScript = `
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const active = document.querySelector('[data-page="${activePage}"]');
    if (active) {
      active.classList.add('bg-white/10', 'text-white');
      active.classList.remove('text-gray-400');
    }
  });
</script>`

  const platformScript = buildPlatformScript(projectId, sharedCode)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${activePage}</title>
  ${SHARED_HEAD}
</head>
<body class="bg-[#0a0a0a] text-gray-100">
  ${layout}
  ${platformScript}
  <main id="page-content" class="ml-56 mt-14 min-h-screen">
    ${content}
  </main>
  ${NAV_SCRIPT}
  ${activeScript}
</body>
</html>`
}

/**
 * For the standalone preview: generates a full navigable app that can
 * switch pages client-side by fetching content from the preview API.
 */
export function composePreviewApp(
  layout: string | null,
  pageCode: string,
  pages: PageRef[],
  activePage: string,
  activePageId: string,
  sharedCode?: string | null,
): string {
  if (!layout) return pageCode

  const content = isFullHtmlDoc(pageCode) ? extractBodyContent(pageCode) : pageCode

  // Build page map for client-side navigation in standalone preview
  const pageMap = JSON.stringify(pages.map(p => ({ id: p.id, name: p.name })))

  const standaloneNavScript = `
<script>
  const PAGE_MAP = ${pageMap};
  let currentPageId = '${activePageId}';

  document.addEventListener('click', function(e) {
    const pageLink = e.target.closest('[data-page]');
    if (!pageLink) return;
    e.preventDefault();
    const pageName = pageLink.getAttribute('data-page');
    const target = PAGE_MAP.find(p => p.name === pageName);
    if (!target || target.id === currentPageId) return;

    // Highlight active nav
    document.querySelectorAll('[data-page]').forEach(el => {
      el.classList.remove('bg-white/10', 'text-white');
      el.classList.add('text-gray-400');
    });
    pageLink.classList.add('bg-white/10', 'text-white');
    pageLink.classList.remove('text-gray-400');

    // Fetch and replace content
    fetch('/api/preview/' + target.id + '?content_only=true')
      .then(r => r.text())
      .then(html => {
        document.getElementById('page-content').innerHTML = html;
        currentPageId = target.id;
        window.location.hash = pageName.toLowerCase().replace(/\\s+/g, '-');
        // Re-run any inline scripts in the new content
        document.getElementById('page-content').querySelectorAll('script').forEach(s => {
          const ns = document.createElement('script');
          ns.textContent = s.textContent;
          s.parentNode.replaceChild(ns, s);
        });
      })
      .catch(err => console.error('Navigation failed:', err));
  });

  // Highlight active nav on load
  document.addEventListener('DOMContentLoaded', function() {
    const active = document.querySelector('[data-page="${activePage}"]');
    if (active) {
      active.classList.add('bg-white/10', 'text-white');
      active.classList.remove('text-gray-400');
    }
  });
</script>`

  const platformScript = buildPlatformScript(undefined, sharedCode)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${activePage}</title>
  ${SHARED_HEAD}
</head>
<body class="bg-[#0a0a0a] text-gray-100">
  ${layout}
  ${platformScript}
  <main id="page-content" class="ml-56 mt-14 min-h-screen">
    ${content}
  </main>
  ${standaloneNavScript}
</body>
</html>`
}
