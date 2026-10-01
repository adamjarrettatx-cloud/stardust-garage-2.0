// Display names are independent of the existing billing/application slugs.
export const QUIZ_VERSION = 1;
export const PLAN_SLUGS = {
  weekender: "weekender",
  builder: "cowork",
  insider: "cowork-party",
};
export const emptyQuiz = () => ({
  age: "",
  gender: "",
  interests: [],
  activities: [],
  priority: "",
  branch: "",
});
export const QUIZ_QUESTIONS = [
  {
    key: "gender",
    label: "",
    title: "How do you identify?",
    sub: "This helps us understand our membership community.",
    options: [
      ["male", "Male"],
      ["female", "Female"],
      ["other", "Other"],
      ["private", "Prefer not to say"],
    ],
  },
  {
    key: "interests",
    label: "YOUR WORLD",
    title: "How would you like to spend your time at Stardust Garage?",
    sub: "Choose up to three.",
    multi: true,
    max: 3,
    options: [
      ["night", "Enjoying music, dancing, and weekend nights"],
      ["work", "Coworking and bringing my projects to life"],
      [
        "experience",
        "Taking part in conscious experiences and curated gatherings",
      ],
      ["community", "Meeting people and connecting with a creative community"],
      ["studio", "Creating and collaborating in the studio"],
      ["unsure", "I’m still exploring"],
    ],
  },
  {
    key: "activities",
    label: "MAKE IT PART OF YOUR LIFE",
    title: "Which experiences would you look forward to most?",
    sub: "Select any that interest you.",
    multi: true,
    options: [
      ["night", "Weekend music and parties"],
      ["work", "Weekday coworking"],
      ["movies", "Movie nights"],
      ["wellness", "Wellness Wednesday"],
      ["producer", "Producer parties"],
      ["exclusive", "Members-only parties and gatherings"],
      ["studio", "Creating in the studio"],
      ["unsure", "I’m not sure yet"],
    ],
  },
  {
    key: "priority",
    label: "WHAT MATTERS MOST",
    title: "What matters most in your membership?",
    sub: "Choose the one that feels closest.",
    options: [
      ["night", "A membership focused on weekend nights"],
      ["work", "A regular place to work and create"],
      ["insider", "Curated gatherings and Insider-only benefits"],
      ["mix", "A mix of work, nightlife, and community"],
      ["unsure", "Help me choose"],
    ],
  },
];
export function quizSignals(a) {
  return {
    night: a.interests.includes("night") || a.activities.includes("night"),
    work: a.interests.includes("work") || a.activities.includes("work"),
    insider:
      a.interests.some((v) => ["experience", "studio"].includes(v)) ||
      a.activities.some((v) =>
        ["movies", "wellness", "producer", "exclusive", "studio"].includes(v),
      ),
  };
}
export function quizBranch(a) {
  const s = quizSignals(a),
    p = a.priority;
  if (["insider", "mix"].includes(p)) return null;
  if (p === "night" && (s.insider || s.work)) return "night";
  if (p === "work" && (s.insider || s.night)) return "work";
  if (p === "unsure" && Object.values(s).filter(Boolean).length > 1)
    return s.work && !s.night ? "work" : "night";
  if (p === "unsure" && !Object.values(s).some(Boolean)) return "explore";
  return null;
}
export function branchQuestion(a) {
  const branch = quizBranch(a);
  if (!branch) return null;
  if (branch === "explore")
    return {
      key: "branch",
      label: "LET’S FIND A STARTING POINT",
      title: "Which would you try first?",
      sub: "No commitment. Just choose the experience you’re most curious about.",
      options: [
        ["try-night", "A weekend night of music and dancing"],
        ["try-work", "A workday in a different kind of space"],
        ["try-insider", "A curated gathering with the member community"],
      ],
    };
  return {
    key: "branch",
    label: "ONE LAST THING",
    title:
      branch === "work"
        ? "Would you use Stardust beyond your workday?"
        : "Would weekend nights cover what you’re looking for?",
    sub: "Let’s narrow it down to the right fit.",
    options: [
      [
        "simple",
        branch === "work"
          ? "Mostly just for coworking"
          : "Yes, that’s mainly why I’d join",
      ],
      [
        "expanded",
        branch === "work"
          ? "Yes, for gatherings, parties, or studio access too"
          : "No, I also want curated gatherings and Insider-only benefits",
      ],
      ["both", "Show me both options"],
    ],
  };
}
export function quizRecommendation(a) {
  const s = quizSignals(a),
    branch = quizBranch(a);
  const make = (primary, reason, secondary = null) => ({
    primary,
    reason,
    secondary,
  });
  if (branch === "explore")
    return make(
      {
        "try-night": "weekender",
        "try-work": "builder",
        "try-insider": "insider",
      }[a.branch],
      "Based on what you’d like to try first, this is a starting point worth exploring. You can edit your answers anytime.",
    );
  if (branch && a.branch === "simple")
    return make(
      branch === "work" ? "builder" : "weekender",
      branch === "work"
        ? "You want a regular place to work and create, without making the wider experience your priority."
        : "You told us weekend music and nights out are what you mainly want.",
    );
  if (branch && a.branch === "expanded")
    return make(
      "insider",
      "You want more than one side of Stardust, including curated gatherings or access beyond your main routine.",
    );
  if (branch && a.branch === "both")
    return make(
      branch === "work" ? "builder" : "weekender",
      "You asked to see both. Start with the membership focused on your main routine, or choose Insider for broader access.",
      "insider",
    );
  if (["insider", "mix"].includes(a.priority))
    return make(
      "insider",
      a.priority === "mix"
        ? "You want work, nightlife, and community in one membership. Insider brings those parts of Stardust together."
        : "Curated gatherings and Insider-only benefits are your priority. Insider is designed around that deeper experience.",
    );
  if (a.priority === "night")
    return make(
      "weekender",
      "Weekend music and parties are your main reason to join. Weekender keeps the focus there.",
    );
  if (a.priority === "work")
    return make(
      "builder",
      "You want a regular place to work and create. Builder puts your workday first.",
    );
  if (s.insider || (s.work && s.night))
    return make(
      "insider",
      s.insider
        ? "You chose curated experiences or studio access. Those interests point toward Insider, even if coworking is not your priority."
        : "You selected both coworking and weekend nightlife. Insider includes both memberships.",
    );
  if (s.work)
    return make(
      "builder",
      "Coworking is the clearest interest in your answers. Builder is the place to begin.",
    );
  return make(
    "weekender",
    "Weekend music is the clearest interest in your answers. Weekender is the place to begin.",
  );
}
// Validate independently on the server. Gender never contributes to recommendation or price.
export function validateQuiz(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Please complete the quiz.");
  const a = emptyQuiz();
  a.age = Number(value.age);
  if (!Number.isInteger(a.age) || a.age < 21 || a.age > 120)
    throw new Error("You must be 21 or older to apply.");
  for (const q of QUIZ_QUESTIONS) {
    const allowed = q.options.map(([v]) => v);
    if (q.multi) {
      if (
        !Array.isArray(value[q.key]) ||
        !value[q.key].length ||
        value[q.key].length > (q.max || allowed.length)
      )
        throw new Error("Please complete the interest questions.");
      a[q.key] = [...new Set(value[q.key])];
      if (
        a[q.key].length !== value[q.key].length ||
        a[q.key].some((v) => !allowed.includes(v)) ||
        (a[q.key].includes("unsure") && a[q.key].length !== 1)
      )
        throw new Error("Invalid quiz selections.");
    } else {
      if (!allowed.includes(value[q.key]))
        throw new Error("Please complete the quiz.");
      a[q.key] = value[q.key];
    }
  }
  const q = branchQuestion(a);
  if (q) {
    if (!q.options.some(([v]) => v === value.branch))
      throw new Error("Please complete the final question.");
    a.branch = value.branch;
  }
  return a;
}
