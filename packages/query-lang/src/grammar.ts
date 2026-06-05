/**
 * Hand-rolled recursive-descent parser for filter expressions.
 * Grammar (v1):
 *   expr := clause (AND clause)*
 *   clause := column op value
 *   column := identifier
 *   op := '<' | '<=' | '=' | '!=' | '>=' | '>' | 'in'
 *   value := number | integer | string | list
 *   string := 'single quoted'
 *   list := (value, value, ...)
 *
 * No OR, no parens (v1). Returns an AST or throws with descriptive errors.
 */

export interface ASTNode {
  type: 'expr';
  clauses: Clause[];
}

export interface Clause {
  type: 'clause';
  column: string;
  op: ComparisonOp | 'in';
  value: any; // number | string | any[] for 'in'
}

export type ComparisonOp = '<' | '<=' | '=' | '!=' | '>=' | '>';

// Tokenizer state
interface Token {
  type: 'identifier' | 'op' | 'number' | 'string' | 'keyword' | 'lparen' | 'rparen' | 'comma' | 'eof';
  value: string;
  pos: number;
}

class Tokenizer {
  private input: string;
  private pos = 0;

  constructor(input: string) {
    this.input = input.trim();
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  private peek(): string | null {
    this.skipWhitespace();
    return this.pos < this.input.length ? this.input[this.pos] : null;
  }

  private advance(): string {
    this.skipWhitespace();
    return this.input[this.pos++];
  }

  private readString(quote: string): string {
    let result = '';
    this.pos++; // skip opening quote
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\') {
        this.pos++;
        if (this.pos < this.input.length) {
          result += this.input[this.pos++];
        }
      } else {
        result += this.input[this.pos++];
      }
    }
    if (this.pos >= this.input.length) {
      throw new Error(`Unterminated string at position ${this.pos}`);
    }
    this.pos++; // skip closing quote
    return result;
  }

  /**
   * Read a numeric literal. Accepts the friendly forms users actually type:
   *   - bare integers / decimals: `42`, `0.08`
   *   - dollar-prefixed: `$300,000`, `$1.5M`
   *   - comma thousands separators: `300,000`
   *   - magnitude suffixes (case-insensitive): `300k`, `1.5m`, `2B`
   * The returned string is fully normalized — `$` stripped, commas removed,
   * suffix expanded — so `parseFloat`/`parseInt` upstream see a plain
   * number. Always-positive (signs are operators, not literals).
   */
  private readNumber(): string {
    // Optional leading '$' — already validated by the caller before delegating
    // here; we just consume it so the digit loop starts at the right offset.
    if (this.input[this.pos] === '$') this.pos++;

    let raw = '';
    while (
      this.pos < this.input.length &&
      /[\d.,]/.test(this.input[this.pos])
    ) {
      raw += this.input[this.pos++];
    }

    // Optional k/m/b suffix. We accept exactly one and consume it inline
    // so a follow-up token (`AND`, EOF, etc.) starts at the next char.
    let multiplier = 1;
    if (this.pos < this.input.length) {
      const suffix = this.input[this.pos].toLowerCase();
      if (suffix === 'k') {
        multiplier = 1_000;
        this.pos++;
      } else if (suffix === 'm') {
        multiplier = 1_000_000;
        this.pos++;
      } else if (suffix === 'b') {
        multiplier = 1_000_000_000;
        this.pos++;
      }
    }

    // Strip commas — they are decorative thousands separators in this dialect.
    const cleaned = raw.replace(/,/g, '');
    if (cleaned === '' || cleaned === '.') {
      throw new Error(`Invalid numeric literal at position ${this.pos}`);
    }

    if (multiplier === 1) return cleaned;

    // Apply multiplier without going through float when possible — preserves
    // integer fidelity for `300k` (-> 300000) and tolerates `1.5m` (-> 1500000).
    const asNumber = parseFloat(cleaned);
    if (!Number.isFinite(asNumber)) {
      throw new Error(`Invalid numeric literal '${raw}' at position ${this.pos}`);
    }
    return String(asNumber * multiplier);
  }

  private readIdentifier(): string {
    let result = '';
    while (
      this.pos < this.input.length &&
      /[a-zA-Z0-9_]/.test(this.input[this.pos])
    ) {
      result += this.input[this.pos++];
    }
    return result;
  }

  next(): Token {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      return { type: 'eof', value: '', pos: this.pos };
    }

    const startPos = this.pos;
    const ch = this.input[this.pos];

    // Operators
    if (ch === '<' || ch === '>' || ch === '=' || ch === '!') {
      this.pos++;
      let op = ch;
      if (
        (ch === '<' || ch === '>' || ch === '!' || ch === '=') &&
        this.pos < this.input.length &&
        this.input[this.pos] === '='
      ) {
        op += this.input[this.pos++];
      }
      return { type: 'op', value: op, pos: startPos };
    }

    // Parentheses and comma
    if (ch === '(') {
      this.pos++;
      return { type: 'lparen', value: '(', pos: startPos };
    }
    if (ch === ')') {
      this.pos++;
      return { type: 'rparen', value: ')', pos: startPos };
    }
    if (ch === ',') {
      this.pos++;
      return { type: 'comma', value: ',', pos: startPos };
    }

    // Strings
    if (ch === "'") {
      const str = this.readString("'");
      return { type: 'string', value: str, pos: startPos };
    }

    // Numbers (digit-leading, or `$`-prefixed currency forms like `$300,000`).
    if (/\d/.test(ch) || (ch === '$' && /\d/.test(this.input[this.pos + 1] ?? ''))) {
      const num = this.readNumber();
      return { type: 'number', value: num, pos: startPos };
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      const id = this.readIdentifier();
      if (id.toUpperCase() === 'AND') {
        return { type: 'keyword', value: 'AND', pos: startPos };
      }
      if (id.toUpperCase() === 'IN') {
        return { type: 'keyword', value: 'IN', pos: startPos };
      }
      return { type: 'identifier', value: id, pos: startPos };
    }

    throw new Error(`Unexpected character '${ch}' at position ${this.pos}`);
  }
}

