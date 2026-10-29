import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import ProfileAvatar from "./ProfileAvatar";
import { ROLE_LABELS } from "../../lib/roles";
import "../../styles/MentionInput.css";

const MIN_HEIGHT = 40;
const MAX_HEIGHT = 120;

function resize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_HEIGHT), MAX_HEIGHT)}px`;
}

// A chat textarea with "@" tagging: typing "@" opens a dropdown of the
// chat's participants (name, designation, profile photo); picking one
// inserts "@Full Name " into the draft and remembers that id. The caller
// reads which mentions are still present in the message text at send time
// via the ref (`getMentionedIds`), rather than this component tracking
// state the parent would otherwise have to mirror — a mention is "still
// there" simply if its inserted name still appears in the text, so editing
// or deleting it un-mentions them without any extra bookkeeping.
const MentionInput = forwardRef(function MentionInput(
  { value, onChange, onEnterSend, participants, selfId, placeholder, disabled, className = "" },
  ref
) {
  const textareaRef = useRef(null);
  const mentionsRef = useRef(new Map());
  const [query, setQuery] = useState(null);
  const [triggerIndex, setTriggerIndex] = useState(-1);
  const [highlighted, setHighlighted] = useState(0);

  useImperativeHandle(ref, () => ({
    getMentionedIds(text) {
      const ids = [];
      mentionsRef.current.forEach((name, id) => {
        if (text.includes(`@${name}`)) ids.push(id);
      });
      return ids;
    },
    clearMentions() {
      mentionsRef.current.clear();
    },
    resetHeight() {
      if (textareaRef.current) textareaRef.current.style.height = `${MIN_HEIGHT}px`;
    },
    focus() {
      textareaRef.current?.focus();
    },
  }));

  function closeMenu() {
    setQuery(null);
    setTriggerIndex(-1);
  }

  const candidates =
    query === null
      ? []
      : (participants || [])
          .filter((p) => p.user_id !== selfId)
          .filter((p) => !query || (p.full_name || "").toLowerCase().includes(query.toLowerCase()))
          .slice(0, 6);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  function handleChange(e) {
    const text = e.target.value;
    onChange(text);
    resize(e.target);

    const caret = e.target.selectionStart ?? text.length;
    const upToCaret = text.slice(0, caret);
    const at = upToCaret.lastIndexOf("@");
    if (at === -1 || /\s/.test(upToCaret.slice(at + 1))) {
      closeMenu();
      return;
    }
    setQuery(upToCaret.slice(at + 1));
    setTriggerIndex(at);
  }

  function selectCandidate(p) {
    if (!p) return;
    const el = textareaRef.current;
    const caret = el ? el.selectionStart ?? value.length : value.length;
    const before = value.slice(0, triggerIndex);
    const after = value.slice(caret);
    const inserted = `@${p.full_name} `;
    mentionsRef.current.set(p.user_id, p.full_name);
    onChange(`${before}${inserted}${after}`);
    closeMenu();
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = before.length + inserted.length;
      el.selectionStart = el.selectionEnd = pos;
      resize(el);
    });
  }

  function handleKeyDown(e) {
    if (query !== null && candidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % candidates.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectCandidate(candidates[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onEnterSend?.();
    }
  }

  return (
    <div className="mention-input-wrap">
      {query !== null && candidates.length > 0 && (
        <div className="mention-dropdown" role="listbox">
          {candidates.map((p, i) => (
            <button
              type="button"
              key={p.user_id}
              role="option"
              aria-selected={i === highlighted}
              className={`mention-option${i === highlighted ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectCandidate(p);
              }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <ProfileAvatar profile={p} className="mention-option-avatar" />
              <span className="mention-option-text">
                <span className="mention-option-name">{p.full_name}</span>
                <span className="mention-option-role">{ROLE_LABELS[p.role] || p.role}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        className={className}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
});

export default MentionInput;
