import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SongCard } from '../../components/SongCard';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Muted, Screen, SectionTitle, Title } from '../../components/ui';
import { api, apiBase, type PlaceSong } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { confirmAction, useToast } from '../../lib/feedback';
import { timeAgo } from '../../lib/format';
import { colors } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

export default function MeTab() {
  const router = useRouter();
  const toast = useToast();
  const { user, rename, logout } = useAuth();
  const me = useAsync(() => api.me(), []);
  const checkins = useAsync(() => api.myCheckins(), []);
  const songs = useAsync(() => api.mySongs(), []);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadAll = async () => {
    await Promise.all([me.reload(), checkins.reload(), songs.reload()]);
  };

  if (!me.data) {
    return me.error ? <ErrorState message={me.error} onRetry={me.reload} /> : <Loading />;
  }
  const { stats } = me.data;

  const save = async () => {
    const next = (name ?? '').trim();
    if (!next || next === user!.nickname) return setName(null);
    setSaving(true);
    try {
      await rename(next);
      setName(null);
      toast.show('昵称已更新');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const patch = (next: PlaceSong) =>
    songs.setData((d) => d && { songs: d.songs.map((s) => (s.id === next.id ? { ...s, ...next } : s)) });
  const drop = (id: string) => songs.setData((d) => d && { songs: d.songs.filter((s) => s.id !== id) });

  return (
    <Screen onRefresh={reloadAll} refreshing={me.loading}>
      <Title>我的</Title>
      <Card>
        {name === null ? (
          <View style={styles.row}>
            <Text style={styles.nick} testID="nickname-display">{user!.nickname}</Text>
            <Button label="改昵称" variant="ghost" small onPress={() => setName(user!.nickname)} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Field label="昵称" value={name} onChangeText={setName} maxLength={20} autoFocus />
            <View style={styles.row}>
              <Button label="保存" small onPress={save} loading={saving} />
              <Button label="取消" variant="ghost" small onPress={() => setName(null)} />
            </View>
          </View>
        )}
        <View style={styles.stats}>
          <Stat n={stats.checkins} label="次打卡" />
          <Stat n={stats.places} label="个地点" />
          <Stat n={stats.songs} label="首分享" />
          <Stat n={stats.likesReceived} label="个赞" />
        </View>
      </Card>

      <SectionTitle>打卡足迹</SectionTitle>
      {!checkins.data ? (
        <Loading />
      ) : checkins.data.checkins.length === 0 ? (
        <Muted>还没有打卡记录。到一个地点附近，打开它的页面就能打卡。</Muted>
      ) : (
        checkins.data.checkins.slice(0, 10).map((c) => (
          <Card key={c.id}>
            <View style={styles.row}>
              <Text style={styles.place} onPress={() => router.push(`/place/${c.placeId}`)}>
                📍 {c.placeName}
              </Text>
              <Muted>{timeAgo(c.createdAt)}</Muted>
            </View>
            {c.note ? <Muted>{c.note}</Muted> : null}
          </Card>
        ))
      )}

      <SectionTitle>我分享的歌</SectionTitle>
      {!songs.data ? (
        <Loading />
      ) : songs.data.songs.length === 0 ? (
        <EmptyState title="还没有分享" message="路过让你觉得很应景的地方，分享一首歌吧。" />
      ) : (
        songs.data.songs.map((s) => (
          <SongCard
            key={s.id}
            item={s}
            userId={user!.id}
            place={{ id: s.placeId, name: s.placeName }}
            onChange={patch}
            onDeleted={drop}
            onPressPlace={() => router.push(`/place/${s.placeId}`)}
          />
        ))
      )}

      <Button
        label="退出（清除本机登录）"
        variant="danger"
        onPress={async () => {
          if (await confirmAction('退出？', '访客账号没有密码，退出后无法找回当前身份和你的足迹。', '退出')) await logout();
        }}
      />
      <Muted>服务器：{apiBase()}</Muted>
    </Screen>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n}</Text>
      <Muted>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  nick: { color: colors.text, fontSize: 22, fontWeight: '800' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  stat: { alignItems: 'center', flex: 1 },
  statN: { color: colors.accent, fontSize: 22, fontWeight: '800' },
  place: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
});
