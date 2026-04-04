'use strict';

module.exports = {
  PORT:        process.env.PORT    || 3003,
  DB_PATH:     process.env.DB_PATH || './data/peava.db',
  SESSION_TTL: 8 * 60 * 60 * 1000,   // 8 hours in ms
  BACKUP_DIR:  './data/backups',
  UPLOADS_DIR: './uploads',
  SALT:        'peava_salt_2024',      // preserved — existing users' PINs stay valid
  SMTP: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },
  SMS: {
    url: process.env.SMS_URL || '',
    key: process.env.SMS_KEY || ''
  }
};
