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

describe("Select (searchable)", () => {
  it("typing filters the option list, unlike a plain (non-searchable) Select's button trigger", () => {
    render(<Controlled searchable options={TEAM_OPTIONS} placeholder="Select a team" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "BI" } });
    expect(screen.getByText("BIID")).toBeInTheDocument();
    expect(screen.queryByText("BPDD")).not.toBeInTheDocument();
  });

  it("picking an existing option shows its label", () => {
    render(<Controlled searchable options={TEAM_OPTIONS} placeholder="Select a team" />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("BPDD"));
    expect(screen.getByRole("combobox")).toHaveValue("BPDD");
  });

  it("unlike creatable, typing a name that isn't in options never offers a '+ Add' entry", () => {
    render(<Controlled searchable options={TEAM_OPTIONS} placeholder="Select a team" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Mumbai-West" } });
    expect(screen.queryByText(/\+ Add/)).not.toBeInTheDocument();
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("closing without picking anything reverts the typed text back to the selected value", () => {
    render(<Controlled searchable options={TEAM_OPTIONS} initial="BPDD" placeholder="Select a team" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "xyz" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("BPDD");
  });

  // Regression test — an edit form typically sets `value` to an id straight
  // from the loaded record, before the matching option list (a separate
  // async fetch) has arrived. The display-sync effect used to key only off
  // `value`, which never changes again once options do load — leaving the
  // raw id stuck in the input forever instead of resolving to the person's
  // name (see LeadForm.jsx's Person Responsible/Reviewer fields).
  it("resolves to the matching label once options arrive after value was already set", () => {
    function LateOptions() {
      const [options, setOptions] = useState([]);
      return (
        <>
          <Select searchable options={options} value="user-1" onChange={() => {}} placeholder="Select a person" />
          <button onClick={() => setOptions([{ value: "user-1", label: "Jane Doe" }])}>load</button>
        </>
      );
    }
    render(<LateOptions />);
    const input = screen.getByRole("combobox");
    expect(input).toHaveValue("user-1");
    fireEvent.click(screen.getByText("load"));
    expect(input).toHaveValue("Jane Doe");
  });
});
