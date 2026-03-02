/**
 * Simple className merger for Tailwind/shadcn-style components.
 * For full Tailwind class merging, install: clsx tailwind-merge
 */
export function cn(...inputs) {
  return inputs.filter(Boolean).join(' ');
}
