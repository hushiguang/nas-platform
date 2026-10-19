/**
 * 账单侧的图床入口。实现在 @nas/media，纪念日背景上传走的是同一份。
 * 这里只把 MediaError 转成 BillError，旧接口的状态码保持不变。
 */
import {
  fetchImage as fetchImageRaw,
  imageHostConfigured,
  isAllowedImageUrl,
  MediaError,
  uploadImage as uploadImageRaw,
  type ImageUploadInput,
  type ImageUploadResult,
} from "@nas/media";
import { BillError } from "./errors";

export { imageHostConfigured, isAllowedImageUrl };

function asBillError(err: unknown): never {
  if (err instanceof MediaError) throw new BillError(err.message, err.status);
  throw err;
}

export async function uploadImage(input: ImageUploadInput): Promise<ImageUploadResult> {
  try {
    return await uploadImageRaw(input);
  } catch (err) {
    asBillError(err);
  }
}

export async function fetchImage(url: string) {
  try {
    return await fetchImageRaw(url);
  } catch (err) {
    asBillError(err);
  }
}

/** 前端展示统一走这里：/legacy/api/image?u=<原图地址> */
export function proxiedImageUrl(url: string): string {
  return `/legacy/api/image?u=${encodeURIComponent(url || "")}`;
}
