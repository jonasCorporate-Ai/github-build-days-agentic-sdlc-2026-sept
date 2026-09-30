import request from "supertest";
import { createApp } from "../src/server/app.js";
import type { Logger } from "../src/server/logger.js";
import {
  InMemoryFeedbackStorage,
  type FeedbackStorage,
} from "../src/server/storage.js";

const silentLogger: Logger = { log: () => undefined };

describe("feedback API", () => {
  it("exposes liveness and storage-backed readiness", async () => {
    const storage = new InMemoryFeedbackStorage();
    const app = createApp({ storage, logger: silentLogger });

    await request(app).get("/health").expect(200, { status: "healthy" });
    await request(app).get("/ready").expect(200, { status: "ready" });
  });

  it("returns 503 when storage is unavailable", async () => {
    const storage = new InMemoryFeedbackStorage();
    storage.checkHealth = () => Promise.reject(new Error("secret details"));
    const app = createApp({ storage, logger: silentLogger });

    const response = await request(app).get("/ready").expect(503);
    expect(response.text).not.toContain("secret details");
    expect(response.body.error.code).toBe("STORAGE_UNAVAILABLE");
  });

  it("creates, lists, and votes on feedback", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });
    const created = await request(app)
      .post("/api/feedback")
      .send({
        title: "  Add a break  ",
        description: "A short break would help.",
        category: "facilitation",
        displayName: "Lin",
      })
      .expect(201);

    expect(created.body.feedback).toMatchObject({
      title: "Add a break",
      votes: 0,
      status: "new",
    });
    const id = created.body.feedback.id as string;

    const firstVote = await request(app)
      .post(`/api/feedback/${id}/votes`)
      .send({ clientId: "workshop-client" })
      .expect(201);
    expect(firstVote.body).toMatchObject({
      alreadyVoted: false,
      feedback: { votes: 1 },
    });

    const duplicateVote = await request(app)
      .post(`/api/feedback/${id}/votes`)
      .send({ clientId: "workshop-client" })
      .expect(200);
    expect(duplicateVote.body).toMatchObject({
      alreadyVoted: true,
      feedback: { votes: 1 },
    });

    const list = await request(app).get("/api/feedback").expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].votes).toBe(1);
    expect(list.body.items[0].status).toBe("new");
  });

  it("persists adjacent status transitions without changing votes", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });
    const created = await request(app)
      .post("/api/feedback")
      .send({
        title: "Keep the vote",
        description: "Status changes must preserve votes.",
        category: "facilitation",
        displayName: "Lin",
      })
      .expect(201);
    const id = created.body.feedback.id as string;
    await request(app)
      .post(`/api/feedback/${id}/votes`)
      .send({ clientId: "workshop-client" })
      .expect(201);

    await request(app)
      .patch(`/api/feedback/${id}/status`)
      .send({ status: "planned" })
      .expect(200)
      .expect(({ body }) =>
        expect(body.feedback).toMatchObject({ status: "planned", votes: 1 }),
      );
    await request(app)
      .patch(`/api/feedback/${id}/status`)
      .send({ status: "done" })
      .expect(200)
      .expect(({ body }) =>
        expect(body.feedback).toMatchObject({ status: "done", votes: 1 }),
      );
    await request(app)
      .get("/api/feedback")
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toContainEqual(
          expect.objectContaining({ id, status: "done", votes: 1 }),
        ),
      );
  });

  it("rejects invalid, skipped, and missing status updates without changing state", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });
    const created = await request(app)
      .post("/api/feedback")
      .send({
        title: "Transition checks",
        description: "Invalid transitions do not update feedback.",
        category: "idea",
        displayName: "Ada",
      })
      .expect(201);
    const id = created.body.feedback.id as string;

    await request(app)
      .patch(`/api/feedback/${id}/status`)
      .send({ status: "unsupported" })
      .expect(400);
    await request(app)
      .patch(`/api/feedback/${id}/status`)
      .send({ status: "done" })
      .expect(409)
      .expect(({ body }) =>
        expect(body.error).toMatchObject({
          code: "STATUS_CONFLICT",
          message: expect.any(String),
        }),
      );
    await request(app)
      .patch("/api/feedback/missing/status")
      .send({ status: "planned" })
      .expect(404);
    await request(app)
      .get("/api/feedback")
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toContainEqual(
          expect.objectContaining({ id, status: "new" }),
        ),
      );
  });

  it("returns actionable validation without persisting", async () => {
    const storage = new InMemoryFeedbackStorage();
    const app = createApp({ storage, logger: silentLogger });
    const response = await request(app)
      .post("/api/feedback")
      .send({ title: "", description: "", category: "idea", displayName: "" })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      fieldErrors: {
        title: ["Enter a title."],
        description: ["Enter a description."],
        displayName: ["Enter your display name."],
      },
    });
    expect(await storage.list()).toEqual([]);
  });

  it("returns a not-found response for votes on missing feedback", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });
    await request(app)
      .post("/api/feedback/missing/votes")
      .send({ clientId: "client-1" })
      .expect(404, {
        error: { code: "NOT_FOUND", message: "Feedback was not found." },
      });
  });

  it("rate-limits repeated application requests without blocking liveness", async () => {
    const app = createApp({
      storage: new InMemoryFeedbackStorage(),
      logger: silentLogger,
    });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await request(app).get("/api/feedback").expect(200);
    }

    await request(app).get("/api/feedback").expect(429, {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Try again shortly.",
      },
    });
    await request(app).get("/health").expect(200, { status: "healthy" });
  });

  it("converts unexpected storage failures to safe errors", async () => {
    const storage: FeedbackStorage = {
      initialize: () => Promise.resolve(),
      list: () => Promise.reject(new Error("connection string was secret")),
      create: () => Promise.reject(new Error("unused")),
      vote: () => Promise.reject(new Error("unused")),
      checkHealth: () => Promise.resolve(),
    };
    const app = createApp({ storage, logger: silentLogger });
    const response = await request(app).get("/api/feedback").expect(500);
    expect(response.text).not.toContain("connection string");
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
  });
});
