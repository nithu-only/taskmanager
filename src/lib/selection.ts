/** Expand a selection to include descendants, without including their parents. */
export function treeClosure<T extends { id: number; parentPid: number | null }>(ids: Iterable<number>, rows: T[]): T[] {
  const selected = new Set(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<number, T[]>();
  for (const row of rows) {
    if (row.parentPid != null) {
      const list = children.get(row.parentPid) ?? [];
      list.push(row);
      children.set(row.parentPid, list);
    }
  }
  const queue = [...selected];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      if (!selected.has(child.id)) {
        selected.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return queue.map((id) => byId.get(id)).filter((r): r is T => !!r);
}
