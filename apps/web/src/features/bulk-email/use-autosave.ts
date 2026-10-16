import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorCodes } from '@spolu/shared';
import { ApiError } from '@/lib/api';

/**
 * `saved`: nothing to save; `pending`: a change waits for the debounce; `saving`: a PUT runs;
 * `invalid`: the draft has problems and is not sent; `error`: the last save failed (retry);
 * `changed`: another admin saved first (409 `changed`), `notDraft`: sending started (409
 * `not_draft`). The last two stop autosaving for good: the editor must reload.
 */
export type SaveState = 'saved' | 'pending' | 'saving' | 'invalid' | 'error' | 'changed' | 'notDraft';

type Options<D> = {
  draft: D;
  /** The version the draft was loaded with. */
  version: number;
  save: (draft: D, version: number) => Promise<{ version: number }>;
  isValid: (draft: D) => boolean;
  delay?: number;
};

/**
 * Debounced autosave with optimistic locking: `delay` ms after the last change the draft is
 * saved with the version read last, and the answer's version is used for the next save. A
 * change made while a save runs is saved after it. A conflict is never retried, so another
 * admin's edit is never overwritten silently. A pending change is saved at once on unmount.
 */
export function useAutosave<D>({ draft, version, save, isValid, delay = 1000 }: Options<D>) {
  const serialized = JSON.stringify(draft);
  const [state, setState] = useState<SaveState>('saved');
  const [currentVersion, setCurrentVersion] = useState(version);

  const latest = useRef({ draft, serialized, save, isValid });
  latest.current = { draft, serialized, save, isValid };
  const lastSaved = useRef(serialized);
  const versionRef = useRef(version);
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const run = useCallback(() => {
    clearTimeout(timer.current);
    const { draft: toSave, serialized: snapshot, save: doSave, isValid: valid } = latest.current;
    if (blocked.current || inFlight.current) return;
    if (snapshot === lastSaved.current) return setState('saved');
    if (!valid(toSave)) return setState('invalid');
    inFlight.current = true;
    setState('saving');
    doSave(toSave, versionRef.current).then(
      (answer) => {
        inFlight.current = false;
        versionRef.current = answer.version;
        lastSaved.current = snapshot;
        setCurrentVersion(answer.version);
        // Edited while saving: the effect below did not schedule, so save the rest now.
        if (latest.current.serialized !== snapshot) run();
        else setState('saved');
      },
      (error: unknown) => {
        inFlight.current = false;
        const code = error instanceof ApiError && error.status === 409 ? error.code : undefined;
        if (code === ErrorCodes.changed || code === ErrorCodes.notDraft) {
          blocked.current = true;
          setState(code === ErrorCodes.changed ? 'changed' : 'notDraft');
        } else {
          setState('error');
        }
      },
    );
  }, []);

  useEffect(() => {
    if (blocked.current || inFlight.current) return;
    if (serialized === lastSaved.current) {
      setState('saved');
      return;
    }
    if (!latest.current.isValid(latest.current.draft)) {
      setState('invalid');
      return;
    }
    setState('pending');
    timer.current = setTimeout(run, delay);
    return () => clearTimeout(timer.current);
  }, [serialized, delay, run]);

  // Leaving the editor: save what is still pending (fire and forget).
  useEffect(() => () => run(), [run]);

  return { state, version: currentVersion, retry: run };
}
