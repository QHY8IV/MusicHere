import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font, gradients, kindColor, moodColor, radius, space } from '../lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const NATIVE_DRIVER = Platform.OS !== 'web';

// ---------- 版式 ----------

export function Txt({
  v = 'body',
  style,
  children,
  numberOfLines,
  testID,
}: {
  v?: keyof typeof font;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  testID?: string;
}) {
  return (
    <Text style={[font[v], style]} numberOfLines={numberOfLines} testID={testID}>
      {children}
    </Text>
  );
}

/**
 * 页面容器：顶部一层淡淡的彩色光晕，内容避开刘海和底部悬浮 Tab 栏。
 * glow 传颜色可以让不同页面有各自的氛围（AI 页是紫色，首页是青柠）。
 */
export function Screen({
  children,
  onRefresh,
  refreshing = false,
  glow = colors.lime,
  contentStyle,
  topInset = true,
  bottomPad = 140,
  testID,
}: {
  testID?: string;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  glow?: string;
  contentStyle?: StyleProp<ViewStyle>;
  topInset?: boolean;
  bottomPad?: number;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen} testID={testID}>
      <LinearGradient
        colors={[`${glow}26`, `${glow}08`, 'transparent']}
        locations={[0, 0.45, 1]}
        style={styles.glow}
        pointerEvents="none"
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingTop: (topInset ? insets.top : 0) + space.lg, paddingBottom: bottomPad + insets.bottom },
          contentStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.lime} /> : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({
  children,
  style,
  padded = true,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  testID?: string;
}) {
  return (
    <View style={[styles.card, padded && { padding: space.lg }, style]} testID={testID}>
      {children}
    </View>
  );
}

export function SectionHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="h2">{title}</Txt>
        {subtitle ? <Txt v="sub">{subtitle}</Txt> : null}
      </View>
      {right}
    </View>
  );
}

// ---------- 按钮 ----------

