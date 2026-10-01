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

/**
 * 演示位置：构建时设置 EXPO_PUBLIC_DEMO_LOCATION="纬度,经度"（与 seed 的坐标一致）后，
 * 拿不到真实定位的访客（不在示例数据附近、或网页不是 HTTPS 无法定位）可以一键使用该位置体验完整流程。
 */
export function demoLocation(): Coords | null {
  const raw = process.env.EXPO_PUBLIC_DEMO_LOCATION;
  if (!raw) return null;
  const [lat, lng] = raw.split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat!, lng: lng!, accuracy: null } : null;
}

interface LocationState {
  status: Status;
  coords: Coords | null;
  /** 当前是否在使用演示位置 */
  isDemo: boolean;
  /** 使用演示位置（未配置演示位置时为 null） */
  useDemo: (() => void) | null;
  /** 重新请求权限并取一次最新位置 */
  refresh: () => Promise<Coords | null>;
}

const LocationContext = createContext<LocationState | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [isDemo, setIsDemo] = useState(false);
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
        setIsDemo(false);
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

  const demo = demoLocation();
  const useDemo = useMemo(
    () =>
      demo
        ? () => {
            setCoords(demo);
            setIsDemo(true);
            setStatus('ready');
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demo?.lat, demo?.lng],
  );

  const value = useMemo(
    () => ({ status, coords, isDemo, useDemo, refresh }),
    [status, coords, isDemo, useDemo, refresh],
  );
  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationState {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation 必须在 LocationProvider 内使用');
  return ctx;
}
