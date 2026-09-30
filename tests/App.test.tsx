// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/client/App.js";
import type { Feedback } from "../src/shared/contracts.js";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("feedback board", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows an accessible empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ items: [] }));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading feedback");
    expect(await screen.findByRole("heading", { name: "No feedback yet" })).toBeVisible();
  });

  it("creates feedback and votes through the complete UI flow", async () => {
    let item: Feedback | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, options) => {
      const url = String(input);
      if (url === "/api/feedback" && !options?.method) {
        return jsonResponse({ items: [] });
      }
      if (url === "/api/feedback" && options?.method === "POST") {
        item = {
          id: "feedback-1",
          ...(JSON.parse(String(options.body)) as Omit<
            Feedback,
            "id" | "votes" | "createdAt"
          >),
          status: "new",
          votes: 0,
          createdAt: "2025-01-01T00:00:00.000Z",
        };
        return jsonResponse({ feedback: item }, 201);
      }
      if (url.endsWith("/votes") && item) {
        item = { ...item, votes: 1 };
        return jsonResponse({ feedback: item, alreadyVoted: false }, 201);
      }
      return jsonResponse({}, 404);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "No feedback yet" });

    await user.type(screen.getByLabelText("Title"), "Better examples");
    await user.type(
      screen.getByLabelText("Description"),
      "Show another API example.",
    );
    await user.selectOptions(screen.getByLabelText("Category"), "tooling");
    await user.type(screen.getByLabelText("Display name"), "Sam");
    await user.click(screen.getByRole("button", { name: "Add feedback" }));

    expect(
      await screen.findByRole("heading", { name: "Better examples" }),
    ).toBeVisible();
    const vote = screen.getByRole("button", {
      name: "Vote for Better examples. 0 votes",
    });
    await user.click(vote);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Vote for Better examples. 1 votes",
        }),
      ).toBeVisible(),
    );
    expect(screen.getByText("Vote added for “Better examples”.")).toBeVisible();
  });

  it("shows server validation beside fields", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Check the highlighted fields and try again.",
              fieldErrors: { title: ["Enter a title."] },
            },
          },
          400,
        ),
      );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "No feedback yet" });
    await user.click(screen.getByRole("button", { name: "Add feedback" }));

    expect(await screen.findByText("Enter a title.")).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveAttribute("aria-invalid", "true");
  });

  it("advances status accessibly without changing the vote count", async () => {
    const item: Feedback = {
      id: "feedback-status",
      title: "More examples",
      description: "Show one more example.",
      category: "content",
      displayName: "Sam",
      status: "new",
      votes: 2,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ items: [item] }))
      .mockResolvedValueOnce(
        jsonResponse({ feedback: { ...item, status: "planned" } }),
      );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "More examples" });

    expect(screen.getByText("Status: new")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Move More examples to planned" }),
    );

    expect(await screen.findByText("Status: planned")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Vote for More examples. 2 votes",
      }),
    ).toBeVisible();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      "/api/feedback/feedback-status/status",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "planned" }),
      }),
    );
  });

  it("announces a pending update and disables duplicate submissions", async () => {
    const item: Feedback = {
      id: "feedback-pending",
      title: "Add recovery time",
      description: "Allow time for troubleshooting.",
      category: "facilitation",
      displayName: "Kai",
      status: "new",
      votes: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    let finishUpdate!: (response: Response) => void;
    const pendingUpdate = new Promise<Response>((resolve) => {
      finishUpdate = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ items: [item] }))
      .mockReturnValueOnce(pendingUpdate);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Add recovery time" });
    const advance = screen.getByRole("button", {
      name: "Move Add recovery time to planned",
    });

    await user.click(advance);
    expect(advance).toBeDisabled();
    expect(screen.getByText("Updating status to planned…")).toBeVisible();

    finishUpdate(jsonResponse({ feedback: { ...item, status: "planned" } }));
    expect(await screen.findByText("Status: planned")).toBeVisible();
  });

  it("retains the confirmed status and allows retry after a failed update", async () => {
    const item: Feedback = {
      id: "feedback-retry",
      title: "Improve the checklist",
      description: "Keep retry available when an update fails.",
      category: "facilitation",
      displayName: "Lin",
      status: "new",
      votes: 0,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ items: [item] }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "CONFLICT",
              message: "The status changed. Refresh and try again.",
            },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ feedback: { ...item, status: "planned" } }),
      );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Improve the checklist" });
    const advance = screen.getByRole("button", {
      name: "Move Improve the checklist to planned",
    });

    await user.click(advance);
    expect(
      await screen.findByText(
        "Status was not updated. The status changed. Refresh and try again. Select “Move to planned” to retry.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Status: new")).toBeVisible();
    expect(advance).toBeEnabled();

    await user.click(advance);
    expect(await screen.findByText("Status: planned")).toBeVisible();
  });

  it("offers retry after a loading error", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("The board could not load."))
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("The board could not load.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "No feedback yet" })).toBeVisible();
  });
});
