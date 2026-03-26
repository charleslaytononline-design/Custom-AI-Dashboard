/**
 * Generates an HTML document (srcdoc) from bundled JS/CSS output
 * for rendering in an iframe preview.
 */

export interface PreviewOptions {
  /** Bundled JavaScript from browserBundler */
  js: string
  /** Collected CSS from project files */
  css: string
  /** CDN URL map for the import map (bare specifier → CDN URL) */
  cdnMap?: Record<string, string>
  /** Project name for the title */
  projectName?: string
  /** Brand color for Tailwind config */
  brandColor?: string
}

/**
 * Build an import map JSON string from a CDN map.
 * Each exact bare specifier gets mapped to its CDN URL.
 */
function buildImportMap(cdnMap: Record<string, string>): string {
  const imports: Record<string, string> = {}
  const keys = Object.keys(cdnMap)
  for (let i = 0; i < keys.length; i++) {
    imports[keys[i]] = cdnMap[keys[i]]
  }
  return JSON.stringify({ imports }, null, 2)
}

/**
 * Generate the full HTML document to be used as iframe srcdoc.
 * Includes:
 * - Import map for resolving bare specifiers to CDN URLs
 * - Tailwind CSS via CDN play script (matches how projects actually use Tailwind)
 * - Custom CSS from project files
 * - Bundled React app as ESM module
 * - Error boundary to catch runtime errors and post to parent
 * - Console override to forward logs to parent
 * - Loading spinner and 10-second timeout
 */
export function generatePreviewHtml(options: PreviewOptions): string {
  const { js, css, cdnMap = {}, projectName = 'Preview', brandColor = '#7c6ef7' } = options

  // Escape the JS for embedding in a template literal
  const encodedJs = js
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')

  const importMapJson = buildImportMap(cdnMap)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName}</title>

  <!-- Import map: resolves bare specifiers to CDN URLs -->
  <script type="importmap">
  ${importMapJson}
  </script>

  <!-- Tailwind CSS CDN Play Script -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
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
    }
  </script>

  <!-- Custom CSS from project files -->
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 0;
    }
    ${css}
    /* Loading spinner */
    @keyframes preview-spin { to { transform: rotate(360deg); } }
    .preview-loader {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 12px;
      color: #888;
      font-size: 13px;
    }
    .preview-loader-ring {
      width: 28px;
      height: 28px;
      border: 3px solid #e5e7eb;
      border-top-color: ${brandColor};
      border-radius: 50%;
      animation: preview-spin 0.8s linear infinite;
    }
  </style>
