import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';
import { api, imageUri, type Place } from '../lib/api';
import { useToast } from '../lib/feedback';
import { artPalette, colors, radius } from '../lib/theme';
import { Vinyl } from './Art';
import { PlaceCover } from './PlaceCover';
import { Sheet } from './Sheet';
import { AIBadge, Button, Txt } from './ui';

export interface PostcardData {
  place: Pick<Place, 'id' | 'name' | 'imageUrl' | 'lat' | 'lng'>;
  song: { title: string; artist: string };
  nickname: string;
}

const fmtCoord = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 声音明信片：地点封面 + 这里的一首歌 + AI 写的一句话 + 坐标和日期。
 * 用来分享到朋友圈 / 群聊，把「此地有歌」带到更多人面前。web 端可直接保存为图片。
 */
export function PostcardSheet({ data, onClose }: { data: PostcardData | null; onClose: () => void }) {
  const toast = useToast();
  const [line, setLine] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setLine(null);
    let alive = true;
    api
      .caption({ placeId: data.place.id, title: data.song.title, artist: data.song.artist })
      .then((r) => alive && setLine(r.text))
      .catch(() => alive && setLine(`在${data.place.name}，想听《${data.song.title}》`));
    return () => {
      alive = false;
    };
  }, [data]);

  const save = async () => {
    if (!data || !line) return;
    setSaving(true);
    try {
      if (Platform.OS === 'web') {
        const url = await renderPostcardPng(data, line);
        const a = document.createElement('a');
        a.href = url;
        a.download = `此地有歌-${data.place.name}.png`;
        a.click();
        toast.show('明信片已保存');
      } else {
        await Share.share({ message: `「${line}」——在${data.place.name}听《${data.song.title}》· 此地有歌` });
      }
    } catch {
      toast.show('保存失败，可以直接截图分享', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible={!!data} onClose={onClose} title="声音明信片" testID="postcard">
      {data ? (
        <>
          <View style={styles.card} testID="postcard-card">
            <PlaceCover place={{ id: data.place.id, imageUrl: data.place.imageUrl }} height={230}>
              <Text style={styles.brand}>此地有歌 · MusicHere</Text>
              <Text style={styles.place}>{data.place.name}</Text>
              <Text style={styles.meta}>
                {fmtCoord(data.place.lat, data.place.lng)}　{today()}
              </Text>
            </PlaceCover>
            <View style={styles.body}>
              <View style={styles.songRow}>
                <Vinyl title={data.song.title} artist={data.song.artist} size={72} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.song}>《{data.song.title}》</Text>
                  <Text style={styles.artist}>{data.song.artist}</Text>
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <AIBadge label="AI 写的一句" />
                <Text style={styles.line} testID="postcard-line">
                  {line ?? '正在为这里写一句话…'}
                </Text>
              </View>
              <Text style={styles.foot}>— {data.nickname} 在这里听见了这首歌</Text>
            </View>
          </View>
          <Button
            label={Platform.OS === 'web' ? '保存为图片' : '分享'}
            icon={Platform.OS === 'web' ? 'download' : 'share-social'}
            size="lg"
            loading={saving}
            disabled={!line}
            onPress={save}
            testID="postcard-save"
          />
          <View style={styles.tip}>
            <Ionicons name="information-circle-outline" size={14} color={colors.faint} />
            <Txt v="caption">保存后可以发到朋友圈或群聊，邀请朋友也来这里听听</Txt>
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

// ---------- web：用 canvas 画一张 1080×1440 的明信片 ----------

const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif';
const SERIF = '"Songti SC","STSong","Noto Serif SC",serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function renderPostcardPng(data: PostcardData, line: string): Promise<string> {
  const W = 1080;
  const H = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07080C';
  ctx.fillRect(0, 0, W, H);

  // 封面
  const coverH = 820;
  const src = imageUri(data.place.imageUrl);
  let drew = false;
  if (src) {
    try {
      const img = await loadImage(src);
      const scale = Math.max(W / img.width, coverH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (W - w) / 2, (coverH - h) / 2, w, h);
      drew = true;
    } catch {
      /* 跨域或加载失败：用渐变 */
    }
  }
  if (!drew) {
    const [a, b] = artPalette(data.place.id);
    const g = ctx.createLinearGradient(0, 0, W, coverH);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, coverH);
  }
  const fade = ctx.createLinearGradient(0, coverH * 0.35, 0, coverH);
  fade.addColorStop(0, 'rgba(7,8,12,0)');
  fade.addColorStop(1, 'rgba(7,8,12,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, coverH);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText('此地有歌 · MusicHere', 72, 96);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 92px ${FONT}`;
  ctx.fillText(data.place.name, 72, coverH - 90);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(`${fmtCoord(data.place.lat, data.place.lng)}   ${today()}`, 76, coverH - 36);

  // 唱片
  const cx = 72 + 110;
  const cy = coverH + 170;
  ctx.fillStyle = '#060608';
  ctx.beginPath();
  ctx.arc(cx, cy, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  for (const r of [100, 86, 72, 58]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const [a, b, c] = artPalette(`${data.song.title}|${data.song.artist}`);
  const lg = ctx.createLinearGradient(cx - 44, cy - 44, cx + 44, cy + 44);
  lg.addColorStop(0, a);
  lg.addColorStop(0.5, b);
  lg.addColorStop(1, c);
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#060608';
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#F4F5F7';
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText(`《${data.song.title}》`, cx + 140, cy - 6);
  ctx.fillStyle = '#A7ACB9';
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(data.song.artist, cx + 152, cy + 46);

  // AI 写的一句
  ctx.fillStyle = '#F4F5F7';
  ctx.font = `600 46px ${SERIF}`;
  const lines = wrapText(ctx, `「${line}」`, W - 144).slice(0, 3);
  lines.forEach((l, i) => ctx.fillText(l, 72, coverH + 390 + i * 66));

  ctx.fillStyle = '#6B7181';
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(`— ${data.nickname} 在这里听见了这首歌`, 72, H - 70);
  const bar = ctx.createLinearGradient(W - 300, 0, W - 72, 0);
  bar.addColorStop(0, '#D2F76A');
  bar.addColorStop(1, '#3EE6C1');
  ctx.fillStyle = bar;
  ctx.fillRect(W - 300, H - 84, 228, 10);

  return canvas.toDataURL('image/png');
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.lineStrong },
  brand: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  place: { color: '#fff', fontSize: 30, fontWeight: '900' },
  meta: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  body: { padding: 18, gap: 16 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  song: { color: colors.text, fontSize: 18, fontWeight: '900' },
  artist: { color: colors.sub, fontSize: 13, marginTop: 2 },
  line: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 28,
    fontFamily: Platform.select({ web: SERIF, ios: 'Songti SC', default: 'serif' }),
  },
  foot: { color: colors.faint, fontSize: 12 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
});
