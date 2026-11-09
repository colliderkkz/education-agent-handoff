import { requireOptionalNativeModule } from 'expo';
import type { NativeOcrResult, OcrAvailability } from './XiaoheOcr.types';

interface XiaoheOcrModule {
  recognize(uri: string): Promise<NativeOcrResult>;
  getAvailability(): Promise<OcrAvailability>;
}

// Old development builds and web must keep the manual photo workflow usable.
export default requireOptionalNativeModule<XiaoheOcrModule>('XiaoheOcr');
