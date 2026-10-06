"""
Attendance Marker System - Full-Stack Python REST API Server
Built with Python standard library (sqlite3, http.server, hashlib, secrets).
No external pip dependencies required! Runs directly with:
    python server.py
"""

import http.server
import socketserver
import json
import sqlite3
import hashlib
import secrets
import os
import mimetypes
import datetime
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 5000))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DB_FILE = os.path.join(BASE_DIR, "attendance.db")


# ==========================================
# DATABASE INITIALIZATION & SEEDING
# ==========================================
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.sha256((password + salt).encode("utf-8")).hexdigest()
    return hashed, salt


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Create tables
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'student')),
        roll_no TEXT,
        department TEXT,
        semester TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        time_in TEXT,
        status TEXT NOT NULL CHECK(status IN ('Present', 'Absent', 'Late', 'Excused')),
        marked_by TEXT NOT NULL CHECK(marked_by IN ('self', 'admin')),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(user_id, date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    conn.commit()

    # Seed Admin if not exists
    cursor.execute("SELECT id FROM users WHERE email = ?", ("admin@college.edu",))
    if not cursor.fetchone():
        pwd_hash, salt = hash_password("admin123")
        cursor.execute("""
        INSERT INTO users (name, email, password_hash, salt, role, roll_no, department, semester)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            "Admin User",
            "admin@college.edu",
            pwd_hash,
            salt,
            "admin",
            "EMP-001",
            "Department of Administration",
            "Staff"
        ))
        print("[DB] Admin user created: admin@college.edu / admin123")

    # Seed Sample Students if not exists
    sample_students = [
        ("John Doe", "john@student.edu", "CS-2026-01", "Computer Science", "6th Semester"),
        ("Emma Watson", "emma@student.edu", "CS-2026-02", "Computer Science", "6th Semester"),
        ("Alex Rivera", "alex@student.edu", "EC-2026-15", "Electronics Engineering", "4th Semester"),
        ("Sophia Patel", "sophia@student.edu", "IT-2026-08", "Information Technology", "6th Semester"),
        ("Liam Chen", "liam@student.edu", "CS-2026-11", "Computer Science", "6th Semester"),
    ]

    for name, email, roll, dept, sem in sample_students:
        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        if not cursor.fetchone():
            pwd_hash, salt = hash_password("student123")
            cursor.execute("""
            INSERT INTO users (name, email, password_hash, salt, role, roll_no, department, semester)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (name, email, pwd_hash, salt, "student", roll, dept, sem))

    conn.commit()

    # Seed attendance for past 10 days for realistic dashboard analytics
    cursor.execute("SELECT id FROM users WHERE role = 'student'")
    student_ids = [row["id"] for row in cursor.fetchall()]

    today = datetime.date.today()
    for day_offset in range(1, 12):
        past_date = (today - datetime.timedelta(days=day_offset)).strftime("%Y-%m-%d")
        for idx, sid in enumerate(student_ids):
            cursor.execute("SELECT id FROM attendance WHERE user_id = ? AND date = ?", (sid, past_date))
            if not cursor.fetchone():
                # Pseudo-realistic attendance distribution
                if (idx + day_offset) % 7 == 0:
                    status = "Absent"
                    time_in = None
                elif (idx + day_offset) % 5 == 0:
                    status = "Late"
                    time_in = "09:35 AM"
                else:
                    status = "Present"
                    time_in = "09:05 AM"
                cursor.execute("""
                INSERT INTO attendance (user_id, date, time_in, status, marked_by, notes)
                VALUES (?, ?, ?, ?, ?, ?)
                """, (sid, past_date, time_in, status, "admin", "Auto-seeded record"))

    conn.commit()
    conn.close()
    print("[DB] Database initialized and pre-seeded successfully.")


# ==========================================
# AUTH & SESSION HELPERS
# ==========================================
def create_session(user_id, role):
    token = secrets.token_hex(24)
    # Valid for 7 days
    expires_at = (datetime.datetime.now() + datetime.timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)",
                   (token, user_id, role, expires_at))
    conn.commit()
    conn.close()
    return token


