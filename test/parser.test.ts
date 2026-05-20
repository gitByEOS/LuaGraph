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
          endLine: 4,
          endColumn: 3,
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
          endLine: 7,
          endColumn: 3,
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
          endLine: 10,
          endColumn: 3,
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

  it("区分 class 声明和普通配置 table", () => {
    const source = [
      'Player = class("Player")',
      "DinerConfig = {",
      "  meditation = {",
      "  }",
      "}",
    ].join("\n");

    const file = parseLuaFile("src/config.lua", source);

    expect(file.symbols.map((symbol) => [symbol.kind, symbol.qualifiedName])).toEqual([
      ["class", "Player"],
      ["table", "DinerConfig"],
    ]);
  });

  it("用黄金样本对账函数范围和漏识别符号", () => {
    const source = [
      'Player = class("Player", Base)',
      "PlayerConfig = {}",
      "function createSession()",
      "  if enabled then",
      "    do",
      "      for index = 1, 2 do",
      "        print(index)",
      "      end",
      "    end",
      "  end",
      "end",
      "local function scoreRound()",
      "  return 1",
      "end",
      "function Player.start()",
      "  while ready do",
      "    break",
      "  end",
      "end",
      "function Player:spin()",
      "  local function nestedBonus()",
      "    if active then",
      "      return true",
      "    end",
      "  end",
      "  return nestedBonus()",
      "end",
    ].join("\n");

    const file = parseLuaFile("src/player.lua", source);

    expect(
      file.symbols.map((symbol) => ({
        kind: symbol.kind,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        signature: symbol.signature,
      })),
    ).toEqual([
      {
        kind: "class",
        name: "Player",
        qualifiedName: "Player",
        startLine: 1,
        endLine: 1,
        signature: 'Player = class("Player", Base)',
      },
      {
        kind: "table",
        name: "PlayerConfig",
        qualifiedName: "PlayerConfig",
        startLine: 2,
        endLine: 2,
        signature: "PlayerConfig = {}",
      },
      {
        kind: "function",
        name: "createSession",
        qualifiedName: "createSession",
        startLine: 3,
        endLine: 11,
        signature: "function createSession()",
      },
      {
        kind: "function",
        name: "scoreRound",
        qualifiedName: "scoreRound",
        startLine: 12,
        endLine: 14,
        signature: "local function scoreRound()",
      },
      {
        kind: "method",
        name: "start",
        qualifiedName: "Player.start",
        startLine: 15,
        endLine: 19,
        signature: "function Player.start()",
      },
      {
        kind: "method",
        name: "spin",
        qualifiedName: "Player:spin",
        startLine: 20,
        endLine: 27,
        signature: "function Player:spin()",
      },
      {
        kind: "function",
        name: "nestedBonus",
        qualifiedName: "nestedBonus",
        startLine: 21,
        endLine: 25,
        signature: "local function nestedBonus()",
      },
    ]);
  });
});
