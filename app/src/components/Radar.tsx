import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Place } from '../lib/api';
import type { Coords } from '../lib/location';
import { colors, kindColor } from '../lib/theme';
import { NATIVE_DRIVER } from './ui';

/**
 * 声景雷达：你在中心，附近的地点按真实方位和距离落在雷达上；
 * 点的大小代表这里留下的歌有多少，颜色是这里最受欢迎那首歌的类型。
 */
export function Radar({
  center,
  places,
  rangeM,
  onPick,
}: {
  center: Coords;
  places: Place[];
  rangeM: number;
  onPick: (p: Place) => void;
}) {
  const [size, setSize] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }),
    );
    const b = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [sweep, pulse]);

  const R = size / 2;
  const mPerDegLat = 111_195;
  const mPerDegLng = 111_195 * Math.cos((center.lat * Math.PI) / 180);
  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 3] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  const label = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} 公里` : `${m} 米`);

  return (
    <View style={styles.box} onLayout={(e) => setSize(Math.min(e.nativeEvent.layout.width, 380))} testID="radar">
      {size > 0 ? (
        <View style={{ width: size, height: size, alignSelf: 'center' }}>
          {[1, 2 / 3, 1 / 3].map((k) => (
            <View
              key={k}
              style={[
                styles.ring,
                { width: size * k, height: size * k, borderRadius: (size * k) / 2, left: R - (size * k) / 2, top: R - (size * k) / 2 },
              ]}
            />
          ))}
          <View style={[styles.axis, { width: size, top: R, left: 0, height: StyleSheet.hairlineWidth }]} />
          <View style={[styles.axis, { height: size, left: R, top: 0, width: StyleSheet.hairlineWidth }]} />
          {[1, 2 / 3, 1 / 3].map((k) => (
            <Text key={`l${k}`} style={[styles.ringLabel, { left: R + 4, top: R - R * k + 2 }]}>
              {label(Math.round(rangeM * k))}
            </Text>
          ))}

          <Animated.View style={[styles.sweepWrap, { width: size, height: size, transform: [{ rotate }] }]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(183,243,107,0)', 'rgba(183,243,107,0.35)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', left: R - R * 0.02, top: R - 1, width: R, height: 2 }}
            />
          </Animated.View>

          {places.map((p) => {
            const dx = (p.lng - center.lng) * mPerDegLng;
            const dy = (p.lat - center.lat) * mPerDegLat;
            const d = Math.hypot(dx, dy);
            const k = Math.min(1, d / rangeM) / (d || 1);
            const x = R + dx * k * R;
            const y = R - dy * k * R;
            const dot = 10 + Math.min(10, p.songCount * 1.4);
            const color = p.topSong ? kindColor[p.topSong.kind as 'vibe'] ?? colors.lime : colors.faint;
            return (
              <Pressable
                key={p.id}
                onPress={() => onPick(p)}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                style={[styles.dotWrap, { left: x - 40, top: y - dot / 2 }]}
                hitSlop={8}
              >
                <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, boxShadow: `0 0 10px ${color}` }]} />
                <Text style={styles.dotLabel} numberOfLines={1}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}

          <Animated.View
            pointerEvents="none"
            style={[styles.me, { left: R - 7, top: R - 7, opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]}
          />
          <View pointerEvents="none" style={[styles.me, styles.meCore, { left: R - 7, top: R - 7 }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', minHeight: 40 },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(183,243,107,0.16)' },
  axis: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.06)' },
  ringLabel: { position: 'absolute', color: colors.faint, fontSize: 9, fontWeight: '700' },
  sweepWrap: { position: 'absolute', left: 0, top: 0 },
  dotWrap: { position: 'absolute', width: 80, alignItems: 'center', gap: 3 },
  dot: { borderWidth: 2, borderColor: colors.bg },
  dotLabel: { color: colors.text, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  me: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: colors.lime },
  meCore: { borderWidth: 3, borderColor: colors.bg },
});
