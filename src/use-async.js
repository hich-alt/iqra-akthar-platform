/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * useAsync (extracted — was duplicated identically in use-students.js and
 * use-student-records.js; audit flagged this as duplicate logic)
 *
 * Guards against two real bugs the duplicated version had:
 * 1. Stale-write races between overlapping calls (kept: attempt counter)
 * 2. Calling setState after the component unmounts while a request is
 *    still in flight (fixed: mounted ref)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { log } from "./logger";

export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, isLoading: true, error: null });
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const run = useCallback(async () => {
    const myAttempt = ++attemptRef.current;
    setState((prev) => (mountedRef.current ? { ...prev, isLoading: true, error: null } : prev));
    try {
      const data = await fn();
      if (myAttempt === attemptRef.current && mountedRef.current) {
        setState({ data, isLoading: false, error: null });
      }
    } catch (error) {
      log.error("useAsync fetch failed", { error });
      if (myAttempt === attemptRef.current && mountedRef.current) {
        setState({ data: null, isLoading: false, error });
      }
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { run(); }, [run]);

  return { ...state, retry: run };
}
