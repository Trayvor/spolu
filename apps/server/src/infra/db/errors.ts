/** Whether the Postgres error (drizzle may wrap the driver error in `cause`) has this SQLSTATE. */
function hasPgCode(error: unknown, sqlState: string): boolean {
  const code = (e: unknown): unknown => (e as { code?: unknown } | null)?.code;
  return (
    code(error) === sqlState || code((error as { cause?: unknown } | null)?.cause) === sqlState
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return hasPgCode(error, '23505');
}

export function isForeignKeyViolation(error: unknown): boolean {
  return hasPgCode(error, '23503');
}

export function isDeadlock(error: unknown): boolean {
  return hasPgCode(error, '40P01');
}

/** A statement cancelled by `statement_timeout` (or a cancel request). */
export function isQueryCanceled(error: unknown): boolean {
  return hasPgCode(error, '57014');
}
