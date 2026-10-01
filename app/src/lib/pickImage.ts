import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { PickedImage } from './api';

export class PickError extends Error {}

/** 封面横图，宽度 1280 足够清晰；再压成 JPEG，通常 200–400KB，远低于服务端 5MB 上限。 */
const MAX_WIDTH = 1280;

async function normalize(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_WIDTH) ctx.resize({ width: MAX_WIDTH });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.75 });
  return { uri: out.uri, mimeType: 'image/jpeg', fileName: 'cover.jpg' };
}

/** 从相册选一张图。用户取消返回 null。 */
export async function pickFromLibrary(): Promise<PickedImage | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [16, 10],
    quality: 1,
  });
  if (res.canceled || !res.assets[0]) return null;
  return normalize(res.assets[0]);
}

/** 拍一张。web 上没有相机选项；无权限时抛 PickError。 */
export async function takePhoto(): Promise<PickedImage | null> {
  if (Platform.OS === 'web') return pickFromLibrary();
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new PickError('没有相机权限，请在系统设置里允许，或改用相册');
  const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [16, 10], quality: 1 });
  if (res.canceled || !res.assets[0]) return null;
  return normalize(res.assets[0]);
}
