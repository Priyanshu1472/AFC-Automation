import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Select from "./Select";

// A thin controlled wrapper — Select's value/onChange contract mirrors a
// plain form field, so tests drive it the same way a real form would.
function Controlled(props) {
  const [value, setValue] = useState(props.initial || "");
  return <Select {...props} value={value} onChange={setValue} />;
}

const TEAM_OPTIONS = ["BPDD", "BIID"];

describe("Select (creatable)", () => {
  it("picking an existing option shows its label", () => {
    render(<Controlled creatable options={TEAM_OPTIONS} placeholder="Select a team" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("BPDD"));
    expect(screen.getByRole("combobox")).toHaveValue("BPDD");
  });

  it("typing a name that isn't in options shows a '+ Add' entry", () => {
    render(<Controlled creatable options={TEAM_OPTIONS} placeholder="Select a team" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Mumbai-West" } });
    expect(screen.getByText(/\+ Add/)).toBeInTheDocument();
  });

  // Regression test — commitCreate used to correctly call onChange, but the
  // display-sync effect then immediately reset the input back to blank
  // because the freshly created value wasn't in `options` yet, making the
  // click look like it did nothing (see useTeamOptions/Select.jsx).
  it("clicking '+ Add' keeps the new value displayed instead of blanking the input", () => {
    render(<Controlled creatable options={TEAM_OPTIONS} placeholder="Select a team" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Mumbai-West" } });
    fireEvent.click(screen.getByText(/\+ Add/));
    expect(input).toHaveValue("Mumbai-West");
  });

  it("pressing Enter on a '+ Add' match also commits it without blanking the input", () => {
    render(<Controlled creatable options={TEAM_OPTIONS} placeholder="Select a team" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Delhi-North" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Delhi-North");
  });

  it("a value not present in options at all (e.g. an already-created team) still displays instead of showing blank", () => {
    render(<Controlled creatable options={TEAM_OPTIONS} initial="Chennai-South" placeholder="Select a team" />);
    expect(screen.getByRole("combobox")).toHaveValue("Chennai-South");
  });
});
