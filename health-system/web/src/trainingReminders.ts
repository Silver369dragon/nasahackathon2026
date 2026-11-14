type Reminder = {
  date: string
  kind: string
  status: string
  reminderActive: boolean
  remindedAt: string | null
}

export function isActiveReminder(task: Reminder) {
  return (task.status === 'pending' || task.status === 'in_progress') &&
    task.reminderActive && !!task.remindedAt
}

export function newTaskReminders<T extends Reminder>(
  tasks: T[], previous: Record<string, string>,
  context: { hidden: boolean; permission: NotificationPermission | null },
) {
  const seen = { ...previous }
  const desktop: T[] = []
  for (const task of tasks) {
    if (!isActiveReminder(task) || !task.remindedAt) continue
    // An approved replacement has a new ID but keeps the day's original reminder.
    const key = task.date + '/' + task.kind
    const last = seen[key]
    if (last && Date.parse(last) >= Date.parse(task.remindedAt)) continue
    seen[key] = task.remindedAt
    if (context.hidden && context.permission === 'granted') desktop.push(task)
  }
  return { seen, desktop }
}
