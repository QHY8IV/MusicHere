import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { TabBar } from '../../components/TabBar';
import { peekAutoDemo } from '../../lib/demo';
import { colors } from '../../lib/theme';

export default function TabsLayout() {
  const router = useRouter();
  // 从欢迎页点了「看兔子带跑」：直达兔子电台（它自己消费这个标记并自动开始模拟）
  useEffect(() => {
    if (peekAutoDemo()) router.replace('/rabbit');
  }, [router]);
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: '此刻' }} />
      <Tabs.Screen name="places" options={{ title: '地点' }} />
      <Tabs.Screen name="rabbit" options={{ title: '兔子' }} />
      {/* 共鸣（街头）从兔子电台页进入，不占 Tab 位置 */}
      <Tabs.Screen name="resonance" options={{ title: '共鸣', href: null }} />
      {/* 「听这里」从首页进入，不占 Tab 位置 */}
      <Tabs.Screen name="listen" options={{ title: '听这里', href: null }} />
      <Tabs.Screen name="add" options={{ title: '分享' }} />
      <Tabs.Screen name="me" options={{ title: '我的' }} />
    </Tabs>
  );
}
