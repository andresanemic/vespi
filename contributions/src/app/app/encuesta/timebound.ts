export function surveyMaxTime(nowMs: number, deadlineMs?: number | null) {
  const now = Math.floor(nowMs / 1000);
  if (deadlineMs === undefined) return now + 30;
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return null;
  const deadline = Math.floor(deadlineMs / 1000);
  return deadline > now ? Math.min(now + 30, deadline) : null;
}
