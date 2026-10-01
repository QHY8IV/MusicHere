import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from '../http.ts';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageType = { ext: 'jpg' | 'png' | 'webp'; mime: string };

/** 按文件头（魔数）判断真实格式，不信任客户端声明的类型或扩展名。 */
export function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/** 上传文件的公开路径前缀；数据库里存的就是 `/api/uploads/<文件名>`。 */
export const UPLOAD_PREFIX = '/api/uploads/';
const FILE_NAME = /^[A-Za-z0-9_-]{1,64}\.(jpg|png|webp)$/;

export const mimeForFile = (name: string) =>
  name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

/** 保存图片，返回要存进数据库的路径。 */
export function saveImage(uploadDir: string, buf: Buffer): string {
  const type = sniffImage(buf);
  if (!type) throw new HttpError(400, 'invalid_image', '只支持 JPG / PNG / WebP 图片');
  mkdirSync(uploadDir, { recursive: true });
  const name = `${randomUUID()}.${type.ext}`;
  writeFileSync(join(uploadDir, name), buf);
  return UPLOAD_PREFIX + name;
}

/** 读取已上传的图片；文件名不合法或不存在时返回 null（同时杜绝路径穿越）。 */
export function readImage(uploadDir: string, name: string): { data: Buffer; mime: string } | null {
  if (!FILE_NAME.test(name)) return null;
  const file = join(uploadDir, name);
  try {
    if (!statSync(file).isFile()) return null;
    return { data: readFileSync(file), mime: mimeForFile(name) };
  } catch {
    return null;
  }
}

/** 如果 path 是我们自己保存的上传文件，就删掉它（替换封面时回收旧文件）。 */
export function removeUploaded(uploadDir: string, path: string | null) {
  if (!path?.startsWith(UPLOAD_PREFIX)) return;
  const name = path.slice(UPLOAD_PREFIX.length);
  if (!FILE_NAME.test(name)) return;
  try {
    unlinkSync(join(uploadDir, name));
  } catch {
    /* 文件已不存在，忽略 */
  }
}
