// Deterministic color class per category name, so the same category always
// gets the same badge color across the app. Uses CSS classes (cat-moss,
// cat-blue, etc.) defined in index.css, which resolve to theme-aware CSS
// variables — so badges automatically look right in both light and dark mode.
const RAMPS = ['moss', 'blue', 'amber', 'pink', 'purple', 'teal'];

function rampFor(name) {
  if (!name) return 'gray';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return RAMPS[hash % RAMPS.length];
}

export function categoryColorClass(name) {
  return `cat-${rampFor(name)}`;
}

// For places that need the raw color (e.g. chart bar fills) rather than a
// full badge class — returns a CSS var() reference so it still adapts
// automatically between light and dark mode.
export function categoryColorVar(name) {
  const ramp = rampFor(name);
  return ramp === 'gray' ? 'var(--ink-soft)' : `var(--${ramp})`;
}
