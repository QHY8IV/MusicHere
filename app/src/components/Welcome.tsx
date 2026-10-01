import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import { Button, Field, Muted } from './ui';

export function Welcome() {
  const { register } = useAuth();
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const name = nickname.trim();
    if (!name) {
      setError('先给自己起个昵称吧');
      return;
    }
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
      <View style={styles.box}>
        <Ionicons name="musical-notes" size={56} color={colors.accent} />
        <Text style={styles.brand}>MusicHere</Text>
        <Text style={styles.slogan}>每个地方，都有它的背景音乐</Text>
        <Muted style={{ textAlign: 'center' }}>
          留下让你觉得“就是这里”的那首歌，也听听别人在这里听过什么。
        </Muted>
        <View style={{ alignSelf: 'stretch', gap: 12, marginTop: 16 }}>
          <Field
            label="你的昵称"
            value={nickname}
            onChangeText={setNickname}
            placeholder="例如：路过的人"
            maxLength={20}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={submit}
            testID="nickname"
          />
          {error ? <Text style={styles.error} testID="welcome-error">{error}</Text> : null}
          <Button label="开始" icon="arrow-forward" onPress={submit} loading={busy} testID="start" />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  box: { alignItems: 'center', gap: 10, maxWidth: 420, width: '100%', alignSelf: 'center' },
  brand: { color: colors.text, fontSize: 34, fontWeight: '900' },
  slogan: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  error: { color: colors.red, fontSize: 13 },
});
