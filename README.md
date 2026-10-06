# AttendFlow - Modern Attendance Marker System

A full-stack, responsive Attendance Marking web application featuring separate **Admin** and **Student** portals, secure role-based authentication, real-time check-in, statistics dashboards, reports with CSV export, and persistent database storage (SQLite + fallback).

---

## 🌟 Key Features

### 🎓 Student Portal
- **One-Click Attendance Check-In**: Students can mark their own attendance for today with an automatic on-time cutoff detector (marks *Present* before 09:30 AM or *Late* afterwards).
- **Duplicate Prevention**: Enforces a single check-in per day per student.
- **Attendance Percentage Metric**: Dynamic radial gauge showing attendance percentage, with warnings if below the mandatory 75% threshold.
- **Complete Attendance History**: Filterable history table with date, status badges (Present, Late, Absent, Excused), check-in time, and verification notes.

### 🛡️ Admin Portal
- **Daily Attendance Register**: Select any date, search by student name/roll number/department, and instantly mark or toggle status (`Present`, `Late`, `Absent`, `Excused`) with 1-click quick-action buttons.
- **Batch Marking**: One-click **"Mark All Present"** or **"Mark All Absent"** for fast daily management.
- **Attendance Analytics & Trend Chart**: Visual responsive bar chart showing daily attendance rates over time.
- **Export & Print**: One-click **Export to CSV** for spreadsheets and printer-friendly view.
- **Student Directory Management**: Register new students (with username, password, roll number, and department) or remove existing student profiles.

### 💻 Responsive Design
- Optimized for mobile phones, tablets, laptops, and desktops using fluid CSS Grid and Flexbox.
- Touch-friendly action buttons, responsive tables, and clean glassmorphism cards.

### 💾 Backend & Database
- **Express.js REST APIs** for authentication, attendance marking, batch operations, reports, and student management.
- **Zero-Dependency Token Security**: Cryptographically signed HMAC-SHA256 bearer tokens.
- **Persistent Dual-Mode Database**: Operates with **SQLite** (`attendance.db`), with an automatic fallback to high-speed persistent JSON (`attendance_data.json`) so the server runs out-of-the-box without requiring native build tools.

---

## 🚀 Quick Start Guide

### 1. Navigate to the project directory
```powershell
cd C:\Users\a\.gemini\antigravity\scratch\attendance-system
```

### 2. Install dependencies
```powershell
npm install
```
*(Dependencies: `express`, `cors`, `sqlite3`)*

### 3. Start the server
```powershell
npm start
```
The server will start at:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🔑 Default Login Credentials

| Role | Username | Password | Notes |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | System Administrator / Department Head |
| **Student 1** | `alex01` | `student123` | Alex Rivera (CS-2024-001) |
| **Student 2** | `sophia02` | `student123` | Sophia Chen (CS-2024-002) |
| **Student 3** | `marcus03` | `student123` | Marcus Vance (CS-2024-003) |
| **Student 4** | `emily04` | `student123` | Emily Patel (CS-2024-004) |

> 💡 **Tip:** On the login page, you can also click the **"Admin Demo"** or **"Student Demo"** quick-fill buttons to auto-populate credentials instantly!

---

## 📡 REST API Reference

### 🔐 Authentication
- `POST /api/auth/login` — Authenticate Admin or Student; returns token and user payload.
- `GET /api/auth/me` — Retrieve active profile information.
- `POST /api/auth/logout` — Invalidate user session.

### 📋 Attendance
- `GET /api/attendance/summary?date=YYYY-MM-DD` — Overall daily turnout statistics.
- `GET /api/attendance/daily?date=YYYY-MM-DD` — List of all students with attendance status for a date.
- `POST /api/attendance/mark` — Mark attendance (Students can self-mark for today; Admins can mark for any student/date).
- `POST /api/attendance/batch-mark` *(Admin)* — Mark all students as Present or Absent for a date.
- `GET /api/attendance/history` — Retrieve student attendance history and attendance percentage.
- `GET /api/attendance/reports?startDate=...&endDate=...&status=...` *(Admin)* — Filtered logs.
- `GET /api/attendance/export-csv` *(Admin)* — Download attendance records as a `.csv` file.

### 👥 Student Directory (Admin Only)
- `GET /api/students` — Retrieve all registered students with attendance rates.
- `POST /api/students` — Register a new student profile.
- `DELETE /api/students/:id` — Delete student profile and all associated logs.

---

## 📁 Project Structure

```
attendance-system/
├── package.json               # Project manifest and scripts
├── server.js                  # Express REST API server & routing
├── database.js                # Dual-mode SQLite / persistent JSON data service
├── README.md                  # Complete documentation
└── public/
    ├── index.html             # Responsive UI (Login, Student & Admin dashboards)
    ├── css/
    │   └── style.css          # Responsive design, status badges, and print layout
    └── js/
        └── app.js             # Client controller, live clock, and REST API calls
```
