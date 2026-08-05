import React, { useEffect, useState } from 'react';
import { fetchPendingCorrections } from './homeworkService'; // تأكد أن المسار صحيح لملف الخدمة الذي أنشأناه

export default function PendingCorrectionsWidget() {
  const [pendingList, setPendingList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const data = await fetchPendingCorrections();
      setPendingList(data);
      setLoading(false);
    }
    loadData();
  }, []);

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>جاري تحميل الواجبات... ⏳</div>;
  }

  return (
    <div style={{ padding: '20px', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', border: '1px solid #f3f4f6' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '16px' }}>
        الواجبات المنتظرة للتصحيح 📝
      </h2>
      
      {pendingList.length === 0 ? (
        <div style={{ padding: '16px', backgroundColor: '#ecfdf5', color: '#047857', borderRadius: '8px' }}>
          ممتاز! لا يوجد شيء معلق حالياً. 🎉
        </div>
      ) : (
        <ul style={{ listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pendingList.map((item) => (
            <li key={item.submission_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
              <div>
                <p style={{ margin: 0, fontWeight: 'bold', color: '#1f2937' }}>{item.student_name}</p>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>الدرس: {item.lesson_title}</p>
              </div>
              <button 
                style={{ padding: '8px 16px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                onClick={() => alert(`سيتم فتح شاشة تصحيح واجب التلميذ: ${item.student_name}`)}
              >
                تصحـيـح الواجب
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
