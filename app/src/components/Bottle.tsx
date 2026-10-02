import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { api, qqMusicUrl, type Bottle } from '../lib/api';
import { useToast } from '../lib/feedback';
import { timeAgo } from '../lib/format';
import type { Coords } from '../lib/location';
import { colors, radius } from '../lib/theme';
import { Artwork } from './Art';
import { Sheet } from './Sheet';
import { Button, Field, Txt } from './ui';

const SERIF = Platform.select({
  web: '"Songti SC","STSong","Noto Serif SC",serif',
  ios: 'Songti SC',
  default: 'serif',
});

/** 一封漂流瓶里的信：米色信纸 + 手写感的字。 */
export function BottleLetter({ bottle }: { bottle: Bottle }) {
  return (
    <View style={styles.letter} testID="bottle-letter">
      <LinearGradient colors={['#FBF1DC', '#F1DDB4']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text style={styles.letterText} testID="bottle-message">
        {bottle.message}
      </Text>
      <View style={styles.letterSong}>
        <Artwork title={bottle.song.title} artist={bottle.song.artist} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={styles.letterTitle}>《{bottle.song.title}》</Text>
          <Text style={styles.letterArtist}>{bottle.song.artist}</Text>
        </View>
      </View>
      <Text style={styles.letterFrom}>
        —— {bottle.from.nickname} · {timeAgo(bottle.createdAt)}留在{bottle.placeName}
      </Text>
    </View>
  );
}

/** 打卡后捡到漂流瓶时弹出。 */
export function BottleReveal({ bottle, onClose }: { bottle: Bottle | null; onClose: () => void }) {
  return (
    <Sheet visible={!!bottle} onClose={onClose} testID="bottle-reveal">
      {bottle ? (
        <>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={styles.bottleIcon}>
              <Ionicons name="mail-open" size={26} color={colors.ink} />
            </View>
            <Txt v="h1" style={{ textAlign: 'center' }}>
              你捡到了一个漂流瓶
            </Txt>
            <Txt v="sub" style={{ textAlign: 'center' }}>
              只有走到这里的人才能打开它
            </Txt>
          </View>
          <BottleLetter bottle={bottle} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="在 QQ 音乐听"
              icon="play"
              onPress={() => void Linking.openURL(qqMusicUrl(bottle.song))}
              style={{ flex: 1 }}
            />
            <Button label="收下" variant="ghost" onPress={onClose} style={{ flex: 1 }} testID="bottle-keep" />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

/** 投一个漂流瓶给下一个经过的人。 */
export function ThrowBottle({
  visible,
  onClose,
  placeId,
  placeName,
  coords,
  onThrown,
}: {
  visible: boolean;
  onClose: () => void;
  placeId: string;
  placeName: string;
  coords: Coords | null;
  onThrown: (b: Bottle) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const help = async () => {
    if (!title.trim() || !artist.trim()) return setError('先填歌名和歌手，AI 才知道写什么');
    setWriting(true);
    setError(null);
    try {
      const r = await api.caption({ placeId, title: title.trim(), artist: artist.trim() });
      setMessage(r.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : '没写出来，再试一次');
    } finally {
      setWriting(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!coords) return setError('需要定位才能投放');
    if (!title.trim() || !artist.trim() || !message.trim()) return setError('歌名、歌手和留言都要写');
    setBusy(true);
    try {
      const { bottle } = await api.throwBottle(placeId, { ...coords, title: title.trim(), artist: artist.trim(), message: message.trim() });
      onThrown(bottle);
      toast.show('漂流瓶已投出，等下一个路过的人');
      setTitle('');
      setArtist('');
      setMessage('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '投放失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="投一个漂流瓶" testID="throw-bottle">
      <Txt v="sub">
        留一首歌和一句话给下一个来到「{placeName}」的陌生人。只有走到这里打卡的人，才能捡到它。
      </Txt>
      <Field label="歌名" value={title} onChangeText={setTitle} placeholder="例如：夏夜晚风" maxLength={120} testID="bottle-title" />
      <Field label="歌手" value={artist} onChangeText={setArtist} placeholder="例如：伍佰" maxLength={120} testID="bottle-artist" />
      <Field
        label="想对 TA 说"
        value={message}
        onChangeText={setMessage}
        placeholder="今天的晚霞很好看，希望你也看到了"
        multiline
        maxLength={200}
        testID="bottle-message-input"
        right={<Button label="帮我写" icon="sparkles" variant="subtle" size="sm" loading={writing} onPress={help} />}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="投进去" icon="paper-plane" size="lg" loading={busy} onPress={submit} testID="bottle-submit" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bottleIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1DDB4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { borderRadius: radius.lg, padding: 20, gap: 16, overflow: 'hidden' },
  letterText: { color: '#3B2A1A', fontSize: 18, lineHeight: 30, fontFamily: SERIF },
  letterSong: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: 'rgba(59,42,26,0.07)',
  },
  letterTitle: { color: '#3B2A1A', fontSize: 15, fontWeight: '800' },
  letterArtist: { color: '#6B5440', fontSize: 12 },
  letterFrom: { color: '#6B5440', fontSize: 13, textAlign: 'right', fontFamily: SERIF },
  error: { color: colors.red, fontSize: 13 },
});
