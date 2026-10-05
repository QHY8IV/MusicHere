import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { TabBar } from '../../components/TabBar';
import { peekAutoDemo } from '../../lib/demo';
import { colors } from '../../lib/theme';

export default function TabsLayout() {
  const router = useRouter();
  // 从欢迎页点了「30 秒听见共鸣」：直达共鸣页（共鸣页自己消费这个标记并自动开始）
  useEffect(() => {
    if (peekAutoDemo()) router.replace('/resonance');
  }, [router]);
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
