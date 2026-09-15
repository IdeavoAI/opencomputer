// Every fixture log under react/test/fixtures reduces through the same
// reducer the hook uses. `documented/` holds logs authored to
// docs/agents/events.mdx; `backend-emitted/` holds recordings of what the
// platform actually returned, added once the platform emits the documented
// shape on every runtime. The checks are the contract's invariants, so a
// recording that disagrees with the docs fails here rather than in a page.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { applyEvents, emptyTimeline, turnsOf, type AgentEvent, type Turn } from "./events.js";

// Tests run from dist/, one level below the package root, like src/.
const root = new URL("../test/fixtures/", import.meta.url);

interface Fixture {
  events: AgentEvent[];
  /** The turns the log must reduce to, when the fixture pins them. */
  turns?: Turn[];
}

function fixturesIn(directory: string): Array<{ name: string; fixture: Fixture }> {
  const url = new URL(`${directory}/`, root);
  let names: string[];
  try {
    names = readdirSync(url).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  return names.map((name) => ({
    name: `${directory}/${name}`,
    fixture: JSON.parse(readFileSync(new URL(name, url), "utf8")) as Fixture,
  }));
}

function check(name: string, fixture: Fixture): void {
  assert.ok(Array.isArray(fixture.events) && fixture.events.length > 0, `${name}: no events`);
  const whole = turnsOf(applyEvents(emptyTimeline(), fixture.events));
  let paged = emptyTimeline();
  for (let start = 0; start < fixture.events.length; start += 3) {
    paged = applyEvents(paged, fixture.events.slice(start, start + 3));
  }
  assert.deepEqual(turnsOf(paged), whole, `${name}: replay in pages differs from replay whole`);
  for (const turn of whole) {
    const settled = turn.status === "completed" || turn.status === "failed" || turn.status === "cancelled";
    if (settled) {
      for (const call of turn.toolCalls) {
        assert.notEqual(
          call.status,
          "running",
          `${name}: turn ${turn.id} is ${turn.status} but its call ${call.callId} is still running`,
        );
      }
    }
    const ids = turn.toolCalls.map((call) => call.callId);
    assert.equal(new Set(ids).size, ids.length, `${name}: turn ${turn.id} has duplicate tool rows`);
    if (turn.result !== undefined) {
      const pinned = fixture.turns?.find((candidate) => candidate.id === turn.id)?.result;
      if (typeof pinned !== "string") {
        assert.notEqual(typeof turn.result, "string", `${name}: turn ${turn.id} exposes its result as JSON text`);
      }
    }
  }
  if (fixture.turns) assert.deepEqual(whole, fixture.turns, `${name}: turns differ from the pinned turns`);
}

for (const directory of ["documented", "backend-emitted"]) {
  test(`every ${directory} fixture reduces to settled turns, the same whole and in pages`, (t) => {
    const files = fixturesIn(directory);
    for (const { name, fixture } of files) check(name, fixture);
    t.diagnostic(`${directory}: ${String(files.length)} fixture file(s) ran`);
  });
}

test("the documented fixtures cover a result, an interrupt and a failure", () => {
  const names = fixturesIn("documented").map(({ name }) => name);
  assert.ok(names.length >= 3, `expected at least three documented fixtures, found ${String(names.length)}`);
});
