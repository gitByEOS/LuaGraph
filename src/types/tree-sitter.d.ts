declare module "tree-sitter" {
  class Parser {
    parse(source: string): Parser.Tree;
    setLanguage(language: unknown): void;
  }

  namespace Parser {
    type Point = {
      readonly row: number;
      readonly column: number;
    };

    type Tree = {
      readonly rootNode: SyntaxNode;
    };

    type SyntaxNode = {
      readonly type: string;
      readonly text: string;
      readonly startPosition: Point;
      readonly endPosition: Point;
      readonly parent: SyntaxNode | null;
      readonly namedChildren: readonly SyntaxNode[];
      descendantsOfType(types: string | readonly string[]): SyntaxNode[];
    };
  }

  export default Parser;
}
