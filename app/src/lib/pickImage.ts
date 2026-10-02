import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { ColorHint, PickedImage } from './api';

export class PickError extends Error {}

/** 封面横图，宽度 1280 足够清晰；再压成 JPEG，通常 200–400KB，远低于服务端 5MB 上限。 */
const COVER_WIDTH = 1280;
/** 给 AI 看的图：1024 宽足够识别场景，体积更小、响应更快。 */
const SCENE_WIDTH = 1024;

async function normalize(
  asset: ImagePicker.ImagePickerAsset,
  maxWidth: number,
  base64 = false,
): Promise<PickedImage & { base64?: string }> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (asset.width > maxWidth) ctx.resize({ width: maxWidth });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.75, base64 });
  return {
    uri: out.uri,
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    ...(out.base64 ? { base64: out.base64.replace(/^data:[^,]+,/, '') } : {}),
  };
}

async function launch(source: 'camera' | 'library', aspect?: [number, number]) {
  if (source === 'camera' && Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PickError('没有相机权限，请在系统设置里允许，或改用相册');
    return ImagePicker.launchCameraAsync({ allowsEditing: !!aspect, aspect, quality: 1 });
  }
  return ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: !!aspect, aspect, quality: 1 });
}

/** 从相册选一张封面。用户取消返回 null。 */
export async function pickFromLibrary(): Promise<PickedImage | null> {
  const res = await launch('library', [16, 10]);
  if (res.canceled || !res.assets[0]) return null;
  return normalize(res.assets[0], COVER_WIDTH);
}

/** 拍一张封面。web 上没有相机选项，退化为选图。 */
export async function takePhoto(): Promise<PickedImage | null> {
  const res = await launch('camera', [16, 10]);
  if (res.canceled || !res.assets[0]) return null;
  return normalize(res.assets[0], COVER_WIDTH);
}

export interface ScenePhoto {
  uri: string;
  base64: string;
  colorHint?: ColorHint;
}

/** 为「听这里」取一张照片：缩放、转 base64，并在浏览器里顺便算出画面的明暗冷暖。 */
export async function pickScenePhoto(source: 'camera' | 'library'): Promise<ScenePhoto | null> {
  const res = await launch(source);
  if (res.canceled || !res.assets[0]) return null;
  const img = await normalize(res.assets[0], SCENE_WIDTH, true);
  if (!img.base64) throw new PickError('读取照片失败，请换一张试试');
  const colorHint = await computeColorHint(img.uri).catch(() => undefined);
  return { uri: img.uri, base64: img.base64, ...(colorHint ? { colorHint } : {}) };
}

/**
 * 画面的明暗、冷暖、饱和度（仅 web：用 canvas 缩到 32×32 取平均）。
 * 原生端返回 undefined——那里由多模态大模型直接看图；没配模型时只用时段与文字线索。
 */
export async function computeColorHint(uri: string): Promise<ColorHint | undefined> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
  const img = new window.Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('load'));
    img.src = uri;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(img, 0, 0, 32, 32);
  const { data } = ctx.getImageData(0, 0, 32, 32);
  let lum = 0;
  let warm = 0;
  let sat = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    warm += r - b;
    sat += max === 0 ? 0 : (max - min) / max;
  }
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    brightness: round(lum / n),
    warmth: round(Math.max(-1, Math.min(1, (warm / n) * 2))),
    saturation: round(sat / n),
  };
}
