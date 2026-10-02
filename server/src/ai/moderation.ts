import { z } from 'zod';
import { HttpError, type Deps } from '../http.ts';
import { LlmError } from './llm.ts';

/**
 * 内容审核：评论、歌曲感受、漂流瓶留言、地点名称。
 *
 * 第一道：本地规则（引流广告、联系方式、明显违规词），零延迟、零成本；
 * 第二道：配置了大模型时再做一次语义审核（引战、辱骂、隐晦的违规等），超时或出错时放行（fail-open），
 * 避免模型故障让用户无法发言。生产环境建议接入平台的内容安全服务替换第二道。
 */

const RULES: { re: RegExp; reason: string }[] = [
  { re: /(加|\+)\s*(微信|vx|v信|wx|薇信|qq|扣扣)|微信号|vx号|私聊我|私信我/i, reason: '疑似引流' },
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/, reason: '包含手机号' },
  { re: /(qq|QQ|扣扣)\s*[:：]?\s*\d{5,11}/, reason: '包含联系方式' },
  { re: /代开发票|刷单|兼职日结|网贷|贷款秒批|博彩|赌博|赌场|六合彩|色情|约炮|裸聊|成人视频/, reason: '违规广告' },
  { re: /(https?:\/\/|www\.)\S+/i, reason: '包含外部链接' },
];

export function ruleCheck(text: string): string | null {
  for (const r of RULES) if (r.re.test(text)) return r.reason;
  return null;
}

const llmSchema = z.object({ ok: z.boolean(), reason: z.string().max(40).default('') });

export async function moderate(deps: Deps, texts: (string | null | undefined)[]): Promise<{ ok: boolean; reason: string }> {
  const list = texts.map((t) => t?.trim()).filter((t): t is string => !!t);
  if (list.length === 0) return { ok: true, reason: '' };
  for (const t of list) {
    const reason = ruleCheck(t);
    if (reason) return { ok: false, reason };
  }
  if (!deps.llm) return { ok: true, reason: '' };
  try {
    const out = await deps.llm.json(
      llmSchema,
      [
        {
          role: 'system',
          content:
            '你是音乐社区的内容审核员。判断用户内容是否适合公开展示：辱骂、人身攻击、色情低俗、违法、引流广告、泄露他人隐私为不适合；普通的情绪表达、吐槽、对歌曲的评价都适合。只输出 JSON：{"ok":true|false,"reason":"不适合时给出 10 字以内原因"}',
        },
        { role: 'user', content: list.join('\n---\n') },
      ],
      { timeoutMs: 4000, temperature: 0 },
    );
    return { ok: out.ok, reason: out.ok ? '' : out.reason || '内容不适合公开' };
  } catch (err) {
    if (err instanceof LlmError) return { ok: true, reason: '' }; // 模型不可用时不阻塞发言
    throw err;
  }
}

/** 不通过时抛 400 content_rejected。 */
export async function assertClean(deps: Deps, ...texts: (string | null | undefined)[]) {
  const r = await moderate(deps, texts);
  if (!r.ok) {
    throw new HttpError(400, 'content_rejected', `内容未通过审核：${r.reason}，请修改后再发`, { reason: r.reason });
  }
}
