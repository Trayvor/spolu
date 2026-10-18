/**
 * Who invited the person, to which group, and one line on what Help is for (X19), under the
 * title of `/login` and `/welcome`. `by` is left out when there is no invitation context.
 */
export function InviteNote({ by, about }: { by?: string; about: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-primary pl-3">
      {by && <p className="font-semibold">{by}</p>}
      <p className="text-button text-muted-foreground">{about}</p>
    </div>
  );
}
