import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PinInput from "./PinInput";

// A thin controlled wrapper — PinInput's `value`/`onChange` contract mirrors
// a plain text Input (single string in, single string out), so tests drive
// it the same way a real form would.
function Controlled(props) {
  const [value, setValue] = useState(props.initial || "");
  return <PinInput {...props} value={value} onChange={setValue} />;
}

describe("PinInput", () => {
  it("renders one box per digit (4 by default)", () => {
    render(<Controlled label="PIN" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(4);
  });

  it("only accepts digits, stripping any letters typed", () => {
    render(<Controlled label="PIN" />);
    const boxes = screen.getAllByRole("textbox");
    fireEvent.change(boxes[0], { target: { value: "a" } });
    expect(boxes[0].value).toBe("");
    fireEvent.change(boxes[0], { target: { value: "7" } });
    expect(boxes[0].value).toBe("7");
  });

  it("auto-advances focus to the next box after a digit", () => {
    render(<Controlled label="PIN" />);
    const boxes = screen.getAllByRole("textbox");
    boxes[0].focus();
    fireEvent.change(boxes[0], { target: { value: "1" } });
    expect(document.activeElement).toBe(boxes[1]);
  });

  it("Backspace on an empty box moves focus back to the previous one", () => {
    render(<Controlled label="PIN" />);
    const boxes = screen.getAllByRole("textbox");
    boxes[1].focus();
    fireEvent.keyDown(boxes[1], { key: "Backspace" });
    expect(document.activeElement).toBe(boxes[0]);
  });

  it("a multi-digit paste distributes across the remaining boxes", () => {
    render(<Controlled label="PIN" />);
    const boxes = screen.getAllByRole("textbox");
    boxes[0].focus();
    fireEvent.paste(boxes[0], { clipboardData: { getData: () => "1234" } });
    expect(boxes.map((b) => b.value)).toEqual(["1", "2", "3", "4"]);
  });

  it("shows the error state and message", () => {
    render(<Controlled label="PIN" error="Incorrect PIN." />);
    expect(screen.getByText("Incorrect PIN.")).toBeInTheDocument();
  });

  it("respects a custom length", () => {
    render(<Controlled label="Code" length={6} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("disables every box when disabled", () => {
    render(<Controlled label="PIN" disabled />);
    for (const box of screen.getAllByRole("textbox")) expect(box).toBeDisabled();
  });
});
