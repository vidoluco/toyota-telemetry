import { useEffect, useRef, useState } from 'react'

const cache = new Map<string, unknown>()

/** Fetch with an in-memory cache keyed by `key`; re-runs when the key changes. */
export function useApi<T>(key: string, fn: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>(cache.get(key) as T | undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!cache.has(key))
  const [tick, setTick] = useState(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const cached = cache.get(key) as T | undefined
    if (cached !== undefined && tick === 0) { setData(cached); setLoading(false) }
    else setLoading(true)
    fn().then((d) => { if (!alive.current) return; cache.set(key, d); setData(d); setError(null); setLoading(false) })
      .catch((e: Error) => { if (!alive.current) return; setError(e.message); setLoading(false) })
    return () => { alive.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, ...deps])
  return { data, error, loading, reload: () => { cache.delete(key); setTick((t) => t + 1) } }
}

export function clearApiCache(): void { cache.clear() }
