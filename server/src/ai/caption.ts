import { z } from 'zod';
import type { Deps } from '../http.ts';
import { getPlaceRow } from '../services/places.ts';
import { findInCatalog } from './catalog.ts';
import { LlmError } from './llm.ts';
import { moodsForHour, type Mood } from './moods.ts';
import { timeLabel } from './time.ts';

/**
 * 「帮我写一句」：分享歌曲时，为「为什么这首歌属于这里」起个头。
 * 只是草稿——用户可以改；大模型不可用时用按情绪分组的模板。
 */

const TEMPLATES: Partial<Record<Mood, string[]>> = {
  浪漫: ['{time}的{place}，适合把《{title}》放给喜欢的人听', '风刚好，《{title}》也刚好'],
  惬意: ['{time}在{place}慢慢走，《{title}》正合适', '什么都不想，就让《{title}》放着'],
  治愈: ['走到{place}，被《{title}》轻轻接住', '{time}的{place}，《{title}》像一杯热茶'],
  怀旧: ['在{place}听《{title}》，一下回到那几年', '《{title}》一响，{place}就变成了旧照片'],
  伤感: ['{place}有点空，《{title}》刚好填满', '不想说话的{time}，交给《{title}》'],
  孤独: ['一个人路过{place}，耳机里是《{title}》', '{time}的{place}，只有我和《{title}》'],
  热血: ['在{place}跟着《{title}》大声唱', '《{title}》一响，脚步都快了'],
  欢快: ['和朋友在{place}，单曲循环《{title}》', '{place}的热闹，配《{title}》刚好'],
  夜色: ['{time}的{place}，灯一亮就想听《{title}》', '城市的夜晚，从《{title}》开始'],
  自由: ['在{place}吹着风听《{title}》，想去更远的地方', '《{title}》+ {place} = 自由'],
  静谧: ['安静的{place}，适合小声放《{title}》', '{time}的{place}，《{title}》刚好不打扰'],
  清新: ['{time}的{place}空气很好，《{title}》也是', '在{place}按下《{title}》，一切都是新的'],
  梦幻: ['{place}像梦一样，《{title}》是背景音', '抬头看{place}的天，耳边是《{title}》'],
  律动: ['{place}的节奏，和《{title}》对上了', '走在{place}，脚步跟着《{title}》的鼓点'],
};

const schema = z.object({ text: z.string().min(2).max(60) });

export async function suggestCaption(
  deps: Deps,
  input: { placeId?: string | undefined; title: string; artist: string; hour: number },
): Promise<{ text: string; engine: { kind: 'llm' | 'rules'; label: string } }> {
  const place = input.placeId ? getPlaceRow(deps, input.placeId) : null;
  const placeName = place?.name ?? '这里';
  const time = timeLabel(input.hour);

  if (deps.llm) {
    try {
      const out = await deps.llm.json(
        schema,
        [
          {
            role: 'system',
            content:
              '你帮用户写一句话，说明为什么这首歌适合此时此地。要求：口语、有画面感、不超过 24 个字、不要引号和表情、不要编造具体人名。只输出 JSON：{"text":"…"}',
          },
          { role: 'user', content: `地点：${placeName}${place?.description ? `（${place.description}）` : ''}\n时间：${time}\n歌曲：《${input.title}》- ${input.artist}` },
        ],
        { timeoutMs: 8000, temperature: 0.9 },
      );
      return { text: out.text.trim(), engine: { kind: 'llm', label: deps.llm.label } };
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
    }
  }

  const moods = findInCatalog(input.title, input.artist)?.moods ?? moodsForHour(input.hour);
  const pool = moods.flatMap((m) => TEMPLATES[m] ?? []);
  const tpl = pool.length ? pool[Math.floor(deps.rng() * pool.length)]! : '{time}的{place}，想听《{title}》';
  const text = tpl.replaceAll('{time}', time).replaceAll('{place}', placeName).replaceAll('{title}', input.title);
  return { text, engine: { kind: 'rules', label: '本地规则引擎' } };
}
