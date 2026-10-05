import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, gradients } from '../lib/theme';

type Icon = ComponentProps<typeof Ionicons>['name'];

const META: Record<string, { label: string; icon: Icon; iconOn: Icon }> = {
  index: { label: '此刻', icon: 'radio-outline', iconOn: 'radio' },
  places: { label: '地点', icon: 'map-outline', iconOn: 'map' },
  rabbit: { label: '兔子', icon: 'walk-outline', iconOn: 'walk' },
  add: { label: '分享', icon: 'add-circle-outline', iconOn: 'add-circle' },
  me: { label: '我的', icon: 'person-outline', iconOn: 'person' },
};

/** 悬浮的胶囊 Tab 栏；中间是「兔子电台」的极光按钮（共鸣从兔子电台页进入）。 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, i) => {
          const meta = META[route.name];
          if (!meta) return null;
          const focused = state.index === i;
          const onPress = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          if (route.name === 'rabbit') {
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={meta.label}
                testID="tab-rabbit"
                style={styles.centerSlot}
              >
                <View style={styles.centerBtn}>
                  <LinearGradient colors={[...gradients.aurora]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Ionicons name="walk" size={26} color={colors.ink} />
                </View>
                <Text style={[styles.label, focused && { color: colors.text }]}>{meta.label}</Text>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={meta.label}
              testID={`tab-${route.name}`}
              style={styles.item}
            >
              <Ionicons name={focused ? meta.iconOn : meta.icon} size={22} color={focused ? colors.lime : colors.faint} />
              <Text style={[styles.label, focused && { color: colors.lime }]}>{meta.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: 14 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    width: '100%',
    maxWidth: 520,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(18,21,29,0.94)',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 6,
    paddingBottom: 9,
  },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  label: { color: colors.faint, fontSize: 10, fontWeight: '800' },
  centerSlot: { flex: 1, alignItems: 'center', gap: 3 },
  centerBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.bg,
  },
});
