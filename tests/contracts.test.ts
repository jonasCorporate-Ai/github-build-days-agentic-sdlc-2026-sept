import {
  createFeedbackSchema,
  feedbackStatuses,
  fieldLimits,
  updateFeedbackStatusSchema,
  voteRequestSchema,
} from "../src/shared/contracts.js";

describe("feedback contracts", () => {
  it("normalizes valid feedback", () => {
    expect(
      createFeedbackSchema.parse({
        title: "  Clear examples  ",
        description: "  Add examples  ",
        category: "content",
        displayName: "  Ada  ",
      }),
    ).toEqual({
      title: "Clear examples",
      description: "Add examples",
      category: "content",
      displayName: "Ada",
    });
  });

  it("rejects missing and oversized fields", () => {
    const result = createFeedbackSchema.safeParse({
      title: "x".repeat(fieldLimits.title + 1),
      description: "",
      category: "unknown",
      displayName: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining([
          "title",
          "description",
          "category",
          "displayName",
        ]),
      );
    }
  });

  it("accepts workshop-safe client identifiers only", () => {
    expect(voteRequestSchema.safeParse({ clientId: "client_123-abc" }).success).toBe(
      true,
    );
    expect(voteRequestSchema.safeParse({ clientId: "not/valid" }).success).toBe(
      false,
    );
  });

  it("accepts exactly the supported feedback statuses", () => {
    expect(feedbackStatuses).toEqual(["new", "planned", "done"]);
    for (const status of feedbackStatuses) {
      expect(updateFeedbackStatusSchema.parse({ status })).toEqual({ status });
    }
    expect(
      updateFeedbackStatusSchema.safeParse({ status: "blocked" }).success,
    ).toBe(false);
  });
});
