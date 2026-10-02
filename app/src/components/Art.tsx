import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { artPalette } from '../lib/theme';
import { NATIVE_DRIVER } from './ui';

/** 首字：中文取第一个字，英文取首字母。 */
const glyph = (title: string) => {
  const t = title.trim();
  const ch = [...t][0] ?? '♪';
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
};

/**
 * 歌曲封面：按「歌名 + 歌手」生成的渐变封面（同一首歌永远同一张）。
 * 接入平台曲库后可换成真实专辑图。
 */
export function Artwork({
  title,
  artist,
  size = 52,
  rounded,
  style,
}: {
  title: string;
  artist: string;
  size?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const [a, b, c] = artPalette(`${title}|${artist}`);
  const r = rounded ?? Math.round(size * 0.22);
  return (
    <View style={[{ width: size, height: size, borderRadius: r, overflow: 'hidden' }, style]}>
      <LinearGradient colors={[a, b, c]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View
        style={[
          styles.ring,
          { width: size * 1.2, height: size * 1.2, borderRadius: size * 0.6, right: -size * 0.45, bottom: -size * 0.45, borderWidth: Math.max(1, size * 0.03) },
        ]}
      />
      <View
        style={[
          styles.ring,
          { width: size * 0.8, height: size * 0.8, borderRadius: size * 0.4, right: -size * 0.25, bottom: -size * 0.25, borderWidth: Math.max(1, size * 0.03) },
        ]}
      />
      <Text style={[styles.glyph, { fontSize: size * 0.4, lineHeight: size * 0.5, left: size * 0.12, top: size * 0.1 }]}>
        {glyph(title)}
      </Text>
    </View>
  );
}

/** 黑胶唱片：中间贴着歌曲封面，播放态下缓慢旋转。 */
export function Vinyl({
  title,
  artist,
  size = 200,
  spinning = true,
}: {
  title: string;
  artist: string;
  size?: number;
  spinning?: boolean;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, spinning]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const label = size * 0.4;
  return (
    <Animated.View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, transform: [{ rotate }] }]}>
      {[0.94, 0.82, 0.7, 0.58].map((k) => (
        <View
          key={k}
          style={[styles.groove, { width: size * k, height: size * k, borderRadius: (size * k) / 2 }]}
        />
      ))}
      <LinearGradient
        colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']}
        locations={[0, 0.3, 0.62, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
      />
      <Artwork title={title} artist={artist} size={label} rounded={label / 2} />
      <View style={[styles.hole, { width: size * 0.05, height: size * 0.05, borderRadius: size * 0.025 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderColor: 'rgba(255,255,255,0.28)' },
  glyph: { position: 'absolute', color: 'rgba(255,255,255,0.92)', fontWeight: '900' },
  disc: {
    backgroundColor: '#060608',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  groove: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  hole: { position: 'absolute', backgroundColor: '#060608' },
});
