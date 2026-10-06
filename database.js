const fs = require('fs');
const path = require('path');

// Try requiring sqlite3, otherwise fall back to pure JSON persistent store
let sqlite3 = null;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (e) {
  // SQLite3 native binary not installed yet; will fall back to JSON storage
}

const DB_FILE = path.join(__dirname, 'attendance.db');
const JSON_FILE = path.join(__dirname, 'attendance_data.json');

// Default initial seed users
const initialUsers = [
  {
    id: 1,
    username: 'admin',
    password: 'admin123',
    role: 'admin',
    name: 'Dr. Robert Harrison',
    roll_number: 'ADM-01',
    department: 'Department of Computer Science',
    created_at: new Date().toISOString()
  },
  {
    id: 2,
    username: 'alex01',
    password: 'student123',
    role: 'student',
    name: 'Alex Rivera',
    roll_number: 'CS-2024-001',
    department: 'Computer Science (3rd Year)',
    created_at: new Date().toISOString()
  },
  {
    id: 3,
    username: 'sophia02',
    password: 'student123',
    role: 'student',
    name: 'Sophia Chen',
    roll_number: 'CS-2024-002',
    department: 'Computer Science (3rd Year)',
    created_at: new Date().toISOString()
  },
  {
    id: 4,
    username: 'marcus03',
    password: 'student123',
    role: 'student',
    name: 'Marcus Vance',
    roll_number: 'CS-2024-003',
    department: 'Information Technology (3rd Year)',
    created_at: new Date().toISOString()
  },
  {
    id: 5,
    username: 'emily04',
    password: 'student123',
    role: 'student',
    name: 'Emily Patel',
    roll_number: 'CS-2024-004',
    department: 'Computer Science (3rd Year)',
    created_at: new Date().toISOString()
  }
];

function generateSeedAttendance() {
  const records = [];
  let idCounter = 1;
  const today = new Date();
  
  // Generate past 7 days of realistic attendance
  for (let i = 6; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue; // Skip weekends
    const dateStr = d.toISOString().split('T')[0];

    const studentStatuses = [
      { studentId: 2, status: 'Present', time: '09:05:12', remarks: 'On time' },
      { studentId: 3, status: i === 2 ? 'Late' : 'Present', time: i === 2 ? '09:35:10' : '09:08:44', remarks: i === 2 ? 'Traffic delay' : 'On time' },
      { studentId: 4, status: i === 4 ? 'Absent' : 'Present', time: i === 4 ? null : '08:58:20', remarks: i === 4 ? 'Unexcused' : 'On time' },
      { studentId: 5, status: 'Present', time: '09:02:11', remarks: 'On time' }
    ];

    studentStatuses.forEach(s => {
      records.push({
        id: idCounter++,
        student_id: s.studentId,
        date: dateStr,
        status: s.status,
        check_in_time: s.time,
        remarks: s.remarks,
        marked_by: 'system',
        updated_at: new Date(d).toISOString()
      });
    });
  }

  return records;
}

class DatabaseService {
  constructor() {
    this.mode = sqlite3 ? 'sqlite' : 'json';
    this.db = null;
    this.jsonData = null;
  }

  async init() {
    if (this.mode === 'sqlite') {
      return new Promise((resolve) => {
        this.db = new sqlite3.Database(DB_FILE, (err) => {
          if (err) {
            console.warn('[DB] SQLite connection failed, switching to persistent JSON storage:', err.message);
            this.mode = 'json';
            this.initJson();
            return resolve();
          }

          this.initSqliteSchema()
            .then(resolve)
            .catch((schemaErr) => {
              console.warn('[DB] SQLite schema failed, switching to JSON:', schemaErr.message);
              this.mode = 'json';
              this.initJson();
              resolve();
            });
        });
      });
    } else {
      this.initJson();
      return Promise.resolve();
    }
  }

