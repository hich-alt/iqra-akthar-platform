// استيراد الدوال العامة "الجوكر" التي وجدناها في ملفك
import { queryView, callRpc } from './api-client';

/**
 * 1. جلب قائمة الواجبات المنتظرة للتصحيح للأستاذ
 * (نستخدم دالة queryView الجاهزة في مشروعك)
 */
export async function fetchPendingCorrections() {
  try {
    const data = await queryView('owner_pending_correction_view');
    return data;
  } catch (error) {
    console.error('خطأ في جلب الواجبات المنتظرة:', error.message);
    return [];
  }
}

/**
 * 2. إرسال تصحيح واجب تلميذ (الدرجة والتقييم)
 * (نستخدم دالة callRpc الجاهزة في مشروعك)
 */
export async function gradeStudentHomework({
  submissionId,
  totalScore,
  maxScore,
  feedback,
  competencyEvaluation,
  correctionFileUrl = null
}) {
  try {
    const data = await callRpc('owner_grade_homework', {
      p_submission_id: submissionId,
      p_total_score: totalScore,
      p_max_score: maxScore,
      p_feedback: feedback,
      p_competency_evaluation: competencyEvaluation,
      p_correction_file_url: correctionFileUrl
    });
    return data;
  } catch (error) {
    throw new Error('فشل حفظ التصحيح: ' + error.message);
  }
}
