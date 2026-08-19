"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ComplexityLevel, SyncStatus } from "@/lib/api-server";
import { pollSync, retrySync } from "@/lib/profile-actions";
import { finishOnboarding } from "./actions";

const POLL_INTERVAL_MS = 2000;

const STEPS = ["Reading GitHub", "Your stack", "Your goals", "Your fit"] as const;

/** Values must match CONTRIBUTION_GOALS in server/src/routes/me.routes.ts. */
const CONTRIBUTION_GOALS = [
  {
    value: "learn-new-tech",
    title: "Learn something new",
    description: "Point me at languages and tools I have not used yet.",
  },
  {
    value: "deepen-stack",
    title: "Go deeper in my stack",
    description: "Harder problems in the technologies I already know well.",
  },
  {
    value: "first-contribution",
    title: "Make my first contribution",
    description: "Well-scoped issues in projects that welcome newcomers.",
  },
  {
    value: "give-back",
    title: "Give back to what I use",
    description: "Projects that are already part of my daily work.",
  },
] as const;

const WEEKLY_HOURS = [
  { value: 2, label: "1–2 hrs" },
  { value: 4, label: "3–5 hrs" },
  { value: 8, label: "6–10 hrs" },
  { value: 15, label: "10+ hrs" },
] as const;

const DIFFICULTY: {
  value: ComplexityLevel;
  label: string;
  description: string;
}[] = [
  { value: "beginner", label: "Gentle", description: "Clear scope, good first issues" },
  { value: "intermediate", label: "Moderate", description: "Real features, some context to load" },
  { value: "advanced", label: "Challenging", description: "Deep changes in unfamiliar code" },
  { value: "expert", label: "Deep end", description: "Architecture, performance, internals" },
];

export interface OnboardingInitial {
  username: string | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  techStack: string[];
  languages: string[];
  learningGoals: string[];
  preferredLanguages: string[];
  contributionGoals: string[];
  weeklyHours: number | null;
  difficultyPreference: ComplexityLevel | null;
  stackEdited: boolean;
}

// -----------------------------------------------------------------------------
// Shared bits
// -----------------------------------------------------------------------------