</head>
<body>
  <div id="root">
    <div class="preview-loader">
      <div class="preview-loader-ring"></div>
      <span>Loading preview...</span>
    </div>
  </div>

  <!-- Override navigator.locks for sandboxed iframes (Supabase auth uses it but it throws SecurityError) -->
  <script>
    navigator.locks = { request: async function(_n, _o, cb) { return await (cb || _o)(); } };
  </script>

  <!-- Error & console forwarding to parent -->
  <script>
    // Forward console messages to parent
    const origConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };

    function postToParent(level, args) {
      try {
        const message = args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a, null, 2); } catch { return String(a); }
        }).join(' ');
        window.parent.postMessage({
          type: 'preview-console',
          level: level,
          message: message,
          timestamp: Date.now(),
        }, '*');
      } catch {}
    }

    console.log = function(...args) { origConsole.log.apply(console, args); postToParent('log', args); };
    console.warn = function(...args) { origConsole.warn.apply(console, args); postToParent('warn', args); };
    console.error = function(...args) { origConsole.error.apply(console, args); postToParent('error', args); };
    console.info = function(...args) { origConsole.info.apply(console, args); postToParent('info', args); };

    // Catch runtime errors
    window.onerror = function(message, source, line, col, error) {
      window.parent.postMessage({
        type: 'preview-error',
        message: String(message),
        source: source || '',
        line: line || 0,
        col: col || 0,
        stack: error?.stack || '',
        timestamp: Date.now(),
      }, '*');
    };

    // Catch unhandled promise rejections
    window.onunhandledrejection = function(event) {
      const reason = event.reason;
      window.parent.postMessage({
        type: 'preview-error',
        message: reason?.message || String(reason),
        source: '',
        line: 0,
        col: 0,
        stack: reason?.stack || '',
        timestamp: Date.now(),
      }, '*');
    };

    // Notify parent when preview is ready
    window.addEventListener('DOMContentLoaded', function() {
      window.parent.postMessage({ type: 'preview-ready', timestamp: Date.now() }, '*');
    });
  </script>

  <!-- Bundled React app -->
  <script type="module">
    console.log('[Preview] Loading module...');
    const loadStart = Date.now();
    let loaded = false;

    // Timeout: if module doesn't load in 15s, show error
    const timeoutId = setTimeout(() => {
      if (loaded) return;
      const elapsed = ((Date.now() - loadStart) / 1000).toFixed(1);
      const msg = 'Preview timed out after ' + elapsed + 's — CDN modules may be unreachable.';
      console.error('[Preview] ' + msg);
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div style="padding:32px;font-family:monospace;"><div style="background:#1a0000;border:1px solid #ff4444;border-radius:8px;padding:16px;"><div style="color:#ff6666;font-size:14px;font-weight:600;margin-bottom:8px;">Module Load Timeout</div><pre style="color:#ff9999;font-size:12px;white-space:pre-wrap;margin:0;">' + msg + '</pre></div></div>';
      }
      window.parent.postMessage({ type: 'preview-error', message: msg, source: 'timeout', line: 0, col: 0, stack: '', timestamp: Date.now() }, '*');
    }, 15000);

    try {
      const code = \`${encodedJs}\`;
      if (!code.trim()) {
        throw new Error('Bundled output is empty — esbuild may have failed silently.');
      }
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await import(url);
      URL.revokeObjectURL(url);
      loaded = true;
      clearTimeout(timeoutId);
      console.log('[Preview] Module loaded in ' + ((Date.now() - loadStart) / 1000).toFixed(1) + 's');
    } catch (err) {
      loaded = true;
      clearTimeout(timeoutId);
      console.error('[Preview] Module load error:', err);
      // Show error in the preview
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = \`
          <div style="padding: 32px; font-family: monospace;">
            <div style="background: #1a0000; border: 1px solid #ff4444; border-radius: 8px; padding: 16px;">
              <div style="color: #ff6666; font-size: 14px; font-weight: 600; margin-bottom: 8px;">Runtime Error</div>
              <pre style="color: #ff9999; font-size: 12px; white-space: pre-wrap; margin: 0;">\${err.message || err}</pre>
              \${err.stack ? \`<pre style="color: #664444; font-size: 11px; white-space: pre-wrap; margin-top: 8px;">\${err.stack}</pre>\` : ''}
            </div>
          </div>
        \`;
      }
      // Also forward to parent
      window.parent.postMessage({
        type: 'preview-error',
        message: err.message || String(err),
        source: 'module-load',
        line: 0,
        col: 0,
        stack: err.stack || '',
        timestamp: Date.now(),
      }, '*');
    }
  </script>
</body>
</html>`
}

/**
 * Generate an error-only preview HTML when bundling fails.
 */
export function generateErrorHtml(errors: string[]): string {
  const errorList = errors.map(e =>
    `<div style="background: #1a0000; border: 1px solid #ff4444; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
      <pre style="color: #ff9999; font-size: 12px; white-space: pre-wrap; margin: 0;">${e.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </div>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Build Error</title>
</head>
<body style="background: #0a0a0a; color: #f0f0f0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, monospace; margin: 0;">
  <div style="max-width: 720px;">
    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
      <span style="color: #ff4444; font-size: 18px;">⚠</span>
      <span style="color: #ff6666; font-size: 14px; font-weight: 600;">Build Failed — ${errors.length} error${errors.length !== 1 ? 's' : ''}</span>
    </div>
    ${errorList}
    <p style="color: #555; font-size: 12px; margin-top: 16px;">Fix the errors above and save to rebuild the preview.</p>
  </div>
  <script>
    window.parent.postMessage({
      type: 'preview-build-error',
      errors: ${JSON.stringify(errors)},
      timestamp: Date.now(),
    }, '*');
  </script>
</body>
</html>`
}
