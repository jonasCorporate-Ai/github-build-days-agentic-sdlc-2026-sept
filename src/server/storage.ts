import { createHash, randomUUID } from "node:crypto";
import {
  odata,
  TableClient,
  type TableEntity,
  type TransactionAction,
} from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  CreateFeedbackRequest,
  Feedback,
  FeedbackStatus,
  UpdateFeedbackStatusRequest,
  VoteResult,
} from "../shared/contracts.js";

export class FeedbackNotFoundError extends Error {}
export class InvalidFeedbackStatusTransitionError extends Error {}

export interface FeedbackStorage {
  initialize(): Promise<void>;
  list(): Promise<Feedback[]>;
  create(input: CreateFeedbackRequest, options?: CreateOptions): Promise<Feedback>;
  vote(feedbackId: string, clientId: string): Promise<VoteResult>;
  updateStatus?(
    feedbackId: string,
    input: UpdateFeedbackStatusRequest,
  ): Promise<Feedback>;
  checkHealth(): Promise<void>;
}

interface CreateOptions {
  id?: string;
  createdAt?: string;
}

interface FeedbackEntity extends TableEntity {
  title: string;
  description: string;
  category: Feedback["category"];
  displayName: string;
  votes: number;
  createdAt: string;
  status?: FeedbackStatus;
}

const toFeedback = (entity: FeedbackEntity): Feedback => ({
  id: entity.partitionKey,
  title: entity.title,
  description: entity.description,
  category: entity.category,
  displayName: entity.displayName,
  votes: entity.votes,
  createdAt: entity.createdAt,
  status: entity.status ?? "new",
});

const nextStatus: Record<FeedbackStatus, FeedbackStatus | undefined> = {
  new: "planned",
  planned: "done",
  done: undefined,
};

const assertNextStatus = (
  current: FeedbackStatus,
  requested: FeedbackStatus,
): void => {
  if (nextStatus[current] !== requested) {
    throw new InvalidFeedbackStatusTransitionError(
      `Feedback can only move from ${current} to ${
        nextStatus[current] ?? "no further status"
      }.`,
    );
  }
};

export class InMemoryFeedbackStorage implements FeedbackStorage {
  private readonly feedback = new Map<string, Feedback>();
  private readonly votes = new Set<string>();

  async initialize(): Promise<void> {}

