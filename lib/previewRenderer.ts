/**
 * Generates an HTML document (srcdoc) from bundled JS/CSS output
 * for rendering in an iframe preview.
 */

export interface PreviewOptions {
  /** Bundled JavaScript from browserBundler */
  js: string
  /** Collected CSS from project files */
  css: string
  /** Project name for the title */
  projectName?: string
  /** Brand color for Tailwind config */
  brandColor?: string
}

/**
 * Generate the full HTML document to be used as iframe srcdoc.
 * Includes:
 * - Tailwind CSS via CDN play script (matches how projects actually use Tailwind)
 * - Custom CSS from project files
 * - Bundled React app as ESM module
 * - Error boundary to catch runtime errors and post to parent
 * - Console override to forward logs to parent
 */
export function generatePreviewHtml(options: PreviewOptions): string {
  const { js, css, projectName = 'Preview', brandColor = '#7c6ef7' } = options

  // Escape the JS for embedding in a script tag
  // We use a blob URL approach to avoid issues with </script> in the code
  const encodedJs = js
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName}</title>

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
  </style>
</head>
<body class="bg-gray-950 text-white min-h-screen">
  <div id="root"></div>

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
    try {
      const code = \`${encodedJs}\`;
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await import(url);
      URL.revokeObjectURL(url);
    } catch (err) {
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
