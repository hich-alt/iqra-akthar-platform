/**
 * STUDENT MANAGEMENT — PERMISSION TESTS (Jest)
 * Run: npx jest permissions.test.js
 *
 * Authorization is the single highest-blast-radius bug class here: a
 * failure means a student sees another student's data, or a non-owner
 * edits a profile. Tested in isolation from network/DB since permissions.js
 * has no external dependencies — pure functions over a session object.
 */

const { can, canOnStudent, ownsResource, isOwner, isStudent, ROLES } = require("./permissions");

describe("permissions — role checks", () => {
  test("isOwner is true only for owner role", () => {
    expect(isOwner({ role: ROLES.OWNER })).toBe(true);
    expect(isOwner({ role: ROLES.STUDENT })).toBe(false);
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
  });

  test("isStudent is true only for student role", () => {
    expect(isStudent({ role: ROLES.STUDENT })).toBe(true);
    expect(isStudent({ role: ROLES.OWNER })).toBe(false);
  });
});

describe("permissions — can()", () => {
  test("owner can list students; student cannot", () => {
    expect(can({ role: ROLES.OWNER }, "student.list.view")).toBe(true);
    expect(can({ role: ROLES.STUDENT }, "student.list.view")).toBe(false);
  });

  test("only owner can edit a profile", () => {
    expect(can({ role: ROLES.OWNER }, "student.profile.edit")).toBe(true);
    expect(can({ role: ROLES.STUDENT }, "student.profile.edit")).toBe(false);
    expect(can({ role: ROLES.PARENT }, "student.profile.edit")).toBe(false);
  });

  test("only owner can view private notes, regardless of who's asking", () => {
    expect(can({ role: ROLES.OWNER }, "student.notes.view")).toBe(true);
    expect(can({ role: ROLES.STUDENT }, "student.notes.view")).toBe(false);
    expect(can({ role: ROLES.PARENT }, "student.notes.view")).toBe(false);
  });

  test("an action with no registered permission entry fails closed, not open", () => {
    expect(can({ role: ROLES.OWNER }, "some.made.up.action")).toBe(false);
    expect(can({ role: ROLES.STUDENT }, "some.made.up.action")).toBe(false);
  });

  test("a null/undefined session is denied every gated action", () => {
    expect(can(null, "student.list.view")).toBe(false);
    expect(can(undefined, "student.profile.edit")).toBe(false);
  });

  test("bulk actions are owner-only", () => {
    expect(can({ role: ROLES.OWNER }, "student.bulk_action")).toBe(true);
    expect(can({ role: ROLES.STUDENT }, "student.bulk_action")).toBe(false);
  });
});

describe("permissions — lesson actions (Lesson Editor)", () => {
  test("only owner can create, edit, publish, or archive a lesson", () => {
    for (const action of ["lesson.create", "lesson.edit", "lesson.publish", "lesson.archive"]) {
      expect(can({ role: ROLES.OWNER }, action)).toBe(true);
      expect(can({ role: ROLES.STUDENT }, action)).toBe(false);
      expect(can({ role: ROLES.PARENT }, action)).toBe(false);
    }
  });
});

describe("permissions — curriculum structure actions (Curriculum Manager)", () => {
  test("only owner can manage curriculum structure", () => {
    expect(can({ role: ROLES.OWNER }, "curriculum.structure.manage")).toBe(true);
    expect(can({ role: ROLES.STUDENT }, "curriculum.structure.manage")).toBe(false);
    expect(can({ role: ROLES.PARENT }, "curriculum.structure.manage")).toBe(false);
  });
});

describe("permissions — ownsResource()", () => {
  test("owner owns every resource regardless of the id", () => {
    expect(ownsResource({ role: ROLES.OWNER, userId: "owner_1" }, "someone_elses_id")).toBe(true);
  });

  test("a student owns only their own resource", () => {
    const session = { role: ROLES.STUDENT, userId: "student_1" };
    expect(ownsResource(session, "student_1")).toBe(true);
    expect(ownsResource(session, "student_2")).toBe(false);
  });
});

describe("permissions — canOnStudent() (row-level + role-level combined)", () => {
  test("owner can view any student's profile", () => {
    const session = { role: ROLES.OWNER, userId: "owner_1" };
    expect(canOnStudent(session, "student.profile.view", "student_5")).toBe(true);
  });

  test("a student can view their own profile", () => {
    const session = { role: ROLES.STUDENT, userId: "student_1" };
    expect(canOnStudent(session, "student.profile.view", "student_1")).toBe(true);
  });

  test("a student CANNOT view a different student's profile — the core cross-account leak scenario", () => {
    const session = { role: ROLES.STUDENT, userId: "student_1" };
    expect(canOnStudent(session, "student.profile.view", "student_2")).toBe(false);
  });

  test("a student cannot edit even their own profile — edit is owner-only", () => {
    const session = { role: ROLES.STUDENT, userId: "student_1" };
    expect(canOnStudent(session, "student.profile.edit", "student_1")).toBe(false);
  });

  test("a role-denied action stays denied even when ids match", () => {
    // Guards against a future refactor accidentally short-circuiting on
    // id equality before checking the role-level `can()` gate at all.
    const session = { role: ROLES.PARENT, userId: "student_1" };
    expect(canOnStudent(session, "student.bulk_action", "student_1")).toBe(false);
  });
});
