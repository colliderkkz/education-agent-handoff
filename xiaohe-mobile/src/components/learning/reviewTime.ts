import type { ReviewPlan, WorkspaceState } from '../../local/types';
import { reviewAvailableAt } from '../../local/shared/server/mastery';

export function reviewAvailability(state: WorkspaceState, plan: ReviewPlan): { at: string | null; error: string | null } {
  try {
    const at = reviewAvailableAt(state, plan);
    if (!Number.isFinite(Date.parse(at))) throw new Error('复查可开始时间无效');
    return { at, error: null };
  } catch (cause) {
    return { at: null, error: `${cause instanceof Error ? cause.message : '暂时无法确认复查时间'}。请重读本机计划后再试。` };
  }
}

export function fullDateTime(value?: string): string {
  if (!value) return '时间待确认';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '时间待确认';
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function dueDescription(dueAt: string, now: number): string {
  const remaining = Date.parse(dueAt) - now;
  if (!Number.isFinite(remaining)) return '到期时间待确认';
  if (remaining <= 0) return '已到期，可以开始';
  const minutes = Math.ceil(remaining / 60000), days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), rest = minutes % 60;
  return `还需${days ? ` ${days} 天` : ''}${hours ? ` ${hours} 小时` : ''}${rest || !days && !hours ? ` ${rest || 1} 分钟` : ''}`;
}