  initJson() {
    if (fs.existsSync(JSON_FILE)) {
      try {
        const raw = fs.readFileSync(JSON_FILE, 'utf-8');
        this.jsonData = JSON.parse(raw);
        
        // Ensure default initial users are guaranteed present
        if (!Array.isArray(this.jsonData.users)) {
          this.jsonData.users = [];
        }
        for (const u of initialUsers) {
          const idx = this.jsonData.users.findIndex(x => x.username.toLowerCase() === u.username.toLowerCase());
          if (idx === -1) {
            this.jsonData.users.push(u);
          } else {
            // Keep default password and role synchronized
            this.jsonData.users[idx].password = u.password;
            this.jsonData.users[idx].role = u.role;
          }
        }
        this.saveJson();
        console.log('[DB] Loaded data from persistent JSON store:', JSON_FILE);
        return;
      } catch (e) {
        console.error('[DB] Error parsing existing JSON file, resetting seed data:', e);
      }
    }

    this.jsonData = {
      users: [...initialUsers],
      attendance: generateSeedAttendance(),
      nextUserId: 6,
      nextAttendanceId: 100
    };
    this.saveJson();
    console.log('[DB] Initialized fresh JSON database with seed records at:', JSON_FILE);
  }

  saveJson() {
    try {
      fs.writeFileSync(JSON_FILE, JSON.stringify(this.jsonData, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to save JSON database:', err);
    }
  }

  async initSqliteSchema() {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        // 1. Create Users Table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            roll_number TEXT,
            department TEXT,
            created_at TEXT
          )
        `, (userTableErr) => {
          if (userTableErr) return reject(userTableErr);

          // 2. Ensure initial users are populated or updated
          const upsertUser = `
            INSERT INTO users (username, password, role, name, roll_number, department, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
              password = excluded.password,
              role = excluded.role,
              name = excluded.name,
              roll_number = excluded.roll_number,
              department = excluded.department
          `;
          const stmt = this.db.prepare(upsertUser);
          for (const u of initialUsers) {
            stmt.run(u.username, u.password, u.role, u.name, u.roll_number, u.department, u.created_at);
          }
          stmt.finalize((stmtErr) => {
            if (stmtErr) console.warn('[DB] User upsert warning:', stmtErr.message);

            // 3. Create Attendance Table
            this.db.run(`
              CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                date TEXT NOT NULL,
                status TEXT NOT NULL,
                check_in_time TEXT,
                remarks TEXT,
                marked_by TEXT,
                updated_at TEXT,
                UNIQUE(student_id, date),
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
              )
            `, (attTableErr) => {
              if (attTableErr) return reject(attTableErr);

              // 4. Seed attendance records if empty
              this.db.get("SELECT COUNT(*) AS count FROM attendance", (attCountErr, row) => {
                if (!attCountErr && (!row || row.count === 0)) {
                  const seedAtt = generateSeedAttendance();
                  const attStmt = this.db.prepare("INSERT OR REPLACE INTO attendance (student_id, date, status, check_in_time, remarks, marked_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
                  for (const a of seedAtt) {
                    attStmt.run(a.student_id, a.date, a.status, a.check_in_time, a.remarks, a.marked_by, a.updated_at);
                  }
                  attStmt.finalize(() => {
                    console.log('[DB] SQLite database initialized and seeded successfully.');
                    resolve();
                  });
                } else {
                  console.log('[DB] SQLite database initialized successfully.');
                  resolve();
                }
              });
            });
          });
        });
      });
    });
  }

  // --- User Operations ---

  async findUserByUsername(username) {
    if (!username) return null;
    const cleanUsername = String(username).trim();

    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        this.db.get("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", [cleanUsername], (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        });
      });
    } else {
      const user = this.jsonData.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
      return Promise.resolve(user ? { ...user } : null);
    }
  }

  async findUserById(id) {
    const numId = Number(id);
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        this.db.get("SELECT * FROM users WHERE id = ?", [numId], (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        });
      });
    } else {
      const user = this.jsonData.users.find(u => u.id === numId);
      return Promise.resolve(user ? { ...user } : null);
    }
  }

  async getAllStudents() {
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        this.db.all("SELECT id, username, name, roll_number, department, created_at FROM users WHERE role = 'student' ORDER BY roll_number ASC", (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
    } else {
      const students = this.jsonData.users
        .filter(u => u.role === 'student')
        .map(u => ({
          id: u.id,
          username: u.username,
          name: u.name,
          roll_number: u.roll_number,
          department: u.department,
          created_at: u.created_at
        }))
        .sort((a, b) => (a.roll_number || '').localeCompare(b.roll_number || ''));
      return Promise.resolve(students);
    }
  }

  async createStudent({ username, password, name, roll_number, department }) {
    const cleanUsername = String(username).trim();
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        const stmt = this.db.prepare(
          "INSERT INTO users (username, password, role, name, roll_number, department, created_at) VALUES (?, ?, 'student', ?, ?, ?, ?)"
        );
        const now = new Date().toISOString();
        stmt.run(cleanUsername, String(password).trim(), name, roll_number, department, now, function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, username: cleanUsername, role: 'student', name, roll_number, department, created_at: now });
        });
        stmt.finalize();
      });
    } else {
      const exists = this.jsonData.users.some(u => u.username.toLowerCase() === cleanUsername.toLowerCase() || (roll_number && u.roll_number === roll_number));
      if (exists) {
        throw new Error('Username or Roll Number already exists');
      }
      const newStudent = {
        id: this.jsonData.nextUserId++,
        username: cleanUsername,
        password: String(password).trim(),
        role: 'student',
        name,
        roll_number,
        department,
        created_at: new Date().toISOString()
      };
      this.jsonData.users.push(newStudent);
      this.saveJson();
      const { password: _, ...safe } = newStudent;
      return Promise.resolve(safe);
    }
  }

  async deleteStudent(id) {
    const numId = Number(id);
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        this.db.run("DELETE FROM users WHERE id = ? AND role = 'student'", [numId], function(err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        });
      });
    } else {
      const initialLen = this.jsonData.users.length;
      this.jsonData.users = this.jsonData.users.filter(u => !(u.id === numId && u.role === 'student'));
      this.jsonData.attendance = this.jsonData.attendance.filter(a => a.student_id !== numId);
      this.saveJson();
      return Promise.resolve(this.jsonData.users.length < initialLen);
    }
  }

  // --- Attendance Operations ---

  async markAttendance({ student_id, date, status, check_in_time, remarks, marked_by }) {
    const numStudentId = Number(student_id);
    const now = new Date().toISOString();
    const time = check_in_time || new Date().toLocaleTimeString('en-GB');

    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        const query = `
          INSERT INTO attendance (student_id, date, status, check_in_time, remarks, marked_by, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id, date) DO UPDATE SET
            status = excluded.status,
            check_in_time = coalesce(excluded.check_in_time, attendance.check_in_time),
            remarks = excluded.remarks,
            marked_by = excluded.marked_by,
            updated_at = excluded.updated_at
        `;
        this.db.run(query, [numStudentId, date, status, time, remarks || '', marked_by || 'system', now], function(err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, student_id: numStudentId, date, status, check_in_time: time, remarks, marked_by, updated_at: now });
        });
      });
    } else {
      let record = this.jsonData.attendance.find(a => a.student_id === numStudentId && a.date === date);
      if (record) {
        record.status = status;
        if (time) record.check_in_time = time;
        record.remarks = remarks !== undefined ? remarks : record.remarks;
        record.marked_by = marked_by || record.marked_by;
        record.updated_at = now;
      } else {
        record = {
          id: this.jsonData.nextAttendanceId++,
          student_id: numStudentId,
          date,
          status,
          check_in_time: time,
          remarks: remarks || '',
          marked_by: marked_by || 'system',
          updated_at: now
        };
        this.jsonData.attendance.push(record);
      }
      this.saveJson();
      return Promise.resolve({ ...record });
    }
  }

  async getAttendanceForDate(date) {
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        const sql = `
          SELECT 
            u.id AS student_id,
            u.name,
            u.roll_number,
            u.department,
            a.id AS attendance_id,
            a.date,
            coalesce(a.status, 'Not Marked') AS status,
            a.check_in_time,
            a.remarks,
            a.marked_by,
            a.updated_at
          FROM users u
          LEFT JOIN attendance a ON u.id = a.student_id AND a.date = ?
          WHERE u.role = 'student'
          ORDER BY u.roll_number ASC
        `;
        this.db.all(sql, [date], (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
    } else {
      const students = this.jsonData.users.filter(u => u.role === 'student');
      const records = students.map(s => {
        const att = this.jsonData.attendance.find(a => a.student_id === s.id && a.date === date);
        return {
          student_id: s.id,
          name: s.name,
          roll_number: s.roll_number,
          department: s.department,
          attendance_id: att ? att.id : null,
          date,
          status: att ? att.status : 'Not Marked',
          check_in_time: att ? att.check_in_time : null,
          remarks: att ? att.remarks : '',
          marked_by: att ? att.marked_by : null,
          updated_at: att ? att.updated_at : null
        };
      }).sort((a, b) => (a.roll_number || '').localeCompare(b.roll_number || ''));

      return Promise.resolve(records);
    }
  }

  async getStudentAttendanceHistory(studentId) {
    const numId = Number(studentId);
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        const sql = `
          SELECT id, date, status, check_in_time, remarks, marked_by, updated_at
          FROM attendance
          WHERE student_id = ?
          ORDER BY date DESC
        `;
        this.db.all(sql, [numId], (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
    } else {
      const history = this.jsonData.attendance
        .filter(a => a.student_id === numId)
        .sort((a, b) => b.date.localeCompare(a.date));
      return Promise.resolve(history);
    }
  }

  async getAllAttendanceRecords({ startDate, endDate, studentId, status } = {}) {
    if (this.mode === 'sqlite') {
      return new Promise((resolve, reject) => {
        let sql = `
          SELECT 
            a.id, a.date, a.status, a.check_in_time, a.remarks, a.marked_by, a.updated_at,
            u.id as student_id, u.name as student_name, u.roll_number, u.department
          FROM attendance a
          JOIN users u ON a.student_id = u.id
          WHERE 1=1
        `;
        const params = [];
        if (startDate) {
          sql += ` AND a.date >= ?`;
          params.push(startDate);
        }
        if (endDate) {
          sql += ` AND a.date <= ?`;
          params.push(endDate);
        }
        if (studentId) {
          sql += ` AND a.student_id = ?`;
          params.push(Number(studentId));
        }
        if (status) {
          sql += ` AND a.status = ?`;
          params.push(status);
        }
        sql += ` ORDER BY a.date DESC, u.roll_number ASC`;

        this.db.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
    } else {
      let records = this.jsonData.attendance.map(a => {
        const u = this.jsonData.users.find(usr => usr.id === a.student_id) || {};
        return {
          id: a.id,
          date: a.date,
          status: a.status,
          check_in_time: a.check_in_time,
          remarks: a.remarks,
          marked_by: a.marked_by,
          updated_at: a.updated_at,
          student_id: a.student_id,
          student_name: u.name || 'Unknown',
          roll_number: u.roll_number || '',
          department: u.department || ''
        };
      });

      if (startDate) records = records.filter(r => r.date >= startDate);
      if (endDate) records = records.filter(r => r.date <= endDate);
      if (studentId) records = records.filter(r => r.student_id === Number(studentId));
      if (status) records = records.filter(r => r.status.toLowerCase() === status.toLowerCase());

      records.sort((a, b) => b.date.localeCompare(a.date));
      return Promise.resolve(records);
    }
  }

  async getOverallSummary(dateStr) {
    const today = dateStr || new Date().toISOString().split('T')[0];
    const students = await this.getAllStudents();
    const todayRecords = await this.getAttendanceForDate(today);

    const totalStudents = students.length;
    let presentCount = 0;
    let lateCount = 0;
    let absentCount = 0;
    let notMarkedCount = 0;

    todayRecords.forEach(r => {
      const s = (r.status || '').toLowerCase();
      if (s === 'present') presentCount++;
      else if (s === 'late') lateCount++;
      else if (s === 'absent') absentCount++;
      else notMarkedCount++;
    });

    const activeAttendees = presentCount + lateCount;
    const rate = totalStudents > 0 ? Math.round((activeAttendees / totalStudents) * 100) : 0;

    return {
      date: today,
      totalStudents,
      presentToday: presentCount,
      lateToday: lateCount,
      absentToday: absentCount,
      notMarkedToday: notMarkedCount,
      attendancePercentage: rate,
      mode: this.mode
    };
  }
}

const dbInstance = new DatabaseService();
module.exports = dbInstance;