function ChipEditor({
  values,
  onChange,
  placeholder,
  suggestions = [],
  emptyHint,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  suggestions?: string[];
  emptyHint?: string;
}) {
  const [draft, setDraft] = useState("");

  const has = (value: string) =>
    values.some((existing) => existing.toLowerCase() === value.toLowerCase());

  const add = (value: string) => {
    const trimmed = value.trim();

    if (trimmed && !has(trimmed)) {
      onChange([...values, trimmed]);
    }

    setDraft("");
  };

  const unused = suggestions.filter((suggestion) => !has(suggestion));

  return (
    <div className="flex flex-col gap-3">
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => onChange(values.filter((item) => item !== value))}
                className="group flex items-center gap-1.5 rounded-full bg-contrib-2/15 px-3 py-1 font-mono text-xs transition-colors hover:bg-red-500/15"
              >
                {value}
                <span aria-hidden className="opacity-40 group-hover:opacity-100">
                  ×
                </span>
                <span className="sr-only">Remove {value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        emptyHint && <p className="font-mono text-xs opacity-50">{emptyHint}</p>
      )}

      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter commits; the form has no submit of its own to steal it.
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-brand-muted dark:border-white/20"
      />

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs opacity-50">Suggestions</span>
          {unused.slice(0, 12).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="rounded-full border border-dashed border-black/20 px-3 py-1 font-mono text-xs opacity-70 transition-opacity hover:opacity-100 dark:border-white/25"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  title,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-brand-muted bg-contrib-2/10"
          : "border-black/10 hover:border-black/25 dark:border-white/15 dark:hover:border-white/30"
      }`}
    >
      <span className="block text-sm font-medium">{title}</span>
      {description && (
        <span className="mt-1 block text-xs opacity-60">{description}</span>
      )}
    </button>
  );
}

function StepHeader({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm opacity-70">{blurb}</p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// The flow
// -----------------------------------------------------------------------------

export function OnboardingFlow({ initial }: { initial: OnboardingInitial }) {
  const [step, setStep] = useState(0);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(initial.syncStatus);
  const [syncError, setSyncError] = useState<string | null>(initial.syncError);
  const [detectedLanguages, setDetectedLanguages] = useState(initial.languages);

  const [stack, setStack] = useState(initial.techStack);
  const [languages, setLanguages] = useState(initial.preferredLanguages);
  const [goals, setGoals] = useState(initial.learningGoals);
  const [reasons, setReasons] = useState<string[]>(initial.contributionGoals);
  const [hours, setHours] = useState<number | null>(initial.weeklyHours);
  const [difficulty, setDifficulty] = useState<ComplexityLevel | null>(
    initial.difficultyPreference,
  );

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Whether the user has touched the stack editor.
   *
   * A ref, not state, because the poller reads it: as state it would be a
   * dependency of the polling effect and every keystroke would tear down and
   * restart the interval.
   */
  const stackTouched = useRef(initial.stackEdited);

  const isSyncing = syncStatus === "pending" || syncStatus === "running";

  /**
   * Polls until the background analysis settles.
   *
   * Runs across every step, not just the first. The sync was kicked back at
   * the auth callback, so it is already in flight when this page mounts — the
   * questionnaire is what the user does while it finishes, and the detected
   * stack lands in step 2 without anyone having waited for it.
   */
  useEffect(() => {
    if (!isSyncing) {
      return;
    }

    let cancelled = false;

    const id = setInterval(async () => {
      const snapshot = await pollSync();

      if (cancelled) {
        return;
      }

      setSyncStatus(snapshot.sync_status);
      setSyncError(snapshot.sync_error);

      if (snapshot.sync_status === "ready") {
        setDetectedLanguages(snapshot.languages);

        // Never overwrite an edit in progress. The stack is the one field the
        // analysis and the user both write to, and the user wins.
        if (!stackTouched.current) {
          setStack(snapshot.tech_stack);
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isSyncing]);

  const toggle = (list: string[], value: string) =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];

  const submit = (skipped: boolean) => {
    setError(null);

    startTransition(async () => {
      const result = await finishOnboarding({
        // Only sent when actually edited: any write stamps tech_stack_edited_at
        // and permanently hands the column to the user, which would freeze the
        // stack at whatever the first analysis happened to find.
        ...(stackTouched.current && !skipped ? { tech_stack: stack } : {}),
        learning_goals: skipped ? initial.learningGoals : goals,
        preferred_languages: skipped ? initial.preferredLanguages : languages,
        contribution_goals: skipped ? initial.contributionGoals : reasons,
        weekly_hours: skipped ? initial.weeklyHours : hours,
        difficulty_preference: skipped ? initial.difficultyPreference : difficulty,
      });

      // finishOnboarding redirects on success, so anything returned is a failure.
      if (result?.ok === false) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <ol className="flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={`h-1 rounded-full transition-colors ${
                index <= step ? "bg-brand-muted" : "bg-black/10 dark:bg-white/15"
              }`}
            />
            <span
              className={`text-xs ${index === step ? "opacity-80" : "opacity-40"}`}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="flex flex-col gap-5">
          <StepHeader
            title={`Welcome${initial.username ? `, ${initial.username}` : ""}`}
            blurb="We are reading your public GitHub activity to work out what you build. It takes a few seconds — answer the next three questions while it runs."
          />

          <div className="rounded-xl border border-black/10 p-5 dark:border-white/15">
            {isSyncing && (
              <p className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden
                  className="h-2 w-2 animate-pulse rounded-full bg-brand-bright"
                />
                Reading repositories, languages and recent activity…
              </p>
            )}

            {syncStatus === "ready" && (
              <p className="text-sm">
                Done — we found{" "}
                <span className="font-medium">{stack.length || "no"}</span>{" "}
                things in your stack. You can correct them on the next step.
              </p>
            )}

            {syncStatus === "failed" && (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm">
                  We could not read your GitHub profile
                  {syncError ? ` — ${syncError}` : "."}
                </p>
                <p className="text-xs opacity-60">
                  You can still finish setting up; everything below is yours to
                  state directly.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await retrySync();
                      if (result.ok) {
                        setSyncStatus("running");
                        setSyncError(null);
                      } else {
                        setError(result.error ?? "Could not restart the analysis");
                      }
                    })
                  }
                  className="rounded-full border border-black/15 px-4 py-1.5 text-xs transition-colors hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-5">
          <StepHeader
            title="Does this look right?"
            blurb="What we detected from your public repositories. Remove anything that is not really you, and add what we missed — this is what we match against."
          />

          {isSyncing ? (
            <div className="flex flex-col gap-2" aria-busy>
              <div className="h-7 w-2/3 animate-pulse rounded-full bg-black/5 dark:bg-white/10" />
              <div className="h-7 w-1/2 animate-pulse rounded-full bg-black/5 dark:bg-white/10" />
              <p className="mt-1 text-xs opacity-50">
                Still reading — carry on, and correct this later from the
                dashboard if it lands after you have moved past it.
              </p>
            </div>
          ) : (
            <ChipEditor
              values={stack}
              onChange={(next) => {
                stackTouched.current = true;
                setStack(next);
              }}
              placeholder="Add a language, framework or tool, then press Enter"
              emptyHint="Nothing detected — add what you work with."
            />
          )}
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <StepHeader
              title="What do you want to work in?"
              blurb="Not the same question as what you already use. Plenty of people write one language all day and want to contribute in another."
            />
            <ChipEditor
              values={languages}
              onChange={setLanguages}
              placeholder="Add a language, then press Enter"
              suggestions={detectedLanguages}
              emptyHint="No preference yet — we will use your detected languages."
            />
          </div>

          <div className="flex flex-col gap-4">
            <StepHeader
              title="Anything you are trying to learn?"
              blurb="Free text. These steer recommendations beyond what your history already says about you."
            />
            <ChipEditor
              values={goals}
              onChange={setGoals}
              placeholder="e.g. distributed systems, compilers, accessibility"
              emptyHint="Optional."
            />
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-8">
          <div className="flex flex-col gap-4">
            <StepHeader
              title="Why are you here?"
              blurb="Pick as many as apply."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {CONTRIBUTION_GOALS.map((goal) => (
                <Choice
                  key={goal.value}
                  selected={reasons.includes(goal.value)}
                  onClick={() => setReasons(toggle(reasons, goal.value))}
                  title={goal.title}
                  description={goal.description}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <StepHeader
              title="How much time per week?"
              blurb="Used to size the work we suggest, not to hold you to anything."
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {WEEKLY_HOURS.map((option) => (
                <Choice
                  key={option.value}
                  selected={hours === option.value}
                  onClick={() =>
                    setHours(hours === option.value ? null : option.value)
                  }
                  title={option.label}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <StepHeader
              title="How hard do you want it?"
              blurb="What you want to take on, which is a separate question from what you have done before."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {DIFFICULTY.map((option) => (
                <Choice
                  key={option.value}
                  selected={difficulty === option.value}
                  onClick={() =>
                    setDifficulty(difficulty === option.value ? null : option.value)
                  }
                  title={option.label}
                  description={option.description}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm"
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-4 border-t border-black/10 pt-6 dark:border-white/15">
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={pending}
          className="text-sm opacity-50 transition-opacity hover:opacity-100 disabled:opacity-30"
        >
          Skip for now
        </button>

        <div className="flex items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              disabled={pending}
              className="rounded-full border border-black/15 px-5 py-2 text-sm transition-colors hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
            >
              Back
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={pending}
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Finish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
