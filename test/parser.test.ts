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
      extends: [
        {
          type: "Extends",
          filePath: "src/game.lua",
          childQualifiedName: "SlotMachine",
          parentQualifiedName: "BaseGame",
          line: 1,
          column: 1,
        },
      ],
      calls: [
        {
          type: "Call",
          filePath: "src/game.lua",
          calleeQualifiedName: "class",
          line: 1,
          column: 15,
        },
      ],
      requires: [],
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

  it("提取函数体中的静态调用表达式", () => {
    const source = [
      "function init()",
      "  foo()",
      "  M.foo()",
      "  obj:foo()",
      '  print("skip()") -- commentCall()',
      "end",
    ].join("\n");

    const file = parseLuaFile("src/calls.lua", source);

    expect(
      file.calls.map((call) => ({
        calleeQualifiedName: call.calleeQualifiedName,
        line: call.line,
        column: call.column,
      })),
    ).toEqual([
      { calleeQualifiedName: "foo", line: 2, column: 3 },
      { calleeQualifiedName: "M.foo", line: 3, column: 3 },
      { calleeQualifiedName: "obj:foo", line: 4, column: 3 },
      { calleeQualifiedName: "print", line: 5, column: 3 },
    ]);
  });

  it("提取静态和动态 require 表达式", () => {
    const source = [
      'local M = require("foo.bar")',
      'require("plain.module")',
      "require 'SlotsNew.feature.ThemeFeatureBase'",
      'local D = require("base." .. name)',
      'local skipped = "-- require(\\"comment\\")"',
      '-- require("commented")',
    ].join("\n");

    const file = parseLuaFile("src/main.lua", source);

    expect(file.requires).toEqual([
      {
        type: "Require",
        filePath: "src/main.lua",
        moduleName: "foo.bar",
        isStatic: true,
        line: 1,
        column: 11,
      },
      {
        type: "Require",
        filePath: "src/main.lua",
        moduleName: "plain.module",
        isStatic: true,
        line: 2,
        column: 1,
      },
      {
        type: "Require",
        filePath: "src/main.lua",
        moduleName: "SlotsNew.feature.ThemeFeatureBase",
        isStatic: true,
        line: 3,
        column: 1,
      },
      {
        type: "Require",
        filePath: "src/main.lua",
        moduleName: '"base." .. name',
        isStatic: false,
        line: 4,
        column: 11,
      },
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

  it("提取 setmetatable 的确定继承关系", () => {
    const source = [
      "Parent = {}",
      "SlotsBaseDelegate = {}",
      "local Child = setmetatable({}, { __index = Parent })",
      "GrandChild = setmetatable({}, { __index = Child })",
      "local ThemeExpandSymbolFeature = class('ThemeExpandSymbolFeature', ThemeFeatureBase)",
      "SlotsMarketDelegate = class('SlotsMarketDelegate', SlotsBaseDelegate)",
      "SlotsSystemDelegate = class('SlotsSystemDelegate', SlotsBaseDelegate)",
      "T.__index = T",
      "Dynamic = setmetatable({}, { __index = getParent() })",
    ].join("\n");

    const file = parseLuaFile("src/inherit.lua", source);

    expect(file.symbols.map((symbol) => [symbol.kind, symbol.qualifiedName, symbol.isLocal])).toEqual([
      ["table", "Parent", false],
      ["table", "SlotsBaseDelegate", false],
      ["class", "Child", true],
      ["class", "GrandChild", false],
      ["class", "ThemeExpandSymbolFeature", true],
      ["class", "SlotsMarketDelegate", false],
      ["class", "SlotsSystemDelegate", false],
    ]);
    expect(file.extends).toEqual([
      {
        type: "Extends",
        filePath: "src/inherit.lua",
        childQualifiedName: "Child",
        parentQualifiedName: "Parent",
        line: 3,
        column: 1,
      },
      {
        type: "Extends",
        filePath: "src/inherit.lua",
        childQualifiedName: "GrandChild",
        parentQualifiedName: "Child",
        line: 4,
        column: 1,
      },
      {
        type: "Extends",
        filePath: "src/inherit.lua",
        childQualifiedName: "ThemeExpandSymbolFeature",
        parentQualifiedName: "ThemeFeatureBase",
        line: 5,
        column: 1,
      },
      {
        type: "Extends",
        filePath: "src/inherit.lua",
        childQualifiedName: "SlotsMarketDelegate",
        parentQualifiedName: "SlotsBaseDelegate",
        line: 6,
        column: 1,
      },
      {
        type: "Extends",
        filePath: "src/inherit.lua",
        childQualifiedName: "SlotsSystemDelegate",
        parentQualifiedName: "SlotsBaseDelegate",
        line: 7,
        column: 1,
      },
    ]);
  });
});
