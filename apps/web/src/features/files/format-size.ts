const UNITS = ['byte', 'kilobyte', 'megabyte'] as const;

/** "512 byte", "1.5 kB", "25 MB": 1024 steps, at most one decimal, localized. */
export function formatFileSize(bytes: number, language: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: UNITS[unit],
    maximumFractionDigits: 1,
  }).format(value);
}
