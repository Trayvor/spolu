import { useEffect, useState } from 'react';

const attended = () => document.visibilityState === 'visible' && document.hasFocus();

/**
 * True while the reader is in front of the page: it is visible and its window has focus. A
 * desktop browser behind another app stays "visible", so visibility alone would mark messages
 * read that nobody saw, and a read message gets no push.
 */
export function useDocumentAttended(): boolean {
  const [value, setValue] = useState(attended);
  useEffect(() => {
    const update = () => setValue(attended());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);
  return value;
}
