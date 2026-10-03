import { Tabs } from 'expo-router';
import { TabBar } from '../../components/TabBar';
import { colors } from '../../lib/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: '此刻' }} />
      <Tabs.Screen name="places" options={{ title: '地点' }} />
      <Tabs.Screen name="resonance" options={{ title: '共鸣' }} />
      {/* 「听这里」从首页进入，不占 Tab 位置 */}
      <Tabs.Screen name="listen" options={{ title: '听这里', href: null }} />
      <Tabs.Screen name="add" options={{ title: '分享' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
    </Tabs>
  );
}
