export type SnapshotRow = {
  metroSlug: string; metroLabel: string;
  pctClearing: number; medianRatio: number | null; liveCount: number;
};
export type RankedRow = SnapshotRow & { rank: number; momentum: number | null };

export function rankSnapshots(current: SnapshotRow[], prior?: SnapshotRow[]): RankedRow[] {
  const priorBySlug = new Map((prior ?? []).map((r) => [r.metroSlug, r]));
  return [...current]
    .sort((a, b) => b.pctClearing - a.pctClearing || (b.medianRatio ?? 0) - (a.medianRatio ?? 0))
    .map((r, i) => {
      const p = priorBySlug.get(r.metroSlug);
      return { ...r, rank: i + 1, momentum: p ? r.pctClearing - p.pctClearing : null };
    });
}
