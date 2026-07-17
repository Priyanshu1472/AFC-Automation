import Tooltip from "./ui/Tooltip";
import { InfoIcon } from "./icons";

// A small (i) icon with a hover/focus tooltip — for explaining a field or
// action inline next to its label, without cluttering the layout with
// permanent help text.
export default function FieldTooltip({ text, position = "top" }) {
  return (
    <Tooltip text={text} position={position}>
      <span
        tabIndex={0}
        style={{ display: "inline-flex", color: "var(--text-tertiary)", cursor: "help", verticalAlign: "middle" }}
        aria-label={text}
      >
        <InfoIcon />
      </span>
    </Tooltip>
  );
}
