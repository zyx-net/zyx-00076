const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class Archive {
  static create({ contract_id, archived_by, content }) {
    const id = uuidv4();
    const now = Date.now();
    const dateStr = new Date(now).toISOString().slice(0, 10).replace(/-/g, '');
    const archiveNo = `ARCH-${dateStr}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    
    const archiveDir = path.resolve(__dirname, '../../data/archives');
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }
    
    const fileName = `${archiveNo}.json`;
    const filePath = path.join(archiveDir, fileName);
    
    const fileContent = JSON.stringify(content, null, 2);
    const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
    fs.writeFileSync(filePath, fileContent);
    const fileSize = fs.statSync(filePath).size;
    
    const stmt = db.prepare(`
      INSERT INTO archives (id, contract_id, archive_no, file_path, file_hash, archived_by, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, contract_id, archiveNo, filePath, fileHash, archived_by, now);
    
    return { id, archive_no: archiveNo, file_path: filePath, file_hash: fileHash, file_size: fileSize, archived_at: now };
  }

  static findById(id) {
    return db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
  }

  static findByContract(contract_id) {
    return db.prepare('SELECT * FROM archives WHERE contract_id = ?').get(contract_id);
  }

  static findByNo(archive_no) {
    return db.prepare('SELECT * FROM archives WHERE archive_no = ?').get(archive_no);
  }

  static findAll() {
    return db.prepare('SELECT * FROM archives ORDER BY archived_at DESC').all();
  }

  static loadContent(archive_no) {
    const archive = this.findByNo(archive_no);
    if (!archive) return null;
    
    if (fs.existsSync(archive.file_path)) {
      const rawContent = fs.readFileSync(archive.file_path, 'utf8');
      const content = JSON.parse(rawContent);
      const fileHash = crypto.createHash('sha256').update(rawContent).digest('hex');
      return {
        ...archive,
        content,
        is_valid: fileHash === archive.file_hash
      };
    }
    return null;
  }

  static verify(archive_no) {
    const archive = this.findByNo(archive_no);
    if (!archive) return { valid: false, reason: 'Archive not found' };
    if (!fs.existsSync(archive.file_path)) return { valid: false, reason: 'File not found' };
    
    const content = fs.readFileSync(archive.file_path, 'utf8');
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');
    
    return {
      valid: fileHash === archive.file_hash,
      expected_hash: archive.file_hash,
      actual_hash: fileHash
    };
  }
}

module.exports = Archive;
