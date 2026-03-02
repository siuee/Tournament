/**
 * Simple className merger for Tailwind/shadcn-style components.
 * For full Tailwind class merging, install: clsx tailwind-merge
 */
export function cn(...inputs) {
  return inputs.filter(Boolean).join(' ');
}

/** Title case: first letter uppercase, rest lowercase per word. */
export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