class Parser {
  private tokenizer: Tokenizer;
  private currentToken: Token;

  constructor(input: string) {
    this.tokenizer = new Tokenizer(input);
    this.currentToken = this.tokenizer.next();
  }

  private advance() {
    this.currentToken = this.tokenizer.next();
  }

  private expect(type: Token['type'], value?: string): Token {
    if (this.currentToken.type !== type || (value && this.currentToken.value !== value)) {
      throw new Error(
        `Expected ${type}${value ? ` '${value}'` : ''} but got ${this.currentToken.type} '${this.currentToken.value}' at position ${this.currentToken.pos}`
      );
    }
    const token = this.currentToken;
    this.advance();
    return token;
  }

  parse(): ASTNode {
    const clauses: Clause[] = [];

    // Parse first clause
    clauses.push(this.parseClause());

    // Parse additional clauses with AND
    while (this.currentToken.type === 'keyword' && this.currentToken.value === 'AND') {
      this.advance(); // consume 'AND'
      clauses.push(this.parseClause());
    }

    // Expect EOF
    if (this.currentToken.type !== 'eof') {
      throw new Error(
        `Unexpected token '${this.currentToken.value}' at position ${this.currentToken.pos}. Expected end of expression.`
      );
    }

    return { type: 'expr', clauses };
  }

  private parseClause(): Clause {
    const column = this.expect('identifier').value;
    const opToken = this.expect('op');
    const op = opToken.value as ComparisonOp;

    // Handle 'in' operator
    if (op.toUpperCase() === 'IN' || this.currentToken.value.toUpperCase() === 'IN') {
      // Support both 'in' as operator and as keyword
      if (this.currentToken.type === 'keyword' && this.currentToken.value.toUpperCase() === 'IN') {
        this.advance();
      }
      this.expect('lparen');
      const values: any[] = [];

      if (this.currentToken.type !== 'rparen') {
        values.push(this.parseValue());
        while (this.currentToken.type === 'comma') {
          this.advance(); // consume comma
          values.push(this.parseValue());
        }
      }

      this.expect('rparen');
      return { type: 'clause', column, op: 'in', value: values };
    }

    const value = this.parseValue();
    return { type: 'clause', column, op, value };
  }

  private parseValue(): any {
    if (this.currentToken.type === 'number') {
      const value = this.currentToken.value;
      this.advance();
      // Parse as float or int depending on content
      return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
    }

    if (this.currentToken.type === 'string') {
      const value = this.currentToken.value;
      this.advance();
      return value;
    }

    throw new Error(
      `Expected value (number or string) but got ${this.currentToken.type} '${this.currentToken.value}' at position ${this.currentToken.pos}`
    );
  }
}

/**
 * Parse a filter expression into an AST.
 * @param expr The filter expression string, e.g., "price < 300000 AND state = 'TX'"
 * @returns An AST node
 * @throws If parsing fails
 */
export function parse(expr: string): ASTNode {
  const parser = new Parser(expr);
  return parser.parse();
}
