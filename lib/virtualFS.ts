import { supabase } from './supabase'

export interface ProjectFile {
  id: string
  project_id: string
  user_id: string
  path: string
  content: string | null
  file_type: string
  created_at: string
  updated_at: string
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  file_type?: string
  children?: FileTreeNode[]
  file?: ProjectFile
}

/**
 * Load all files for a project
 */
export async function loadProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const { data, error } = await supabase
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .order('path', { ascending: true })
  if (error) throw error
  return data || []
}

/**
 * Create or update a file
 */
export async function saveFile(
  projectId: string,
  userId: string,
  path: string,
  content: string,
  fileType: string = 'html'
): Promise<ProjectFile> {
  const { data, error } = await supabase
    .from('project_files')
    .upsert(
      {
        project_id: projectId,
        user_id: userId,
        path,
        content,
        file_type: fileType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,path' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Delete a file
 */
export async function deleteFile(projectId: string, path: string): Promise<void> {
  const { error } = await supabase
    .from('project_files')
    .delete()
    .eq('project_id', projectId)
    .eq('path', path)
  if (error) throw error
}

/**
 * Rename a file (delete old, create new)
 */
export async function renameFile(
  projectId: string,
  userId: string,
  oldPath: string,
  newPath: string
): Promise<ProjectFile> {
  const { data: existing } = await supabase
    .from('project_files')
    .select('*')
    .eq('project_id', projectId)
    .eq('path', oldPath)
    .single()

  if (!existing) throw new Error('File not found')

  await deleteFile(projectId, oldPath)
  return saveFile(projectId, userId, newPath, existing.content || '', existing.file_type)
}

/**
 * Build a tree structure from flat file paths
 */
export function buildFileTree(files: ProjectFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const file of files) {
    const parts = file.path.split('/')
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const fullPath = parts.slice(0, i + 1).join('/')

      let existing = currentLevel.find(n => n.name === part)

      if (!existing) {
        if (isFile) {
          existing = {
            name: part,
            path: fullPath,
            type: 'file',
            file_type: file.file_type,
            file,
          }
        } else {
          existing = {
            name: part,
            path: fullPath,
            type: 'folder',
            children: [],
          }
        }
        currentLevel.push(existing)
      }

      if (!isFile && existing.children) {
        currentLevel = existing.children
      }
    }
  }

  // Sort: folders first, then files, alphabetically
  function sortNodes(nodes: FileTreeNode[]): FileTreeNode[] {
    return nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    }).map(n => ({
      ...n,
      children: n.children ? sortNodes(n.children) : undefined,
    }))
  }

  return sortNodes(root)
}

/**
 * Get file extension type
 */
export function getFileType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'html': case 'htm': return 'html'
    case 'css': return 'css'
    case 'js': return 'js'
    case 'ts': case 'tsx': return 'ts'
    case 'json': return 'json'
    case 'md': return 'markdown'
    case 'svg': case 'png': case 'jpg': case 'gif': return 'image'
    default: return 'text'
  }
}

/**
 * Migrate existing pages to project_files format.
 * Call this once per project to transition from the pages table.
 */
export async function migratePagesToProjFiles(
  projectId: string,
  userId: string,
  pages: Array<{ name: string; code: string }>,
  layoutCode?: string | null,
): Promise<void> {
  const files: Array<{ path: string; content: string; file_type: string }> = []

  if (layoutCode) {
    files.push({ path: 'layout.html', content: layoutCode, file_type: 'html' })
  }

  for (const page of pages) {
    const safeName = page.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    files.push({
      path: `pages/${safeName}.html`,
      content: page.code,
      file_type: 'html',
    })
  }

  for (const f of files) {
    await saveFile(projectId, userId, f.path, f.content, f.file_type)
  }
}
