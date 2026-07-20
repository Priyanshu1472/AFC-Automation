// src/components/ui/DatePickerCalendar.jsx
// Custom themed date picker — replaces the native <input type="date">
// calendar, which can't be restyled and ignores the app's light/dark theme.
// Ported from the previous AFC empanelment app's DatePickerCalendar.
// Value format: "YYYY-MM-DD"
import { useState, useRef, useEffect } from "react";
import "../../styles/DatePickerCalendar.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseDate(val) {
  if (!val) return null;
  const [y, m, d] = val.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m - 1, day: d };
}

function formatDisplay(val) {
  const d = parseDate(val);
  if (!d) return "";
  return `${d.day} ${MONTHS_SHORT[d.month]} ${d.year}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function DatePickerCalendar({ value, onChange, placeholder = "Select date" }) {
  const parsed = parseDate(value);
  const today = new Date();

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.year || today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth());
  const [mode, setMode] = useState("day"); // "day" | "month" | "year"
  const [yearPage, setYearPage] = useState(Math.floor((parsed?.year || today.getFullYear()) / 12) * 12);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open) setMode("day");
  }, [open]);

  function handleDayClick(day) {
    const mm = String(viewMonth + 1).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    onChange(`${viewYear}-${mm}-${dd}`);
    setOpen(false);
  }

  function handleMonthClick(m) {
    setViewMonth(m);
    setMode("day");
  }

  function handleYearClick(y) {
    setViewYear(y);
    setMode("month");
  }

  function handleToday() {
    const t = new Date();
    const y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
    setViewYear(y); setViewMonth(m);
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    onChange(`${y}-${mm}-${dd}`);
    setOpen(false);
  }

  function handleClear() { onChange(""); setOpen(false); }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  }

  const totalDays = daysInMonth(viewYear, viewMonth);
  const firstDay = firstDayOfMonth(viewYear, viewMonth);
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);

  const isSelected = (d) => !!parsed && d && parsed.year === viewYear && parsed.month === viewMonth && parsed.day === d;
  const isToday = (d) => !!d && today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;

  return (
    <div ref={ref} className="dpc-root">
      <button type="button" className={`dpc-trigger${open ? " dpc-trigger--open" : ""}${!value ? " dpc-trigger--empty" : ""}`} onClick={() => setOpen((o) => !o)}>
        <div className="dpc-trigger-inner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="dpc-cal-icon">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>{value ? formatDisplay(value) : placeholder}</span>
        </div>
        <svg className={`dpc-chevron${open ? " dpc-chevron--open" : ""}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="dpc-panel">
          {mode === "day" && (
            <>
              <div className="dpc-nav">
                <button type="button" className="dpc-nav-btn" onClick={prevMonth}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <button type="button" className="dpc-header-btn" onClick={() => setMode("month")}>{MONTHS[viewMonth]} {viewYear}</button>
                <button type="button" className="dpc-nav-btn" onClick={nextMonth}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>

              <div className="dpc-grid">
                {DAYS.map((d) => <div key={d} className="dpc-day-label">{d}</div>)}
                {cells.map((day, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`dpc-day${!day ? " dpc-day--empty" : ""}${isSelected(day) ? " dpc-day--selected" : ""}${isToday(day) && !isSelected(day) ? " dpc-day--today" : ""}`}
                    onClick={() => day && handleDayClick(day)}
                    disabled={!day}
                  >
                    {day || ""}
                  </button>
                ))}
              </div>

              <div className="dpc-footer">
                <button type="button" className="dpc-footer-btn" onClick={handleClear}>Clear</button>
                <button type="button" className="dpc-footer-btn dpc-footer-btn--today" onClick={handleToday}>Today</button>
              </div>
            </>
          )}

          {mode === "month" && (
            <>
              <div className="dpc-nav">
                <button type="button" className="dpc-nav-btn" onClick={() => setViewYear((y) => y - 1)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <button type="button" className="dpc-header-btn" onClick={() => setMode("year")}>{viewYear}</button>
                <button type="button" className="dpc-nav-btn" onClick={() => setViewYear((y) => y + 1)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>

              <div className="dpc-month-grid">
                {MONTHS_SHORT.map((m, i) => (
                  <button
                    key={m}
                    type="button"
                    className={`dpc-month-btn${viewMonth === i && parsed?.year === viewYear ? " dpc-month-btn--selected" : ""}${today.getMonth() === i && today.getFullYear() === viewYear ? " dpc-month-btn--today" : ""}`}
                    onClick={() => handleMonthClick(i)}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="dpc-footer">
                <button type="button" className="dpc-footer-btn" onClick={() => setMode("day")}>Back</button>
              </div>
            </>
          )}

          {mode === "year" && (
            <>
              <div className="dpc-nav">
                <button type="button" className="dpc-nav-btn" onClick={() => setYearPage((y) => y - 12)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <span className="dpc-header-label">{yearPage} – {yearPage + 11}</span>
                <button type="button" className="dpc-nav-btn" onClick={() => setYearPage((y) => y + 12)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>

              <div className="dpc-year-grid">
                {Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => (
                  <button key={y} type="button" className={`dpc-year-btn${viewYear === y ? " dpc-year-btn--selected" : ""}${today.getFullYear() === y ? " dpc-year-btn--today" : ""}`} onClick={() => handleYearClick(y)}>
                    {y}
                  </button>
                ))}
              </div>

              <div className="dpc-footer">
                <button type="button" className="dpc-footer-btn" onClick={() => setMode("month")}>Back</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
