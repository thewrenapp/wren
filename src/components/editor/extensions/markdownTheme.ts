import { EditorView } from '@codemirror/view';

/**
 * CM6 theme for the Bear-like rendered markdown editor.
 * Uses proportional sans-serif for body text, monospace only for code.
 * All colors derive from the app's CSS variables (purple-indigo theme)
 * for automatic light/dark mode support.
 */
export const markdownRenderTheme = EditorView.theme({
  // =====================================================
  // Writing surface
  // =====================================================
  '&': {
    height: '100%',
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
    fontSize: '16px',
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
  },
  '.cm-content': {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    lineHeight: '1.65',
    padding: '24px clamp(16px, 10%, 280px)',
    caretColor: 'hsl(var(--foreground))',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'hsl(var(--foreground))',
    borderLeftWidth: '1.5px',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'auto',
    overflowX: 'hidden',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'hsl(var(--primary) / 0.15)',
  },

  // =====================================================
  // Headings — purple-tinted with hierarchy
  // =====================================================
  '.cm-md-heading1': {
    fontSize: '1.875em',
    fontWeight: '700',
    lineHeight: '1.2',
    letterSpacing: '-0.02em',
    paddingTop: '0.8em',
    paddingBottom: '0.3em',
    display: 'inline',
    color: 'hsl(var(--primary))',
  },
  '.cm-md-heading2': {
    fontSize: '1.5em',
    fontWeight: '700',
    lineHeight: '1.25',
    letterSpacing: '-0.015em',
    paddingTop: '0.7em',
    paddingBottom: '0.25em',
    display: 'inline',
    color: 'hsl(var(--primary) / 0.85)',
  },
  '.cm-md-heading3': {
    fontSize: '1.25em',
    fontWeight: '600',
    lineHeight: '1.3',
    letterSpacing: '-0.01em',
    paddingTop: '0.6em',
    paddingBottom: '0.2em',
    display: 'inline',
    color: 'hsl(var(--primary) / 0.7)',
  },
  '.cm-md-heading4': {
    fontSize: '1.1em',
    fontWeight: '600',
    lineHeight: '1.35',
    paddingTop: '0.5em',
    paddingBottom: '0.15em',
    display: 'inline',
    color: 'hsl(var(--primary) / 0.6)',
  },

  // =====================================================
  // Inline formatting
  // =====================================================
  '.cm-md-bold': {
    fontWeight: '700',
  },
  '.cm-md-italic': {
    fontStyle: 'italic',
  },
  '.cm-md-strikethrough': {
    textDecoration: 'line-through',
    color: 'hsl(var(--muted-foreground))',
  },

  // Inline code — purple-tinted pill
  '.cm-md-inline-code': {
    fontFamily: "'SF Mono', Monaco, Inconsolata, 'Fira Mono', 'Fira Code', monospace",
    fontSize: '0.85em',
    backgroundColor: 'hsl(var(--primary) / 0.08)',
    borderRadius: '4px',
    padding: '2px 6px',
    border: '1px solid hsl(var(--primary) / 0.15)',
    color: 'hsl(var(--primary) / 0.8)',
  },

  // Links — primary color, subtle underline
  '.cm-md-link': {
    color: 'hsl(var(--primary))',
    textDecoration: 'underline',
    textDecorationColor: 'hsl(var(--primary) / 0.4)',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },

  // =====================================================
  // Blockquotes — primary accent border, subtle bg
  // =====================================================
  '.cm-md-blockquote': {
    borderLeft: '4px solid hsl(var(--primary) / 0.5)',
    paddingLeft: '16px',
    color: 'hsl(var(--muted-foreground))',
    fontStyle: 'italic',
    backgroundColor: 'hsl(var(--primary) / 0.07)',
  },

  // =====================================================
  // Code blocks — Shiki widget with line numbers
  // =====================================================
  // Rendered as a single replace widget via StateField.
  // Shiki generates HTML with dual-theme CSS variables.

  '.cm-md-codeblock-widget': {
    position: 'relative',
    margin: '4px 0',
    borderRadius: '6px',
    border: '1px solid hsl(var(--border))',
    overflow: 'hidden',
    fontFamily: "'SF Mono', Monaco, Inconsolata, 'Fira Mono', 'Fira Code', monospace",
    fontSize: '13px',
    lineHeight: '1.6',
  },
  // Shiki output container
  '.cm-md-codeblock-shiki pre': {
    margin: '0',
    padding: '8px 12px',
    overflowX: 'auto',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    borderRadius: '6px',
  },
  '.cm-md-codeblock-shiki code': {
    fontFamily: 'inherit',
    background: 'transparent',
    padding: '0',
  },
  // .line spans are inline — newlines in <pre> handle line breaks naturally
  // Fallback (plain text, no Shiki)
  '.cm-md-codeblock-fallback': {
    margin: '0',
    padding: '8px 12px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    whiteSpace: 'pre',
    overflowX: 'auto',
    backgroundColor: 'hsl(var(--muted) / 0.5)',
  },
  // Line number gutter (only when .cm-md-codeblock-numbered)
  '.cm-md-codeblock-numbered .cm-md-codeblock-shiki pre': {
    paddingLeft: '44px',
  },
  '.cm-md-codeblock-numbered .cm-md-codeblock-fallback': {
    paddingLeft: '44px',
  },
  '.cm-md-codeblock-gutter': {
    position: 'absolute',
    left: '0',
    top: '8px',
    width: '32px',
    textAlign: 'right',
    paddingRight: '8px',
    color: 'hsl(var(--muted-foreground) / 0.35)',
    fontSize: '11px',
    lineHeight: '1.6',
    userSelect: 'none',
    pointerEvents: 'none',
    fontFamily: 'inherit',
  },
  // Language label (top-right, hides on hover)
  '.cm-md-codeblock-lang': {
    position: 'absolute',
    top: '6px',
    right: '8px',
    fontSize: '10px',
    fontWeight: '500',
    color: 'hsl(var(--muted-foreground) / 0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    lineHeight: '1',
    pointerEvents: 'none',
    transition: 'opacity 0.15s',
  },
  '.cm-md-codeblock-widget:hover .cm-md-codeblock-lang': {
    opacity: '0',
  },
  // Copy button (top-right icon, shows on hover)
  '.cm-md-codeblock-copy': {
    cursor: 'pointer',
    position: 'absolute',
    top: '4px',
    right: '6px',
    padding: '4px',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'hsl(var(--muted-foreground) / 0.4)',
    lineHeight: '0',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: '0',
    transition: 'opacity 0.15s, color 0.15s, background-color 0.15s',
    zIndex: '2',
  },
  '.cm-md-codeblock-widget:hover .cm-md-codeblock-copy': {
    opacity: '1',
  },
  '.cm-md-codeblock-copy:hover': {
    backgroundColor: 'hsl(var(--primary) / 0.1)',
    color: 'hsl(var(--primary))',
  },

  // =====================================================
  // Tables
  // =====================================================
  '.cm-md-table-wrapper': {
    margin: '8px 0',
    overflowX: 'auto',
  },
  '.cm-md-table-widget': {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.9em',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid hsl(var(--border))',
  },
  '.cm-md-table-widget th': {
    backgroundColor: 'hsl(var(--primary) / 0.06)',
    padding: '10px 14px',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: '0.85em',
    color: 'hsl(var(--primary) / 0.8)',
    letterSpacing: '0.02em',
    borderBottom: '2px solid hsl(var(--primary) / 0.15)',
  },
  '.cm-md-table-widget td': {
    padding: '8px 14px',
    borderBottom: '1px solid hsl(var(--border))',
  },
  '.cm-md-table-widget tr:last-child td': {
    borderBottom: 'none',
  },
  '.cm-md-table-widget tr:hover td': {
    backgroundColor: 'hsl(var(--primary) / 0.02)',
  },

  // =====================================================
  // Callouts/Alerts
  // =====================================================
  '.cm-md-callout': {
    borderRadius: '8px',
    padding: '12px 16px',
    margin: '4px 0',
    borderLeft: '4px solid',
  },
  '.cm-md-callout-title': {
    fontWeight: '600',
    fontSize: '0.9em',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  '.cm-md-callout-icon': {
    fontSize: '14px',
    lineHeight: '1',
    flexShrink: '0',
  },
  '.cm-md-callout-content': {
    fontSize: '0.9em',
    lineHeight: '1.5',
    marginTop: '4px',
    opacity: '0.9',
  },
  // Callout color variants
  '.cm-md-callout-note': {
    borderColor: 'hsl(220 80% 60%)',
    backgroundColor: 'hsl(220 80% 60% / 0.06)',
  },
  '.cm-md-callout-note .cm-md-callout-title': { color: 'hsl(220 80% 60%)' },
  '.cm-md-callout-tip': {
    borderColor: 'hsl(142 70% 45%)',
    backgroundColor: 'hsl(142 70% 45% / 0.06)',
  },
  '.cm-md-callout-tip .cm-md-callout-title': { color: 'hsl(142 70% 45%)' },
  '.cm-md-callout-warning': {
    borderColor: 'hsl(38 92% 50%)',
    backgroundColor: 'hsl(38 92% 50% / 0.06)',
  },
  '.cm-md-callout-warning .cm-md-callout-title': { color: 'hsl(38 92% 50%)' },
  '.cm-md-callout-danger': {
    borderColor: 'hsl(0 84% 60%)',
    backgroundColor: 'hsl(0 84% 60% / 0.06)',
  },
  '.cm-md-callout-danger .cm-md-callout-title': { color: 'hsl(0 84% 60%)' },
  '.cm-md-callout-info': {
    borderColor: 'hsl(var(--primary))',
    backgroundColor: 'hsl(var(--primary) / 0.06)',
  },
  '.cm-md-callout-info .cm-md-callout-title': { color: 'hsl(var(--primary))' },
  '.cm-md-callout-abstract': {
    borderColor: 'hsl(200 80% 55%)',
    backgroundColor: 'hsl(200 80% 55% / 0.06)',
  },
  '.cm-md-callout-abstract .cm-md-callout-title': { color: 'hsl(200 80% 55%)' },
  '.cm-md-callout-todo': {
    borderColor: 'hsl(262 83% 58%)',
    backgroundColor: 'hsl(262 83% 58% / 0.06)',
  },
  '.cm-md-callout-todo .cm-md-callout-title': { color: 'hsl(262 83% 58%)' },
  '.cm-md-callout-example': {
    borderColor: 'hsl(270 50% 60%)',
    backgroundColor: 'hsl(270 50% 60% / 0.06)',
  },
  '.cm-md-callout-example .cm-md-callout-title': { color: 'hsl(270 50% 60%)' },
  '.cm-md-callout-quote': {
    borderColor: 'hsl(var(--muted-foreground))',
    backgroundColor: 'hsl(var(--muted-foreground) / 0.06)',
  },
  '.cm-md-callout-quote .cm-md-callout-title': { color: 'hsl(var(--muted-foreground))' },
  '.cm-md-callout-bug': {
    borderColor: 'hsl(0 84% 60%)',
    backgroundColor: 'hsl(0 84% 60% / 0.06)',
  },
  '.cm-md-callout-bug .cm-md-callout-title': { color: 'hsl(0 84% 60%)' },
  '.cm-md-callout-success': {
    borderColor: 'hsl(142 70% 45%)',
    backgroundColor: 'hsl(142 70% 45% / 0.06)',
  },
  '.cm-md-callout-success .cm-md-callout-title': { color: 'hsl(142 70% 45%)' },
  '.cm-md-callout-failure': {
    borderColor: 'hsl(0 84% 60%)',
    backgroundColor: 'hsl(0 84% 60% / 0.06)',
  },
  '.cm-md-callout-failure .cm-md-callout-title': { color: 'hsl(0 84% 60%)' },
  '.cm-md-callout-question': {
    borderColor: 'hsl(38 92% 50%)',
    backgroundColor: 'hsl(38 92% 50% / 0.06)',
  },
  '.cm-md-callout-question .cm-md-callout-title': { color: 'hsl(38 92% 50%)' },

  // =====================================================
  // List markers
  // =====================================================
  '.cm-md-bullet': {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'hsl(var(--primary) / 0.5)',
    marginRight: '8px',
    verticalAlign: 'middle',
  },
  '.cm-md-bullet-hollow': {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'transparent',
    border: '1.5px solid hsl(var(--primary) / 0.4)',
    marginRight: '8px',
    verticalAlign: 'middle',
  },
  '.cm-md-bullet-square': {
    display: 'inline-block',
    width: '5px',
    height: '5px',
    borderRadius: '1px',
    backgroundColor: 'hsl(var(--primary) / 0.4)',
    marginRight: '8px',
    verticalAlign: 'middle',
  },
  '.cm-md-ordered-number': {
    display: 'inline-block',
    fontWeight: '600',
    color: 'hsl(var(--primary) / 0.6)',
    marginRight: '6px',
    fontSize: '0.9em',
    minWidth: '1.2em',
    textAlign: 'right',
  },

  // =====================================================
  // Task lists
  // =====================================================
  '.cm-md-checkbox': {
    marginRight: '6px',
    verticalAlign: 'middle',
    cursor: 'pointer',
    accentColor: 'hsl(var(--primary))',
  },
  '.cm-md-task-checked': {
    textDecoration: 'line-through',
    color: 'hsl(var(--muted-foreground))',
  },

  // =====================================================
  // Horizontal rules — gradient fade
  // =====================================================
  '.cm-md-hr-widget': {
    border: 'none',
    height: '1px',
    margin: '0.05em 0',
    backgroundImage:
      'linear-gradient(to right, transparent, hsl(var(--primary) / 0.3), transparent)',
  },

  // =====================================================
  // Images — centered, captioned, resizable
  // =====================================================
  '.cm-md-image-widget': {
    padding: '0.25em 0',
    textAlign: 'center',
  },
  '.cm-md-image-widget img': {
    maxWidth: '100%',
    borderRadius: '8px',
    margin: '0 auto',
    display: 'block',
    boxShadow: '0 2px 8px hsl(var(--foreground) / 0.08)',
    border: '1px solid hsl(var(--border))',
    transition: 'box-shadow 0.2s',
  },
  '.cm-md-image-widget:hover img': {
    boxShadow: '0 4px 16px hsl(var(--foreground) / 0.12)',
  },
  '.cm-md-image-caption': {
    color: 'hsl(var(--muted-foreground))',
    fontSize: '0.8em',
    fontStyle: 'italic',
    marginTop: '8px',
    textAlign: 'center',
  },
  '.cm-md-image-container': {
    position: 'relative',
    display: 'inline-block',
    maxWidth: '100%',
  },
  '.cm-md-image-resize-handle': {
    position: 'absolute',
    bottom: '4px',
    right: '4px',
    width: '16px',
    height: '16px',
    borderRadius: '4px',
    backgroundColor: 'hsl(var(--primary) / 0.6)',
    cursor: 'nwse-resize',
    opacity: '0',
    transition: 'opacity 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-md-image-container:hover .cm-md-image-resize-handle': {
    opacity: '1',
  },
  '.cm-md-image-resize-handle svg': {
    width: '10px',
    height: '10px',
    color: 'white',
  },

  // Image grid — consecutive images rendered side by side
  '.cm-md-image-grid': {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
    gap: '8px',
    padding: '0.25em 0',
  },
  '.cm-md-image-grid-cell': {
    textAlign: 'center',
  },
  '.cm-md-image-grid-cell img': {
    maxWidth: '100%',
    borderRadius: '8px',
    display: 'block',
    margin: '0 auto',
    boxShadow: '0 2px 8px hsl(var(--foreground) / 0.08)',
    border: '1px solid hsl(var(--border))',
    transition: 'box-shadow 0.2s',
  },
  '.cm-md-image-grid-cell:hover img': {
    boxShadow: '0 4px 16px hsl(var(--foreground) / 0.12)',
  },

  // =====================================================
  // Math (KaTeX)
  // =====================================================
  '.cm-md-math-inline': {
    display: 'inline-block',
    verticalAlign: 'middle',
  },
  '.cm-md-math-block': {
    textAlign: 'center',
    padding: '0',
    margin: '0',
  },
  '.cm-md-math-block .katex-display': {
    margin: '0',
  },

  // =====================================================
  // Interactive Tables (database-backed)
  // =====================================================
  '.cm-md-itable-wrapper': {
    position: 'relative',
    margin: '8px 0',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
    overflow: 'hidden',
    backgroundColor: 'hsl(var(--background))',
  },
  '.cm-md-itable-titlebar': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 12px',
    borderBottom: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--primary) / 0.03)',
  },
  '.cm-md-itable-titlebar-left': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: '1',
    minWidth: '0',
  },
  '.cm-md-itable-titlebar-right': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: '0',
  },
  '.cm-md-itable-title': {
    fontWeight: '600',
    fontSize: '0.9em',
    color: 'hsl(var(--primary))',
    cursor: 'default',
    flex: '1',
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  '.cm-md-itable-title-input': {
    fontWeight: '600',
    fontSize: '0.9em',
    color: 'hsl(var(--primary))',
    flex: '1',
    minWidth: '0',
    border: '1px solid hsl(var(--primary) / 0.3)',
    borderRadius: '4px',
    padding: '2px 6px',
    backgroundColor: 'hsl(var(--background))',
    outline: 'none',
  },
  '.cm-md-itable-search': {
    fontSize: '0.8em',
    padding: '3px 8px',
    border: '1px solid hsl(var(--border))',
    borderRadius: '4px',
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
    width: '140px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  '.cm-md-itable-search:focus': {
    borderColor: 'hsl(var(--primary) / 0.5)',
  },
  '.cm-md-itable-row-count': {
    fontSize: '0.75em',
    color: 'hsl(var(--muted-foreground))',
    whiteSpace: 'nowrap',
  },

  // Table structure
  '.cm-md-itable': {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    fontSize: '0.85em',
  },
  '.cm-md-itable th': {
    position: 'relative',
    padding: '8px 12px',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: '0.85em',
    color: 'hsl(var(--primary) / 0.8)',
    letterSpacing: '0.02em',
    borderBottom: '2px solid hsl(var(--primary) / 0.15)',
    borderRight: '1px solid hsl(var(--border) / 0.5)',
    backgroundColor: 'hsl(var(--primary) / 0.04)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  '.cm-md-itable th:last-child': {
    borderRight: 'none',
  },
  '.cm-md-itable th:hover': {
    backgroundColor: 'hsl(var(--primary) / 0.07)',
  },
  '.cm-md-itable td': {
    padding: '6px 12px',
    borderBottom: '1px solid hsl(var(--border))',
    borderRight: '1px solid hsl(var(--border) / 0.3)',
    cursor: 'text',
    minHeight: '32px',
    wordBreak: 'break-word',
  },
  '.cm-md-itable td:last-child': {
    borderRight: 'none',
  },
  // Empty cell placeholder
  '.cm-md-itable td:empty::after': {
    content: "'\\00a0'",
    color: 'transparent',
  },
  '.cm-md-itable tr:hover td': {
    backgroundColor: 'hsl(var(--primary) / 0.02)',
  },
  '.cm-md-itable tr:last-child td': {
    borderBottom: 'none',
  },

  // Sort icon
  '.cm-md-itable-sort-icon': {
    fontSize: '0.75em',
    color: 'hsl(var(--primary) / 0.5)',
    marginLeft: '2px',
  },

  // Filter row
  '.cm-md-itable-filter-row': {
    backgroundColor: 'hsl(var(--primary) / 0.02)',
  },
  '.cm-md-itable-filter-cell': {
    padding: '4px 6px !important',
    borderBottom: '1px solid hsl(var(--border))',
    borderRight: '1px solid hsl(var(--border) / 0.3)',
  },
  '.cm-md-itable-filter-cell:last-child': {
    borderRight: 'none',
  },
  '.cm-md-itable-filter-input': {
    width: '100%',
    border: '1px solid hsl(var(--border))',
    borderRadius: '3px',
    padding: '3px 6px',
    fontSize: '0.85em',
    color: 'hsl(var(--foreground))',
    backgroundColor: 'hsl(var(--background))',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  '.cm-md-itable-filter-input:focus': {
    borderColor: 'hsl(var(--primary) / 0.5)',
  },
  '.cm-md-itable-filter-input::placeholder': {
    color: 'hsl(var(--muted-foreground) / 0.6)',
    fontSize: '0.95em',
  },

  // Active filter button state
  '.cm-md-itable-toolbar-btn-active': {
    color: 'hsl(var(--primary)) !important',
    backgroundColor: 'hsl(var(--primary) / 0.1)',
  },

  // Resize handle
  '.cm-md-itable-resize-handle': {
    position: 'absolute',
    right: '0',
    top: '0',
    bottom: '0',
    width: '4px',
    cursor: 'col-resize',
    backgroundColor: 'transparent',
    transition: 'background-color 0.15s',
  },
  '.cm-md-itable-resize-handle:hover': {
    backgroundColor: 'hsl(var(--primary) / 0.3)',
  },

  // Add column button
  '.cm-md-itable-add-col': {
    textAlign: 'center',
    color: 'hsl(var(--muted-foreground))',
    cursor: 'pointer',
    fontSize: '1em',
    fontWeight: '400',
    borderLeft: '1px dashed hsl(var(--border))',
    padding: '8px 4px !important',
    width: '40px',
    backgroundColor: 'transparent !important',
  },
  '.cm-md-itable-add-col:hover': {
    color: 'hsl(var(--primary))',
    backgroundColor: 'hsl(var(--primary) / 0.05) !important',
  },

  // Add row button
  '.cm-md-itable-add-row': {
    padding: '6px 12px',
    textAlign: 'center',
    fontSize: '0.8em',
    color: 'hsl(var(--muted-foreground))',
    cursor: 'pointer',
    borderTop: '1px dashed hsl(var(--border))',
    transition: 'color 0.15s, background-color 0.15s',
  },
  '.cm-md-itable-add-row:hover': {
    color: 'hsl(var(--primary))',
    backgroundColor: 'hsl(var(--primary) / 0.03)',
  },

  // Cell input (inline editing)
  '.cm-md-itable-cell-input': {
    width: '100%',
    border: 'none',
    outline: 'none',
    padding: '0',
    margin: '0',
    font: 'inherit',
    fontSize: 'inherit',
    color: 'hsl(var(--foreground))',
    backgroundColor: 'hsl(var(--primary) / 0.05)',
    borderRadius: '2px',
  },

  // Toolbar buttons (copy link, delete table)
  '.cm-md-itable-toolbar-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'none',
    color: 'hsl(var(--muted-foreground))',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    transition: 'color 0.15s, background-color 0.15s',
  },
  '.cm-md-itable-toolbar-btn:hover': {
    color: 'hsl(var(--foreground))',
    backgroundColor: 'hsl(var(--primary) / 0.08)',
  },
  '.cm-md-itable-toolbar-btn-danger:hover': {
    color: 'hsl(var(--destructive))',
    backgroundColor: 'hsl(var(--destructive) / 0.08)',
  },

  // Row actions
  '.cm-md-itable-row-actions': {
    width: '32px',
    textAlign: 'center',
    padding: '4px !important',
    borderBottom: '1px solid hsl(var(--border))',
  },
  '.cm-md-itable-row-menu-btn': {
    opacity: '0.4',
    border: 'none',
    background: 'none',
    color: 'hsl(var(--muted-foreground))',
    cursor: 'pointer',
    fontSize: '1.1em',
    lineHeight: '1',
    padding: '2px 6px',
    borderRadius: '3px',
    transition: 'opacity 0.15s, color 0.15s, background-color 0.15s',
  },
  '.cm-md-itable tr:hover .cm-md-itable-row-menu-btn': {
    opacity: '1',
  },
  '.cm-md-itable-row-menu-btn:hover': {
    color: 'hsl(var(--foreground))',
    backgroundColor: 'hsl(var(--primary) / 0.1)',
  },

  // Context menu
  '.cm-md-itable-menu': {
    position: 'fixed',
    zIndex: '9999',
    minWidth: '180px',
    padding: '4px',
    borderRadius: '8px',
    border: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    boxShadow: '0 4px 16px hsl(0 0% 0% / 0.12)',
    fontSize: '0.85em',
  },
  '.cm-md-itable-menu-item': {
    padding: '6px 12px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
    userSelect: 'none',
  },
  '.cm-md-itable-menu-item:hover': {
    backgroundColor: 'hsl(var(--accent))',
  },
  '.cm-md-itable-menu-destructive': {
    color: 'hsl(var(--destructive))',
  },
  '.cm-md-itable-menu-destructive:hover': {
    backgroundColor: 'hsl(var(--destructive) / 0.08)',
  },
  '.cm-md-itable-menu-disabled': {
    color: 'hsl(var(--muted-foreground))',
    opacity: '0.5',
    cursor: 'default',
    pointerEvents: 'none',
  },
  '.cm-md-itable-menu-separator': {
    height: '1px',
    margin: '4px 8px',
    backgroundColor: 'hsl(var(--border))',
  },

  // Empty / loading states
  '.cm-md-itable-loading': {
    padding: '24px',
    textAlign: 'center',
    color: 'hsl(var(--muted-foreground))',
    fontSize: '0.85em',
    fontStyle: 'italic',
  },
  '.cm-md-itable-empty': {
    padding: '24px',
    textAlign: 'center',
    color: 'hsl(var(--muted-foreground))',
    fontSize: '0.85em',
  },
  '.cm-md-itable-empty-cell': {
    padding: '16px 12px !important',
    textAlign: 'center',
    color: 'hsl(var(--muted-foreground))',
    fontStyle: 'italic',
  },

  // =====================================================
  // Table Links (inline pill references)
  // =====================================================
  '.cm-md-table-link': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '4px',
    backgroundColor: 'hsl(var(--primary) / 0.08)',
    border: '1px solid hsl(var(--primary) / 0.2)',
    cursor: 'pointer',
    fontSize: '0.9em',
    color: 'hsl(var(--primary))',
    textDecoration: 'none',
    transition: 'background-color 0.15s',
    verticalAlign: 'middle',
  },
  '.cm-md-table-link:hover': {
    backgroundColor: 'hsl(var(--primary) / 0.15)',
  },
  '.cm-md-table-link-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'hsl(var(--primary) / 0.7)',
  },
  '.cm-md-table-link-icon svg': {
    width: '14px',
    height: '14px',
  },

  // =====================================================
  // Internal link widgets (entry, attachment, tag, collection)
  // =====================================================
  '.cm-md-entry-link, .cm-md-attachment-link, .cm-md-tag-link, .cm-md-collection-link': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.9em',
    textDecoration: 'none',
    transition: 'background-color 0.15s',
    verticalAlign: 'middle',
  },
  // Entry links — primary/blue tint
  '.cm-md-entry-link': {
    backgroundColor: 'hsl(var(--primary) / 0.08)',
    border: '1px solid hsl(var(--primary) / 0.2)',
    color: 'hsl(var(--primary))',
  },
  '.cm-md-entry-link:hover': {
    backgroundColor: 'hsl(var(--primary) / 0.15)',
  },
  '.cm-md-entry-link-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'hsl(var(--primary) / 0.7)',
  },
  '.cm-md-entry-link-icon svg': {
    width: '14px',
    height: '14px',
  },
  // Attachment links — amber/orange tint
  '.cm-md-attachment-link': {
    backgroundColor: 'hsl(30 80% 55% / 0.08)',
    border: '1px solid hsl(30 80% 55% / 0.2)',
    color: 'hsl(30 80% 40%)',
  },
  '.cm-md-attachment-link:hover': {
    backgroundColor: 'hsl(30 80% 55% / 0.15)',
  },
  '.cm-md-attachment-link-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'hsl(30 80% 55% / 0.7)',
  },
  '.cm-md-attachment-link-icon svg': {
    width: '14px',
    height: '14px',
  },
  // Tag links — green tint
  '.cm-md-tag-link': {
    backgroundColor: 'hsl(142 50% 45% / 0.08)',
    border: '1px solid hsl(142 50% 45% / 0.2)',
    color: 'hsl(142 50% 35%)',
  },
  '.cm-md-tag-link:hover': {
    backgroundColor: 'hsl(142 50% 45% / 0.15)',
  },
  '.cm-md-tag-link-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'hsl(142 50% 45% / 0.7)',
  },
  '.cm-md-tag-link-icon svg': {
    width: '14px',
    height: '14px',
  },
  // Collection links — purple tint
  '.cm-md-collection-link': {
    backgroundColor: 'hsl(270 60% 55% / 0.08)',
    border: '1px solid hsl(270 60% 55% / 0.2)',
    color: 'hsl(270 60% 40%)',
  },
  '.cm-md-collection-link:hover': {
    backgroundColor: 'hsl(270 60% 55% / 0.15)',
  },
  '.cm-md-collection-link-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'hsl(270 60% 55% / 0.7)',
  },
  '.cm-md-collection-link-icon svg': {
    width: '14px',
    height: '14px',
  },

  // =====================================================
  // Text highlight (==text==)
  // =====================================================
  '.cm-md-highlight': {
    backgroundColor: 'rgba(255, 213, 0, 0.3)',
    borderRadius: '2px',
    padding: '1px 0',
    boxDecorationBreak: 'clone',
  },

  // =====================================================
  // Comment annotations
  // =====================================================
  '.cm-md-comment-highlight': {
    backgroundColor: 'rgba(147, 130, 255, 0.15)',
    borderBottom: '2px solid rgba(147, 130, 255, 0.5)',
    borderRadius: '1px',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  '.cm-md-comment-highlight.active': {
    backgroundColor: 'rgba(147, 130, 255, 0.3)',
    borderBottomColor: 'rgba(147, 130, 255, 0.8)',
  },
  '.cm-md-comment-indicator': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    marginLeft: '2px',
    verticalAlign: 'text-bottom',
    cursor: 'pointer',
    color: 'rgba(147, 130, 255, 0.6)',
    borderRadius: '3px',
    transition: 'color 0.15s ease, background-color 0.15s ease',
  },
  '.cm-md-comment-indicator:hover': {
    color: 'rgba(147, 130, 255, 1)',
    backgroundColor: 'rgba(147, 130, 255, 0.1)',
  },
  '.cm-md-comment-indicator.active': {
    color: 'rgba(147, 130, 255, 1)',
    backgroundColor: 'rgba(147, 130, 255, 0.15)',
  },
  '.cm-md-comment-indicator svg': {
    width: '14px',
    height: '14px',
  },

  // =====================================================
  // Search highlights
  // =====================================================
  '.cm-search-match': {
    backgroundColor: 'rgba(255, 213, 0, 0.4)',
    borderRadius: '2px',
  },
  '.cm-search-match.current': {
    backgroundColor: 'rgba(255, 150, 0, 0.6)',
  },
  // Marks injected into table widget DOMs
  '& .cm-md-itable-wrapper mark.cm-search-match': {
    backgroundColor: 'rgba(255, 213, 0, 0.4)',
    borderRadius: '2px',
  },
  '& .cm-md-itable-wrapper mark.cm-search-match.current': {
    backgroundColor: 'rgba(255, 150, 0, 0.6)',
  },
  '& .cm-md-table-wrapper mark.cm-search-match': {
    backgroundColor: 'rgba(255, 213, 0, 0.4)',
    borderRadius: '2px',
  },
  '& .cm-md-table-wrapper mark.cm-search-match.current': {
    backgroundColor: 'rgba(255, 150, 0, 0.6)',
  },
  '& .cm-md-codeblock-widget mark.cm-search-match': {
    backgroundColor: 'rgba(255, 213, 0, 0.4)',
    borderRadius: '2px',
  },
  '& .cm-md-codeblock-widget mark.cm-search-match.current': {
    backgroundColor: 'rgba(255, 150, 0, 0.6)',
  },
});
