import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Our font sizes are custom theme keys (`--text-button`, `--text-tiny`, ...). Unregistered,
 * tailwind-merge reads `text-tiny` as a text colour and drops `text-primary-foreground`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'nano',
            'micro',
            'tiny',
            'button',
            'body',
            'medium',
            'large',
            'xlarge',
            'wordmark',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
