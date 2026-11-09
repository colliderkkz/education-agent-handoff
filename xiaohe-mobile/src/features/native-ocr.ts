import XiaoheOcr from '../../modules/xiaohe-ocr/src/XiaoheOcrModule';
import type { NativeOcrResult, OcrAvailability } from '../../modules/xiaohe-ocr/src/XiaoheOcr.types';

export type { NativeOcrResult, NativeOcrLine, OcrAvailability } from '../../modules/xiaohe-ocr/src/XiaoheOcr.types';

const unavailable = '当前安装包没有本机文字识别模块，可以继续手工核对图片。';

export async function getOcrAvailability(): Promise<OcrAvailability> {
  if (!XiaoheOcr) return { available: false, engine: null, engineVersion: null, reason: unavailable };
  return XiaoheOcr.getAvailability();
}

/** Only the local engine passes a registered, currently owned photo URI here. */
export async function recognizePhoto(uri: string): Promise<NativeOcrResult> {
  if (!XiaoheOcr) throw new Error(unavailable);
  return XiaoheOcr.recognize(uri);
}
