import { posix, win32 } from 'node:path'

function pathOf(cwd) {
  return /^[A-Za-z]:|^\\\\/.test(cwd) ? win32 : posix
}

export function projectFromCwd(cwd) {
  const path = pathOf(cwd)
  const normalized = path.normalize(cwd).replaceAll('\\', '/')
  if (/(?:^|\/)Documents\/Codex\/\d{4}-\d{2}-\d{2}\//i.test(normalized)) return ''
  return path.basename(cwd).slice(0, 120)
}

export function projectOfThread(thread, projects) {
  const assigned = projects.find(project => project.id === thread.projectId)
  if (assigned) return assigned.name

  const fallback = projectFromCwd(thread.cwd)
  if (!fallback) return ''

  const path = pathOf(thread.cwd)
  let bestRootLength = -1
  let name = fallback
  for (const project of projects) {
    for (const root of project.roots) {
      if (typeof root?.path !== 'string' || !path.isAbsolute(root.path)) continue
      const relative = path.relative(root.path, thread.cwd)
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) continue
      const length = path.resolve(root.path).length
      if (length <= bestRootLength) continue
      bestRootLength = length
      name = project.name
    }
  }
  return name
}
