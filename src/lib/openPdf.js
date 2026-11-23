// Calls a PDF-rendering edge function (returns { success, pdf_base64 }) and
// opens the PDF in a new tab. Throws with a readable message on failure.
import { supabase, extractFunctionErrorMessage } from "./supabase";

export async function openPdfFromFunction(fn, body, fallback = "Could not open the note.") {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(await extractFunctionErrorMessage(error, fallback));
  if (!data?.success || !data?.pdf_base64) throw new Error(data?.error || fallback);
  const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
