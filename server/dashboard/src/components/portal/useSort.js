'use client';

import { useState, useCallback } from 'react';

// Shared sort-state for a PortalTable column click → server-side `sort_by`/`sort_dir`
// query params. Kept as one state object (not two separate useStates) so the toggle
// logic reads the CURRENT key/dir together, not a stale pairing from the render that
// queued the click.
export function useSort(initialKey = null, initialDir = 'desc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const onSort = useCallback((key) => {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  }, []);
  return { sortKey: sort.key, sortDir: sort.dir, onSort };
}
