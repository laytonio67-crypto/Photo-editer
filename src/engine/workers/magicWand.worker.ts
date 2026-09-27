/// <reference lib="webworker" />
import { magicWandMask } from './floodFill';

export interface MagicWandRequest {
  data: Uint8Array;
  width: number;
  height: number;
  x: number;
  y: number;
  tolerance: number;
  contiguous: boolean;
}

self.onmessage = (e: MessageEvent<MagicWandRequest>) => {
  const { data, width, height, x, y, tolerance, contiguous } = e.data;
  const result = magicWandMask(data, width, height, x, y, tolerance, contiguous);
  (self as unknown as Worker).postMessage(result, [result.mask.buffer]);
};
