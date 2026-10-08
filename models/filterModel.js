const pool = require('../config/db');

const columns = ['name', 'description', 'type', 'preview_url', 'css_filter', 'is_active'];
const select = 'id, name, description, type, preview_url, css_filter, is_active, created_at';

const Filter = {
  async getAllFilters() {
    const [rows] = await pool.query(`SELECT ${select} FROM filters ORDER BY id DESC`);
    return rows;
  },

  async getAllActiveFilters() {
    const [rows] = await pool.query(`SELECT ${select} FROM filters WHERE is_active = 1 ORDER BY id DESC`);
    return rows;
  },

  async getFilterById(id) {
    const [rows] = await pool.query(`SELECT ${select} FROM filters WHERE id = ? LIMIT 1`, [id]);
    return rows[0] || null;
  },

  async createFilter(data) {
    const [result] = await pool.query(
      `INSERT INTO filters (name, description, type, preview_url, css_filter, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.name, data.description || null, data.type, data.preview_url || null, data.css_filter, data.is_active]
    );
    return result;
  },

  async updateFilter(id, data) {
    const updates = columns.filter(column => Object.hasOwn(data, column));
    if (!updates.length) return { affectedRows: 0 };
    const [result] = await pool.query(
      `UPDATE filters SET ${updates.map(column => `\`${column}\` = ?`).join(', ')} WHERE id = ?`,
      [...updates.map(column => data[column]), id]
    );
    return result;
  },

  async deleteFilter(id) {
    const [result] = await pool.query('DELETE FROM filters WHERE id = ?', [id]);
    return result;
  },
};

module.exports = Filter;
