import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  feedbackCategories,
  fieldLimits,
  type CreateFeedbackRequest,
  type Feedback,
} from "../shared/contracts.js";
import {
  ApiRequestError,
  createFeedback,
  type FeedbackStatus,
  type FeedbackWithStatus,
  listFeedback,
  updateFeedbackStatus,
  voteForFeedback,
} from "./api.js";

const emptyForm: CreateFeedbackRequest = {
  title: "",
  description: "",
  category: "content",
  displayName: "",
};

const getClientId = (): string => {
  const key = "workshop-feedback-client-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(key, created);
  return created;
};

const nextStatusFor = (
  status: FeedbackStatus,
): FeedbackStatus | undefined => {
  switch (status) {
    case "new":
      return "planned";
    case "planned":
      return "done";
    case "done":
      return undefined;
  }
};

export function App() {
  const [items, setItems] = useState<FeedbackWithStatus[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [votingId, setVotingId] = useState<string>();
  const [statusUpdatingIds, setStatusUpdatingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [statusMessages, setStatusMessages] = useState<
    Record<string, { kind: "pending" | "success" | "error"; message: string }>
  >({});
  const statusRequests = useRef(new Set<string>());
  const [error, setError] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<string>();
  const formStatusId = useId();

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    setError(undefined);
    try {
      setItems(await listFeedback());
    } catch (loadError) {
      setLoadFailed(true);
      setError(messageFor(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setNotice(undefined);
    setFieldErrors({});
    try {
      const feedback = await createFeedback(form);
      setItems((current) => [feedback, ...current]);
      setForm(emptyForm);
      setNotice("Feedback added to the board.");
    } catch (submitError) {
      if (submitError instanceof ApiRequestError) {
        setFieldErrors(submitError.fieldErrors ?? {});
      }
      setError(messageFor(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(item: FeedbackWithStatus) {
    setVotingId(item.id);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await voteForFeedback(item.id, getClientId());
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...result.feedback, status: candidate.status }
            : candidate,
        ),
      );
      setNotice(
        result.alreadyVoted
          ? "Your vote was already recorded."
          : `Vote added for “${item.title}”.`,
      );
    } catch (voteError) {
      setError(messageFor(voteError));
    } finally {
      setVotingId(undefined);
    }
  }

  async function updateStatus(item: FeedbackWithStatus, status: FeedbackStatus) {
    if (statusRequests.current.has(item.id)) return;
    statusRequests.current.add(item.id);
    setStatusUpdatingIds((current) => new Set(current).add(item.id));
    setStatusMessages((current) => ({
      ...current,
      [item.id]: {
        kind: "pending",
        message: `Updating status to ${status}…`,
      },
    }));
    try {
      const feedback = await updateFeedbackStatus(item.id, status);
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, status: feedback.status }
            : candidate,
        ),
      );
      setStatusMessages((current) => ({
        ...current,
        [item.id]: {
          kind: "success",
          message: `Status updated to ${feedback.status}.`,
        },
      }));
    } catch (statusError) {
      setStatusMessages((current) => ({
        ...current,
        [item.id]: {
          kind: "error",
          message: `Status was not updated. ${messageFor(statusError)} Select “Move to ${status}” to retry.`,
        },
      }));
    } finally {
      statusRequests.current.delete(item.id);
      setStatusUpdatingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <>
      <header className="hero">
        <div>
          <p className="eyebrow">Agentic SDLC workshop</p>
          <h1>Feedback board</h1>
          <p>Share what would improve the workshop and vote on team ideas.</p>
        </div>
      </header>
      <main>
        <section className="panel form-panel" aria-labelledby="feedback-form-title">
          <h2 id="feedback-form-title">Add feedback</h2>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <Field
              label="Title"
              name="title"
              value={form.title}
              maxLength={fieldLimits.title}
              errors={fieldErrors.title}
              onChange={(value) => setForm({ ...form, title: value })}
            />
            <Field
              label="Description"
              name="description"
              value={form.description}
              maxLength={fieldLimits.description}
              errors={fieldErrors.description}
              multiline
              onChange={(value) => setForm({ ...form, description: value })}
            />
            <label>
              Category
              <select
                name="category"
                value={form.category}
                onChange={(event) =>
                  setForm({
                    ...form,
                    category: event.target.value as Feedback["category"],
                  })
                }
              >
                {feedbackCategories.map((category) => (
                  <option key={category} value={category}>
                    {category[0]?.toUpperCase()}
                    {category.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Display name"
              name="displayName"
              value={form.displayName}
              maxLength={fieldLimits.displayName}
              errors={fieldErrors.displayName}
              onChange={(value) => setForm({ ...form, displayName: value })}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add feedback"}
            </button>
          </form>
          <div id={formStatusId} className="status" aria-live="polite">
            {error && (
              <div className="error">
                <span>{error}</span>
                {loadFailed && (
                  <button type="button" onClick={() => void load()}>
                    Try again
                  </button>
                )}
              </div>
            )}
            {notice && <p className="success">{notice}</p>}
          </div>
        </section>

        <section className="board" aria-labelledby="board-title" aria-busy={loading}>
          <div className="board-heading">
            <div>
              <p className="eyebrow">Team ideas</p>
              <h2 id="board-title">Feedback</h2>
            </div>
            <span className="count" aria-label={`${items.length} feedback items`}>
              {items.length}
            </span>
          </div>
          {loading ? (
            <p className="state" role="status">
              Loading feedback…
            </p>
          ) : loadFailed ? (
            <div className="state">
              <h3>Feedback is unavailable</h3>
              <p>Use Try again to reload the board.</p>
            </div>
          ) : items.length === 0 ? (
            <div className="state">
              <h3>No feedback yet</h3>
              <p>Start the board with the first workshop idea.</p>
            </div>
          ) : (
            <ul className="feedback-list">
              {items.map((item) => {
                const nextStatus = nextStatusFor(item.status);
                const statusMessage = statusMessages[item.id];
                const isUpdating = statusUpdatingIds.has(item.id);
                return (
                  <li className="feedback-card" key={item.id}>
                    <div className="card-topline">
                      <span className={`category category-${item.category}`}>
                        {item.category}
                      </span>
                      <time dateTime={item.createdAt}>
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                        }).format(new Date(item.createdAt))}
                      </time>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <p className="feedback-status">Status: {item.status}</p>
                    <div className="status-control">
                      {nextStatus && (
                        <button
                          type="button"
                          disabled={isUpdating}
                          aria-label={
                            isUpdating
                              ? `Updating status for ${item.title}`
                              : `Move ${item.title} to ${nextStatus}`
                          }
                          onClick={() => void updateStatus(item, nextStatus)}
                        >
                          {isUpdating
                            ? "Updating…"
                            : `Move to ${nextStatus}`}
                        </button>
                      )}
                      {statusMessage && (
                        <p
                          className={
                            statusMessage.kind === "error"
                              ? "error"
                              : statusMessage.kind === "success"
                                ? "success"
                                : undefined
                          }
                          role={
                            statusMessage.kind === "error" ? "alert" : "status"
                          }
                          aria-live={
                            statusMessage.kind === "error"
                              ? "assertive"
                              : "polite"
                          }
                        >
                          {statusMessage.message}
                        </p>
                      )}
                    </div>
                    <div className="card-footer">
                      <span>By {item.displayName}</span>
                      <button
                        className="vote"
                        type="button"
                        disabled={votingId === item.id}
                        aria-label={`Vote for ${item.title}. ${item.votes} votes`}
                        onClick={() => void vote(item)}
                      >
                        <span aria-hidden="true">▲</span>
                        {votingId === item.id ? "Voting…" : item.votes}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

interface FieldProps {
  label: string;
  name: string;
  value: string;
  maxLength: number;
  errors?: string[];
  multiline?: boolean;
  onChange: (value: string) => void;
}

function Field({
  label,
  name,
  value,
  maxLength,
  errors,
  multiline,
  onChange,
}: FieldProps) {
  const errorId = `${name}-error`;
  const props = {
    id: name,
    name,
    value,
    maxLength,
    required: true,
    "aria-invalid": Boolean(errors),
    "aria-describedby": errors ? errorId : undefined,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
  };
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {multiline ? <textarea rows={5} {...props} /> : <input {...props} />}
      <span className="field-meta">
        {errors ? (
          <span id={errorId} className="field-error">
            {errors[0]}
          </span>
        ) : (
          <span />
        )}
        <span>
          {value.length}/{maxLength}
        </span>
      </span>
    </div>
  );
}

const messageFor = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
