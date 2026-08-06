import React from 'react'
import ReactDOM from 'react-client/client' // أو react-dom/client حسب النسخة
import ReactDOMClient from 'react-dom/client'

// استيراد المكونات التي أنشأتها مسبقاً في مجلد src
// يمكنك تجربة استعراض إحدى الصفحات الرئيسية مباشرة هنا
import TeacherDashboard from './teacher-today-page.jsx'

function AppRouter() {
  return (
    <div style={{ direction: 'rtl', fontFamily: 'Tahoma, sans-serif', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      <TeacherDashboard />
    </div>
  )
}

ReactDOMClient.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
)