def get_user_from_token(token):
    if not token:
        return None
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.user_id, s.role, u.name, u.email, u.roll_no, u.department, u.semester
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now', 'localtime')
    """, (token,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def delete_session(token):
    if not token:
        return
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


# ==========================================
# HTTP REQUEST HANDLER
# ==========================================
class AttendanceRequestHandler(http.server.SimpleHTTPRequestHandler):

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode("utf-8"))

    def get_auth_token(self):
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:].strip()
        return self.headers.get("X-Auth-Token", "").strip()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        raw_body = self.rfile.read(content_length).decode("utf-8")
        try:
            return json.loads(raw_body)
        except Exception:
            return {}

    # ------------------------------------------
    # ROUTE DISPATCHER
    # ------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # Flatten query params
        query_params = {k: v[0] for k, v in params.items()}

        if path.startswith("/api/"):
            self.handle_api_get(path, query_params)
        else:
            self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            body = self.read_json_body()
            self.handle_api_post(path, body)
        else:
            self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        query_params = {k: v[0] for k, v in params.items()}

        if path.startswith("/api/"):
            self.handle_api_delete(path, query_params)
        else:
            self.send_json(404, {"error": "Not found"})

    # ------------------------------------------
    # STATIC FILE SERVER
    # ------------------------------------------
    def serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        safe_path = os.path.normpath(path.lstrip("/"))
        file_path = os.path.join(PUBLIC_DIR, safe_path)

        if os.path.exists(file_path) and os.path.isfile(file_path):
            mime_type, _ = mimetypes.guess_type(file_path)
            if not mime_type:
                mime_type = "application/octet-stream"
            try:
                with open(file_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", f"{mime_type}; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            # Fallback to index.html for Single Page App navigation
            index_path = os.path.join(PUBLIC_DIR, "index.html")
            if os.path.exists(index_path):
                with open(index_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self.send_json(404, {"error": "File not found"})

    # ------------------------------------------
    # API HANDLERS - GET
    # ------------------------------------------
    def handle_api_get(self, path, params):
        token = self.get_auth_token()
        user = get_user_from_token(token)

        # GET /api/me (Current user info)
        if path == "/api/me":
            if not user:
                return self.send_json(401, {"error": "Unauthorized or session expired"})
            return self.send_json(200, {"user": user})

        # --- STUDENT ENDPOINTS ---
        if path == "/api/student/dashboard":
            if not user:
                return self.send_json(401, {"error": "Unauthorized"})
            return self.get_student_dashboard(user["user_id"])

        if path == "/api/student/records":
            if not user:
                return self.send_json(401, {"error": "Unauthorized"})
            return self.get_student_records(user["user_id"], params)

        # --- ADMIN ENDPOINTS ---
        if path.startswith("/api/admin/"):
            if not user or user["role"] != "admin":
                return self.send_json(403, {"error": "Admin access required"})

            if path == "/api/admin/dashboard":
                return self.get_admin_dashboard(params)
            elif path == "/api/admin/attendance":
                return self.get_admin_attendance(params)
            elif path == "/api/admin/students":
                return self.get_admin_students(params)
            elif path == "/api/admin/reports":
                return self.get_admin_reports(params)

        self.send_json(404, {"error": "API route not found"})

    # ------------------------------------------
    # API HANDLERS - POST
    # ------------------------------------------
    def handle_api_post(self, path, body):
        # Public: POST /api/login
        if path == "/api/login":
            return self.handle_login(body)

        token = self.get_auth_token()
        user = get_user_from_token(token)

        # POST /api/logout
        if path == "/api/logout":
            delete_session(token)
            return self.send_json(200, {"message": "Logged out successfully"})

        if not user:
            return self.send_json(401, {"error": "Unauthorized or session expired"})

        # Student Mark Attendance
        if path == "/api/student/mark-attendance":
            return self.mark_student_attendance(user["user_id"], body)

        # Admin Endpoints
        if path.startswith("/api/admin/"):
            if user["role"] != "admin":
                return self.send_json(403, {"error": "Admin access required"})

            if path == "/api/admin/mark-attendance":
                return self.admin_mark_attendance(user["user_id"], body)
            elif path == "/api/admin/mark-all":
                return self.admin_mark_all(user["user_id"], body)
            elif path == "/api/admin/students":
                return self.admin_add_student(body)

        self.send_json(404, {"error": "API route not found"})

    # ------------------------------------------
    # API HANDLERS - DELETE
    # ------------------------------------------
    def handle_api_delete(self, path, params):
        token = self.get_auth_token()
        user = get_user_from_token(token)

        if not user or user["role"] != "admin":
            return self.send_json(403, {"error": "Admin access required"})

        if path == "/api/admin/students":
            student_id = params.get("id")
            if not student_id:
                return self.send_json(400, {"error": "Student ID required"})

            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE id = ? AND role = 'student'", (student_id,))
            cursor.execute("DELETE FROM attendance WHERE user_id = ?", (student_id,))
            conn.commit()
            conn.close()
            return self.send_json(200, {"message": "Student deleted successfully"})

        self.send_json(404, {"error": "API route not found"})

    # ------------------------------------------
    # BUSINESS LOGIC - AUTH
    # ------------------------------------------
    def handle_login(self, body):
        email = body.get("email", "").strip().lower()
        password = body.get("password", "")
        role = body.get("role", "")  # optional filter

        if not email or not password:
            return self.send_json(400, {"error": "Email and password are required"})

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE LOWER(email) = ?", (email,))
        user_row = cursor.fetchone()
        conn.close()

        if not user_row:
            return self.send_json(401, {"error": "Invalid email or password"})

        stored_hash = user_row["password_hash"]
        salt = user_row["salt"]
        computed_hash, _ = hash_password(password, salt)

        if computed_hash != stored_hash:
            return self.send_json(401, {"error": "Invalid email or password"})

        if role and role != user_row["role"]:
            return self.send_json(403, {"error": f"This account is not registered as a {role}"})

        token = create_session(user_row["id"], user_row["role"])
        user_data = {
            "id": user_row["id"],
            "name": user_row["name"],
            "email": user_row["email"],
            "role": user_row["role"],
            "roll_no": user_row["roll_no"],
            "department": user_row["department"],
            "semester": user_row["semester"]
        }
        return self.send_json(200, {
            "message": "Login successful",
            "token": token,
            "user": user_data
        })

    # ------------------------------------------
    # BUSINESS LOGIC - STUDENT
    # ------------------------------------------
    def get_student_dashboard(self, user_id):
        conn = get_db()
        cursor = conn.cursor()

        today_str = datetime.date.today().strftime("%Y-%m-%d")

        # Today's status
        cursor.execute("SELECT * FROM attendance WHERE user_id = ? AND date = ?", (user_id, today_str))
        today_record = cursor.fetchone()
        today_status = dict(today_record) if today_record else None

        # Statistics
        cursor.execute("""
        SELECT 
            COUNT(*) as total_days,
            SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present_days,
            SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END) as absent_days,
            SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) as late_days,
            SUM(CASE WHEN status = 'Excused' THEN 1 ELSE 0 END) as excused_days
        FROM attendance
        WHERE user_id = ?
        """, (user_id,))
        stats_row = dict(cursor.fetchone())

        total = stats_row["total_days"] or 0
        present = stats_row["present_days"] or 0
        late = stats_row["late_days"] or 0
        # Effective presence: present + late counts as attended
        attended = present + late
        percentage = round((attended / total * 100), 1) if total > 0 else 100.0

        # Recent 7 records
        cursor.execute("""
        SELECT id, date, time_in, status, marked_by, notes 
        FROM attendance 
        WHERE user_id = ? 
        ORDER BY date DESC 
        LIMIT 7
        """, (user_id,))
        recent_records = [dict(row) for row in cursor.fetchall()]

        conn.close()

        return self.send_json(200, {
            "today": {
                "date": today_str,
                "record": today_status
            },
            "stats": {
                "total_days": total,
                "present_days": present,
                "absent_days": stats_row["absent_days"] or 0,
                "late_days": late,
                "excused_days": stats_row["excused_days"] or 0,
                "percentage": percentage
            },
            "recent_records": recent_records
        })

    def get_student_records(self, user_id, params):
        conn = get_db()
        cursor = conn.cursor()

        month = params.get("month", "")  # YYYY-MM
        status = params.get("status", "")

        query = "SELECT id, date, time_in, status, marked_by, notes FROM attendance WHERE user_id = ?"
        query_args = [user_id]

        if month:
            query += " AND strftime('%Y-%m', date) = ?"
            query_args.append(month)

        if status:
            query += " AND status = ?"
            query_args.append(status)

        query += " ORDER BY date DESC"

        cursor.execute(query, query_args)
        records = [dict(row) for row in cursor.fetchall()]
        conn.close()

        return self.send_json(200, {"records": records})

    def mark_student_attendance(self, user_id, body):
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        now_time = datetime.datetime.now().strftime("%I:%M %p")
        status_req = body.get("status", "Present")
        notes = body.get("notes", "Marked by Student")

        if status_req not in ["Present", "Late"]:
            status_req = "Present"

        conn = get_db()
        cursor = conn.cursor()

        # Check if already marked today
        cursor.execute("SELECT * FROM attendance WHERE user_id = ? AND date = ?", (user_id, today_str))
        existing = cursor.fetchone()
        if existing:
            conn.close()
            return self.send_json(400, {
                "error": f"Attendance already marked for today ({existing['status']}) at {existing['time_in'] or 'N/A'}"
            })

        cursor.execute("""
        INSERT INTO attendance (user_id, date, time_in, status, marked_by, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, today_str, now_time, status_req, "self", notes))
        conn.commit()

        cursor.execute("SELECT * FROM attendance WHERE user_id = ? AND date = ?", (user_id, today_str))
        record = dict(cursor.fetchone())
        conn.close()

        return self.send_json(200, {
            "message": f"Successfully marked attendance as {status_req}!",
            "record": record
        })

    # ------------------------------------------
    # BUSINESS LOGIC - ADMIN
    # ------------------------------------------
    def get_admin_dashboard(self, params):
        conn = get_db()
        cursor = conn.cursor()

        date_str = params.get("date", datetime.date.today().strftime("%Y-%m-%d"))

        # Total active students
        cursor.execute("SELECT COUNT(*) as total FROM users WHERE role = 'student'")
        total_students = cursor.fetchone()["total"]

        # Today's attendance counts
        cursor.execute("""
        SELECT 
            SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present_count,
            SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent_count,
            SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) as late_count,
            SUM(CASE WHEN a.status = 'Excused' THEN 1 ELSE 0 END) as excused_count
        FROM users u
        LEFT JOIN attendance a ON u.id = a.user_id AND a.date = ?
        WHERE u.role = 'student'
        """, (date_str,))
        today_counts = dict(cursor.fetchone())

        present = today_counts["present_count"] or 0
        late = today_counts["late_count"] or 0
        absent = today_counts["absent_count"] or 0
        excused = today_counts["excused_count"] or 0
        marked_total = present + late + absent + excused
        unmarked = max(0, total_students - marked_total)

        percentage = round(((present + late) / total_students * 100), 1) if total_students > 0 else 0.0

        # Department breakdown
        cursor.execute("""
        SELECT 
            u.department, 
            COUNT(u.id) as student_count,
            SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) as attended_count
        FROM users u
        LEFT JOIN attendance a ON u.id = a.user_id AND a.date = ?
        WHERE u.role = 'student'
        GROUP BY u.department
        """, (date_str,))
        dept_stats = [dict(row) for row in cursor.fetchall()]

        # Recent activities
        cursor.execute("""
        SELECT a.id, a.date, a.time_in, a.status, a.marked_by, a.notes, u.name, u.roll_no, u.department
        FROM attendance a
        JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT 10
        """)
        recent_activity = [dict(row) for row in cursor.fetchall()]

        conn.close()

        return self.send_json(200, {
            "date": date_str,
            "metrics": {
                "total_students": total_students,
                "present": present,
                "absent": absent,
                "late": late,
                "excused": excused,
                "unmarked": unmarked,
                "attendance_percentage": percentage
            },
            "dept_stats": dept_stats,
            "recent_activity": recent_activity
        })

    def get_admin_attendance(self, params):
        conn = get_db()
        cursor = conn.cursor()

        date_str = params.get("date", datetime.date.today().strftime("%Y-%m-%d"))
        dept = params.get("department", "")
        search = params.get("search", "").strip().lower()

        query = """
        SELECT 
            u.id as user_id, u.name, u.email, u.roll_no, u.department, u.semester,
            a.id as attendance_id, a.status, a.time_in, a.marked_by, a.notes, a.updated_at
        FROM users u
        LEFT JOIN attendance a ON u.id = a.user_id AND a.date = ?
        WHERE u.role = 'student'
        """
        args = [date_str]

        if dept:
            query += " AND u.department = ?"
            args.append(dept)

        if search:
            query += " AND (LOWER(u.name) LIKE ? OR LOWER(u.roll_no) LIKE ?)"
            args.extend([f"%{search}%", f"%{search}%"])

        query += " ORDER BY u.roll_no ASC, u.name ASC"

        cursor.execute(query, args)
        rows = [dict(r) for r in cursor.fetchall()]
        conn.close()

        return self.send_json(200, {
            "date": date_str,
            "students": rows
        })

    def admin_mark_attendance(self, admin_id, body):
        user_id = body.get("user_id")
        date_str = body.get("date", datetime.date.today().strftime("%Y-%m-%d"))
        status = body.get("status")  # 'Present', 'Absent', 'Late', 'Excused'
        notes = body.get("notes", "Marked by Admin")

        if not user_id or not status:
            return self.send_json(400, {"error": "user_id and status are required"})

        if status not in ["Present", "Absent", "Late", "Excused"]:
            return self.send_json(400, {"error": "Invalid status value"})

        time_in = datetime.datetime.now().strftime("%I:%M %p") if status in ["Present", "Late"] else None

        conn = get_db()
        cursor = conn.cursor()

        # Check existing
        cursor.execute("SELECT id FROM attendance WHERE user_id = ? AND date = ?", (user_id, date_str))
        existing = cursor.fetchone()

        if existing:
            cursor.execute("""
            UPDATE attendance 
            SET status = ?, time_in = ?, marked_by = 'admin', notes = ?, updated_at = datetime('now', 'localtime')
            WHERE user_id = ? AND date = ?
            """, (status, time_in, notes, user_id, date_str))
        else:
            cursor.execute("""
            INSERT INTO attendance (user_id, date, time_in, status, marked_by, notes)
            VALUES (?, ?, ?, ?, 'admin', ?)
            """, (user_id, date_str, time_in, status, notes))

        conn.commit()

        cursor.execute("SELECT * FROM attendance WHERE user_id = ? AND date = ?", (user_id, date_str))
        updated = dict(cursor.fetchone())
        conn.close()

        return self.send_json(200, {
            "message": "Attendance updated successfully",
            "record": updated
        })

    def admin_mark_all(self, admin_id, body):
        date_str = body.get("date", datetime.date.today().strftime("%Y-%m-%d"))
        status = body.get("status", "Present")
        dept = body.get("department", "")

        conn = get_db()
        cursor = conn.cursor()

        query = "SELECT id FROM users WHERE role = 'student'"
        args = []
        if dept:
            query += " AND department = ?"
            args.append(dept)

        cursor.execute(query, args)
        students = cursor.fetchall()

        now_time = datetime.datetime.now().strftime("%I:%M %p") if status in ["Present", "Late"] else None

        count = 0
        for s in students:
            sid = s["id"]
            cursor.execute("""
            INSERT INTO attendance (user_id, date, time_in, status, marked_by, notes)
            VALUES (?, ?, ?, ?, 'admin', 'Bulk marked by Admin')
            ON CONFLICT(user_id, date) DO UPDATE SET 
                status = excluded.status,
                time_in = excluded.time_in,
                marked_by = 'admin',
                updated_at = datetime('now', 'localtime')
            """, (sid, date_str, now_time, status))
            count += 1

        conn.commit()
        conn.close()

        return self.send_json(200, {
            "message": f"Successfully marked {count} students as '{status}' for {date_str}!"
        })

    def get_admin_students(self, params):
        conn = get_db()
        cursor = conn.cursor()

        search = params.get("search", "").strip().lower()
        dept = params.get("department", "")

        query = """
        SELECT 
            u.id, u.name, u.email, u.roll_no, u.department, u.semester, u.created_at,
            COUNT(a.id) as total_days,
            SUM(CASE WHEN a.status IN ('Present', 'Late') THEN 1 ELSE 0 END) as attended_days
        FROM users u
        LEFT JOIN attendance a ON u.id = a.user_id
        WHERE u.role = 'student'
        """
        args = []

        if dept:
            query += " AND u.department = ?"
            args.append(dept)

        if search:
            query += " AND (LOWER(u.name) LIKE ? OR LOWER(u.roll_no) LIKE ? OR LOWER(u.email) LIKE ?)"
            args.extend([f"%{search}%", f"%{search}%", f"%{search}%"])

        query += " GROUP BY u.id ORDER BY u.name ASC"

        cursor.execute(query, args)
        rows = []
        for r in cursor.fetchall():
            row = dict(r)
            total = row["total_days"] or 0
            attended = row["attended_days"] or 0
            pct = round((attended / total * 100), 1) if total > 0 else 100.0
            row["percentage"] = pct
            rows.append(row)

        conn.close()
        return self.send_json(200, {"students": rows})

    def admin_add_student(self, body):
        name = body.get("name", "").strip()
        email = body.get("email", "").strip().lower()
        password = body.get("password", "student123")
        roll_no = body.get("roll_no", "").strip()
        dept = body.get("department", "Computer Science").strip()
        sem = body.get("semester", "1st Semester").strip()

        if not name or not email or not roll_no:
            return self.send_json(400, {"error": "Name, email, and roll number are required"})

        pwd_hash, salt = hash_password(password)

        conn = get_db()
        cursor = conn.cursor()
        try:
            cursor.execute("""
            INSERT INTO users (name, email, password_hash, salt, role, roll_no, department, semester)
            VALUES (?, ?, ?, ?, 'student', ?, ?, ?)
            """, (name, email, pwd_hash, salt, roll_no, dept, sem))
            conn.commit()
            new_id = cursor.lastrowid
            conn.close()
            return self.send_json(201, {
                "message": "Student created successfully",
                "student": {
                    "id": new_id,
                    "name": name,
                    "email": email,
                    "roll_no": roll_no,
                    "department": dept,
                    "semester": sem
                }
            })
        except sqlite3.IntegrityError:
            conn.close()
            return self.send_json(400, {"error": "A user with this email already exists"})

    def get_admin_reports(self, params):
        conn = get_db()
        cursor = conn.cursor()

        from_date = params.get("from", (datetime.date.today() - datetime.timedelta(days=30)).strftime("%Y-%m-%d"))
        to_date = params.get("to", datetime.date.today().strftime("%Y-%m-%d"))
        dept = params.get("department", "")

        query = """
        SELECT 
            a.id, a.date, a.time_in, a.status, a.marked_by, a.notes,
            u.id as user_id, u.name, u.email, u.roll_no, u.department, u.semester
        FROM attendance a
        JOIN users u ON a.user_id = u.id
        WHERE a.date BETWEEN ? AND ?
        """
        args = [from_date, to_date]

        if dept:
            query += " AND u.department = ?"
            args.append(dept)

        query += " ORDER BY a.date DESC, u.roll_no ASC"

        cursor.execute(query, args)
        records = [dict(r) for r in cursor.fetchall()]
        conn.close()

        return self.send_json(200, {
            "from": from_date,
            "to": to_date,
            "department": dept or "All",
            "total_records": len(records),
            "records": records
        })


def run_server():
    init_db()
    server_address = ("", PORT)
    httpd = socketserver.TCPServer(server_address, AttendanceRequestHandler)
    print(f"============================================================")
    print(f"  Attendance Marker System Server Running!")
    print(f"  URL: http://localhost:{PORT}")
    print(f"  Admin Login:   admin@college.edu / admin123")
    print(f"  Student Login: john@student.edu  / student123")
    print(f"============================================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server shutting down...]")
        httpd.server_close()


if __name__ == "__main__":
    run_server()
