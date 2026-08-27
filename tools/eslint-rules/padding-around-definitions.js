const FUNCTION_INITS = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression']);

const BLOCK_TYPES = new Set([
  'IfStatement',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
  'SwitchStatement',
  'TryStatement',
]);

function unwrapExport(statement) {
  if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') {
    return statement.declaration ?? statement;
  }

  return statement;
}

function classify(statement) {
  const node = unwrapExport(statement);

  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    return 'definition';
  }

  if (node.type === 'VariableDeclaration') {
    const definesFunction = node.declarations.some(
      (declarator) => declarator.init && FUNCTION_INITS.has(declarator.init.type),
    );

    return definesFunction ? 'definition' : 'variable';
  }

  if (BLOCK_TYPES.has(node.type)) {
    return 'block';
  }

  return 'other';
}

function requiresBlankLine(previous, next) {
  const previousKind = classify(previous);
  const nextKind = classify(next);

  if (previousKind === 'definition' || nextKind === 'definition') {
    return true;
  }

  if (previousKind === 'block' || nextKind === 'block') {
    return true;
  }

  if (previousKind === 'variable' || nextKind === 'variable') {
    return previousKind !== nextKind;
  }

  return next.type === 'ReturnStatement';
}

export default {
  meta: {
    type: 'layout',
    docs: {
      description:
        'Require a blank line around function and class definitions, around control-flow blocks, after a run of variable declarations, and before a return',
    },
    fixable: 'whitespace',
    schema: [],
    messages: {
      expectedBlankLine: 'Expected a blank line before this statement',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;

    function anchorOf(statement) {
      const comments = sourceCode.getCommentsBefore(statement);

      return comments.length > 0 ? comments[0] : statement;
    }

    function check(statements) {
      for (let index = 1; index < statements.length; index += 1) {
        const previous = statements[index - 1];
        const next = statements[index];

        if (!requiresBlankLine(previous, next)) {
          continue;
        }

        const anchor = anchorOf(next);
        const gap = anchor.loc.start.line - previous.loc.end.line;

        if (gap >= 2) {
          continue;
        }

        context.report({
          node: next,
          messageId: 'expectedBlankLine',
          fix: (fixer) => {
            if (gap === 0) {
              return fixer.insertTextBefore(anchor, '\n\n');
            }

            const lineStart = sourceCode.getIndexFromLoc({
              line: anchor.loc.start.line,
              column: 0,
            });

            return fixer.insertTextBeforeRange([lineStart, lineStart], '\n');
          },
        });
      }
    }

    return {
      Program: (node) => check(node.body),
      BlockStatement: (node) => check(node.body),
      StaticBlock: (node) => check(node.body),
      SwitchCase: (node) => check(node.consequent),
    };
  },
};
