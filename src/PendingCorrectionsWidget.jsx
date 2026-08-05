import React, { useEffect, useState } from 'react';
// تأكد من استيراد دالة التصحيح التي بنيناها في الدرس السابق
import { fetchPendingCorrections, gradeStudentHomework } from './homeworkService'; 

export default function PendingCorrectionsWidget() {
  const [pendingList, setPendingList] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // حالات (States) خاصة بنافذة التصحيح
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [score, setScore] = useState("");
  const [maxScore, setMaxScore] = useState(20);
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  // دالة لجلب البيانات
  async function loadData() {
    setLoading(true);
    const data = await fetchPendingCorrections();
    setPendingList(data);
    setLoading(false);
  }

  // دالة لفتح نافذة التصحيح وتجهيز الخانات
  function openGradingModal(item) {
    setSelectedSubmission(item);
    setScore("");
    setMaxScore(20);
    setFeedback("");
    setError(null);
  }

  // دالة إرسال التقييم لقاعدة البيانات
  async function handleGradeSubmit() {
    if (score === "" || isNaN(score)) {
      setError("الرجاء إدخال عدد صحيح.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await gradeStudentHomework({
        submissionId: selectedSubmission.submission_id,
        totalScore: Number(score),
        maxScore: Number(maxScore),
        feedback: feedback,
        competencyEvaluation: {} // أرسلناها فارغة حالياً، ويمكنك لاحقاً برمجتها لتقييم الكفاءات بدقة
      });
      
      // بعد نجاح الحفظ: نغلق النافذة ونحدث القائمة
      setSelectedSubmission(null);
      loadData(); 
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-center text-stone-500 font-medium">جاري تحميل الواجبات المنتظرة... ⏳</div>;
  }

  return (
    <div className="p-6 bg-white rounded-xl shadow-sm border border-stone-200">
      <h2 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
        الواجبات المنتظرة للتصحيح 📝
      </h2>

      {pendingList.length === 0 ? (
        <div className="p-4 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium border border-emerald-100">
          ممتاز! لقد قمت بتصحيح جميع واجبات تلاميذك. لا يوجد شيء معلق حالياً. 🎉
        </div>
      ) : (
        <ul className="space-y-3">
          {pendingList.map((item) => (
            <li 
              key={item.submission_id} 
              className="flex justify-between items-center p-3 bg-stone-50 rounded-lg hover:bg-stone-100 transition border border-stone-100"
            >
              <div>
                <p className="font-bold text-stone-800 text-sm">{item.student_name}</p>
                <p className="text-xs text-stone-500 mt-1">الدرس: {item.lesson_title}</p>
              </div>
              <button 
                className="px-4 py-2 bg-stone-900 text-white text-xs font-bold rounded-lg hover:bg-stone-800 transition shadow-sm"
                onClick={() => openGradingModal(item)}
              >
                تصحـيـح الواجب
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ----------------- نافذة التصحيح المنبثقة (Modal) ----------------- */}
      {selectedSubmission && (
        <div dir="rtl" className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            
            <div className="flex items-center justify-between mb-5 border-b border-stone-100 pb-3">
              <h3 className="font-bold text-lg text-stone-800">
                تصحيح واجب: <span className="text-blue-600">{selectedSubmission.student_name}</span>
              </h3>
              <button onClick={() => setSelectedSubmission(null)} className="text-stone-400 hover:text-red-500 font-bold text-xl">
                 ✕
              </button>
            </div>

            <div className="mb-5 p-3 bg-stone-50 rounded-lg border border-stone-200">
              <p className="text-sm text-stone-600 mb-1">عنوان الدرس:</p>
              <p className="font-bold text-sm text-stone-800">{selectedSubmission.lesson_title}</p>
            </div>

            {error && <p className="text-xs text-red-600 mb-4 p-2 bg-red-50 rounded border border-red-100">{error}</p>}

            <div className="flex gap-4 mb-5">
              <div className="flex-1">
                <label className="block text-sm font-bold text-stone-700 mb-2">العدد المُسند (الدرجة)</label>
                <input
                  type="number"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 font-bold"
                  placeholder="مثال: 18.5"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-bold text-stone-700 mb-2">الضارب (العدد الأقصى)</label>
                <input
                  type="number"
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400 text-stone-500 bg-stone-50 font-bold"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-bold text-stone-700 mb-2">تغذية راجعة (ملاحظاتك للتلميذ)</label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
                placeholder="أحسنت العمل، لكن ركز أكثر على..."
              />
            </div>

            <div className="flex justify-end gap-3 mt-2">
              <button onClick={() => setSelectedSubmission(null)} className="px-5 py-2.5 text-sm font-bold rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
                إلغاء
              </button>
              <button 
                onClick={handleGradeSubmit} 
                disabled={saving} 
                className="px-5 py-2.5 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 disabled:opacity-50 transition shadow-sm"
              >
                {saving ? "جارٍ الحفظ..." : "حفظ العدد والتقييم ✓"}
              </button>
            </div>

          </div>
        </div>
      )}
      {/* ------------------------------------------------------------------ */}
    </div>
  );
}
