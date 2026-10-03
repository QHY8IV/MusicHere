import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type QuizBoard, type Quiz, type QuizAnswer, type QuizResult } from '../lib/api';
import { colors, radius } from '../lib/theme';
import { PlaceRecord } from './Art';
import { AIBadge, Button, Card, ErrorState, Loading, NATIVE_DRIVER, Pill, Txt } from './ui';

/**
 * 「此地知音」：用这个地点真实留下的歌和故事出 5 道题。
 * 入口卡片放在地点页，游戏本身是一个全屏弹层：出题 → 逐题作答揭晓 → 结算 + 知音榜。
 */

const FAST_MS = 15_000;
const LETTERS = ['A', 'B', 'C', 'D'];

const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`);

export function QuizCard({
  placeName,
  board,
  inRange,
  onStart,
}: {
  placeName: string;
  board: QuizBoard | null;
  inRange: boolean;
  onStart: () => void;
}) {
  const top = board?.board.slice(0, 3) ?? [];
  return (
    <View style={styles.card} testID="quiz-card">
      <LinearGradient
        colors={['rgba(160,139,255,0.30)', 'rgba(92,200,255,0.12)', 'rgba(62,230,193,0.06)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.cardHead}>
        <View style={styles.cardIcon}>
          <Ionicons name="game-controller" size={20} color={colors.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.cardTitle}>此地知音</Text>
            <AIBadge label="AI 出谜" />
          </View>
          <Txt v="sub">5 道题，全部来自这里真实留下的歌和故事。你有多懂{placeName}？</Txt>
        </View>
      </View>

      {top.length > 0 ? (
        <View style={{ gap: 8 }}>
          {top.map((e) => (
            <View key={e.user.id} style={styles.miniRow}>
              <Text style={styles.medal}>{medal(e.rank)}</Text>
              <Text style={styles.miniName} numberOfLines={1}>
                {e.user.nickname}
              </Text>
              <Text style={styles.miniTitle}>{e.title}</Text>
              <Text style={styles.miniScore}>{e.score}</Text>
            </View>
          ))}
          <Txt v="caption">
            {board!.players} 人挑战过{board?.me ? ` · 你的最好成绩 ${board.me.score} 分，第 ${board.me.rank} 名` : ''}
          </Txt>
        </View>
      ) : (
        <Txt v="sub">还没有人挑战过，来当这里的第一位知音。</Txt>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Button label="开始挑战" icon="play" variant="aurora" onPress={onStart} style={{ flex: 1 }} testID="quiz-start" />
        {inRange ? <Pill label="在现场 ×1.2" icon="location" color={colors.lime} /> : null}
      </View>
    </View>
  );
}

type Phase = 'loading' | 'play' | 'result' | 'error';

export function QuizGame({
  visible,
  placeId,
  coords,
  onClose,
  onFinished,
}: {
  visible: boolean;
  placeId: string;
  coords: { lat: number; lng: number } | null;
  onClose: () => void;
  onFinished: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [reveal, setReveal] = useState<QuizAnswer | null>(null);
  const [history, setHistory] = useState<boolean[]>([]);
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [board, setBoard] = useState<QuizBoard | null>(null);
  const timer = useRef(new Animated.Value(1)).current;
  const scroller = useRef<ScrollView>(null);
  const pop = useRef(new Animated.Value(0)).current;

  const start = useCallback(async () => {
    setPhase('loading');
    setQuiz(null);
    setIdx(0);
    setPicked(null);
    setReveal(null);
    setHistory([]);
    setScore(0);
    setResult(null);
    setBoard(null);
    try {
      const { quiz } = await api.startQuiz(placeId, coords ?? undefined);
      setQuiz(quiz);
      setPhase('play');
    } catch (err) {
      setError(err instanceof Error ? err.message : '出题失败');
      setPhase('error');
    }
  }, [placeId, coords]);

  useEffect(() => {
    if (visible) void start();
    // 只在打开时开一局；坐标变化不重开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 每题的倒计时条（只是提示速度奖励，时间到了也能答）
  useEffect(() => {
    if (phase !== 'play' || reveal) return;
    timer.setValue(1);
    const anim = Animated.timing(timer, { toValue: 0, duration: FAST_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER });
    anim.start();
    return () => anim.stop();
  }, [phase, idx, reveal, timer]);

  const choose = async (choice: number) => {
    if (!quiz || picked !== null) return;
    setPicked(choice);
    try {
      const res = await api.answerQuiz(quiz.id, idx, choice);
      setReveal(res);
      setHistory((h) => [...h, res.correct]);
      setScore(res.score);
      pop.setValue(0);
      Animated.spring(pop, { toValue: 1, useNativeDriver: NATIVE_DRIVER, friction: 5 }).start();
      // 让揭晓卡片和「下一题」露出来
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80);
      if (res.finished) setResult(res.result);
    } catch (err) {
      setPicked(null);
      setError(err instanceof Error ? err.message : '提交失败');
    }
  };

  const next = async () => {
    if (!quiz) return;
    if (result) {
      setPhase('result');
      onFinished();
      try {
        setBoard(await api.quizBoard(placeId));
      } catch {
        // 榜单加载失败不影响结算
      }
      return;
    }
    setIdx((i) => i + 1);
    setPicked(null);
    setReveal(null);
    scroller.current?.scrollTo({ y: 0, animated: false });
  };

  const round = quiz?.rounds[idx];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]} testID="quiz-game">
        <LinearGradient
          colors={['rgba(160,139,255,0.28)', 'rgba(92,200,255,0.08)', 'rgba(7,8,12,0)']}
          style={styles.glow}
          pointerEvents="none"
        />
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="关闭" style={styles.close} testID="quiz-close">
            <Ionicons name="close" size={20} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headTitle}>此地知音</Text>
            {quiz ? (
              <Text style={styles.headSub} numberOfLines={1}>
                {quiz.placeName}
                {quiz.onSite ? ' · 现场 ×1.2' : ''}
              </Text>
            ) : null}
          </View>
          <View style={styles.scorePill}>
            <Ionicons name="star" size={13} color={colors.ink} />
            <Text style={styles.scoreText} testID="quiz-score">
              {score}
            </Text>
          </View>
        </View>

        {phase === 'loading' ? (
          <View style={styles.center}>
            <Loading label="AI 正在用这里的歌出题…" />
          </View>
        ) : phase === 'error' ? (
          <View style={styles.center}>
            <ErrorState message={error} onRetry={start} />
          </View>
        ) : phase === 'result' && result && quiz ? (
          <Result result={result} board={board} placeName={quiz.placeName} onAgain={start} onDone={onClose} />
        ) : quiz && round ? (
          <ScrollView ref={scroller} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <View style={styles.dots}>
              {quiz.rounds.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i < history.length && { backgroundColor: history[i] ? colors.lime : colors.red },
                    i === idx && !reveal && { backgroundColor: colors.text },
                  ]}
                />
              ))}
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.roundNo}>
                第 {idx + 1} / {quiz.rounds.length} 题
              </Text>
              {round.type === 'emoji' ? <AIBadge label={quiz.engine.kind === 'llm' ? `${quiz.engine.label}出谜` : 'AI 出谜'} /> : null}
            </View>

            <View style={styles.timerTrack}>
              <Animated.View
                style={[
                  styles.timerFill,
                  reveal && { opacity: 0.25 },
                  { transform: [{ scaleX: timer }] },
                ]}
              />
            </View>

            <Text style={styles.prompt} testID="quiz-prompt">
              {round.prompt}
            </Text>
            {round.clue ? (
              <View style={styles.clue} testID="quiz-clue">
                <Text style={styles.clueText}>{round.clue}</Text>
              </View>
            ) : null}
            {round.hint ? <Txt v="sub">💡 {round.hint}</Txt> : null}

            <View style={{ gap: 10 }}>
              {round.options.map((o, i) => {
                const isAnswer = reveal && i === reveal.answer;
                const isWrongPick = reveal && i === picked && !reveal.correct;
                const dim = reveal && !isAnswer && !isWrongPick;
                return (
                  <Pressable
                    key={i}
                    onPress={() => void choose(i)}
                    disabled={picked !== null}
                    accessibilityRole="button"
                    accessibilityLabel={o.label}
                    testID={`quiz-option-${i}`}
                    style={({ pressed }) => [
                      styles.option,
                      pressed && { transform: [{ scale: 0.98 }] },
                      picked === i && !reveal && { borderColor: colors.text },
                      isAnswer && { borderColor: colors.lime, backgroundColor: 'rgba(183,243,107,0.12)' },
                      isWrongPick && { borderColor: colors.red, backgroundColor: 'rgba(255,92,122,0.12)' },
                      dim && { opacity: 0.45 },
                    ]}
                  >
                    <View style={[styles.letter, isAnswer && { backgroundColor: colors.lime }, isWrongPick && { backgroundColor: colors.red }]}>
                      {isAnswer ? (
                        <Ionicons name="checkmark" size={16} color={colors.ink} />
                      ) : isWrongPick ? (
                        <Ionicons name="close" size={16} color={colors.ink} />
                      ) : (
                        <Text style={styles.letterText}>{LETTERS[i]}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optLabel} numberOfLines={2}>
                        {o.label}
                      </Text>
                      {o.sub ? <Text style={styles.optSub}>{o.sub}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {reveal ? (
              <Animated.View
                style={{ opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}
              >
                <Card style={{ gap: 8 }} testID="quiz-reveal">
                  <View style={styles.rowBetween}>
                    <Text style={[styles.verdict, { color: reveal.correct ? colors.lime : colors.red }]}>
                      {reveal.correct ? `答对了 +${reveal.points}` : '差一点'}
                    </Text>
                    {reveal.streak >= 2 ? <Pill label={`连对 ×${reveal.streak}`} icon="flame" color={colors.sunset} /> : null}
                  </View>
                  <Txt v="sub" testID="quiz-fact">
                    {reveal.fact}
                  </Txt>
                </Card>
              </Animated.View>
            ) : null}

            {reveal ? (
              <Button
                label={reveal.finished ? '看看我有多懂这里' : '下一题'}
                icon={reveal.finished ? 'trophy' : 'arrow-forward'}
                size="lg"
                onPress={() => void next()}
                testID="quiz-next"
              />
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

function Result({
  result,
  board,
  placeName,
  onAgain,
  onDone,
}: {
  result: QuizResult;
  board: QuizBoard | null;
  placeName: string;
  onAgain: () => void;
  onDone: () => void;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(spin, { toValue: 1, useNativeDriver: NATIVE_DRIVER, friction: 6 }).start();
  }, [spin]);
  const perfect = result.correct === result.total;
  return (
    <ScrollView contentContainerStyle={[styles.body, { alignItems: 'stretch' }]} showsVerticalScrollIndicator={false} testID="quiz-result">
      <Animated.View style={{ alignItems: 'center', gap: 10, transform: [{ scale: spin.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }}>
        <PlaceRecord name={placeName} moods={perfect ? ['梦幻', '热血'] : ['夜色', '静谧']} size={150} spinning />
        <Text style={styles.resultTitle} testID="quiz-title">
          {result.title}
        </Text>
        <Text style={styles.resultScore}>{result.score} 分</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Pill label={`答对 ${result.correct}/${result.total}`} icon="checkmark-circle" color={colors.lime} />
          {result.onSite ? <Pill label="现场认证 ×1.2" icon="location" color={colors.mint} /> : null}
          {result.rank ? <Pill label={`知音榜第 ${result.rank} 名`} icon="trophy" color={colors.gold} /> : null}
          {result.isBest ? <Pill label="个人新纪录" icon="sparkles" color={colors.violet} /> : null}
        </View>
      </Animated.View>

      <Card style={{ gap: 10 }} testID="quiz-board">
        <Txt v="title">{placeName} · 知音榜</Txt>
        {!board ? (
          <Loading />
        ) : (
          board.board.map((e) => {
            const me = board.me?.user.id === e.user.id;
            return (
              <View key={e.user.id} style={[styles.boardRow, me && styles.boardMe]}>
                <Text style={styles.medal}>{medal(e.rank)}</Text>
                <Text style={styles.miniName} numberOfLines={1}>
                  {e.user.nickname}
                  {me ? '（我）' : ''}
                </Text>
                {e.onSite ? <Ionicons name="location" size={12} color={colors.mint} /> : null}
                <Text style={styles.miniTitle}>{e.title}</Text>
                <Text style={styles.miniScore}>{e.score}</Text>
              </View>
            );
          })
        )}
      </Card>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="再来一局" icon="refresh" variant="subtle" onPress={onAgain} style={{ flex: 1 }} testID="quiz-again" />
        <Button label="完成" icon="checkmark" onPress={onDone} style={{ flex: 1 }} testID="quiz-done" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.35)',
    backgroundColor: colors.surface,
    padding: 16,
    gap: 14,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  medal: { width: 24, textAlign: 'center', color: colors.sub, fontSize: 15, fontWeight: '800' },
  miniName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  miniTitle: { color: colors.sub, fontSize: 12 },
  miniScore: { color: colors.lime, fontSize: 15, fontWeight: '900', minWidth: 40, textAlign: 'right' },

  screen: { flex: 1, backgroundColor: colors.bg },
  glow: { position: 'absolute', left: 0, right: 0, top: 0, height: 320 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10 },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  headSub: { color: colors.sub, fontSize: 12 },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.lime,
    minWidth: 64,
    justifyContent: 'center',
  },
  scoreText: { color: colors.ink, fontWeight: '900', fontSize: 14 },
  center: { flex: 1, justifyContent: 'center' },
  body: { padding: 18, gap: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.surface3 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  roundNo: { color: colors.sub, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  timerTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: 'hidden' },
  timerFill: { height: 4, width: '100%', backgroundColor: colors.mint, transformOrigin: 'left' },
  prompt: { color: colors.text, fontSize: 22, fontWeight: '900', lineHeight: 30 },
  clue: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 22,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(160,139,255,0.35)',
  },
  clueText: { fontSize: 44, letterSpacing: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  letter: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letterText: { color: colors.text, fontWeight: '900', fontSize: 13 },
  optLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  optSub: { color: colors.sub, fontSize: 12, marginTop: 2 },
  verdict: { fontSize: 18, fontWeight: '900' },
  resultTitle: {
    color: colors.lime,
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(183,243,107,0.45)',
    textShadowRadius: 18,
  },
  resultScore: { color: colors.text, fontSize: 22, fontWeight: '800' },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.sm },
  boardMe: { backgroundColor: 'rgba(183,243,107,0.10)' },
});

