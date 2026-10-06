const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'attendance-secret-key-deepmind-2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ROBUST RFC 7515 COMPLIANT JWT TOKEN ENGINE
// Works universally across all Node.js versions
// ==========================================

function toBase64Url(str) {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function fromBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function createSignature(data) {
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createToken(payload) {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days expiration
  const body = toBase64Url(JSON.stringify({ ...payload, exp }));
  const signature = createSignature(`${header}.${body}`);

  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSig = createSignature(`${header}.${body}`);

    if (signature !== expectedSig) {
      console.warn('[AUTH] Token signature mismatch.');
      return null;
    }

    const payload = JSON.parse(fromBase64Url(body));
    if (payload.exp && Date.now() > payload.exp) {
      console.warn('[AUTH] Token has expired.');
      return null;
    }

    return payload;
  } catch (err) {
    console.error('[AUTH] Token verification exception:', err.message);
    return null;
  }
}

// Authentication Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Access token required. Please log in.' });
  }

  const parts = authHeader.trim().split(/\s+/);
  const token = parts.length === 2 ? parts[1] : parts[0];

  if (!token) {
    return res.status(401).json({ error: 'Access token missing. Please log in.' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
  }

  req.user = decoded;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  }
  next();
}

// ==========================================
// 1. AUTHENTICATION APIS
// ==========================================

// Login for Admin and Student
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const cleanUsername = String(username).trim();
    const cleanPassword = String(password).trim();

    const user = await db.findUserByUsername(cleanUsername);
    if (!user) {
      console.log(`[AUTH] Failed login: User "${cleanUsername}" not found.`);
      return res.status(401).json({ error: 'User not found. Check your username.' });
    }

    if (String(user.password).trim() !== cleanPassword) {
      console.log(`[AUTH] Failed login: Incorrect password for "${cleanUsername}".`);
      return res.status(401).json({ error: 'Invalid password. Please try again.' });
    }

    const tokenPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      roll_number: user.roll_number,
      department: user.department
    };

    const token = createToken(tokenPayload);
    console.log(`[AUTH] Successful login for "${user.username}" (${user.role}).`);

    return res.json({
      message: 'Login successful',
      token,
      user: tokenPayload
    });
  } catch (error) {
    console.error('[AUTH] Login exception:', error);
    return res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

// Current User Profile
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await db.findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const { password, ...safeUser } = user;
    return res.json({ user: safeUser });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
});

// Logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  return res.json({ message: 'Logged out successfully.' });
});

// ==========================================
// 2. ATTENDANCE APIS
// ==========================================

// Overview summary (for Admin dashboard stats)
app.get('/api/attendance/summary', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await db.getOverallSummary(date);
    return res.json(summary);
  } catch (error) {
    console.error('Summary error:', error);
    return res.status(500).json({ error: 'Failed to retrieve attendance summary.' });
  }
});

// Get attendance list for a specific date (Admin or Student view)
app.get('/api/attendance/daily', authMiddleware, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const records = await db.getAttendanceForDate(date);
    return res.json({ date, records });
  } catch (error) {
    console.error('Daily attendance error:', error);
    return res.status(500).json({ error: 'Failed to fetch daily attendance.' });
  }
});

// Mark / Update Attendance
app.post('/api/attendance/mark', authMiddleware, async (req, res) => {
  try {
    let { student_id, date, status, check_in_time, remarks } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (req.user.role === 'student') {
      student_id = req.user.id;
      date = today;
      
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();

      if (!status) {
        // Cutoff time: 09:30 AM
        if (hours < 9 || (hours === 9 && minutes <= 30)) {
          status = 'Present';
        } else {
          status = 'Late';
        }
      }

      if (!check_in_time) {
        check_in_time = now.toLocaleTimeString('en-GB');
      }

      remarks = remarks || 'Self check-in via student portal';
    } else {
      if (!student_id) {
        return res.status(400).json({ error: 'Student ID is required.' });
      }
      date = date || today;
      status = status || 'Present';
      remarks = remarks || 'Marked by Administrator';
    }

    const updatedRecord = await db.markAttendance({
      student_id,
      date,
      status,
      check_in_time,
      remarks,
      marked_by: req.user.role
    });

    return res.json({
      message: `Attendance marked successfully as "${status}".`,
      record: updatedRecord
    });
  } catch (error) {
    console.error('Mark attendance error:', error);
    return res.status(500).json({ error: 'Failed to record attendance.' });
  }
});

// Batch mark attendance for multiple students (Admin Only)
app.post('/api/attendance/batch-mark', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { date, status, student_ids, remarks } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const targetStatus = status || 'Present';

    let ids = student_ids;
    if (!ids || !ids.length) {
      const allStudents = await db.getAllStudents();
      ids = allStudents.map(s => s.id);
    }

    const nowTime = new Date().toLocaleTimeString('en-GB');
    const results = [];

    for (const sid of ids) {
      const rec = await db.markAttendance({
        student_id: sid,
        date: targetDate,
        status: targetStatus,
        check_in_time: targetStatus === 'Absent' ? null : nowTime,
        remarks: remarks || `Batch marked by Admin (${targetStatus})`,
        marked_by: 'admin'
      });
      results.push(rec);
    }

    return res.json({
      message: `Successfully updated attendance for ${results.length} students on ${targetDate}.`,
      count: results.length
    });
  } catch (error) {
    console.error('Batch mark error:', error);
    return res.status(500).json({ error: 'Failed to batch process attendance.' });
  }
});

