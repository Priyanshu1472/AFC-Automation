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
  { id: "m1", lead_id: "lead-1", sender_id: "user-1", message: "Hello team", created_at: "2026-08-25T10:00:00Z", sender: { full_name: "Jane Doe" } },
  { id: "m2", lead_id: "lead-1", sender_id: "user-2", message: "Looks good", created_at: "2026-08-25T10:05:00Z", sender: { full_name: "Bob Smith" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  order.mockResolvedValue({ data: SAMPLE_MESSAGES, error: null });
  invoke.mockResolvedValue({ data: { success: true }, error: null });
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("LeadChatPanel", () => {
  it("renders nothing when chatOpenedAt is null (chat hasn't opened yet)", () => {
    const { container } = render(<LeadChatPanel leadId="lead-1" chatOpenedAt={null} locked={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders messages with sender names once chat is open", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Bob Smith")).toBeInTheDocument();
    expect(screen.getByText("Looks good")).toBeInTheDocument();
  });

  it("marks the chat read for this lead once messages are fetched", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("mark_lead_chat_read", { p_lead_id: "lead-1" }));
  });

  it("shows a locked message and hides the input once the lead is approved", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked />);
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());
    expect(screen.getByText("Chat closed — this lead has been approved.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a message…")).not.toBeInTheDocument();
  });

  it("sends a message via send-lead-chat-message with the right body", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText("Type a message…");
    fireEvent.change(textarea, { target: { value: "New update" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("send-lead-chat-message", { body: { lead_id: "lead-1", message: "New update" } })
    );
  });

  it("the Send button is disabled when the draft is empty", async () => {
    render(<LeadChatPanel leadId="lead-1" chatOpenedAt="2026-08-25T00:00:00Z" locked={false} />);
    await waitFor(() => expect(screen.getByText("Hello team")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
