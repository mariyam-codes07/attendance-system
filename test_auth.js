/**
 * Self-Test Script for Authentication, Token Engine & Database
 * Can be run anytime via: node test_auth.js
 */

const crypto = require('crypto');
const db = require('./database');

const SECRET_KEY = process.env.JWT_SECRET || 'attendance-secret-key-deepmind-2024';

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
  const exp = Date.now() + (7 * 24 * 60 * 60 * 1000);
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

    if (signature !== expectedSig) return null;

    const payload = JSON.parse(fromBase64Url(body));
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch (err) {
    return null;
  }
}

async function runSelfTests() {
  console.log('--- Starting Attendance Marker Self-Tests ---');

  // Test 1: Token Engine
  const testPayload = { id: 1, username: 'admin', role: 'admin' };
  const token = createToken(testPayload);
  const verified = verifyToken(token);

  if (verified && verified.username === 'admin' && verified.role === 'admin') {
    console.log('✅ TEST 1 PASSED: Token generation and verification successful.');
  } else {
    console.error('❌ TEST 1 FAILED: Token verification failed.');
  }

  // Test 2: Database Initialization
  try {
    await db.init();
    console.log(`✅ TEST 2 PASSED: Database initialized in ${db.mode.toUpperCase()} mode.`);
  } catch (e) {
    console.error('❌ TEST 2 FAILED: Database initialization error:', e);
  }

  // Test 3: Admin User Lookup & Password Check
  try {
    const adminUser = await db.findUserByUsername('admin');
    if (adminUser && adminUser.password === 'admin123' && adminUser.role === 'admin') {
      console.log('✅ TEST 3 PASSED: Admin account found and password matches (admin/admin123).');
    } else {
      console.error('❌ TEST 3 FAILED: Admin account not found or password incorrect:', adminUser);
    }
  } catch (e) {
    console.error('❌ TEST 3 FAILED: Error finding admin user:', e);
  }

  // Test 4: Student User Lookup & Password Check
  try {
    const studentUser = await db.findUserByUsername('alex01');
    if (studentUser && studentUser.password === 'student123' && studentUser.role === 'student') {
      console.log('✅ TEST 4 PASSED: Student account found and password matches (alex01/student123).');
    } else {
      console.error('❌ TEST 4 FAILED: Student account not found or password incorrect:', studentUser);
    }
  } catch (e) {
    console.error('❌ TEST 4 FAILED: Error finding student user:', e);
  }

  console.log('--- Self-Tests Completed ---');
}

runSelfTests();
