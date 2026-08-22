import { expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolModule } from "../src/module";
import { createServer } from "../src/server";

/** A module the server has never heard of, standing in for whatever gets built next. */
function stubModule(name: string, onRegister: (server: McpServer) => void = () => {}): ToolModule {
  return { name, migrations: [], register: onRegister };
}

test("mounts unrelated modules in the order they are listed", () => {
  const mounted: string[] = [];
  createServer([
    stubModule("first", () => mounted.push("first")),
    stubModule("second", () => mounted.push("second")),
  ]);
  expect(mounted).toEqual(["first", "second"]);
});

test("a module needs nothing but a name, migrations, and register", () => {
  expect(() => createServer([stubModule("standalone")])).not.toThrow();
});

test("refuses two modules with the same name", () => {
  expect(() => createServer([stubModule("resume-review"), stubModule("resume-review")])).toThrow(
    'Two modules are both named "resume-review"',
  );
});

test("no module is mounted unless it is passed in", () => {
  const mounted: string[] = [];
  createServer([stubModule("only-me", () => mounted.push("only-me"))]);
  expect(mounted).toEqual(["only-me"]);
});
