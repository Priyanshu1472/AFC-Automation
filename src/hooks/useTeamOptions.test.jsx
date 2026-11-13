import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTeamOptions } from "./useTeamOptions";

// Mirrors supabase-js's real behaviour closely enough to catch the bug this
// guards against: .channel(topic) dedupes by topic, returning the SAME
// channel to a second caller, and .on() throws once that channel is already
// subscribed — exactly what happened when two components called
// useTeamOptions() with the same hard-coded topic on the same page at once.
const channelsByTopic = new Map();
function fakeChannel(topic) {
  let existing = channelsByTopic.get(topic);
  if (existing) return existing;
  const chan = {
    subscribed: false,
    on() {
      if (this.subscribed) throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`);
      return this;
    },
    subscribe() {
      this.subscribed = true;
      return this;
    },
  };
  channelsByTopic.set(topic, chan);
  return chan;
}

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ not: () => Promise.resolve({ data: [], error: null }) }) }),
    channel: (topic) => fakeChannel(topic),
    removeChannel: vi.fn(),
  },
}));

function TwoInstances() {
  useTeamOptions();
  useTeamOptions();
  return null;
}

it("two components calling useTeamOptions at once on the same page don't collide on a shared channel topic", () => {
  expect(() => render(<TwoInstances />)).not.toThrow();
});
