import type { TableClient } from "@azure/data-tables";
import {
  AzureTableFeedbackStorage,
  FeedbackNotFoundError,
  InMemoryFeedbackStorage,
  seedStorage,
} from "../src/server/storage.js";

const input = {
  title: "Useful workshop",
  description: "Keep the live walkthrough.",
  category: "facilitation" as const,
  displayName: "Grace",
};

describe("in-memory feedback storage", () => {
  it("creates and lists newest feedback first", async () => {
    const storage = new InMemoryFeedbackStorage();
    await storage.create(input, {
      id: "older",
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    await storage.create(
      { ...input, title: "Newer" },
      { id: "newer", createdAt: "2025-01-02T00:00:00.000Z" },
    );

    expect((await storage.list()).map(({ id }) => id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("starts feedback as new and allows only adjacent forward transitions", async () => {
    const storage = new InMemoryFeedbackStorage();
    const feedback = await storage.create(input, { id: "status-item" });

    expect(feedback.status).toBe("new");
    expect(() =>
      storage.updateStatus(feedback.id, { status: "done" }),
    ).toThrow();
    expect((await storage.list())[0]?.status).toBe("new");

    const planned = await storage.updateStatus(feedback.id, {
      status: "planned",
    });
    expect(planned.status).toBe("planned");
    expect(() =>
      storage.updateStatus(feedback.id, { status: "new" }),
    ).toThrow();
    const done = await storage.updateStatus(feedback.id, { status: "done" });

    expect(done.status).toBe("done");
  });

  it("rejects a missing feedback status update", async () => {
    const storage = new InMemoryFeedbackStorage();
    await expect(
      storage.updateStatus("missing", { status: "planned" }),
    ).rejects.toBeInstanceOf(FeedbackNotFoundError);
  });

  it("serializes concurrent status updates and preserves the vote count", async () => {
    const storage = new InMemoryFeedbackStorage();
    const feedback = await storage.create(input, { id: "concurrent-status" });
    await storage.vote(feedback.id, "client-1");

    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        storage.updateStatus(feedback.id, { status: "planned" }),
      ),
      Promise.resolve().then(() =>
        storage.updateStatus(feedback.id, { status: "planned" }),
      ),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await storage.list()).toContainEqual(
      expect.objectContaining({ id: feedback.id, status: "planned", votes: 1 }),
    );
  });

  it("counts one vote per client and feedback item", async () => {
    const storage = new InMemoryFeedbackStorage();
    const feedback = await storage.create(input);

    const first = await storage.vote(feedback.id, "client-1");
    const duplicate = await storage.vote(feedback.id, "client-1");
    const secondClient = await storage.vote(feedback.id, "client-2");

    expect(first).toMatchObject({ alreadyVoted: false, feedback: { votes: 1 } });
    expect(duplicate).toMatchObject({
      alreadyVoted: true,
      feedback: { votes: 1 },
    });
    expect(secondClient.feedback.votes).toBe(2);
  });

  it("reports missing feedback", async () => {
    const storage = new InMemoryFeedbackStorage();
    await expect(storage.vote("missing", "client-1")).rejects.toBeInstanceOf(
      FeedbackNotFoundError,
    );
  });

  it("seeds deterministic data idempotently", async () => {
    const storage = new InMemoryFeedbackStorage();
    await seedStorage(storage);
    await seedStorage(storage);
    expect(await storage.list()).toHaveLength(2);
  });
});

describe("Azure Table feedback storage", () => {
  it("normalizes a legacy row without status to new", async () => {
    const table = {
      listEntities: vi.fn().mockReturnValue(
        (async function* () {
          yield {
            partitionKey: "legacy-feedback",
            rowKey: "feedback",
            ...input,
            votes: 2,
            createdAt: "2025-01-01T00:00:00.000Z",
          };
        })(),
      ),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    await expect(storage.list()).resolves.toContainEqual(
      expect.objectContaining({ id: "legacy-feedback", status: "new", votes: 2 }),
    );
  });

  it("uses the Azure entity ETag for a status transition", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "feedback-1",
        rowKey: "feedback",
        ...input,
        votes: 1,
        status: "new",
        createdAt: "2025-01-01T00:00:00.000Z",
        etag: "etag-1",
      }),
      updateEntity: vi.fn().mockResolvedValue({}),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    await expect(
      storage.updateStatus("feedback-1", { status: "planned" }),
    ).resolves.toMatchObject({
      status: "planned",
      votes: 1,
    });
    expect(table.updateEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        partitionKey: "feedback-1",
        status: "planned",
        votes: 1,
      }),
      "Replace",
      expect.objectContaining({ etag: "etag-1" }),
    );
  });

  it("re-reads after an ETag conflict and does not overwrite a concurrent transition", async () => {
    const table = {
      getEntity: vi
        .fn()
        .mockResolvedValueOnce({
          partitionKey: "feedback-1",
          rowKey: "feedback",
          ...input,
          votes: 0,
          status: "planned",
          createdAt: "2025-01-01T00:00:00.000Z",
          etag: "etag-1",
        })
        .mockResolvedValueOnce({
          partitionKey: "feedback-1",
          rowKey: "feedback",
          ...input,
          votes: 0,
          status: "done",
          createdAt: "2025-01-01T00:00:00.000Z",
          etag: "etag-2",
        }),
      updateEntity: vi.fn().mockRejectedValue({ statusCode: 412 }),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    await expect(
      storage.updateStatus("feedback-1", { status: "done" }),
    ).rejects.toThrow();
    expect(table.getEntity).toHaveBeenCalledTimes(2);
    expect(table.updateEntity).toHaveBeenCalledOnce();
  });

  it("records the vote marker and counter in one transaction", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "feedback-1",
        rowKey: "feedback",
        title: input.title,
        description: input.description,
        category: input.category,
        displayName: input.displayName,
        votes: 2,
        createdAt: "2025-01-01T00:00:00.000Z",
        etag: "etag-1",
      }),
      submitTransaction: vi.fn().mockResolvedValue({}),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    const result = await storage.vote("feedback-1", "client-1");

    expect(result).toMatchObject({
      alreadyVoted: false,
      feedback: { votes: 3 },
    });
    expect(table.submitTransaction).toHaveBeenCalledOnce();
    const actions = table.submitTransaction.mock.calls[0]?.[0];
    expect(actions).toHaveLength(2);
    expect(actions[0][0]).toBe("create");
    expect(actions[1]).toMatchObject(["update", { votes: 3 }, "Replace"]);
  });

  it("reports an existing Azure vote without increasing the count", async () => {
    const table = {
      getEntity: vi.fn().mockResolvedValue({
        partitionKey: "feedback-1",
        rowKey: "feedback",
        title: input.title,
        description: input.description,
        category: input.category,
        displayName: input.displayName,
        votes: 2,
        createdAt: "2025-01-01T00:00:00.000Z",
        etag: "etag-1",
      }),
      submitTransaction: vi.fn().mockRejectedValue({ statusCode: 409 }),
    };
    const storage = new AzureTableFeedbackStorage(
      table as unknown as TableClient,
    );

    await expect(storage.vote("feedback-1", "client-1")).resolves.toMatchObject({
      alreadyVoted: true,
      feedback: { votes: 2 },
    });
  });
});
