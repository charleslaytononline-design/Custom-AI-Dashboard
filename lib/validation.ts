/**
 * Shared validation library for security-critical input checking.
 * Used by ALL API routes to validate user input and AI output.
 *
 * SECURITY: This is a trust boundary — all data crossing it must be validated.
 */

// ── UUID Validation ──────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

// ── Schema Name Validation ───────────────────────────────────────

const SCHEMA_RE = /^proj_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidSchemaName(name: string): boolean {
  return SCHEMA_RE.test(name)
}

export function buildSchemaName(projectId: string): string | null {
  if (!isValidUUID(projectId)) return null
  return `proj_${projectId}`
}

// ── Table & Column Name Validation ───────────────────────────────

export const TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,49}$/
export const COLUMN_NAME_RE = /^[a-z][a-z0-9_]{0,49}$/

export function isValidTableName(name: unknown): name is string {
  return typeof name === 'string' && TABLE_NAME_RE.test(name)
}

export function isValidColumnName(name: unknown): name is string {
  return typeof name === 'string' && COLUMN_NAME_RE.test(name)
}

// ── File Path Validation ─────────────────────────────────────────

export function isValidFilePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!path || path.length > 500) return false
  if (path.includes('\0')) return false        // null bytes
  if (path.includes('\\')) return false         // backslashes
  if (path.startsWith('/')) return false        // absolute paths
  if (path.includes('..')) return false         // directory traversal
  if (path.startsWith('.')) return false        // hidden files at root
  // Only allow safe characters: alphanumeric, dash, underscore, slash, dot
  if (!/^[a-zA-Z0-9_\-/.@]+$/.test(path)) return false
  // Block suspicious filenames
  const lower = path.toLowerCase()
  if (lower.includes('.env') && path !== '.env') return false  // .env.local, .env.production etc.
  return true
}

// ── Column Type Whitelist ────────────────────────────────────────

export const ALLOWED_COLUMN_TYPES = new Set([
  'uuid', 'text', 'integer', 'numeric', 'boolean',
  'timestamptz', 'jsonb', 'bigint',
  'text[]', 'integer[]', 'uuid[]',
  'smallint', 'real', 'double precision',
  'date', 'time', 'interval',
])

// ── Safe Default Values ──────────────────────────────────────────

const SAFE_DEFAULT_RE = /^(now\(\)|gen_random_uuid\(\)|true|false|0|'[^']{0,100}')$/

export function isSafeDefaultValue(val: unknown): boolean {
  if (val === undefined || val === null) return true
  if (typeof val !== 'string') return false
  return SAFE_DEFAULT_RE.test(val)
}

// ── CREATE_TABLE Validation ──────────────────────────────────────

export interface TableColumnDef {
  name: string
  type: string
  primaryKey?: boolean
  default?: string
}

export interface TableDef {
  name: string
  columns: TableColumnDef[]
}

export function validateTableDef(def: unknown): { valid: boolean; error?: string } {
  if (!def || typeof def !== 'object') return { valid: false, error: 'Invalid table definition' }
  const d = def as any
  if (!isValidTableName(d.name)) return { valid: false, error: `Invalid table name: ${String(d.name).slice(0, 50)}` }
  if (!Array.isArray(d.columns) || d.columns.length === 0) return { valid: false, error: 'Columns required' }
  if (d.columns.length > 30) return { valid: false, error: 'Max 30 columns per table' }

  let hasPK = false
  for (const col of d.columns) {
    if (!isValidColumnName(col.name)) return { valid: false, error: `Invalid column name: ${String(col.name).slice(0, 50)}` }
    if (!ALLOWED_COLUMN_TYPES.has(col.type)) return { valid: false, error: `Disallowed column type: ${col.type}` }
    if (col.primaryKey) hasPK = true
    if (col.default && !isSafeDefaultValue(col.default)) {
      return { valid: false, error: `Unsafe default value for column ${col.name}` }
    }
  }
  if (!hasPK) return { valid: false, error: 'Table must have a primary key' }
  return { valid: true }
}

// ── ALTER_TABLE Validation ───────────────────────────────────────

export interface AlterOp {
  action: 'add_column' | 'drop_column' | 'rename_column'
  column: string
  type?: string
  new_name?: string
}

const PROTECTED_COLUMNS = new Set(['id', 'created_at'])

export function validateAlterOps(ops: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(ops) || ops.length === 0) return { valid: false, error: 'Operations required' }
  if (ops.length > 10) return { valid: false, error: 'Max 10 alter operations at once' }

  for (const op of ops) {
    if (!op || typeof op !== 'object') return { valid: false, error: 'Invalid operation' }
    const { action, column, type, new_name } = op as any

    if (!['add_column', 'drop_column', 'rename_column'].includes(action)) {
      return { valid: false, error: `Unknown alter action: ${action}` }
    }
    if (!isValidColumnName(column)) return { valid: false, error: `Invalid column name: ${column}` }

    if (action === 'add_column') {
      if (!type || !ALLOWED_COLUMN_TYPES.has(type)) return { valid: false, error: `Disallowed type: ${type}` }
    }
    if (action === 'drop_column' && PROTECTED_COLUMNS.has(column)) {
      return { valid: false, error: `Cannot drop protected column: ${column}` }
    }
    if (action === 'rename_column') {
      if (PROTECTED_COLUMNS.has(column)) return { valid: false, error: `Cannot rename protected column: ${column}` }
      if (!isValidColumnName(new_name)) return { valid: false, error: `Invalid new column name: ${new_name}` }
    }
  }
  return { valid: true }
}

// ── Cron Expression Validation ───────────────────────────────────

const CRON_FIELD_RE = /^(\*|(\d{1,2}(-\d{1,2})?(,\d{1,2}(-\d{1,2})?)*)(\/\d{1,2})?)$/

export function isValidCronExpression(expr: unknown): expr is string {
  if (typeof expr !== 'string') return false
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  return parts.every(part => CRON_FIELD_RE.test(part))
}

// ── Error Sanitization ───────────────────────────────────────────

export function sanitizeError(error: unknown): string {
  const msg = (error as any)?.message || String(error)

  // Strip internal database details
  if (msg.includes('proj_') || msg.includes('schema') || msg.includes('relation')) {
    return 'A database error occurred. Please try again.'
  }
  if (msg.includes('duplicate key')) return 'A record with that value already exists.'
  if (msg.includes('violates')) return 'The data did not meet validation requirements.'
  if (msg.includes('permission denied')) return 'You do not have permission for this operation.'
  if (msg.includes('does not exist')) return 'The requested resource was not found.'
  if (msg.includes('syntax error')) return 'A database error occurred. Please try again.'

  // For safe-looking messages, return truncated
  if (msg.length > 200) return msg.slice(0, 200) + '...'
  return msg
}

// ── Training Rule Sanitization ───────────────────────────────────

const BLOCKED_PATTERNS = [
  '<system>', '</system>', 'SYSTEM:', 'OVERRIDE:',
  'IGNORE PREVIOUS', 'IGNORE ALL', 'DISREGARD',
  'DROP TABLE', 'DROP SCHEMA', 'DELETE FROM', 'TRUNCATE',
  'ALTER ROLE', 'CREATE ROLE', 'GRANT ', 'REVOKE ',
  'pg_catalog', 'information_schema', 'auth.users',
  'service_role', 'supabase_admin',
]

export function sanitizeTrainingRule(text: string): string {
  let clean = text
  for (const pattern of BLOCKED_PATTERNS) {
    clean = clean.replace(new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[FILTERED]')
  }
  return clean.slice(0, 2000)
}
