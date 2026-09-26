export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface ParsedShortcut {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string; // lower-case key name
}

/** Parses "Shift+Mod+Z", "Alt+Mod+N", "[", "Mod+=" … Mod = Ctrl (Win/Linux) / Cmd (macOS). */
export function parseShortcut(spec: string): ParsedShortcut {
  const parts = spec.split('+');
  // "Mod++" style specs: a trailing empty part means the key is "+".
  let key = parts.pop() ?? '';
  if (key === '' && parts.length > 0) {
    parts.pop();
    key = '+';
  }
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  return { mod: mods.has('mod'), shift: mods.has('shift'), alt: mods.has('alt'), key: key.toLowerCase() };
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Equal: '=',
  Minus: '-',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

/** Key names for an event: the produced character plus layout-independent fallbacks. */
function eventKeys(e: KeyboardEvent): string[] {
  const keys = [e.key.toLowerCase()];
  if (e.code.startsWith('Key')) keys.push(e.code.slice(3).toLowerCase());
  else if (e.code.startsWith('Digit')) keys.push(e.code.slice(5));
  else if (e.code.startsWith('Numpad') && /\d$/.test(e.code)) keys.push(e.code.slice(6));
  else if (CODE_KEYS[e.code]) keys.push(CODE_KEYS[e.code]!);
  if (e.code === 'NumpadAdd') keys.push('=', '+');
  if (e.code === 'NumpadSubtract') keys.push('-');
  return keys;
}

export function matchesShortcut(e: KeyboardEvent, s: ParsedShortcut): boolean {
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod !== s.mod || e.altKey !== s.alt) return false;
  const keys = eventKeys(e);
  // "=" is typed with shift on many layouts for "+": accept Mod+= with or without shift.
  if ((s.key === '=' || s.key === '+') && (keys.includes('=') || keys.includes('+'))) return true;
  if (e.shiftKey !== s.shift) return false;
  return keys.includes(s.key);
}

/** Display form: "⇧⌘Z" on macOS, "Ctrl+Shift+Z" elsewhere. */
export function formatShortcut(spec: string): string {
  const s = parseShortcut(spec);
  const keyLabel =
    s.key === 'delete'
      ? IS_MAC
        ? '⌦'
        : 'Del'
      : s.key === 'backspace'
        ? IS_MAC
          ? '⌫'
          : 'Backspace'
        : s.key === 'escape'
          ? 'Esc'
          : s.key === 'enter'
            ? IS_MAC
              ? '↩'
              : 'Enter'
            : s.key.length === 1
              ? s.key.toUpperCase()
              : s.key[0]!.toUpperCase() + s.key.slice(1);
  if (IS_MAC) {
    return `${s.alt ? '⌥' : ''}${s.shift ? '⇧' : ''}${s.mod ? '⌘' : ''}${keyLabel}`;
  }
  return [s.mod ? 'Ctrl' : '', s.shift ? 'Shift' : '', s.alt ? 'Alt' : '', keyLabel].filter(Boolean).join('+');
}

/** True when keyboard focus is in a text field, where shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(target.type);
  }
  return false;
}