type ButtonVariant = 'primary' | 'aurora' | 'ghost' | 'subtle' | 'danger';

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const filled = variant === 'primary' || variant === 'aurora';
  const fg = filled ? colors.ink : variant === 'danger' ? colors.red : colors.text;
  const h = size === 'lg' ? 54 : size === 'md' ? 46 : 36;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      aria-disabled={off}
      disabled={off}
      accessibilityLabel={label}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        { height: h, paddingHorizontal: size === 'sm' ? 14 : 20 },
        variant === 'ghost' && styles.btnGhost,
        variant === 'subtle' && styles.btnSubtle,
        variant === 'danger' && styles.btnDanger,
        off && { opacity: 0.4 },
        pressed && !off && { transform: [{ scale: 0.97 }] },
        style,
      ]}
    >
      {filled ? (
        <LinearGradient
          colors={variant === 'aurora' ? [...gradients.aurora] : [...gradients.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 15 : 18} color={fg} />
      ) : null}
      <Text style={[styles.btnText, { color: fg, fontSize: size === 'sm' ? 13 : 15 }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  active = false,
  color = colors.text,
  size = 40,
  testID,
  badge,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  active?: boolean;
  color?: string;
  size?: number;
  testID?: string;
  badge?: string | number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconBtn,
        { width: size, height: size, borderRadius: size / 2 },
        active && { backgroundColor: `${color}26`, borderColor: `${color}66` },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.45} color={active ? color : colors.text} />
      {badge !== undefined ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ---------- 标签 ----------

export function Chip({
  label,
  selected,
  onPress,
  icon,
  color = colors.lime,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
  color?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && { borderColor: color, backgroundColor: `${color}1F` }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? color : colors.sub} /> : null}
      <Text style={[styles.chipText, selected && { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Pill({
  label,
  icon,
  color = colors.sub,
  solid = false,
  testID,
}: {
  label: string;
  icon?: IconName;
  color?: string;
  solid?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[styles.pill, solid ? { backgroundColor: color, borderColor: color } : { borderColor: `${color}66`, backgroundColor: `${color}14` }]}
    >
      {icon ? <Ionicons name={icon} size={11} color={solid ? colors.ink : color} /> : null}
      <Text style={[styles.pillText, { color: solid ? colors.ink : color }]}>{label}</Text>
    </View>
  );
}

export function MoodChip({ mood, size = 'md' }: { mood: string; size?: 'sm' | 'md' }) {
  const c = moodColor[mood] ?? colors.sub;
  return (
    <View style={[styles.mood, size === 'sm' && { paddingHorizontal: 7, paddingVertical: 2 }, { backgroundColor: `${c}1F`, borderColor: `${c}55` }]}>
      <View style={[styles.moodDot, { backgroundColor: c }]} />
      <Text style={[styles.moodText, size === 'sm' && { fontSize: 11 }, { color: c }]}>{mood}</Text>
    </View>
  );
}

const KIND_META = {
  vibe: { label: '应景', icon: 'sparkles' as IconName },
  frequent: { label: '常听', icon: 'headset' as IconName },
  live: { label: '现场', icon: 'mic' as IconName },
};

export function KindBadge({ kind }: { kind: 'vibe' | 'frequent' | 'live' }) {
  const m = KIND_META[kind];
  return <Pill label={m.label} icon={m.icon} color={kindColor[kind]} />;
}

/** 「AI 在工作」的标识：极光色小标签。 */
export function AIBadge({ label = 'AI', testID }: { label?: string; testID?: string }) {
  return (
    <View style={styles.aiBadge} testID={testID}>
      <LinearGradient colors={[...gradients.aurora]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <Ionicons name="sparkles" size={11} color={colors.ink} />
      <Text style={styles.aiBadgeText}>{label}</Text>
    </View>
  );
}

// ---------- 表单 ----------

export function Field({ label, hint, right, ...props }: TextInputProps & { label: string; hint?: string; right?: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.fieldHead}>
        <Text style={font.label}>{label}</Text>
        {right}
      </View>
      <TextInput
        placeholderTextColor={colors.faint}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 84, textAlignVertical: 'top', paddingTop: 12 }, props.style]}
      />
      {hint ? <Txt v="caption">{hint}</Txt> : null}
    </View>
  );
}

export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; count?: number; color?: string; testID?: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={o.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.segItem, on && { backgroundColor: colors.surface3 }]}
          >
            <Text style={[styles.segText, on && { color: o.color ?? colors.text }]}>{o.label}</Text>
            {o.count !== undefined ? <Text style={[styles.segCount, on && { color: o.color ?? colors.sub }]}>{o.count}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- 状态 ----------

/** 加载中：一张缓慢旋转的唱片。 */
export function Loading({ label }: { label?: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.center}>
      <Animated.View style={[styles.miniDisc, { transform: [{ rotate }] }]}>
        <View style={styles.miniGroove} />
        <LinearGradient colors={[...gradients.brand]} style={styles.miniLabel} />
      </Animated.View>
      {label ? <Txt v="sub">{label}</Txt> : null}
    </View>
  );
}

export function EmptyState({
  icon = 'musical-notes-outline',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.center}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.sub} />
      </View>
      <Txt v="title" style={{ textAlign: 'center' }}>{title}</Txt>
      {message ? <Txt v="sub" style={{ textAlign: 'center', maxWidth: 320 }}>{message}</Txt> : null}
      {action ? <View style={{ gap: 10, alignItems: 'center', marginTop: 4 }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="出了点问题"
      message={message}
      action={onRetry ? <Button label="重试" icon="refresh" variant="ghost" size="sm" onPress={onRetry} /> : undefined}
    />
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  content: { paddingHorizontal: 18, gap: space.xl, maxWidth: 720, width: '100%', alignSelf: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    gap: space.md,
    overflow: 'hidden',
  },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  btnGhost: { borderWidth: 1, borderColor: colors.lineStrong },
  btnSubtle: { backgroundColor: colors.surface2 },
  btnDanger: { borderWidth: 1, borderColor: `${colors.red}66` },
  btnText: { fontWeight: '800', letterSpacing: 0.2 },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.ink, fontSize: 10, fontWeight: '900' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface2,
  },
  chipText: { color: colors.sub, fontSize: 13, fontWeight: '700' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { fontSize: 11, fontWeight: '800' },
  mood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  moodDot: { width: 6, height: 6, borderRadius: 3 },
  moodText: { fontSize: 12, fontWeight: '800' },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  aiBadgeText: { color: colors.ink, fontSize: 11, fontWeight: '900' },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  seg: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 4,
    gap: 2,
  },
  segItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: radius.pill,
  },
  segText: { color: colors.sub, fontSize: 13, fontWeight: '800' },
  segCount: { color: colors.faint, fontSize: 11, fontWeight: '800' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 24 },
  miniDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#050508',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  miniGroove: { position: 'absolute', width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  miniLabel: { width: 14, height: 14, borderRadius: 7 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
});
