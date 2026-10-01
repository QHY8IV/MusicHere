import * as Location from 'expo-location';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface Coords {
  lat: number;
  lng: number;
  /** 定位精度（米），可能缺失 */
  accuracy: number | null;
}

type Status = 'loading' | 'ready' | 'denied' | 'unavailable';

interface LocationState {
  status: Status;
  coords: Coords | null;
  /** 重新请求权限并取一次最新位置 */
  refresh: () => Promise<Coords | null>;
}

const LocationContext = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [coords, setCoords] = useState<Coords | null>(null);
  const inflight = useRef<Promise<Coords | null> | null>(null);

  const refresh = useCallback(() => {
    // 多个页面同时请求时合并成一次
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          setStatus('denied');
          return null;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const next = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        };
        setCoords(next);
        setStatus('ready');
        return next;
      } catch {
        setStatus((s) => (s === 'ready' ? s : 'unavailable'));
        return null;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ status, coords, refresh }), [status, coords, refresh]);
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationState {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation 必须在 LocationProvider 内使用');
  return ctx;
}
