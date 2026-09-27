/// <reference lib="webworker" />
import { packSurface, unpackSurface } from '../io/projectCodec';

export interface CodecRequest {
  id: number;
  op: 'pack' | 'unpack';
  data: Uint8Array;
  width: number;
  height: number;
  bpp: 1 | 4;
}

export type CodecResponse = { id: number; data: Uint8Array } | { id: number; error: string };

self.onmessage = async (e: MessageEvent<CodecRequest>) => {
  const { id, op, data, width, height, bpp } = e.data;
  const post = (msg: CodecResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    const out = op === 'pack' ? await packSurface(data, width, height, bpp) : await unpackSurface(data, width, height, bpp);
    post({ id, data: out }, [out.buffer]);
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
