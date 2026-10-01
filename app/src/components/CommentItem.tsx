import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type Comment } from '../lib/api';
import { confirmAction, useToast } from '../lib/feedback';
import { timeAgo } from '../lib/format';
import { colors } from '../lib/theme';
import { Card, Pill } from './ui';

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

  return (
    <Card>
      <View style={styles.head}>
        <Text style={styles.author}>{comment.author.nickname}</Text>
        {comment.mood ? <Pill label={comment.mood} tone="accent" /> : null}
        <Text style={styles.time}>{timeAgo(comment.createdAt)}</Text>
      </View>
      <Text style={styles.body} testID="comment-body">{comment.body}</Text>
      {comment.song ? (
        <Text style={styles.song}>♪ 《{comment.song.title}》 · {comment.song.artist}</Text>
      ) : null}
      <View style={styles.foot}>
        <Pressable onPress={like} style={styles.like} accessibilityRole="button" testID="comment-like">
          <Ionicons
            name={comment.likedByMe ? 'heart' : 'heart-outline'}
            size={18}
            color={comment.likedByMe ? colors.red : colors.sub}
          />
          <Text style={[styles.likeText, comment.likedByMe && { color: colors.red }]}>{comment.likes}</Text>
        </Pressable>
        {comment.author.id === userId ? (
          <Pressable onPress={remove} hitSlop={8} accessibilityLabel="删除评论">
            <Ionicons name="trash-outline" size={17} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { color: colors.text, fontWeight: '700', fontSize: 14 },
  time: { color: colors.faint, fontSize: 12, marginLeft: 'auto' },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  song: { color: colors.violet, fontSize: 13, fontWeight: '600' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  like: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeText: { color: colors.sub, fontSize: 13, fontWeight: '600' },
});
