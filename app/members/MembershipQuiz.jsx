"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Wordmark from "@/app/components/Wordmark";
import {
  emptyQuiz,
  QUIZ_QUESTIONS,
  PLAN_SLUGS,
  quizBranch,
  branchQuestion,
  quizRecommendation,
} from "@/lib/membership-quiz";
import "./quiz.css";

export default function MembershipQuiz({
  plans: sourcePlans,
  savedQuiz = null,
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState(
    () => savedQuiz?.answers || emptyQuiz(),
  );
  const [step, setStep] = useState(savedQuiz ? 6 : 0);
  const [result, setResult] = useState(() =>
    savedQuiz ? quizRecommendation(savedQuiz.answers) : null,
  );
  const [selectedPlan, setSelectedPlan] = useState(() =>
    savedQuiz
      ? Object.keys(PLAN_SLUGS).find(
          (key) => PLAN_SLUGS[key] === savedQuiz.selected_plan,
        ) || quizRecommendation(savedQuiz.answers).primary
      : null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState("light");
  const heading = useRef(null),
    dialog = useRef(null);
  const plans = Object.fromEntries(
    Object.entries(PLAN_SLUGS).map(([key, slug]) => [
      key,
      sourcePlans.find((p) => p.slug === slug),
    ]),
  );
  useEffect(() => {
    setTheme(
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    );
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    setError("");
  }, [step]);
  const q = step === 5 ? branchQuestion(answers) : QUIZ_QUESTIONS[step - 1];
  async function saveResults(selected) {
    const response = await fetch("/api/members/quiz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers,
        ...(selected ? { selectedPlan: selected } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error || "Your results could not be saved. Please try again.",
      );
    return data;
  }
  async function finish() {
    setBusy(true);
    setError("");
    try {
      const data = await saveResults();
      setResult(data.recommendation);
      setSelectedPlan(data.selectedPlan);
      setStep(6);
      router.refresh();
    } catch (e) {
      setError(
        e.message || "Your results could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function next() {
    if (step === 0) {
      const age = Number(answers.age);
      if (!answers.age || !Number.isInteger(age) || age < 1 || age > 120) {
        setError("Please enter a valid whole-number age.");
        return;
      }
      setStep(age < 21 ? -1 : 1);
    } else if (step === 4) {
      if (quizBranch(answers)) setStep(5);
      else finish();
    } else if (step === 5) finish();
    else setStep(step + 1);
  }
  function choose(value) {
    let selected = value;
    if (q.multi) {
      const current = answers[q.key];
      if (current.includes(value))
        selected = current.filter((v) => v !== value);
      else if (value === "unsure") selected = ["unsure"];
      else {
        const withoutUnsure = current.filter((v) => v !== "unsure");
        if (q.max && withoutUnsure.length >= q.max) {
          setError(`Choose up to ${q.max}. Deselect one to choose another.`);
          return;
        }
        selected = [...withoutUnsure, value];
      }
    }
    setAnswers((a) => ({
      ...a,
      [q.key]: selected,
      ...(q.key === "branch" ? {} : { branch: "" }),
    }));
    setError("");
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const data = await saveResults(selectedPlan);
      router.push(data.next);
    } catch (e) {
      setError(e.message || "Could not continue. Please try again.");
      setBusy(false);
    }
  }
  function selectPlan(key) {
    setSelectedPlan(key);
    dialog.current?.close();
    heading.current?.focus();
    window.scrollTo(0, 0);
  }
  const h1 = (text) => (
    <h1 ref={heading} tabIndex={-1}>
      {text}
    </h1>
  );
  const back = () =>
    setStep(step === 6 ? (quizBranch(answers) ? 5 : 4) : Math.max(0, step - 1));
  const benefits = (p) => (
    <ul className="benefits">
      {p.benefits.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
  const selected = plans[selectedPlan];
  const alternative = result?.secondary
    ? selectedPlan === result.primary
      ? result.secondary
      : result.primary
    : null;
  return (
    <div className="membership-quiz" data-theme={theme}>
      <header className="header">
        <Link href="/" className="brand" aria-label="Stardust Garage home">
          <Wordmark />
        </Link>
        <div className="header-actions">
          <Link className="text-button" href="/home">
            Back to site
          </Link>
          <button
            className="theme"
            aria-label="Switch color theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            ◐
          </button>
        </div>
      </header>
      <main className="quiz-main">
        <nav className="progress" aria-label="Quiz progress">
          {["", "Your world", "Your fit"].map((label, i) => (
            <span
              key={i}
              className={i <= (step < 2 ? 0 : step < 6 ? 1 : 2) ? "active" : ""}
            >
              0{i + 1} {label && <b>{label}</b>}
            </span>
          ))}
        </nav>
        <section className="screen" key={step}>
          {step === -1 ? (
            <>
              <span className="eyebrow">MEMBERSHIP ELIGIBILITY</span>
              {h1("For ages 21 and up.")}
              <p>
                Stardust Garage is a 21+ venue. You’ll need to be at least 21 to
                continue with membership discovery.
              </p>
              <button className="primary" onClick={() => setStep(0)}>
                Change my age <span>←</span>
              </button>
            </>
          ) : step === 0 ? (
            <>
              <span className="eyebrow">FIND YOUR FIT</span>
              {h1("What’s your age?")}
              <p className="intro">
                A few questions. A membership that fits you.
                <br />
                Let’s start with the basics.
              </p>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  next();
                }}
              >
                <label className="sr-only" htmlFor="quiz-age">
                  Your age
                </label>
                <div className="age-wrap">
                  <input
                    id="quiz-age"
                    data-testid="input-age"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="120"
                    step="1"
                    placeholder="Your age"
                    required
                    value={answers.age}
                    aria-describedby={error ? "quiz-error" : undefined}
                    aria-invalid={!!error}
                    onChange={(e) => {
                      setAnswers({ ...answers, age: e.target.value });
                      setError("");
                    }}
                  />
                  <span>years old</span>
                </div>
                {error && (
                  <p id="quiz-error" className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="actions">
                  <button className="primary" data-testid="button-continue">
                    Continue <span>→</span>
                  </button>
                </div>
              </form>
            </>
          ) : step < 6 && q ? (
            <>
              {q.label && <span className="eyebrow">{q.label}</span>}
              {h1(q.title)}
              <p className="intro">{q.sub}</p>
              <div className="choices" role="group" aria-label={q.title}>
                {q.options.map(([value, text]) => (
                  <button
                    className={`choice ${q.multi ? "multi" : ""}`}
                    key={value}
                    disabled={busy}
                    data-testid={`option-${q.key}-${value}`}
                    aria-pressed={
                      q.multi
                        ? answers[q.key].includes(value)
                        : answers[q.key] === value
                    }
                    onClick={() => choose(value)}
                  >
                    <span>{text}</span>
                    <span className="check" aria-hidden="true">
                      ✓
                    </span>
                  </button>
                ))}
              </div>
              {error && (
                <p className="error" role="status">
                  {error}
                </p>
              )}
              <div className="actions">
                <button
                  className="primary"
                  data-testid="button-continue"
                  disabled={busy || (q.multi ? !answers[q.key].length : !answers[q.key])}
                  onClick={next}
                >
                  {busy ? "Saving your results…" : step >= 4 ? "Find my membership" : "Continue"} <span>→</span>
                </button>
                <div className="subactions">
                  <button className="text-button" disabled={busy} onClick={back}>
                    ← Back
                  </button>
                  <span className="meta">
                    {q.multi
                      ? q.max
                        ? `Choose up to ${q.max}`
                        : "Choose any that fit"
                      : "Choose one"}
                  </span>
                </div>
              </div>
              {step === 1 && (
                <p className="footnote">
                  Your answer does not change your recommendation or price.
                  Completed quiz responses are saved to your account and accompany your application.
                </p>
              )}
            </>
          ) : result && selected ? (
            <>
              <span className="eyebrow">
                {selectedPlan === result.primary
                  ? "YOUR MEMBERSHIP MATCH"
                  : "YOUR SELECTED MEMBERSHIP"}
              </span>
              {h1("Your kind of Stardust.")}
              <p>
                {selectedPlan === result.primary
                  ? result.reason
                  : `You’re exploring ${selected.name}. Your quiz recommendation is still ${plans[result.primary].name}.`}
              </p>
              <article className="result-card">
                <span className="eyebrow">{selected.kicker}</span>
                <h2>{selected.name}</h2>
                <p>{selected.tagline}</p>
                <p className="price">
                  {selected.price}
                  <span> {selected.period}</span>
                </p>
                {benefits(selected)}
                {selectedPlan === "insider" && (
                  <p className="small">
                    Studio booking access does not mean free studio hours.
                    Ticket discounts and event entry remain subject to their
                    applicable terms.
                  </p>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="primary"
                  data-testid="button-apply"
                  disabled={busy}
                  onClick={apply}
                >
                  {busy ? "Continuing…" : "Apply for membership"}
                  <span>→</span>
                </button>
                <p className="footnote">
                  Saved to your account, ready on your phone or computer.
                  Your match is a recommendation, not an approval.
                </p>
              </article>
              {alternative && (
                <>
                  <span className="eyebrow alternate-label">
                    ALSO WORTH A LOOK
                  </span>
                  <button
                    className="alt"
                    onClick={() => selectPlan(alternative)}
                  >
                    <strong>
                      {plans[alternative].name} · {plans[alternative].price}
                      /month ↗
                    </strong>
                    <small>{plans[alternative].tagline}</small>
                  </button>
                </>
              )}
              <div className="result-bottom">
                {selectedPlan !== result.primary && (
                  <button
                    className="text-button"
                    onClick={() => selectPlan(result.primary)}
                  >
                    Return to my match: {plans[result.primary].name}
                  </button>
                )}
                <div className="membership-browser">
                  <button
                    className="text-button"
                    aria-haspopup="dialog"
                    data-testid="button-browse-memberships"
                    onClick={() => dialog.current?.showModal()}
                  >
                    View all memberships
                  </button>
                </div>
                <button className="text-button" onClick={back}>
                  Edit my answers
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setAnswers(emptyQuiz());
                    setResult(null);
                    setSelectedPlan(null);
                    setStep(0);
                  }}
                >
                  Start again
                </button>
              </div>
            </>
          ) : null}
        </section>
      </main>
      <footer className="footer">
        <span>AUSTIN, TEXAS</span>
        <span>
          <Link href="/account/profile">My account</Link> ·{" "}
          <Link href="/pass">Trial Pass</Link> ·{" "}
          <Link href="/privacy">Privacy</Link>
        </span>
      </footer>
      <dialog
        id="membership-options"
        ref={dialog}
        aria-labelledby="membership-options-title"
      >
        <div className="dialog-head">
          <span className="eyebrow">EXPLORE YOUR OPTIONS</span>
          <button
            className="text-button"
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
        <h2 id="membership-options-title">All memberships.</h2>
        <p className="small">
          Your quiz match stays marked. Explore another membership without
          starting over.
        </p>
        {Object.entries(plans).map(([key, p]) => (
          <article className="compare-plan" key={key}>
            {result?.primary === key && (
              <span className="tag">YOUR QUIZ MATCH</span>
            )}
            <div className="compare-title">
              <h3>{p.name}</h3>
              <span>
                {p.price}
                <small> {p.period}</small>
              </span>
            </div>
            <p className="small">{p.tagline}</p>
            {benefits(p)}
            <button
              className="compare-select"
              data-testid={`view-${key}`}
              disabled={selectedPlan === key}
              onClick={() => selectPlan(key)}
            >
              {selectedPlan === key
                ? "Currently viewing"
                : "View this membership"}{" "}
              <span>→</span>
            </button>
          </article>
        ))}
        <button className="text-button" onClick={() => dialog.current?.close()}>
          ← Back to my results
        </button>
      </dialog>
    </div>
  );
}
