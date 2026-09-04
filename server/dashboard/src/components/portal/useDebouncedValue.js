'use client';

import { useState, useEffect } from 'react';

// Debounces a fast-changing value (a search input's every keystroke) so callers
// only re-fetch `delay`ms after typing pauses, not once per character.
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
