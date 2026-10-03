import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { apiBase } from '../lib/api';
import { colors } from '../lib/theme';
import { AIBadge, Card, Screen, Txt } from './ui';

/**
 * 原生端占位：共鸣模式依赖 Web Audio（AudioWorklet、实时合成），目前在网页版提供。
 * 原生版计划基于 react-native-audio-api（Web Audio 的原生实现）移植同一套引擎。
 */
export function ResonanceScreen() {
  return (
    <Screen testID="screen-resonance" glow={colors.violet}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Txt v="display">共鸣</Txt>
        <AIBadge label="实验" />
      </View>
      <Txt v="sub">让世界为你的歌伴奏：跟着周围的节奏，落在周围的调上。</Txt>
      <Card style={{ gap: 10, alignItems: 'center' }}>
        <Ionicons name="pulse" size={36} color={colors.violet} />
        <Txt v="title">共鸣模式目前在网页版提供</Txt>
        <Txt v="sub" style={{ textAlign: 'center' }}>
          用手机浏览器打开 {apiBase()} 即可体验。原生版会基于 react-native-audio-api 移植同一套实时引擎。
        </Txt>
      </Card>
    </Screen>
  );
}
