export type OcrEngine = 'mlkit-chinese' | 'apple-vision';

/** Coordinates refer to the oriented, downsampled recognition image, origin top-left. */
export type NativeOcrLine = {
  id: string;
  text: string;
  confidence: number | null;
  box: { x: number; y: number; width: number; height: number };
};

export type NativeOcrResult = {
  engine: OcrEngine;
  engineVersion: string;
  /** SHA256 of the original private file bytes, not the downsampled pixels. */
  imageDigest: string;
  width: number;
  height: number;
  lines: NativeOcrLine[];
};

export type OcrAvailability = {
  available: boolean;
  engine: OcrEngine | null;
  engineVersion: string | null;
  reason?: string;
};
