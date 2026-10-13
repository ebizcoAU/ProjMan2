// usePortalData.js — generic fetch hook. Ported from Nexus portal/_components.
// `opts.refreshMs` (dashboard spec §9 / §11 #4): re-fetch in the background on that interval
// without flashing the loading state; `refetch()` is the manual refresh.
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

export function usePortalData(fetchFn, deps = [], opts = {}) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const hasData = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet || !hasData.current) setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result?.data ?? result);
      hasData.current = true;
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!opts.refreshMs) return undefined;
    const t = setInterval(() => load({ quiet: true }), opts.refreshMs);
    return () => clearInterval(t);
  }, [load, opts.refreshMs]);

  return { data, loading, error, refetch: load, updatedAt };
}
