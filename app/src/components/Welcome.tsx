import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { requestAutoDemo } from '../lib/demo';
import { colors, gradients } from '../lib/theme';
import { Vinyl } from './Art';
import { Button, Field, Txt } from './ui';

const FEATURES = [
  { k: '共鸣', v: '听出身边的节奏和音高，歌跟上脚步、落在街的调上' },
  { k: '此地记忆', v: '听见前人在这里留下的歌和现场，也留一个漂流瓶' },
];

export function Welcome() {
  const { register } = useAuth();
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 先听一听：用「路过的人」直接进来，跳到共鸣页自动开始模拟街头 */
  const tryDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      requestAutoDemo();
      await register(nickname.trim() || '路过的人');
    } catch (err) {
      setError(err instanceof Error ? err.message : '进入失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const name = nickname.trim();
    if (!name) return setError('先给自己起个昵称吧');
    setBusy(true);
    setError(null);
    try {
      await register(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : '进入失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
      <LinearGradient
        colors={['rgba(183,243,107,0.22)', 'rgba(62,230,193,0.08)', 'rgba(7,8,12,0)']}
        locations={[0, 0.4, 0.8]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.box}>
        <Vinyl title="此地有歌" artist="MusicHere" size={150} />
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={styles.brand}>此地有歌</Text>
          <Text style={styles.en}>MUSICHERE</Text>
        </View>
        <Text style={styles.slogan}>让世界为你的歌伴奏</Text>
        <View style={{ alignSelf: 'stretch', gap: 8 }}>
          <Button label="30 秒听见共鸣" icon="pulse" variant="aurora" size="lg" onPress={tryDemo} loading={busy} testID="try-demo" />
          <Txt v="caption" style={{ textAlign: 'center' }}>
            戴上耳机 · 不用麦克风、不用定位、不用注册
          </Txt>
        </View>
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.k} style={styles.feature}>
              <LinearGradient colors={[...gradients.brand]} style={styles.dot} />
              <Text style={styles.fk}>{f.k}</Text>
              <Text style={styles.fv}>{f.v}</Text>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: 'stretch', gap: 12, marginTop: 8 }}>
          <Field
            label="你的昵称"
            value={nickname}
            onChangeText={setNickname}
            placeholder="例如：路过的人"
            maxLength={20}
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="nickname"
          />
          {error ? (
            <Text style={styles.error} testID="welcome-error">
              {error}
            </Text>
          ) : null}
          <Button label="开始听" icon="arrow-forward" variant="subtle" size="lg" onPress={submit} loading={busy} testID="start" />
          <Txt v="caption" style={{ textAlign: 'center' }}>
            进入完整版：此地记忆、漂流瓶、AI 读懂此刻。无需注册，昵称只用于展示
          </Txt>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  box: { alignItems: 'center', gap: 16, maxWidth: 420, width: '100%', alignSelf: 'center' },
  brand: { color: colors.text, fontSize: 40, fontWeight: '900', letterSpacing: 2 },
  en: { color: colors.faint, fontSize: 12, fontWeight: '900', letterSpacing: 6 },
  slogan: { color: colors.lime, fontSize: 16, fontWeight: '800' },
  features: { alignSelf: 'stretch', gap: 10, marginTop: 4 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  fk: { color: colors.text, fontSize: 14, fontWeight: '900', width: 64 },
  fv: { color: colors.sub, fontSize: 13, flex: 1 },
  error: { color: colors.red, fontSize: 13 },
});
