# Code Review Rules

Rules that every change is reviewed against, before and after it is written. Each rule carries three parts on purpose: what the rule is, why it exists, and how it is checked. A rule nobody can check is a rule nobody enforces.

Rules are numbered so a finding can be reported in one line — `CR-1, src/api/server.js:22`.

These rules sit next to, not instead of, the architectural and security rules in `docs/guidelines.md`.

## CR-1 — Blank lines around definitions and blocks

Code is read far more often than it is written, and the eye finds a definition by the space around it, not by the keyword.

**Rule**

- Variable declarations may follow each other with no blank line between them.
- A statement that defines a function or a class has a blank line before and after it. This covers every form: `function parse() {}`, `export function parse() {}`, `const parse = () => {}`, `class Client {}`.
- A control-flow block — `if` / `else`, `for`, `while`, `do`, `switch`, `try` — has a blank line before and after it.
- A run of variable declarations is separated by a blank line from whatever is not a variable declaration, on both sides — the statement that follows it and the statement that precedes it.
- `return` has a blank line before it, unless it is the first statement in its block.
- Class members are separated by a blank line, except single-line ones.

The first and last statement of a block need no padding against the enclosing braces.

```js
const price = 0;
const text = '';

const parseText = () => {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed;
};

export function formatPrice(value) {
  return `${value} TL`;
}
```

**Why**

Definitions and branches are the landmarks of a file. Packed against their neighbours they stop being landmarks, and a reader has to parse the syntax to find where one unit ends and the next begins.

**How it is checked**

`npm run lint` in `backend/` and in `dashboard/`. `npx eslint . --fix` inserts the missing lines, and the fix is idempotent — a second run changes nothing.

The rule is implemented in `tools/eslint-rules/padding-around-definitions.js`, shared by both packages. ESLint's stock `padding-line-between-statements` cannot express it: it classifies `export function parse() {}` as an _export_ rather than a _function_, and `const parse = () => {}` as a _variable_, so both of the forms this codebase uses most would go unchecked.
