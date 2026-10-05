import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { apiBase } from '../lib/api';
import { colors } from '../lib/theme';
import { Card, Screen, Txt } from './ui';

/**
 * 原生端占位：兔子电台依赖 Web Audio（实时合成），目前在网页版提供。
 * 原生版计划基于 react-native-audio-api（Web Audio 的原生实现）移植同一套引擎。
 */
export function RabbitScreen() {
  return (
    <Screen testID="screen-rabbit" glow={colors.lime}>
      <Txt v="display">兔子电台</Txt>
      <Txt v="sub">马拉松里的配速兔，现在在你的耳机里：步频掉了，音乐先快一点点，把你带回去。</Txt>
      <Card style={{ gap: 10, alignItems: 'center' }}>
        <View>
          <Ionicons name="walk" size={36} color={colors.lime} />
        </View>
        <Txt v="title">兔子电台目前在网页版提供</Txt>
        <Txt v="sub" style={{ textAlign: 'center' }}>
          用手机浏览器打开 {apiBase()} 即可体验。
        </Txt>
      </Card>
    </Screen>
  );
}
