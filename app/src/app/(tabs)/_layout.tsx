import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { colors } from '../../lib/theme';

type Icon = ComponentProps<typeof Ionicons>['name'];

const tab = (title: string, icon: Icon, iconOn: Icon) => ({
  title,
  tabBarIcon: ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? iconOn : icon} size={size} color={color} />
  ),
});

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.faint,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={tab('发现', 'compass-outline', 'compass')} />
      <Tabs.Screen name="places" options={tab('地点', 'location-outline', 'location')} />
      <Tabs.Screen name="add" options={tab('分享', 'add-circle-outline', 'add-circle')} />
      <Tabs.Screen name="me" options={tab('我的', 'person-outline', 'person')} />
    </Tabs>
  );
}
