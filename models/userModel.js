const pool = require('../config/db');

let nameColumnPromise;

async function getNameColumn() {
  if (!nameColumnPromise) {
    nameColumnPromise = pool.query(
      `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
          AND COLUMN_NAME IN ('name', 'full_name')
        ORDER BY FIELD(COLUMN_NAME, 'name', 'full_name')
        LIMIT 1`
    ).then(([rows]) => {
      if (!rows[0]) throw new Error("The users table must contain either a 'name' or 'full_name' column");
      return rows[0].COLUMN_NAME;
    }).catch(error => {
      nameColumnPromise = null;
      throw error;
    });
  }
  return nameColumnPromise;
}

function quoteIdentifier(identifier) {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function jsonValue(value) {
  return Array.isArray(value) ? JSON.stringify(value) : value;
}

const User = {
  async findByEmail(email) {
    const nameColumn = quoteIdentifier(await getNameColumn());
    const [rows] = await pool.query(
      `SELECT id, ${nameColumn} AS full_name, email, password_hash, role, partner_name,
              assigned_kiosks, status, created_at, updated_at
         FROM users WHERE email = ? LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const nameColumn = quoteIdentifier(await getNameColumn());
    const [rows] = await pool.query(
      `SELECT id, ${nameColumn} AS full_name, email, password_hash, role, partner_name,
              assigned_kiosks, status, created_at, updated_at
         FROM users WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  async getUserById(id) {
    const nameColumn = quoteIdentifier(await getNameColumn());
    const [rows] = await pool.query(
      `SELECT id, ${nameColumn} AS full_name, email, role, partner_name,
              assigned_kiosks, service_mode, status, notes, created_at, updated_at
         FROM users WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  async getAllUsers() {
    const nameColumn = quoteIdentifier(await getNameColumn());
    const [rows] = await pool.query(
      `SELECT id, ${nameColumn} AS full_name, email, role, partner_name,
              assigned_kiosks, service_mode, status, notes, created_at, updated_at
         FROM users ORDER BY created_at DESC`
    );
    return rows;
  },

  async create(userData) {
    const nameColumn = quoteIdentifier(await getNameColumn());
    const [result] = await pool.query(
      `INSERT INTO users (${nameColumn}, email, password_hash, role, partner_name, assigned_kiosks, service_mode, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userData.full_name || userData.name,
        userData.email,
        userData.password_hash,
        userData.role,
        userData.partner_name || null,
        JSON.stringify(userData.assigned_kiosks || []),
        userData.service_mode || 'Self-managed',
        userData.status || 'Active',
        userData.notes || '',
      ]
    );
    return result;
  },

  async updateUser(id, userData) {
    const nameColumn = await getNameColumn();
    const columns = {
      full_name: nameColumn,
      name: nameColumn,
      email: 'email',
      role: 'role',
      partner_name: 'partner_name',
      assigned_kiosks: 'assigned_kiosks',
      service_mode: 'service_mode',
      status: 'status',
      notes: 'notes',
    };
    const updates = Object.entries(userData)
      .filter(([key]) => Object.hasOwn(columns, key))
      .map(([key, value]) => [quoteIdentifier(columns[key]), jsonValue(value)]);
    if (!updates.length) return { affectedRows: 0 };
    const [result] = await pool.query(
      `UPDATE users SET ${updates.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
      [...updates.map(([, value]) => value), id]
    );
    return result;
  },

  async deleteUser(id) {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
    return result;
  },
};

User.findUserByEmail = User.findByEmail;
User.getNameColumn = getNameColumn;

module.exports = User;
