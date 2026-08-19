/**
 * Queries that show aggregated figures and therefore go stale whenever any
 * business record is added, edited or deleted.
 *
 * Kept in one place so a new screen cannot forget one. Nothing here calculates
 * anything - these are the keys of the existing queries, and invalidating them
 * simply makes the existing server-side calculations run again against current
 * data.
 */
export const DEPENDENT_QUERY_KEYS = [
  'dashboard',
  'dashboard-sales',
  'dashboard-finance',
] as const;

/**
 * Invalidate the aggregate queries after a change.
 *
 * Takes the query client rather than calling useQueryClient itself, so it can be
 * used from mutation callbacks as well as hooks.
 */
export function refreshAggregates(queryClient: {
  invalidateQueries: (filters: { queryKey: unknown[] }) => unknown;
}) {
  for (const key of DEPENDENT_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}
