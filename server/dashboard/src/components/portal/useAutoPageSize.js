'use client';

import { useState, useEffect, useRef } from 'react';

// Auto-sizes a paginated table's page length to however many rows fit below the
// table's own top, so a tall viewport shows more per page instead of always
// stopping at a fixed count. Falls back to `fallback` until the first client-side
// measurement lands (SSR-safe — avoids a hydration mismatch) and re-measures on
// window resize. `containerRef` goes on the element immediately wrapping the table
// (e.g. the PortalCard), so its top position is what the remaining-height math uses.
export function useAutoPageSize({ rowHeight = 42, minRows = 10, maxRows = 60, fallback = 20 } = {}) {
  const [pageSize, setPageSize] = useState(fallback);
  const ref = useRef(null);

  useEffect(() => {
    function measure() {
      const top = ref.current?.getBoundingClientRect().top;
      if (top == null) return;
      // Header row + pagination bar + bottom padding, roughly — leaves a little
      // slack rather than fitting exactly and risking a scrollbar for one row.
      // The +50 was added after live testing (2026-09-03) showed the table still
      // overflowing its available space by ~50px (one row) without it.
      const chrome = 46 + 60 + 24 + 50;
      const available = window.innerHeight - top - chrome;
      const n = Math.floor(available / rowHeight);
      setPageSize(Math.min(maxRows, Math.max(minRows, n || fallback)));
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rowHeight, minRows, maxRows, fallback]);

  return { pageSize, containerRef: ref };
}
