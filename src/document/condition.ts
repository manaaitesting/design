/**
 * The expression behind Figma's "Conditional" prototype action.
 *
 * Figma's condition is a line of text over the file's variables, so this is a
 * small evaluator for the same shape: comparisons joined by `and` / `or`, with
 * variables written `$Name` (or `${A name with spaces}`) and resolved against
 * whatever the run currently holds.
 *
 * It is deliberately tiny and total — a condition that does not parse is
 * `false`, never a thrown error, because a prototype must keep playing.
 */

export type Value = string | number | boolean;

type Token =
  | { kind: 'value'; value: Value }
  | { kind: 'var'; name: string }
  | { kind: 'op'; op: string };

const OPERATORS = ['>=', '<=', '==', '!=', '>', '<'];

/** A variable's current value, or undefined if the run has never heard of it. */
export type Lookup = (name: string) => string | undefined;

function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === '(' || char === ')') {
      out.push({ kind: 'op', op: char });
      i++;
      continue;
    }

    // a variable: $Name, or ${a name with spaces}
    if (char === '$') {
      if (source[i + 1] === '{') {
        const end = source.indexOf('}', i + 2);
        if (end === -1) throw new Error('unclosed ${');
        out.push({ kind: 'var', name: source.slice(i + 2, end) });
        i = end + 1;
        continue;
      }
      const match = /^[A-Za-z0-9_\-/.]+/.exec(source.slice(i + 1));
      if (!match) throw new Error('a $ with no name after it');
      out.push({ kind: 'var', name: match[0] });
      i += 1 + match[0].length;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = source.indexOf(char, i + 1);
      if (end === -1) throw new Error('unclosed string');
      out.push({ kind: 'value', value: source.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    const operator = OPERATORS.find((entry) => source.startsWith(entry, i));
    if (operator) {
      out.push({ kind: 'op', op: operator });
      i += operator.length;
      continue;
    }

    const number = /^\d+(\.\d+)?/.exec(source.slice(i));
    if (number) {
      out.push({ kind: 'value', value: Number(number[0]) });
      i += number[0].length;
      continue;
    }

    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (word) {
      const lower = word[0].toLowerCase();
      if (lower === 'and' || lower === 'or' || lower === 'not') {
        out.push({ kind: 'op', op: lower });
      } else if (lower === 'true' || lower === 'false') {
        out.push({ kind: 'value', value: lower === 'true' });
      } else {
        // a bare word is a variable name, the way Figma's chips read
        out.push({ kind: 'var', name: word[0] });
      }
      i += word[0].length;
      continue;
    }

    throw new Error(`cannot read "${char}"`);
  }

  return out;
}

/** "12" is a number wherever it is compared with one; "on" never is. */
function asNumber(value: Value): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Empty, "false" and "0" are false; everything else a variable holds is true. */
export function truthy(value: Value): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const trimmed = value.trim().toLowerCase();
  return trimmed !== '' && trimmed !== 'false' && trimmed !== '0';
}

function compare(op: string, left: Value, right: Value): boolean {
  const a = asNumber(left);
  const b = asNumber(right);
  // compare as numbers when both sides are numbers, and as text otherwise, so
  // "10" > "9" is true rather than alphabetical
  if (a !== null && b !== null) {
    switch (op) {
      case '==':
        return a === b;
      case '!=':
        return a !== b;
      case '>':
        return a > b;
      case '<':
        return a < b;
      case '>=':
        return a >= b;
      default:
        return a <= b;
    }
  }
  const x = String(left);
  const y = String(right);
  switch (op) {
    case '==':
      return x === y;
    case '!=':
      return x !== y;
    case '>':
      return x > y;
    case '<':
      return x < y;
    case '>=':
      return x >= y;
    default:
      return x <= y;
  }
}

class Parser {
  private at = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly lookup: Lookup,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private eat(op: string): boolean {
    const token = this.peek();
    if (token?.kind === 'op' && token.op === op) {
      this.at++;
      return true;
    }
    return false;
  }

  parse(): boolean {
    const value = this.or();
    if (this.at !== this.tokens.length) throw new Error('trailing input');
    return truthy(value);
  }

  private or(): Value {
    let left = this.and();
    while (this.eat('or')) {
      const right = this.and();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  private and(): Value {
    let left = this.unary();
    while (this.eat('and')) {
      const right = this.unary();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  private unary(): Value {
    if (this.eat('not')) return !truthy(this.unary());
    return this.comparison();
  }

  private comparison(): Value {
    const left = this.primary();
    const token = this.peek();
    if (token?.kind === 'op' && OPERATORS.includes(token.op)) {
      this.at++;
      return compare(token.op, left, this.primary());
    }
    return left;
  }

  private primary(): Value {
    if (this.eat('(')) {
      const inner = this.or();
      if (!this.eat(')')) throw new Error('unclosed (');
      return inner;
    }
    const token = this.peek();
    if (!token) throw new Error('the expression stops early');
    if (token.kind === 'value') {
      this.at++;
      return token.value;
    }
    if (token.kind === 'var') {
      this.at++;
      // a name the run has never set reads as empty, which is false
      return this.lookup(token.name) ?? '';
    }
    throw new Error(`did not expect "${token.op}"`);
  }
}

/**
 * Whether a condition holds.
 *
 * A blank condition is true — an `if` with nothing in it is the branch you
 * always take — and anything that will not parse is false.
 */
export function evaluate(condition: string | undefined, lookup: Lookup): boolean {
  if (!condition || !condition.trim()) return true;
  try {
    return new Parser(tokenize(condition), lookup).parse();
  } catch {
    return false;
  }
}

/** Why a condition will not parse, for the panel to show. Null when it is fine. */
export function conditionError(condition: string): string | null {
  if (!condition.trim()) return null;
  try {
    new Parser(tokenize(condition), () => '').parse();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'cannot read this';
  }
}
