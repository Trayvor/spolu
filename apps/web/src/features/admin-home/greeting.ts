export type GreetingKey = 'morning' | 'afternoon' | 'evening';

const hourInBratislava = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: 'Europe/Bratislava',
});

/** By the Bratislava hour: 04–11 morning, 12–17 afternoon, otherwise evening. */
export function greetingKey(now: Date): GreetingKey {
  const hour = Number(hourInBratislava.format(now));
  if (hour >= 4 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

/** The first word of the name ("Vladyslav Herasymenko" gives "Vladyslav"). */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';
