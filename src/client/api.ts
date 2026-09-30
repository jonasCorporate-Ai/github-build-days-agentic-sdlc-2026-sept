import type {
  ApiError,
  CreateFeedbackRequest,
  Feedback,
  VoteResult,
} from "../shared/contracts.js";

export type FeedbackStatus = "new" | "planned" | "done";

export type FeedbackWithStatus = Feedback & {
  status: FeedbackStatus;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers,
    },
  });
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) {
    const apiError = body as ApiError;
    throw new ApiRequestError(
      apiError.error?.message ?? "Something went wrong. Try again.",
      apiError.error?.fieldErrors,
    );
  }
  return body as T;
}

export const listFeedback = async (): Promise<FeedbackWithStatus[]> => {
  const result = await request<{ items: FeedbackWithStatus[] }>("/api/feedback");
  return result.items;
};

export const createFeedback = async (
  input: CreateFeedbackRequest,
): Promise<FeedbackWithStatus> => {
  const result = await request<{ feedback: FeedbackWithStatus }>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.feedback;
};

export const updateFeedbackStatus = async (
  id: string,
  status: FeedbackStatus,
): Promise<FeedbackWithStatus> => {
  const result = await request<{ feedback: FeedbackWithStatus }>(
    `/api/feedback/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
  return result.feedback;
};

export const voteForFeedback = (
  id: string,
  clientId: string,
): Promise<Omit<VoteResult, "feedback"> & { feedback: FeedbackWithStatus }> =>
  request<Omit<VoteResult, "feedback"> & { feedback: FeedbackWithStatus }>(
    `/api/feedback/${encodeURIComponent(id)}/votes`,
    {
      method: "POST",
      body: JSON.stringify({ clientId }),
    },
  );
