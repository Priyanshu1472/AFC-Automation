import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LeadChatPanel from "./LeadChatPanel";

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ profile: { id: "user-1" } }),
}));

vi.mock("../../hooks/useToast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const order = vi.fn();
const invoke = vi.fn();
const rpc = vi.fn();

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table) => {
      if (table === "lead_chat_messages") {
        return { select: () => ({ eq: () => ({ order: (...a) => order(...a) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
    functions: { invoke: (...a) => invoke(...a) },
    rpc: (...a) => rpc(...a),
  },
  extractFunctionErrorMessage: async (error, fallback) => error?.message || fallback,
}));

const SAMPLE_MESSAGES = [
  { id: "m1", lead_id: "lead-1", sender_id: "user-1", message: "Hello team", created_at: "2026-08-25T10:00:00Z" },
  { id: "m2", lead_id: "lead-1", sender_id: "user-2", message: "Looks good", created_at: "2026-08-25T10:05:00Z" },
];

const SAMPLE_PARTICIPANTS = [
  { user_id: "user-1", full_name: "Jane Doe", role: "project_officer", avatar_path: null },
  { user_id: "user-2", full_name: "Bob Smith", role: "dgm", avatar_path: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  order.mockResolvedValue({ data: SAMPLE_MESSAGES, error: null });
  invoke.mockResolvedValue({ data: { success: true }, error: null });
  rpc.mockImplementation(async (fn) => {
    if (fn === "get_lead_chat_participant_names") return { data: SAMPLE_PARTICIPANTS, error: null };
    // Defaults to "on the roster" — the one test that cares about the
    // opposite (not a participant) overrides this per-test.
    if (fn === "is_lead_chat_participant") return { data: true, error: null };
    return { data: null, error: null };
  });
});

// The widget starts collapsed to a floating bubble — every test that needs
// to see the thread has to open it first, same as a real click.
function openWidget() {
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
}

describe("LeadChatPanel", () => {
  it("renders nothing when chatOpenedAt is null (chat hasn't opened yet)", () => {
    const { container } = render(<LeadChatPanel leadId="lead-1" chatOpenedAt={null} locked={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a caller who isn't on this lead's chat roster, even once the chat is open", async () => {
    rpc.mockImplementation(async (fn) => {
      if (fn === "is_lead_chat_participant") return { data: false, error: null };
      return { data: null, error: null };
    });
    const { container } = render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("is_lead_chat_participant", { p_lead_id: "lead-1" }));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Open chat" })).not.toBeInTheDocument();
  });

  it("renders only a floating bubble until clicked, once confirmed as a participant", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open chat" })).toBeInTheDocument());
    expect(screen.queryByText("Hello team")).not.toBeInTheDocument();
    expect(order).not.toHaveBeenCalled();
  });

  it("renders messages with sender names once the bubble is opened", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => screen.getByRole("button", { name: "Open chat" }));
    openWidget();
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
  });

  it("marks the chat read for this lead once the bubble is opened", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => screen.getByRole("button", { name: "Open chat" }));
    openWidget();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mark_lead_chat_read", { p_lead_id: "lead-1" }));
  });

  it("shows a locked message and hides the input once the lead is approved", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked />);
    await waitFor(() => screen.getByRole("button", { name: "Open chat" }));
    openWidget();
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());
    expect(screen.getByText("Chat closed — this lead has been approved.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a message… use @ to tag someone")).not.toBeInTheDocument();
  });

  it("sends a message via send-lead-chat-message with the right body", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => screen.getByRole("button", { name: "Open chat" }));
    openWidget();
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText("Type a message… use @ to tag someone");
    fireEvent.change(textarea, { target: { value: "New update" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("send-lead-chat-message", {
        body: { lead_id: "lead-1", message: "New update", mentioned_user_ids: [] },
      })
    );
  });

  it("the send button is disabled when the draft is empty", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => screen.getByRole("button", { name: "Open chat" }));
    openWidget();
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });
});
