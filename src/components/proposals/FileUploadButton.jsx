// A visible button that triggers a hidden file input via a ref and a
// direct `.click()` call — deliberately not the <label htmlFor> pattern,
// so there's no id/for indirection that can silently break.
import { useRef } from "react";
import Button from "../ui/Button";

export default function FileUploadButton({ label, onSelect, disabled, size = "sm", variant = "secondary" }) {
  const inputRef = useRef(null);

  return (
    <>
      <input
        type="file"
        ref={inputRef}
        style={{ display: "none" }}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0] || null;
          e.target.value = "";
          if (file) onSelect(file);
        }}
      />
      <Button type="button" variant={variant} size={size} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
    </>
  );
}
