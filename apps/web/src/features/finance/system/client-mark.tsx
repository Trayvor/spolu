/**
 * A client's 24 px logo in a ranking or table row, or its first letter drawn by CSS (so it is
 * not part of the row's text).
 */
export function ClientMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        className="size-6 shrink-0 rounded-md object-contain"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      data-letter={(Array.from(name.trim())[0] ?? '').toUpperCase()}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-micro font-semibold text-secondary-foreground before:content-[attr(data-letter)]"
    />
  );
}
