import { describe, expect, it } from "vitest";
import { examStudyOverlap, type ExamSummaryDto } from "../../packages/shared/src/exams";

type Exam = Pick<ExamSummaryDto, "status" | "ready_by_deck">;
const exam = (ready: Exam["ready_by_deck"], status: Exam["status"] = "active"): Exam => ({
  status,
  ready_by_deck: ready,
});

describe("examStudyOverlap", () => {
  it("adds nothing when the exam only wants what regular study already offers", () => {
    const overlap = examStudyOverlap(
      [exam([{ project_id: "bio", new: 5, due: 8, early: 0 }])],
      [{ id: "bio", due: 12, new: 10 }],
    );
    expect(overlap.extra).toBe(0);
    // The exam's session comes first, so the deck has that much less left.
    expect(overlap.byDeck.get("bio")).toEqual({ due: 8, new: 5 });
  });

  it("counts cards wanted early and new cards beyond the deck's own for today", () => {
    const overlap = examStudyOverlap(
      [exam([{ project_id: "bio", new: 30, due: 4, early: 9 }])],
      [{ id: "bio", due: 4, new: 10 }],
    );
    expect(overlap.extra).toBe(9 + 20);
    expect(overlap.byDeck.get("bio")).toEqual({ due: 4, new: 10 });
  });

  it("counts everything when the deck has nothing of its own today", () => {
    const overlap = examStudyOverlap(
      [exam([{ project_id: "bio", new: 6, due: 0, early: 3 }])],
      [],
    );
    expect(overlap.extra).toBe(9);
    expect(overlap.byDeck.get("bio")).toEqual({ due: 0, new: 0 });
  });

  it("sums several exams and ignores finished or archived ones", () => {
    const overlap = examStudyOverlap(
      [
        exam([{ project_id: "bio", new: 0, due: 0, early: 2 }]),
        exam([{ project_id: "chem", new: 4, due: 0, early: 1 }]),
        exam([{ project_id: "bio", new: 50, due: 50, early: 50 }], "completed"),
        exam([{ project_id: "bio", new: 50, due: 50, early: 50 }], "archived"),
      ],
      [
        { id: "bio", due: 3, new: 0 },
        { id: "chem", due: 0, new: 4 },
      ],
    );
    expect(overlap.extra).toBe(3);
    expect([...overlap.byDeck.keys()].sort()).toEqual(["bio", "chem"]);
  });

  it("is empty with no exams", () => {
    expect(examStudyOverlap([], [{ id: "bio", due: 3, new: 2 }]).extra).toBe(0);
  });
});
