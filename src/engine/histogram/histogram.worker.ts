/// <reference lib="webworker" />
import { histogramFromPixels } from './histogram';

self.onmessage = (e: MessageEvent<{ id: number; data: Uint8Array }>) => {
  const h = histogramFromPixels(e.data.data);
  (self as unknown as Worker).postMessage({ id: e.data.id, histogram: h }, [h.r.buffer, h.g.buffer, h.b.buffer, h.luma.buffer]);
};
