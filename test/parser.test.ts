import { describe, expect, it } from "vitest";

import { parseLuaFile } from "../src/parser.js";

describe("Lua parser Phase 1 最小提取", () => {
  it("从内联 fixture 提取 class、method 和 function 符号", () => {
    const source = [
      'SlotMachine = class("SlotMachine", BaseGame)',
      "",
      "function SlotMachine:spin()",
      "end",
      "",
      "local function scoreRound()",
      "end",
      "",
      "function createSession()",
      "end",
    ].join("\n");

    const file = parseLuaFile("src/game.lua", source);

    expect(file).toEqual({
      type: "File",
      path: "src/game.lua",
      symbols: [
        {
          type: "Symbol",
          id: "src/game.lua#class#SlotMachine#1:1",
          kind: "class",
          name: "SlotMachine",
          qualifiedName: "SlotMachine",
          filePath: "src/game.lua",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 44,
          signature: 'SlotMachine = class("SlotMachine", BaseGame)',
          isLocal: false,
          isExported: true,
          isUnresolved: false,
        },
        {
          type: "Symbol",
          id: "src/game.lua#method#SlotMachine:spin#3:1",
          kind: "method",
          name: "spin",
          qualifiedName: "SlotMachine:spin",
          filePath: "src/game.lua",
          startLine: 3,
          startColumn: 1,
          endLine: 3,
          endColumn: 27,
          signature: "function SlotMachine:spin()",
          isLocal: false,
          isExported: true,
          isUnresolved: false,
        },
        {
          type: "Symbol",
          id: "src/game.lua#function#scoreRound#6:1",
          kind: "function",
          name: "scoreRound",
          qualifiedName: "scoreRound",
          filePath: "src/game.lua",
          startLine: 6,
          startColumn: 1,
          endLine: 6,
          endColumn: 27,
          signature: "local function scoreRound()",
          isLocal: true,
          isExported: false,
          isUnresolved: false,
        },
        {
          type: "Symbol",
          id: "src/game.lua#function#createSession#9:1",
          kind: "function",
          name: "createSession",
          qualifiedName: "createSession",
          filePath: "src/game.lua",
          startLine: 9,
          startColumn: 1,
          endLine: 9,
          endColumn: 24,
          signature: "function createSession()",
          isLocal: false,
          isExported: true,
          isUnresolved: false,
        },
      ],
    });
  });

  it("记录声明起点列号用于稳定 id", () => {
    const file = parseLuaFile("src/nested.lua", "  function Player:enter()\nend");

    expect(file.symbols[0]?.id).toBe("src/nested.lua#method#Player:enter#1:3");
    expect(file.symbols[0]?.startColumn).toBe(3);
  });
});
