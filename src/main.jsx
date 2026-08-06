import React from 'react'
import ReactDOM from 'react-dom/client'

// مكون بسيط مؤقت لحين ربط الصفحة الرئيسية
function App() {
  return (
    <div style={{ padding: '40px', fontFamily: 'Tahoma, sans-serif', textAlign: 'center' }}>
      <h1>🎓 منصة اقرأ أكثر التعليمية</h1>
      <p>تم إطلاق النظام والواجهة بنجاح تام!</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
