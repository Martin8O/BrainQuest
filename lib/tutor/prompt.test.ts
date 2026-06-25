// Tests for the grader's PURE prompt construction (D1). The risky bit hardened in E3: every untrusted
// input that reaches the model — the grounding note AND the client-supplied question + answer — is
// length-bounded, so one giant string can't blow the token budget or be used to abuse the local model.
import { describe, expect, it } from "vitest";
import {
  MAX_ANSWER_CHARS,
  MAX_NOTE_CHARS,
  MAX_QUESTION_CHARS,
  buildUserPrompt,
  clamp,
} from "./prompt";

describe("clamp", () => {
  it("leaves short text untouched", () => {
    expect(clamp("hello", 100)).toBe("hello");
  });

  it("truncates and marks overflow", () => {
    const out = clamp("x".repeat(50), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("(zkráceno)");
    expect(out.length).toBeLessThan(50);
  });
});

describe("buildUserPrompt input bounds", () => {
  it("caps the note, the question, and the answer", () => {
    const prompt = buildUserPrompt(
      "Q".repeat(MAX_QUESTION_CHARS + 500),
      "N".repeat(MAX_NOTE_CHARS + 500),
      "A".repeat(MAX_ANSWER_CHARS + 500),
    );
    // None of the three raw inputs survives at full length — each is clamped before it reaches the model.
    expect(prompt).not.toContain("Q".repeat(MAX_QUESTION_CHARS + 1));
    expect(prompt).not.toContain("N".repeat(MAX_NOTE_CHARS + 1));
    expect(prompt).not.toContain("A".repeat(MAX_ANSWER_CHARS + 1));
    expect(prompt.split("(zkráceno)").length - 1).toBe(3); // all three overflowed
  });

  it("passes normal-sized inputs through verbatim", () => {
    const prompt = buildUserPrompt("What is a server action?", "A server action runs on the server.", "It runs server-side.");
    expect(prompt).toContain("What is a server action?");
    expect(prompt).toContain("A server action runs on the server.");
    expect(prompt).toContain("It runs server-side.");
    expect(prompt).not.toContain("(zkráceno)");
  });
});
