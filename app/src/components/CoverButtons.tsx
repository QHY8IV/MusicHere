import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { PickedImage } from '../lib/api';
import { useToast } from '../lib/feedback';
import { pickFromLibrary, takePhoto } from '../lib/pickImage';
import { Button } from './ui';

/**
 * 选择封面图：拍照 / 相册。
 * compact=true 时是浮在图片上的圆形图标按钮；否则是带文字的描边按钮（用在表单里）。
 */
export function CoverButtons({
  onPicked,
  compact = false,
  busy = false,
}: {
  onPicked: (img: PickedImage) => void | Promise<void>;
  compact?: boolean;
  busy?: boolean;
}) {
  const toast = useToast();
  const [picking, setPicking] = useState(false);

  const run = async (pick: () => Promise<PickedImage | null>) => {
    if (picking || busy) return;
    setPicking(true);
    try {
      const img = await pick();
      if (img) await onPicked(img);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '选择图片失败', 'error');
    } finally {
      setPicking(false);
    }
  };

  const loading = picking || busy;
  const canCamera = Platform.OS !== 'web';

  if (compact) {
    return (
      <View style={styles.row}>
        {canCamera && <Round icon="camera" label="拍照设为封面" onPress={() => run(takePhoto)} loading={loading} />}
        <Round icon="images" label="从相册选择封面" onPress={() => run(pickFromLibrary)} loading={loading} testID="cover-library" />
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {canCamera && <Button label="拍照" icon="camera" variant="ghost" small loading={loading} onPress={() => run(takePhoto)} />}
      <Button label="从相册选" icon="images" variant="ghost" small loading={loading} onPress={() => run(pickFromLibrary)} testID="cover-library" />
    </View>
  );
}

function Round({
  icon,
  label,
  onPress,
  loading,
  testID,
}: {
  icon: 'camera' | 'images';
  label: string;
  onPress: () => void;
  loading: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.round}
    >
      {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={icon} size={18} color="#fff" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  round: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(14,15,31,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
