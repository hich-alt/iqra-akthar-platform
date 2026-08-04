/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * Permissions (new — no permission utility existed in the codebase before)
 *
 * The platform has exactly one Owner (see the master project document:
 * "There is only one Owner... No Teacher role exists"). Roles are
 * therefore simple: 'owner' | 'student' | 'parent' (future). This module
 * centralizes every permission check so components never inline role logic.
 */

export const ROLES = { OWNER: "owner", STUDENT: "student", PARENT: "parent" };

export function isOwner(session) {
  return session?.role === ROLES.OWNER;
}

export function isStudent(session) {
  return session?.role === ROLES.STUDENT;
}

/** Students may only ever act on their own resources. */
export function ownsResource(session, resourceOwnerOrStudentId) {
  if (isOwner(session)) return true; // Owner has full access, by design
  return session?.userId === resourceOwnerOrStudentId;
}

/**
 * Central platform-wide permission table. Kept as data, not scattered `if`
 * statements, so every audit has one place to verify against.
 *
 * Renamed from STUDENT_MANAGEMENT_PERMISSIONS: that name stopped being
 * accurate the moment Parent Portal added `parent.dashboard.view` here
 * rather than starting a second table — this is the architecture-drift fix
 * for that, made explicit rather than left as a misleading name. There is
 * exactly one permission table in this codebase, named for what it is.
 */
const PERMISSIONS = {
  "student.list.view": [ROLES.OWNER],
  "student.profile.view": [ROLES.OWNER, ROLES.STUDENT], // student can view own profile only — checked via ownsResource separately
  "student.profile.edit": [ROLES.OWNER],
  "student.bulk_action": [ROLES.OWNER],
  "student.notes.view": [ROLES.OWNER], // Owner-private notes field — never exposed to student/parent regardless of role check
  "parent.dashboard.view": [ROLES.OWNER, ROLES.PARENT],
  "lesson.create": [ROLES.OWNER],
  "lesson.edit": [ROLES.OWNER],
  "lesson.publish": [ROLES.OWNER], // gates the same action lessons.status='published' RLS also gates server-side — UX layer only, as always
  "lesson.archive": [ROLES.OWNER],
  "curriculum.structure.manage": [ROLES.OWNER], // academic years, terms, weeks, fields, subjects
};

export function can(session, action) {
  const allowedRoles = PERMISSIONS[action];
  if (!allowedRoles) {
    // Fail closed: an action with no registered permission entry is denied,
    // not silently allowed — a missing entry is a bug to fix, not a gap to exploit.
    return false;
  }
  return allowedRoles.includes(session?.role);
}

/** Combines role-based `can()` with row-level ownership for actions scoped to a specific student. */
export function canOnStudent(session, action, studentId) {
  if (!can(session, action)) return false;
  if (action === "student.profile.view") return isOwner(session) || session?.userId === studentId;
  return true;
}

/**
 * UX-layer only, same disclaimer as everywhere else in this file: the real
 * gate for a parent reading a child's data is `is_verified_parent_of()` in
 * parent-portal-schema.sql, evaluated by Postgres RLS on every query. This
 * function only decides whether to render a "switch to this child" option
 * in the UI given a list of linked children already fetched (and therefore
 * already RLS-filtered) from parent_student_links. It is not, and cannot
 * be, a substitute for that.
 */
export function parentCanViewChild(linkedStudentIds, studentId) {
  return Array.isArray(linkedStudentIds) && linkedStudentIds.includes(studentId);
}
