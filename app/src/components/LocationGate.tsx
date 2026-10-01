import type { ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useLocation, type Coords } from '../lib/location';
import { Button, EmptyState, Loading } from './ui';

/**
 * 需要定位的页面外面包一层：定位成功才渲染 children(coords)，
 * 否则展示对应的引导（加载中 / 未授权 / 取不到位置）。
 */
export function LocationGate({ children }: { children: (coords: Coords) => ReactNode }) {
  const { status, coords, refresh, useDemo } = useLocation();

  if (coords) return <>{children(coords)}</>;
  if (status === 'loading') {
    return (
      <>
        <Loading label="正在获取你的位置…" />
        {useDemo ? (
          <View style={{ alignItems: 'center' }}>
            <Button label="使用示例位置体验（上海外滩）" icon="map" variant="ghost" onPress={useDemo} testID="use-demo-location" />
          </View>
        ) : null}
      </>
    );
  }

  const denied = status === 'denied';
  return (
    <EmptyState
      icon="location-outline"
      title={denied ? '需要位置权限' : '暂时获取不到位置'}
      message={
        denied
          ? 'MusicHere 通过你所在的位置，为你显示这里的歌，并确认你在现场打卡。'
          : '请确认已打开定位服务，信号好的地方再试一次。'
      }
      action={
        <>
          <Button label={denied ? '授予权限' : '重试'} icon="locate" onPress={() => void refresh()} />
          {denied && Platform.OS !== 'web' ? (
            <Button label="去系统设置" variant="ghost" onPress={() => void Linking.openSettings()} />
          ) : null}
          {useDemo ? (
            <Button label="使用示例位置体验（上海外滩）" icon="map" variant="ghost" onPress={useDemo} testID="use-demo-location" />
          ) : null}
        </>
      }
    />
  );
}
