import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type Comment } from '../lib/api';
import { confirmAction, useToast } from '../lib/feedback';
import { timeAgo } from '../lib/format';
import { artPalette, colors, moodColor, radius } from '../lib/theme';
import { MoodChip } from './ui';

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const [a, b] = artPalette(name);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.42 }}>{[...name][0] ?? '?'}</Text>
    </View>
  );
}

export function CommentItem({
  comment,
  userId,
  onChange,
  onDeleted,
}: {
  comment: Comment;
  userId: string;
  onChange: (c: Comment) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const like = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onChange((await api.likeComment(comment.id, !comment.likedByMe)).comment);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmAction('删除评论？', '删除后无法恢复。', '删除'))) return;
    try {
      await api.deleteComment(comment.id);
      onDeleted(comment.id);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  const accent = comment.mood ? moodColor[comment.mood] : undefined;
  return (
    <View style={[styles.card, accent ? { borderLeftColor: accent } : null]}>
      <View style={styles.head}>
        <Avatar name={comment.author.nickname} />
        <View style={{ flex: 1 }}>
          <Text style={styles.author}>{comment.author.nickname}</Text>
          <Text style={styles.time}>{timeAgo(comment.createdAt)}</Text>
        </View>
        {comment.mood ? <MoodChip mood={comment.mood} size="sm" /> : null}
      </View>
      <Text style={styles.body} testID="comment-body">
        {comment.body}
      </Text>
      {comment.song ? (
        <View style={styles.song}>
          <Ionicons name="musical-note" size={12} color={colors.mint} />
          <Text style={styles.songText}>
            《{comment.song.title}》 · {comment.song.artist}
          </Text>
        </View>
      ) : null}
      <View style={styles.foot}>
        <Pressable onPress={like} style={styles.like} accessibilityRole="button" testID="comment-like">
          <Ionicons name={comment.likedByMe ? 'heart' : 'heart-outline'} size={16} color={comment.likedByMe ? colors.pink : colors.sub} />
          <Text style={[styles.likeText, comment.likedByMe && { color: colors.pink }]}>{comment.likes}</Text>
        </Pressable>
        {comment.author.id === userId ? (
          <Pressable onPress={remove} hitSlop={8} accessibilityLabel="删除评论">
            <Ionicons name="trash-outline" size={16} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderLeftColor: colors.lineStrong,
    padding: 14,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  author: { color: colors.text, fontWeight: '800', fontSize: 14 },
  time: { color: colors.faint, fontSize: 11, marginTop: 1 },
  body: { color: colors.text, fontSize: 15, lineHeight: 23 },
  song: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  songText: { color: colors.mint, fontSize: 12, fontWeight: '700' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  like: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  likeText: { color: colors.sub, fontSize: 12, fontWeight: '700' },
});
