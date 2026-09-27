export type ToneChannel = 'rgb' | 'r' | 'g' | 'b';

export const CHANNEL_OPTIONS: { value: ToneChannel; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];
