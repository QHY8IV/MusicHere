import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { imageUri, type Place } from '../lib/api';

/** 没有图片时的兜底渐变，按地点 id 固定挑一组，同一个地点每次看到的颜色一致。 */
const FALLBACKS: [string, string][] = [
  ['#3b2a78', '#c2467a'],
  ['#14506b', '#3fa796'],
  ['#5a2d57', '#e0765b'],
  ['#1f3a72', '#6a7be8'],
  ['#3d4a1f', '#c9a443'],
  ['#4a1f3d', '#8b5bd6'],
];

export function fallbackColors(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACKS[h % FALLBACKS.length]!;
}

/**
 * 地点封面：有图用图，没图或加载失败用渐变；上面再叠一层从透明到深色的渐变，保证文字可读。
 * children 贴底部显示（通常是地点名和标签）。
 */
export function PlaceCover({
  place,
  height,
  children,
  topRight,
  style,
}: {
  place: Pick<Place, 'id' | 'imageUrl'>;
  height: number;
  children?: ReactNode;
  /** 右上角的浮动内容（如“更换封面”按钮） */
  topRight?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const uri = imageUri(place.imageUrl);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!uri && failed !== uri;
  const [c1, c2] = fallbackColors(place.id);

  return (
    <View style={[styles.box, { height }, style]} testID="place-cover">
      {showImage ? (
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={() => setFailed(uri)}
          testID="place-cover-image"
        />
      ) : (
        <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      )}
      <LinearGradient
        colors={['rgba(14,15,31,0.05)', 'rgba(14,15,31,0.35)', 'rgba(14,15,31,0.92)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {topRight ? <View style={styles.topRight}>{topRight}</View> : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', overflow: 'hidden', justifyContent: 'flex-end', backgroundColor: '#1A1B33' },
  content: { padding: 14, gap: 6 },
  topRight: { position: 'absolute', top: 10, right: 10 },
});
