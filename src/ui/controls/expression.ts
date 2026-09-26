/**
 * Evaluates simple arithmetic typed into numeric fields ("1920/2", "(100+25)*2", "-3.5").
 * Supports + - * / parentheses and unary minus. Returns null for invalid input.
 */
export function evaluateExpression(text: string): number | null {
  const src = text.replace(/,/g, '.').replace(/\s+/g, '');
  if (!src) return null;
  let pos = 0;

  const peek = (): string => src[pos] ?? '';

  const parseNumber = (): number | null => {
    const m = /^(\d+(\.\d*)?|\.\d+)/.exec(src.slice(pos));
    if (!m) return null;
    pos += m[0].length;
    return Number(m[0]);
  };

  const parsePrimary = (): number | null => {
    const c = peek();
    if (c === '-' || c === '+') {
      pos++;
      const v = parsePrimary();
      return v === null ? null : c === '-' ? -v : v;
    }
    if (c === '(') {
      pos++;
      const v = parseSum();
      if (v === null || peek() !== ')') return null;
      pos++;
      return v;
    }
    return parseNumber();
  };

  const parseProduct = (): number | null => {
    let v = parsePrimary();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = src[pos++];
      const rhs = parsePrimary();
      if (rhs === null) return null;
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  };

  const parseSum = (): number | null => {
    let v = parseProduct();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = src[pos++];
      const rhs = parseProduct();
      if (rhs === null) return null;
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  };

  const result = parseSum();
  if (result === null || pos !== src.length || !Number.isFinite(result)) return null;
  return result;
}