// Student attendance history & statistics
app.get('/api/attendance/history', authMiddleware, async (req, res) => {
  try {
    let studentId = req.user.id;

    if (req.user.role === 'admin' && req.query.studentId) {
      studentId = req.query.studentId;
    }

    const history = await db.getStudentAttendanceHistory(studentId);
    
    const totalDays = history.length;
    const presentDays = history.filter(h => h.status === 'Present').length;
    const lateDays = history.filter(h => h.status === 'Late').length;
    const absentDays = history.filter(h => h.status === 'Absent').length;
    const excusedDays = history.filter(h => h.status === 'Excused').length;

    const attended = presentDays + lateDays;
    const percentage = totalDays > 0 ? Math.round((attended / totalDays) * 100) : 0;

    const today = new Date().toISOString().split('T')[0];
    const todayRecord = history.find(h => h.date === today) || null;

    return res.json({
      studentId,
      todayStatus: todayRecord,
      statistics: {
        totalDays,
        presentDays,
        lateDays,
        absentDays,
        excusedDays,
        percentage
      },
      history
    });
  } catch (error) {
    console.error('Student history error:', error);
    return res.status(500).json({ error: 'Failed to retrieve attendance history.' });
  }
});

// Filtered report for Admin
app.get('/api/attendance/reports', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { startDate, endDate, studentId, status } = req.query;
    const records = await db.getAllAttendanceRecords({ startDate, endDate, studentId, status });
    return res.json({ records });
  } catch (error) {
    console.error('Report error:', error);
    return res.status(500).json({ error: 'Failed to generate report.' });
  }
});

// CSV Export
app.get('/api/attendance/export-csv', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const records = await db.getAllAttendanceRecords({ startDate, endDate, status });

    const csvHeaders = ['Record ID', 'Date', 'Roll Number', 'Student Name', 'Department', 'Status', 'Check-in Time', 'Remarks', 'Marked By'];
    const csvRows = records.map(r => [
      r.id,
      r.date,
      `"${(r.roll_number || '').replace(/"/g, '""')}"`,
      `"${(r.student_name || '').replace(/"/g, '""')}"`,
      `"${(r.department || '').replace(/"/g, '""')}"`,
      r.status,
      r.check_in_time || '--',
      `"${(r.remarks || '').replace(/"/g, '""')}"`,
      r.marked_by || '--'
    ]);

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_report_${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Failed to export CSV.' });
  }
});

// ==========================================
// 3. STUDENT MANAGEMENT APIS (ADMIN ONLY)
// ==========================================

app.get('/api/students', authMiddleware, adminOnly, async (req, res) => {
  try {
    const students = await db.getAllStudents();
    
    const enriched = await Promise.all(students.map(async (s) => {
      const hist = await db.getStudentAttendanceHistory(s.id);
      const total = hist.length;
      const attended = hist.filter(h => h.status === 'Present' || h.status === 'Late').length;
      const rate = total > 0 ? Math.round((attended / total) * 100) : 100;
      return {
        ...s,
        totalClasses: total,
        attendedClasses: attended,
        attendanceRate: rate
      };
    }));

    return res.json({ students: enriched });
  } catch (error) {
    console.error('Get students error:', error);
    return res.status(500).json({ error: 'Failed to retrieve students list.' });
  }
});

app.post('/api/students', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { username, password, name, roll_number, department } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ error: 'Username, password, and student name are required.' });
    }

    const created = await db.createStudent({
      username: username.trim(),
      password: password.trim(),
      name: name.trim(),
      roll_number: roll_number ? roll_number.trim() : `STU-${Date.now().toString().slice(-4)}`,
      department: department ? department.trim() : 'General'
    });

    return res.status(201).json({
      message: 'Student added successfully.',
      student: created
    });
  } catch (error) {
    console.error('Create student error:', error);
    return res.status(400).json({ error: error.message || 'Failed to create student.' });
  }
});

app.delete('/api/students/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await db.deleteStudent(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Student not found or already deleted.' });
    }
    return res.json({ message: 'Student and attendance records deleted successfully.' });
  } catch (error) {
    console.error('Delete student error:', error);
    return res.status(500).json({ error: 'Failed to delete student.' });
  }
});

// Catch-all route to serve SPA frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function start() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🚀 Attendance Marker Server running on port ${PORT}`);
      console.log(`📡 URL: http://localhost:${PORT}`);
      console.log(`💾 Database Storage Mode: ${db.mode.toUpperCase()}`);
      console.log(`====================================================`);
    });
  } catch (err) {
    console.error('Fatal initialization error:', err);
  }
}

start();
