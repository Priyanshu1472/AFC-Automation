// How each of a lead's Business Partners is involved. The first BP's
// choice is leads.bp_association; every BP with its own choice is in
// leads.bp_list ([{ name, association }], kept by a DB trigger).
export const BP_ASSOCIATION_LABELS = {
  consortium_jv: "Consortium/JV",
  independent_bp_inputs: "Independent (with BP Inputs)",
};

// Every BP on a lead, in order, with its arrangement label.
export function bpListOf(lead) {
  if (Array.isArray(lead?.bp_list) && lead.bp_list.length) {
    return lead.bp_list.map((b) => ({ name: b.name, arrangement: BP_ASSOCIATION_LABELS[b.association] || "" }));
  }
  return [];
}

// "A (Consortium/JV) & B (Independent (with BP Inputs))" — one line for a
// note or a table cell; falls back to the plain names.
export function bpListText(lead, fallback = "") {
  const list = bpListOf(lead);
  if (!list.length) return lead?.bp_names || fallback;
  return list.map((b) => (b.arrangement ? `${b.name} (${b.arrangement})` : b.name)).join(" & ");
}
