import { useRef, useCallback } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'

interface CodeEditorProps {
  code: string
  onChange: (code: string) => void
  onSave: (code: string) => void
  pageName: string
}

export default function CodeEditor({ code, onChange, onSave, pageName }: CodeEditorProps) {
  const editorRef = useRef<any>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monaco.editor.defineTheme('dashboardDark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0a0a0a',
        'editor.foreground': '#e0e0e0',
        'editorLineNumber.foreground': '#444',
        'editorLineNumber.activeForeground': '#888',
        'editor.selectionBackground': '#7c6ef740',
        'editor.lineHighlightBackground': '#ffffff08',
        'editorCursor.foreground': '#7c6ef7',
        'editorWidget.background': '#141414',
        'editorWidget.border': '#ffffff10',
        'input.background': '#1a1a1a',
        'input.border': '#ffffff14',
        'dropdown.background': '#141414',
        'list.hoverBackground': '#ffffff0a',
        'list.activeSelectionBackground': '#7c6ef720',
      },
    })
    monaco.editor.setTheme('dashboardDark')

    // Cmd/Ctrl+S to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const val = editor.getValue()
      onSave(val)
    })
  }

  const handleChange = useCallback((value: string | undefined) => {
    const val = value || ''
    onChange(val)
    // Debounced live preview update
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      onChange(val)
    }, 500)
  }, [onChange])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: '#0f0f0f', flexShrink: 0,
      }}>
        <span style={{ color: '#666', fontSize: 12, fontFamily: 'monospace' }}>
          {pageName}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => {
              const val = editorRef.current?.getValue() || code
              navigator.clipboard.writeText(val)
            }}
            style={{
              padding: '3px 10px', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: '#666', fontSize: 11, cursor: 'pointer',
            }}
          >
            Copy
          </button>
          <button
            onClick={() => {
              const val = editorRef.current?.getValue() || code
              onSave(val)
            }}
            style={{
              padding: '3px 10px', background: '#7c6ef7', border: 'none',
              borderRadius: 6, color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 500,
            }}
          >
            Save
          </button>
        </div>
      </div>
      <Editor
        height="100%"
        defaultLanguage="html"
        value={code}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: 12.5,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          formatOnPaste: true,
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          padding: { top: 8 },
          renderLineHighlight: 'line',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        }}
        loading={
          <div style={{ background: '#0a0a0a', color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 13 }}>
            Loading editor...
          </div>
        }
      />
    </div>
  )
}
