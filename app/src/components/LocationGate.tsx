import type { ReactNode } from 'react';
import { Linking, Platform, View } from 'react-native';
import { useLocation, type Coords } from '../lib/location';
import { colors } from '../lib/theme';
import { Button, EmptyState, Loading } from './ui';

/**
 * 需要定位的页面外面包一层：定位成功才渲染 children(coords)，
 * 否则展示对应的引导（加载中 / 未授权 / 取不到位置），演示站还可以一键使用示例位置。
 */
export function LocationGate({ children }: { children: (coords: Coords) => ReactNode }) {
  const { status, coords, refresh, useDemo } = useLocation();

  if (coords) return <>{children(coords)}</>;

  const demoBtn = useDemo ? (
    <Button label="使用示例位置体验（上海外滩）" icon="map" variant="ghost" size="sm" onPress={useDemo} testID="use-demo-location" />
  ) : null;

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Loading label="正在找到你的位置…" />
        {demoBtn ? <View style={{ alignItems: 'center' }}>{demoBtn}</View> : null}
      </View>
    );
  }

  const denied = status === 'denied';
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
      <EmptyState
        icon="location-outline"
        title={denied ? '需要你的位置' : '暂时获取不到位置'}
        message={
          denied
            ? '此地有歌通过你所在的位置，让你听见这里的歌，并确认你在现场打卡、捡漂流瓶。'
            : '请确认已打开定位服务；网页版需要 HTTPS 才能定位。'
        }
        action={
          <>
            <Button label={denied ? '授予权限' : '重试'} icon="locate" onPress={() => void refresh()} />
            {denied && Platform.OS !== 'web' ? (
              <Button label="去系统设置" variant="ghost" size="sm" onPress={() => void Linking.openSettings()} />
            ) : null}
            {demoBtn}
          </>
        }
      />
    </View>
  );
}
