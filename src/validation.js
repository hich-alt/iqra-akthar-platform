/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * Validation (new — no shared validation existed before this file; every
 * form built so far used inline ad-hoc checks like `title.trim() &&
 * selectedQuestions.size > 0`. This is the single source of truth going
 * forward. Existing forms migrate to it when next touched, per policy —
 * not rewritten in this pass just to use it.)
 */

export const rules = {
  required: (message = "هذا الحقل مطلوب") => (value) =>
    (value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0))
      ? message : null,

  minLength: (min, message) => (value) =>
    (typeof value === "string" && value.trim().length < min)
      ? (message ?? `يجب أن يحتوي هذا الحقل على ${min} أحرف على الأقل`) : null,

  maxLength: (max, message) => (value) =>
    (typeof value === "string" && value.trim().length > max)
      ? (message ?? `يجب ألا يتجاوز هذا الحقل ${max} حرفًا`) : null,

  minItems: (min, message) => (value) =>
    (Array.isArray(value) && value.length < min)
      ? (message ?? `اختر ${min} عنصر على الأقل`) : null,

  oneOf: (allowed, message) => (value) =>
    (value !== undefined && value !== null && !allowed.includes(value))
      ? (message ?? `القيمة غير صالحة`) : null,

  maxFileSizeMB: (maxMB, message) => (file) =>
    (file && file.size > maxMB * 1024 * 1024)
      ? (message ?? `الحد الأقصى لحجم الملف ${maxMB} ميغابايت`) : null,

  allowedFileTypes: (mimeTypes, message) => (file) =>
    (file && !mimeTypes.includes(file.type))
      ? (message ?? `نوع الملف غير مدعوم`) : null,
};

/**
 * Composes multiple rules for one field — returns the first failing
 * message, or null if all pass.
 */
export function composeRules(...ruleFns) {
  return (value) => {
    for (const rule of ruleFns) {
      const error = rule(value);
      if (error) return error;
    }
    return null;
  };
}

/**
 * Validates a values object against a schema of { field: validatorFn }.
 * Returns { isValid, errors } where errors is { field: message }.
 */
export function validate(schema, values) {
  const errors = {};
  for (const [field, validator] of Object.entries(schema)) {
    const error = validator(values[field]);
    if (error) errors[field] = error;
  }
  return { isValid: Object.keys(errors).length === 0, errors };
}

// ============================================================================
// 🚀 LESSON LIFECYCLE SCHEMA (دورة حياة الدرس)
// تمت الإضافة لضمان التحكم الصارم في حالات الدرس وانتقالاتها
// ============================================================================

export const LESSON_STATUSES = ["draft", "scheduled", "published", "closed", "archived"];

export const lessonLifecycleSchema = {
  title: rules.required("عنوان الدرس مطلوب"),
  content_body: composeRules(
    rules.required("محتوى الدرس مطلوب"),
    rules.minLength(20, "المحتوى قصير جدًا — أضف تفاصيل أكثر")
  ),
  competencyIds: rules.minItems(1, "اختر كفاءة واحدة على الأقل"),
  status: rules.oneOf(LESSON_STATUSES, "حالة الدرس غير صالحة أو غير معترف بها في النظام"),
};

/**
 * دالة ذكية للتحقق من منطق الانتقال بين حالات الدرس
 * تمنع الأخطاء المنطقية (مثل إغلاق درس لم يُنشر بعد، أو تعديل درس مؤرشف)
 */
export function validateLessonTransition(currentStatus, newStatus) {
  if (currentStatus === newStatus) return null; // لا يوجد تغيير، مسموح

  if (currentStatus === "archived") {
    return "لا يمكن تغيير حالة درس مؤرشف. يجب إعادته كمسودة أولاً إذا لزم الأمر.";
  }

  if (currentStatus === "draft" && newStatus === "closed") {
    return "عملية غير منطقية: لا يمكن إغلاق واجب وهو لا يزال مسودة ولم يُنشر للتلاميذ بعد.";
  }

  return null; // الانتقال مسموح وصالح
}
