import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottleLetter } from '../../components/Bottle';
import { Avatar } from '../../components/CommentItem';
import { SongRow } from '../../components/SongRow';
import { Button, Card, EmptyState, ErrorState, Field, Loading, Pill, Screen, Segmented, Txt } from '../../components/ui';
import { api, apiBase, type PlaceSong } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { confirmAction, useToast } from '../../lib/feedback';
import { timeAgo } from '../../lib/format';
import { colors, radius } from '../../lib/theme';
import { useAsync } from '../../lib/useAsync';

type Tab = 'trail' | 'bottles' | 'songs';

export default function MeTab() {
  const router = useRouter();
  const toast = useToast();
  const { user, rename, logout } = useAuth();
  const me = useAsync(() => api.me(), []);
  const checkins = useAsync(() => api.myCheckins(), []);
  const songs = useAsync(() => api.mySongs(), []);
  const bottles = useAsync(() => api.myBottles(), []);
  const engine = useAsync(() => api.aiStatus(), []);
  const [tab, setTab] = useState<Tab>('trail');
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadAll = async () => {
    await Promise.all([me.reload(), checkins.reload(), songs.reload(), bottles.reload()]);
  };

  if (!me.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        {me.error ? <ErrorState message={me.error} onRetry={me.reload} /> : <Loading />}
      </View>
    );
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

  const patch = (next: PlaceSong) => songs.setData((d) => d && { songs: d.songs.map((s) => (s.id === next.id ? { ...s, ...next } : s)) });
  const drop = (id: string) => songs.setData((d) => d && { songs: d.songs.filter((s) => s.id !== id) });

  return (
    <Screen onRefresh={reloadAll} refreshing={me.loading} glow={colors.sky}>
      <View style={styles.profile}>
        <Avatar name={user!.nickname} size={72} />
        {name === null ? (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={styles.nick} testID="nickname-display">
              {user!.nickname}
            </Text>
            <Pressable onPress={() => setName(user!.nickname)} hitSlop={8}>
              <Text style={styles.edit}>修改昵称</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ alignSelf: 'stretch', gap: 10 }}>
            <Field label="昵称" value={name} onChangeText={setName} maxLength={20} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="保存" size="sm" onPress={save} loading={saving} style={{ flex: 1 }} />
              <Button label="取消" variant="ghost" size="sm" onPress={() => setName(null)} style={{ flex: 1 }} />
            </View>
          </View>
        )}
      </View>

      <View style={styles.stats}>
        <Stat n={stats.checkins} label="次打卡" />
        <Stat n={stats.places} label="个地点" />
        <Stat n={stats.songs} label="首分享" />
        <Stat n={stats.likesReceived} label="个赞" />
      </View>

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { key: 'trail', label: '足迹', count: checkins.data?.checkins.length, testID: 'me-trail' },
          { key: 'bottles', label: '漂流瓶', count: (bottles.data?.thrown.length ?? 0) + (bottles.data?.picked.length ?? 0), testID: 'me-bottles' },
          { key: 'songs', label: '我的分享', count: songs.data?.songs.length, testID: 'me-songs' },
        ]}
      />

      {tab === 'trail' ? (
        !checkins.data ? (
          <Loading />
        ) : checkins.data.checkins.length === 0 ? (
          <EmptyState icon="footsteps-outline" title="还没有足迹" message="走到一个地点附近，打开它的页面就能打卡。" />
        ) : (
          <View style={styles.timeline}>
            {checkins.data.checkins.slice(0, 20).map((c, i, all) => (
              <Pressable key={c.id} onPress={() => router.push(`/place/${c.placeId}`)} style={styles.tlRow}>
                <View style={styles.tlRail}>
                  <View style={styles.tlDot} />
                  {i < all.length - 1 ? <View style={styles.tlLine} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: 18 }}>
                  <Text style={styles.tlPlace}>{c.placeName}</Text>
                  <Text style={styles.tlTime}>{timeAgo(c.createdAt)}</Text>
                  {c.note ? <Txt v="sub">{c.note}</Txt> : null}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.faint} />
              </Pressable>
            ))}
          </View>
        )
      ) : tab === 'bottles' ? (
        !bottles.data ? (
          <Loading />
        ) : bottles.data.thrown.length + bottles.data.picked.length === 0 ? (
          <EmptyState icon="mail-outline" title="还没有漂流瓶" message="在一个地点现场投一个，留给下一个路过的人；或者打卡时捡一个。" />
        ) : (
          <View style={{ gap: 14 }}>
            {bottles.data.picked.length > 0 ? <Txt v="title">我捡到的</Txt> : null}
            {bottles.data.picked.map((b) => (
              <BottleLetter key={b.id} bottle={b} />
            ))}
            {bottles.data.thrown.length > 0 ? <Txt v="title">我投出的</Txt> : null}
            {bottles.data.thrown.map((b) => (
              <Card key={b.id} style={{ gap: 8 }} testID="thrown-bottle">
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={styles.bottlePlace}>{b.placeName}</Text>
                  {b.picked ? (
                    <Pill label={`已被 ${b.picked.by.nickname} 捡起`} icon="mail-open" color={colors.lime} />
                  ) : (
                    <Pill label="漂流中…" icon="water" color={colors.sky} />
                  )}
                </View>
                <Txt v="sub">“{b.message}”</Txt>
                <Txt v="caption">
                  《{b.song.title}》{b.song.artist} · {timeAgo(b.createdAt)}投出
                  {b.picked ? ` · ${timeAgo(b.picked.at)}被捡起` : ''}
                </Txt>
              </Card>
            ))}
          </View>
        )
      ) : !songs.data ? (
        <Loading />
      ) : songs.data.songs.length === 0 ? (
        <EmptyState title="还没有分享" message="路过让你觉得很应景的地方，分享一首歌吧。" />
      ) : (
        <View>
          {songs.data.songs.map((s) => (
            <SongRow
              key={s.id}
              item={s}
              userId={user!.id}
              place={{ id: s.placeId, name: s.placeName }}
              onChange={patch}
              onDeleted={drop}
              onPressPlace={() => router.push(`/place/${s.placeId}`)}
            />
          ))}
        </View>
      )}

      <Card style={{ gap: 10 }}>
        <View style={styles.infoRow}>
          <Ionicons name="sparkles" size={14} color={colors.violet} />
          <Txt v="sub" style={{ flex: 1 }}>
            AI 引擎：{engine.data ? (engine.data.engine.kind === 'llm' ? engine.data.engine.label : '本地规则引擎（未接入大模型）') : '…'}
          </Txt>
        </View>
        <View style={styles.infoRow}>
          <Ionicons name="server-outline" size={14} color={colors.faint} />
          <Txt v="caption" style={{ flex: 1 }}>
            服务器：{apiBase()}
          </Txt>
        </View>
        <Button
          label="退出（清除本机登录）"
          variant="danger"
          size="sm"
          onPress={async () => {
            if (await confirmAction('退出？', '访客账号没有密码，退出后无法找回当前身份和你的足迹。', '退出')) await logout();
          }}
        />
      </Card>
    </Screen>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: { alignItems: 'center', gap: 12, paddingTop: 8 },
  nick: { color: colors.text, fontSize: 26, fontWeight: '900' },
  edit: { color: colors.sub, fontSize: 12, fontWeight: '700' },
  stats: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 16,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statN: { color: colors.lime, fontSize: 24, fontWeight: '900' },
  statL: { color: colors.sub, fontSize: 12 },
  timeline: { paddingLeft: 4 },
  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 14, alignItems: 'center' },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.lime, marginTop: 5 },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.line, marginTop: 4 },
  tlPlace: { color: colors.text, fontSize: 15, fontWeight: '800' },
  tlTime: { color: colors.faint, fontSize: 12, marginTop: 2 },
  bottlePlace: { color: colors.text, fontSize: 15, fontWeight: '800' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
