// Knowledge Repository contract values are stored in crore
// (projects.summary.capitalCost, also what experience-import writes and what
// find_relevant_experience filters on) but shown and entered in lakh.
// 1 crore = 100 lakh. Blank or non-numeric input returns "".

function toNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function croreToLakh(crore) {
  const n = toNumber(crore);
  return n === null ? "" : Number((n * 100).toFixed(4));
}

export function lakhToCrore(lakh) {
  const n = toNumber(lakh);
  return n === null ? "" : Number((n / 100).toFixed(6));
}
