import type { Snapshot } from "./types";

type Cell = Snapshot["cellGroups"][number];

export function summarizeCells(cells: Cell[]) {
  const fresh = cells.filter(
    (cell): cell is Cell & { value: number } =>
      cell.quality === "fresh" &&
      cell.value !== null &&
      Number.isFinite(cell.value),
  );
  if (!fresh.length)
    return { fresh, lowest: null, highest: null, average: null };
  const lowest = fresh.reduce((result, cell) =>
    cell.value < result.value ? cell : result,
  );
  const highest = fresh.reduce((result, cell) =>
    cell.value > result.value ? cell : result,
  );
  const average =
    fresh.reduce((total, cell) => total + cell.value, 0) / fresh.length;
  return { fresh, lowest, highest, average };
}