  list(): Promise<Feedback[]> {
    return Promise.resolve(
      [...this.feedback.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }

  create(
    input: CreateFeedbackRequest,
    options: CreateOptions = {},
  ): Promise<Feedback> {
    const item: Feedback = {
      id: options.id ?? randomUUID(),
      ...input,
      votes: 0,
      createdAt: options.createdAt ?? new Date().toISOString(),
      status: "new",
    };
    if (this.feedback.has(item.id)) {
      return Promise.resolve(this.feedback.get(item.id) as Feedback);
    }
    this.feedback.set(item.id, item);
    return Promise.resolve(item);
  }

  updateStatus(
    feedbackId: string,
    { status }: UpdateFeedbackStatusRequest,
  ): Promise<Feedback> {
    const feedback = this.feedback.get(feedbackId);
    if (!feedback) {
      return Promise.reject(
        new FeedbackNotFoundError(`Feedback ${feedbackId} was not found.`),
      );
    }
    assertNextStatus(feedback.status, status);
    const updated = { ...feedback, status };
    this.feedback.set(feedbackId, updated);
    return Promise.resolve(updated);
  }

  vote(feedbackId: string, clientId: string): Promise<VoteResult> {
    const feedback = this.feedback.get(feedbackId);
    if (!feedback) {
      return Promise.reject(
        new FeedbackNotFoundError(`Feedback ${feedbackId} was not found.`),
      );
    }
    const voteKey = `${feedbackId}:${clientId}`;
    if (this.votes.has(voteKey)) {
      return Promise.resolve({ feedback, alreadyVoted: true });
    }
    this.votes.add(voteKey);
    const updated = { ...feedback, votes: feedback.votes + 1 };
    this.feedback.set(feedbackId, updated);
    return Promise.resolve({ feedback: updated, alreadyVoted: false });
  }

  async checkHealth(): Promise<void> {
    await this.list();
  }
}

export class AzureTableFeedbackStorage implements FeedbackStorage {
  constructor(private readonly table: TableClient) {}

  static fromEnvironment(): AzureTableFeedbackStorage {
    const accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL;
    if (!accountUrl) {
      throw new Error(
        "AZURE_STORAGE_ACCOUNT_URL is required when STORAGE_BACKEND=azure.",
      );
    }
    const tableName = process.env.AZURE_STORAGE_TABLE_NAME ?? "feedback";
    return new AzureTableFeedbackStorage(
      new TableClient(accountUrl, tableName, new DefaultAzureCredential()),
    );
  }

  async initialize(): Promise<void> {
    try {
      await this.table.createTable();
    } catch (error) {
      if (!isStatus(error, 409)) {
        throw error;
      }
    }
  }

  async list(): Promise<Feedback[]> {
    const items: Feedback[] = [];
    const entities = this.table.listEntities<FeedbackEntity>({
      queryOptions: { filter: odata`rowKey eq ${"feedback"}` },
    });
    for await (const entity of entities) {
      items.push(toFeedback(entity));
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(
    input: CreateFeedbackRequest,
    options: CreateOptions = {},
  ): Promise<Feedback> {
    const item: Feedback = {
      id: options.id ?? randomUUID(),
      ...input,
      votes: 0,
      createdAt: options.createdAt ?? new Date().toISOString(),
      status: "new",
    };
    await this.table.createEntity<FeedbackEntity>({
      partitionKey: item.id,
      rowKey: "feedback",
      ...input,
      votes: item.votes,
      createdAt: item.createdAt,
      status: item.status,
    });
    return item;
  }

  async updateStatus(
    feedbackId: string,
    { status }: UpdateFeedbackStatusRequest,
  ): Promise<Feedback> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let entity: FeedbackEntity;
      try {
        entity = await this.table.getEntity<FeedbackEntity>(
          feedbackId,
          "feedback",
        );
      } catch (error) {
        if (isStatus(error, 404)) {
          throw new FeedbackNotFoundError(
            `Feedback ${feedbackId} was not found.`,
          );
        }
        throw error;
      }

      const currentStatus = entity.status ?? "new";
      assertNextStatus(currentStatus, status);
      const updated: FeedbackEntity = { ...entity, status };
      try {
        const etag =
          typeof entity.etag === "string" ? entity.etag : undefined;
        await this.table.updateEntity(updated, "Replace", {
          etag,
        });
        return toFeedback(updated);
      } catch (error) {
        if (!isStatus(error, 412) || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("Unable to update feedback status.");
  }

  async vote(feedbackId: string, clientId: string): Promise<VoteResult> {
    const voteRowKey = `vote-${createHash("sha256")
      .update(clientId)
      .digest("hex")}`;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let entity: FeedbackEntity;
      try {
        entity = await this.table.getEntity<FeedbackEntity>(
          feedbackId,
          "feedback",
        );
      } catch (error) {
        if (isStatus(error, 404)) {
          throw new FeedbackNotFoundError(
            `Feedback ${feedbackId} was not found.`,
          );
        }
        throw error;
      }

      const updated: FeedbackEntity = { ...entity, votes: entity.votes + 1 };
      const actions: TransactionAction[] = [
        [
          "create",
          {
            partitionKey: feedbackId,
            rowKey: voteRowKey,
            createdAt: new Date().toISOString(),
          },
        ],
        ["update", updated, "Replace"],
      ];
      try {
        await this.table.submitTransaction(actions);
        return { feedback: toFeedback(updated), alreadyVoted: false };
      } catch (error) {
        if (isStatus(error, 409)) {
          return { feedback: toFeedback(entity), alreadyVoted: true };
        }
        if (!isStatus(error, 412) || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("Unable to record vote.");
  }

  async checkHealth(): Promise<void> {
    const iterator = this.table.listEntities();
    await iterator.byPage({ maxPageSize: 1 }).next();
  }
}

const isStatus = (error: unknown, statusCode: number): boolean =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  error.statusCode === statusCode;

export const createStorageFromEnvironment = (): FeedbackStorage =>
  (process.env.STORAGE_BACKEND ??
    (process.env.AZURE_STORAGE_ACCOUNT_URL ? "azure" : "memory")) === "azure"
    ? AzureTableFeedbackStorage.fromEnvironment()
    : new InMemoryFeedbackStorage();

const seedItems: Array<CreateFeedbackRequest & CreateOptions> = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    title: "More hands-on examples",
    description: "Add another guided example before the independent exercise.",
    category: "content",
    displayName: "Workshop participant",
    createdAt: "2025-01-01T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Keep the recovery checkpoints",
    description: "The checkpoints make it easy to catch up after a detour.",
    category: "facilitation",
    displayName: "Workshop participant",
    createdAt: "2025-01-01T09:05:00.000Z",
  },
];

export const seedStorage = async (storage: FeedbackStorage): Promise<void> => {
  for (const { id, createdAt, ...input } of seedItems) {
    try {
      await storage.create(input, { id, createdAt });
    } catch (error) {
      if (!isStatus(error, 409)) {
        throw error;
      }
    }
  }
};
