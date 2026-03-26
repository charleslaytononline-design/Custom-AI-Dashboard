import type { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'
import { generateReactTemplate } from '../../../lib/reactTemplate'
import { getAuthUser } from '../../../lib/apiAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  // Verify server-side session
  const sessionUserId = await getAuthUser(req, res)
  if (!sessionUserId) return res.status(401).json({ error: 'Not authenticated' })

  const { name, description, projectType = 'react' } = req.body
  const userId = sessionUserId
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Missing name' })
  }

  // Role permission check: can this user create projects?
  const { data: userProfile } = await supabase.from('profiles').select('role').eq('id', userId).single()
  if (userProfile?.role) {
    const { data: rolePerms } = await supabase.from('roles').select('can_create_projects').eq('name', userProfile.role).single()
    if (rolePerms && !rolePerms.can_create_projects) {
      return res.status(403).json({ error: 'Your account role does not allow creating projects.' })
    }
  }

  try {
    // Create the project record
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        user_id: userId,
        name: name.trim(),
        description: (description || '').trim(),
        project_type: projectType,
      })
      .select()
      .single()

    if (projectError || !project) {
      return res.status(500).json({ error: projectError?.message || 'Failed to create project' })
    }

    if (projectType === 'react') {
      // Get Supabase credentials for the clients DB (if configured)
      const clientsUrl = process.env.CLIENTS_SUPABASE_URL || ''
      const clientsAnonKey = process.env.CLIENTS_SUPABASE_ANON_KEY || ''

      // Generate all template files
      const templateFiles = generateReactTemplate({
        projectName: name.trim(),
        supabaseUrl: clientsUrl,
        supabaseAnonKey: clientsAnonKey,
      })

      // Batch insert all files into project_files
      const fileRows = templateFiles.map((f) => ({
        project_id: project.id,
        user_id: userId,
        path: f.path,
        content: f.content,
        file_type: f.file_type,
      }))

      const { error: filesError } = await supabase
        .from('project_files')
        .insert(fileRows)

      if (filesError) {
        // Clean up the project if file insertion fails
        await supabase.from('projects').delete().eq('id', project.id)
        return res.status(500).json({ error: 'Failed to scaffold project files: ' + filesError.message })
      }
    }

    res.status(200).json({ project })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}
