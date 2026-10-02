/**
 * 大模型客户端：OpenAI 兼容的 /chat/completions 协议。
 *
 * 默认对接腾讯混元（https://api.hunyuan.cloud.tencent.com/v1），也可以换成任何兼容该协议的服务。
 * 没有配置 AI_API_KEY 时整个 AI 能力退化为本地规则引擎（见各 ai/*.ts 的 fallback），功能不中断。
 */
import type { z } from 'zod';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  /** 展示给用户的引擎名，例如「腾讯混元」 */
  label: string;
  timeoutMs: number;
}

export type ChatContent =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: ChatContent;
}

export interface Llm {
  readonly label: string;
  /** 调用模型并把回复解析为 JSON，再用 schema 校验；任何一步失败都抛错，由调用方降级。 */
  json<S extends z.ZodType>(
    schema: S,
    messages: ChatMessage[],
    opts?: { vision?: boolean; timeoutMs?: number; temperature?: number },
  ): Promise<z.output<S>>;
}

export class LlmError extends Error {}

export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): Llm | null {
  const apiKey = env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  return createLlm({
    baseUrl: (env.AI_BASE_URL || 'https://api.hunyuan.cloud.tencent.com/v1').replace(/\/+$/, ''),
    apiKey,
    model: env.AI_MODEL || 'hunyuan-turbos-latest',
    visionModel: env.AI_VISION_MODEL || 'hunyuan-vision',
    label: env.AI_LABEL || '腾讯混元',
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 15_000,
  });
}

/** 从模型回复里抠出 JSON：兼容 ```json 代码块、前后带解释文字等常见情况。 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new LlmError('回复中没有 JSON');
  const open = body[start]!;
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) throw new LlmError('回复中的 JSON 不完整');
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new LlmError('回复中的 JSON 无法解析');
  }
}

export function createLlm(cfg: LlmConfig): Llm {
  return {
    label: cfg.label,
    async json(schema, messages, opts = {}) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? cfg.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: opts.vision ? cfg.visionModel : cfg.model,
            messages,
            temperature: opts.temperature ?? 0.6,
            stream: false,
          }),
        });
      } catch (err) {
        throw new LlmError(ctrl.signal.aborted ? '模型响应超时' : `模型请求失败：${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        throw new LlmError(`模型返回 HTTP ${res.status}`);
      }
      const data = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
      } | null;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError('模型回复格式不正确');
      const parsed = schema.safeParse(extractJson(content));
      if (!parsed.success) throw new LlmError('模型回复不符合约定的结构');
      return parsed.data;
    },
  };
}
